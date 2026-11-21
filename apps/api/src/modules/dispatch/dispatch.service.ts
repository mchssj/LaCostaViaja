import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  backhaulMatch,
  DISPATCHABLE_STATUSES,
  DispatchConflictError,
  DriverNotOnShiftError,
  haversineMeters,
  NotFoundError,
  rankCandidates,
  type CandidateBackhaul,
  type CorridorDirection,
  type DispatchCandidate,
  type FareQuote,
  type GeoPoint,
  type RankedCandidate,
  type TripStatus,
} from '@lacosta/domain';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { RedisStateStore, type DriverState } from '../../redis/redis-state.store';
import { FareCalculatorService } from '../fares/fare-calculator.service';
import { DriverPresenceService } from '../presence/driver-presence.service';
import { GeoIndexService } from '../presence/geo-index.service';
import { ROUTING_PROVIDER, type IRoutingProvider } from '../routing/routing.types';
import { DispatchEvents } from './dispatch.events';
import { DispatchRepository, type DispatchTrip } from './dispatch.repository';

/** Rondas de búsqueda: se amplía la ventana sobre RP11 y el radio geográfico en cada una. */
export const DISPATCH_ROUNDS = [
  { corridorWindowMeters: 4_000, geoRadiusMeters: 2_500 },
  { corridorWindowMeters: 10_000, geoRadiusMeters: 6_000 },
  { corridorWindowMeters: 25_000, geoRadiusMeters: 15_000 },
] as const;

/** Cuántos candidatos (los más cercanos) pasan a pedir ETA al proveedor de ruteo. */
const ETA_CANDIDATES = 8;
/** Choferes en Viaje de Vuelta que coinciden con el viaje: se suman aunque estén más lejos. */
const EXTRA_BACKHAUL_CANDIDATES = 4;
const SOURCE_LIMIT = 60;
const DIRECTION_EPSILON_METERS = 50;
const FALLBACK_SPEED_KMH = 30;
const FALLBACK_DETOUR = 1.3;

export type AdvanceOutcome =
  | { readonly kind: 'OFFERED'; readonly driverId: string; readonly offerId: string; readonly round: number; readonly rank: number; readonly scoreSeconds: number }
  | { readonly kind: 'WAITING_OFFER' }
  | { readonly kind: 'LEASE_HELD' }
  | { readonly kind: 'ALREADY_TAKEN' }
  | { readonly kind: 'NOT_SEARCHING'; readonly status: TripStatus | null }
  | { readonly kind: 'NO_CANDIDATES_YET'; readonly round: number }
  | { readonly kind: 'NO_DRIVER' };

export interface AcceptResult {
  readonly tripId: string;
  readonly driverId: string;
  readonly vehicleId: string;
  /** La misma aceptación llegó dos veces (reintento de la app): no se hizo nada nuevo. */
  readonly idempotent: boolean;
  readonly isBackhaul: boolean;
  readonly fareCents: number;
  readonly repriced: boolean;
}

interface TripContext {
  readonly originPositionMeters: number;
  readonly zoneId: string | null;
  readonly direction: CorridorDirection;
  readonly destinationLocalityId: string;
}

/**
 * Despacho: busca candidatos (cola de parada + ventana sobre RP11 + GEOSEARCH), los ordena con
 * rankCandidates(), ofrece el viaje a uno por vez y asigna con lock atómico en Redis + confirmación
 * en PostgreSQL. Sin estado propio: cualquier réplica puede retomar cualquier viaje.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);
  private readonly inFlight = new Map<string, Promise<AdvanceOutcome>>();
  private readonly rerun = new Set<string>();
  readonly instanceId: string;

  constructor(
    private readonly store: RedisStateStore,
    private readonly presence: DriverPresenceService,
    private readonly geo: GeoIndexService,
    private readonly repo: DispatchRepository,
    private readonly events: DispatchEvents,
    private readonly fares: FareCalculatorService,
    @Inject(ROUTING_PROVIDER) private readonly routing: IRoutingProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.instanceId = config.dispatch.instanceId;
  }

  /** Pone el viaje en búsqueda y hace la primera oferta. Lo llama la creación del viaje (Fase 3). */
  async startDispatch(tripId: string): Promise<AdvanceOutcome> {
    const trip = await this.repo.startSearching(tripId);
    if (!trip) {
      const current = await this.repo.loadTrip(tripId);
      if (!current) throw new NotFoundError('Viaje inexistente', { tripId });
      return { kind: 'NOT_SEARCHING', status: current.status };
    }
    return this.advance(tripId);
  }

  /** Avanza la búsqueda de un viaje. Serializado por viaje dentro de la réplica y con lease entre réplicas. */
  advance(tripId: string): Promise<AdvanceOutcome> {
    const running = this.inFlight.get(tripId);
    if (running) {
      this.rerun.add(tripId);
      return running;
    }
    const p = this.doAdvance(tripId).finally(() => {
      this.inFlight.delete(tripId);
      if (this.rerun.delete(tripId)) {
        this.advance(tripId).catch((err: Error) => this.logger.error(`advance(${tripId}): ${err.message}`));
      }
    });
    this.inFlight.set(tripId, p);
    return p;
  }

  private async doAdvance(tripId: string): Promise<AdvanceOutcome> {
    const lease = await this.store.acquireLease(tripId, this.instanceId, this.config.dispatch.leaseTtlMs);
    if (lease === 'HELD') return { kind: 'LEASE_HELD' };
    try {
      const trip = await this.repo.loadTrip(tripId);
      if (!trip || trip.status !== 'SEARCHING') return { kind: 'NOT_SEARCHING', status: trip?.status ?? null };
      if (await this.store.currentOffer(tripId)) return { kind: 'WAITING_OFFER' };
      if (await this.store.tripLockOwner(tripId)) return { kind: 'ALREADY_TAKEN' };

      const now = this.clock.now().getTime();
      const startedAt = trip.dispatchStartedAt?.getTime() ?? now;
      if (now - startedAt >= this.config.dispatch.maxSearchMs) return this.noDriver(tripId);

      const history = await this.repo.offerHistory(tripId);
      const ctx = this.tripContext(trip);
      for (let round = Math.max(1, trip.dispatchRound); round <= DISPATCH_ROUNDS.length; round++) {
        const isLastRound = round === DISPATCH_ROUNDS.length;
        // En la última ronda no hay tope: se sigue ofreciendo a choferes nuevos hasta el límite de tiempo.
        if (!isLastRound && (history.countByRound.get(round) ?? 0) >= this.config.dispatch.maxOffersPerRound) continue;
        const ranked = await this.findCandidates(trip, ctx, round, history.offeredDriverIds);
        for (const [i, candidate] of ranked.entries()) {
          const outcome = await this.tryOffer(trip, candidate, round, i + 1, now);
          if (outcome) {
            if (outcome.kind === 'OFFERED' && round > trip.dispatchRound) await this.repo.setRound(tripId, round);
            return outcome;
          }
        }
      }
      if (trip.dispatchRound < DISPATCH_ROUNDS.length) await this.repo.setRound(tripId, DISPATCH_ROUNDS.length);
      return { kind: 'NO_CANDIDATES_YET', round: DISPATCH_ROUNDS.length };
    } finally {
      await this.store.releaseLease(tripId, this.instanceId).catch(() => undefined);
    }
  }

  private async tryOffer(trip: DispatchTrip, c: RankedCandidate, round: number, rank: number, now: number): Promise<AdvanceOutcome | null> {
    const offerId = randomUUID();
    const expiresAt = now + this.config.dispatch.offerTimeoutMs;
    const r = await this.store.offerTrip(trip.id, c.driverId, offerId, expiresAt, this.config.dispatch.offerTimeoutMs + 60_000);
    if (r === 'DRIVER_UNAVAILABLE') return null; // le llegó otra oferta o cambió de estado: siguiente candidato
    if (r === 'OFFER_PENDING') return { kind: 'WAITING_OFFER' };
    if (r === 'ALREADY_TAKEN') return { kind: 'ALREADY_TAKEN' };
    try {
      await this.repo.insertOffer({
        id: offerId,
        tripId: trip.id,
        driverId: c.driverId,
        vehicleId: c.vehicleId,
        round,
        rank,
        scoreSeconds: c.scoreSeconds,
        etaSeconds: c.etaSeconds,
        backhaulMatch: c.backhaulMatch,
        breakdown: c.breakdown,
        expiresAt: new Date(expiresAt),
        instanceId: this.instanceId,
      });
    } catch (err) {
      // Sin registro auditable no hay oferta: se deshace en Redis.
      await this.store.respondOffer(trip.id, c.driverId, offerId, now, false, this.config.dispatch.rejectionWindowMs);
      if ((err as { code?: string }).code === '23505') return { kind: 'WAITING_OFFER' };
      throw err;
    }
    this.events.emit('offer.created', {
      tripId: trip.id,
      driverId: c.driverId,
      offerId,
      expiresAt,
      etaSeconds: c.etaSeconds,
      round,
      rank,
      backhaulMatch: c.backhaulMatch,
    });
    return { kind: 'OFFERED', driverId: c.driverId, offerId, round, rank, scoreSeconds: c.scoreSeconds };
  }

  private tripContext(trip: DispatchTrip): TripContext {
    const index = this.geo.require();
    const originPositionMeters = index.corridorPosition(trip.origin).positionMeters;
    const destinationPositionMeters = index.corridorPosition(trip.destination).positionMeters;
    const delta = destinationPositionMeters - originPositionMeters;
    return {
      originPositionMeters,
      zoneId: index.zoneAt(trip.origin)?.id ?? null,
      direction: delta > DIRECTION_EPSILON_METERS ? 'SOUTHBOUND' : delta < -DIRECTION_EPSILON_METERS ? 'NORTHBOUND' : 'NONE',
      destinationLocalityId: trip.destinationLocalityId,
    };
  }

  /** Candidatos ordenados para una ronda (excluye a quienes ya recibieron una oferta de este viaje). */
  async findCandidates(trip: DispatchTrip, ctx: TripContext, round: number, exclude: ReadonlySet<string>): Promise<RankedCandidate[]> {
    const window = DISPATCH_ROUNDS[round - 1];
    if (!window) return [];
    const ids = (
      await this.store.candidateIds({
        service: trip.serviceType,
        origin: trip.origin,
        corridorPositionMeters: ctx.originPositionMeters,
        corridorWindowMeters: window.corridorWindowMeters,
        geoRadiusMeters: window.geoRadiusMeters,
        zoneId: ctx.zoneId,
        limitPerSource: SOURCE_LIMIT,
      })
    ).filter((id) => !exclude.has(id));
    if (ids.length === 0) return [];

    const now = this.clock.now().getTime();
    const staleMs = this.config.dispatch.heartbeatStaleMs;
    const usable = (await this.store.getDrivers(ids)).filter(
      (s) =>
        DISPATCHABLE_STATUSES.includes(s.status) &&
        s.serviceType === trip.serviceType &&
        s.position !== null &&
        s.corridorPositionMeters !== null &&
        now - (s.lastSeenAt ?? 0) <= staleMs &&
        (trip.scope !== 'INTERURBAN' || s.acceptsInterurban),
    );
    const eligible = await this.presence.filterEligible(usable);
    if (eligible.length === 0) return [];

    const tripCtx = { destinationLocalityId: ctx.destinationLocalityId, direction: ctx.direction };
    const byDistance = eligible
      .map((s) => ({
        s,
        corridorDistance: Math.abs((s.corridorPositionMeters ?? 0) - ctx.originPositionMeters),
        straight: haversineMeters(s.position!, trip.origin),
      }))
      .sort(
        (a, b) =>
          Math.max(a.corridorDistance, a.straight) - Math.max(b.corridorDistance, b.straight) ||
          a.s.driverId.localeCompare(b.s.driverId),
      );
    const nearest = byDistance.slice(0, ETA_CANDIDATES);
    const backhaulExtras = byDistance
      .slice(ETA_CANDIDATES)
      .filter((c) => backhaulMatch(this.backhaulOf(c.s), tripCtx) !== null)
      .slice(0, EXTRA_BACKHAUL_CANDIDATES);
    const shortlist = [...nearest, ...backhaulExtras];
    const shortIds = shortlist.map((c) => c.s.driverId);

    const [etas, queue, rejections] = await Promise.all([
      Promise.all(shortlist.map((c) => this.eta(c.s.position!, trip.origin))),
      this.store.queuePositions(ctx.zoneId, shortIds),
      this.store.recentRejections(shortIds, now - this.config.dispatch.rejectionWindowMs),
    ]);

    const candidates: DispatchCandidate[] = shortlist.map((c, i) => ({
      driverId: c.s.driverId,
      vehicleId: c.s.vehicleId,
      etaSeconds: etas[i]!,
      corridorDistanceMeters: Math.round(c.corridorDistance),
      idleSeconds: c.s.availableSince !== null ? Math.max(0, (now - c.s.availableSince) / 1000) : 0,
      recentRejections: rejections.get(c.s.driverId) ?? 0,
      queuePosition: queue.get(c.s.driverId) ?? null,
      backhaul: this.backhaulOf(c.s),
    }));
    return rankCandidates(candidates, tripCtx);
  }

  private backhaulOf(s: DriverState): CandidateBackhaul | null {
    const returning = s.status === 'RETURNING' || (s.status === 'OFFERED' && s.prevStatus === 'RETURNING');
    return returning && s.returnToLocalityId && s.returnDirection
      ? { baseLocalityId: s.returnToLocalityId, returnDirection: s.returnDirection }
      : null;
  }

  private async eta(from: GeoPoint, to: GeoPoint): Promise<number> {
    try {
      return Math.round((await this.routing.route({ origin: from, destination: to })).durationSeconds);
    } catch {
      return Math.round((haversineMeters(from, to) * FALLBACK_DETOUR) / (FALLBACK_SPEED_KMH / 3.6));
    }
  }

  /** El chofer acepta la oferta. Exactamente un ganador por viaje, aunque lleguen aceptaciones en paralelo. */
  async accept(tripId: string, driverId: string, offerId: string): Promise<AcceptResult> {
    const before = await this.store.getDriver(driverId);
    if (!before) throw new DriverNotOnShiftError(driverId);
    const now = this.clock.now().getTime();
    const claim = await this.store.claimTrip(tripId, driverId, offerId, now, this.config.dispatch.tripLockTtlMs);

    if (claim === 'ALREADY_YOURS') {
      const t = await this.repo.loadTrip(tripId);
      if (t?.status === 'ASSIGNED' && t.driverId === driverId) {
        return {
          tripId,
          driverId,
          vehicleId: t.vehicleId ?? before.vehicleId,
          idempotent: true,
          isBackhaul: t.isBackhaulAssignment,
          fareCents: t.quotedFareCents,
          repriced: false,
        };
      }
      throw new DispatchConflictError('CLAIM_FAILED', 'La asignación de este viaje todavía se está confirmando', { tripId });
    }
    if (claim !== 'OK') {
      const t = await this.repo.loadTrip(tripId);
      if (t?.status.startsWith('CANCELLED')) throw new DispatchConflictError('TRIP_CANCELLED', 'El pasajero canceló el viaje', { tripId });
      if (claim === 'ALREADY_TAKEN') throw new DispatchConflictError('ALREADY_TAKEN', 'El viaje ya fue asignado a otro chofer', { tripId });
      throw new DispatchConflictError('OFFER_EXPIRED', 'La oferta venció o ya no es tuya', { tripId });
    }

    try {
      const trip = await this.repo.loadTrip(tripId);
      if (!trip) throw new NotFoundError('Viaje inexistente', { tripId });
      const ctx = this.tripContext(trip);
      const match = backhaulMatch(this.backhaulOf(before), { destinationLocalityId: trip.destinationLocalityId, direction: ctx.direction });
      const repriced = match === 'HOME' && trip.scope === 'INTERURBAN' ? await this.reprice(trip, before.baseLocalityId) : null;
      const ok = await this.repo.assign({ tripId, driverId, vehicleId: before.vehicleId, offerId, isBackhaul: match !== null, repriced });
      if (!ok) {
        const t = await this.repo.loadTrip(tripId);
        if (t?.status.startsWith('CANCELLED')) throw new DispatchConflictError('TRIP_CANCELLED', 'El pasajero canceló el viaje', { tripId });
        throw new DispatchConflictError('TRIP_NOT_SEARCHING', 'El viaje ya no está en búsqueda', { tripId, status: t?.status });
      }
      const after = await this.store.getDriver(driverId);
      if (after) await this.store.unindex(after);
      const fareCents = repriced?.totalCents ?? trip.quotedFareCents;
      this.events.emit('trip.assigned', { tripId, driverId, vehicleId: before.vehicleId, isBackhaul: match !== null, fareCents, repriced: repriced !== null });
      return { tripId, driverId, vehicleId: before.vehicleId, idempotent: false, isBackhaul: match !== null, fareCents, repriced: repriced !== null };
    } catch (err) {
      // Compensación: PostgreSQL no confirmó → se deshace el lock de Redis y se sigue buscando.
      await this.store.releaseClaim(tripId, driverId);
      if (await this.repo.closeOffer(offerId, 'CLAIM_FAILED').catch(() => false)) {
        this.events.emit('offer.closed', { tripId, driverId, offerId, outcome: 'CLAIM_FAILED' });
      }
      this.advance(tripId).catch((e: Error) => this.logger.error(`advance(${tripId}) tras falla de asignación: ${e.message}`));
      if (err instanceof DispatchConflictError || err instanceof NotFoundError) throw err;
      throw new DispatchConflictError('CLAIM_FAILED', `La base rechazó la asignación: ${(err as Error).message}`, { tripId });
    }
  }

  /** Recotiza con la bonificación de Viaje de Vuelta. Solo se aplica si baja la tarifa; si falla, se mantiene la original. */
  private async reprice(trip: DispatchTrip, driverBaseLocalityId: string): Promise<FareQuote | null> {
    try {
      const quote = await this.fares.quote({
        origin: trip.origin,
        destination: trip.destination,
        serviceType: trip.serviceType,
        pricingInstant: trip.pricingInstant,
        assignedDriverBaseLocalityId: driverBaseLocalityId,
      });
      return quote.totalCents < trip.quotedFareCents ? quote : null;
    } catch (err) {
      this.logger.warn(`No se pudo recotizar el Viaje de Vuelta de ${trip.id}: ${(err as Error).message}`);
      return null;
    }
  }

  async reject(tripId: string, driverId: string, offerId: string): Promise<AdvanceOutcome> {
    const now = this.clock.now().getTime();
    const r = await this.store.respondOffer(tripId, driverId, offerId, now, true, this.config.dispatch.rejectionWindowMs);
    if (r !== 'OK') throw new DispatchConflictError('OFFER_EXPIRED', 'La oferta venció o ya no es tuya', { tripId });
    if (await this.repo.closeOffer(offerId, 'REJECTED')) this.events.emit('offer.closed', { tripId, driverId, offerId, outcome: 'REJECTED' });
    return this.advance(tripId);
  }

  /** Procesa ofertas vencidas (cada una la toma una sola réplica) y pasa al siguiente candidato. */
  async expireDueOffers(): Promise<number> {
    const now = this.clock.now().getTime();
    const due = await this.store.popExpiredOffers(now);
    let expired = 0;
    for (const { tripId, driverId, offerId } of due) {
      const r = await this.store.respondOffer(tripId, driverId, offerId, now, true, this.config.dispatch.rejectionWindowMs);
      if (r !== 'OK') continue; // se aceptó o canceló justo antes
      expired++;
      if (await this.repo.closeOffer(offerId, 'EXPIRED')) this.events.emit('offer.closed', { tripId, driverId, offerId, outcome: 'EXPIRED' });
      await this.advance(tripId).catch((err: Error) => this.logger.error(`advance(${tripId}) tras vencimiento: ${err.message}`));
    }
    return expired;
  }

  /** Cancelación del pasajero mientras se busca chofer: se retira la oferta abierta. */
  async cancelSearching(tripId: string, reason = 'Cancelado por el pasajero durante la búsqueda'): Promise<boolean> {
    const cancelled = await this.repo.cancelSearching(tripId, reason);
    const offer = await this.store.currentOffer(tripId);
    if (offer) {
      const now = this.clock.now().getTime();
      const r = await this.store.respondOffer(tripId, offer.driverId, offer.offerId, now, false, this.config.dispatch.rejectionWindowMs);
      if (r === 'OK' && (await this.repo.closeOffer(offer.offerId, 'CANCELLED'))) {
        this.events.emit('offer.closed', { tripId, driverId: offer.driverId, offerId: offer.offerId, outcome: 'CANCELLED' });
      }
    }
    return cancelled;
  }

  /** Retoma viajes en búsqueda sin oferta abierta (réplica caída, choferes nuevos, tope de tiempo). */
  async resumeSearching(limit = 100): Promise<number> {
    const ids = await this.repo.searchingTripIds(limit);
    let advanced = 0;
    for (const id of ids) {
      try {
        const outcome = await this.advance(id);
        if (outcome.kind === 'OFFERED' || outcome.kind === 'NO_DRIVER') advanced++;
      } catch (err) {
        this.logger.error(`resume(${id}): ${(err as Error).message}`);
      }
    }
    return advanced;
  }

  private async noDriver(tripId: string): Promise<AdvanceOutcome> {
    if (await this.repo.markNoDriver(tripId)) this.events.emit('trip.no_driver', { tripId });
    return { kind: 'NO_DRIVER' };
  }
}
