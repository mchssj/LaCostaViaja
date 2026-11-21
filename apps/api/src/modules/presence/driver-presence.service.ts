import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  assertValidGeoPoint,
  classifyPing,
  DEFAULT_PING_LIMITS,
  DISPATCHABLE_STATUSES,
  DispatchConflictError,
  DriverNotEligibleError,
  DriverNotOnShiftError,
  InvalidInputError,
  type CorridorDirection,
  type DriverPresenceStatus,
  type GpsPing,
  type LastFix,
} from '@lacosta/domain';
import { CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { RedisStateStore, type DriverState, type PositionUpdate, type TrackEntry } from '../../redis/redis-state.store';
import { GeoIndexService } from './geo-index.service';
import { PresenceRepository } from './presence.repository';

export const MAX_PINGS_PER_BATCH = 500;

export interface IngestSummary {
  readonly applied: number;
  readonly heartbeatOnly: number;
  readonly stale: number;
  readonly invalid: number;
  readonly tracked: number;
  readonly suspiciousJumps: number;
  readonly status: DriverPresenceStatus;
  readonly returningEnded: boolean;
}

/**
 * Turno y presencia del chofer: habilitación al iniciar, ingesta de pings (en lotes, tolerando
 * reintentos y datos guardados sin señal), cola de parada, Viaje de Vuelta y barrido de desconectados.
 */
@Injectable()
export class DriverPresenceService {
  private readonly logger = new Logger(DriverPresenceService.name);

  constructor(
    private readonly store: RedisStateStore,
    private readonly geo: GeoIndexService,
    private readonly repo: PresenceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Abre el turno. Exige habilitación vigente del par chofer↔vehículo. */
  async startShift(driverId: string, vehicleId: string): Promise<DriverState> {
    const eligibility = await this.repo.eligibility(driverId, vehicleId);
    if (!eligibility) throw new DriverNotEligibleError(['SIN_AUTORIZACION_PARA_EL_VEHICULO'], { driverId, vehicleId });
    if (!eligibility.isEligible) throw new DriverNotEligibleError(eligibility.blockingReasons, { driverId, vehicleId });

    const now = this.clock.now().getTime();
    const fields = {
      status: 'AVAILABLE',
      vehicleId,
      serviceType: eligibility.serviceType,
      baseLocalityId: eligibility.baseLocalityId,
      acceptsInterurban: eligibility.acceptsInterurban ? '1' : '0',
      shiftStartedAt: now,
      availableSince: now,
      eligibleCheckedAt: now,
      lastSeenAt: now,
    };
    let result = await this.store.openShift(driverId, vehicleId, fields);
    if (result === 'OTHER_VEHICLE') {
      // Cambió de auto sin cerrar el turno anterior (y no está en viaje): se cierra el viejo.
      const previous = await this.store.getDriver(driverId);
      if (previous) await this.store.closeShift(previous, false);
      result = await this.store.openShift(driverId, vehicleId, fields);
    }
    if (result === 'VEHICLE_IN_USE') {
      throw new DispatchConflictError('VEHICLE_IN_USE', 'El vehículo ya está en turno con otro chofer', { driverId, vehicleId });
    }
    if (result === 'DRIVER_BUSY' || result === 'OTHER_VEHICLE') {
      throw new DispatchConflictError('DRIVER_BUSY', 'El chofer tiene un viaje u oferta en curso con otro vehículo', { driverId });
    }
    const state = await this.store.getDriver(driverId);
    if (!state) throw new Error(`No se pudo abrir el turno de ${driverId}`);
    await this.store.applyPosition(state, null, now, 0); // entra al barrido aunque nunca mande un ping
    if (result === 'OK' && state.position) await this.store.reindex(state, now);
    return state;
  }

  async endShift(driverId: string): Promise<void> {
    const state = await this.store.getDriver(driverId);
    if (!state) return;
    const r = await this.store.closeShift(state, false);
    if (r === 'BUSY') {
      throw new DispatchConflictError('DRIVER_BUSY', 'No se puede cerrar el turno con una oferta o un viaje en curso', {
        driverId,
        status: state.status,
      });
    }
  }

  async getState(driverId: string): Promise<DriverState | null> {
    return this.store.getDriver(driverId);
  }

  /** Procesa un lote de pings. Solo el último válido define la posición de despacho; todos van al recorrido si hay viaje. */
  async ingest(driverId: string, pings: readonly GpsPing[]): Promise<IngestSummary> {
    if (pings.length === 0) throw new InvalidInputError('El lote de posiciones está vacío');
    if (pings.length > MAX_PINGS_PER_BATCH) {
      throw new InvalidInputError(`Máximo ${MAX_PINGS_PER_BATCH} posiciones por lote`, { received: pings.length });
    }
    const index = this.geo.require();
    const state = await this.store.getDriver(driverId);
    if (!state) throw new DriverNotOnShiftError(driverId);

    const now = this.clock.now().getTime();
    const sorted = [...pings].sort((a, b) => a.recordedAt - b.recordedAt);
    let last: LastFix | null = state.position;
    let latest: { ping: GpsPing; recordedAt: number } | null = null;
    const track: TrackEntry[] = [];
    let applied = 0;
    let heartbeatOnly = 0;
    let stale = 0;
    let invalid = 0;
    let suspicious = 0;

    for (const ping of sorted) {
      try {
        assertValidGeoPoint(ping, 'ping');
        if (!Number.isFinite(ping.recordedAt)) throw new InvalidInputError('recordedAt inválido');
      } catch {
        invalid++;
        continue;
      }
      const verdict = classifyPing(last, ping, now, {
        ...DEFAULT_PING_LIMITS,
        maxPlausibleSpeedKmh: this.config.dispatch.maxPlausibleSpeedKmh,
      });
      if (state.tripId) track.push({ ...ping, recordedAt: verdict.recordedAt, tripId: state.tripId, driverId });
      if (verdict.kind === 'APPLY') {
        applied++;
        last = { lat: ping.lat, lng: ping.lng, recordedAt: verdict.recordedAt };
        latest = { ping, recordedAt: verdict.recordedAt };
      } else if (verdict.kind === 'STALE') {
        stale++;
      } else {
        heartbeatOnly++;
        if (verdict.reason === 'IMPOSSIBLE_JUMP') suspicious++;
      }
    }

    let update: PositionUpdate | null = null;
    if (latest) {
      const point = { lat: latest.ping.lat, lng: latest.ping.lng };
      update = {
        ...point,
        recordedAt: latest.recordedAt,
        accuracyM: latest.ping.accuracyM ?? null,
        corridorPositionMeters: index.corridorPosition(point).positionMeters,
        localityId: index.localityAt(point)?.id ?? null,
        zoneId: index.zoneAt(point)?.id ?? null,
      };
    }
    if (applied + heartbeatOnly + stale > 0) await this.store.applyPosition(state, update, now, suspicious);
    if (track.length > 0) await this.store.appendTrack(track, this.config.tracking.streamMaxLen);

    // Viaje de Vuelta: termina al entrar a la localidad base o al vencer el plazo.
    let returningEnded = false;
    if (state.returnToLocalityId) {
      const arrived = update?.localityId === state.returnToLocalityId;
      const expired = state.returningUntil !== null && now > state.returningUntil;
      if (arrived || expired) returningEnded = (await this.store.endReturning(driverId)) === 'OK';
    }
    if (suspicious > 0) this.logger.warn(`Chofer ${driverId}: ${suspicious} salto(s) de posición imposibles`);

    return {
      applied,
      heartbeatOnly,
      stale,
      invalid,
      tracked: track.length,
      suspiciousJumps: suspicious,
      status: returningEnded && state.status === 'RETURNING' ? 'AVAILABLE' : state.status,
      returningEnded,
    };
  }

  /** ASSIGNED → ON_TRIP (pasajero a bordo). Lo llama el ciclo de vida del viaje (Fase 3). */
  async markOnTrip(driverId: string, tripId: string): Promise<void> {
    const r = await this.store.toOnTrip(driverId, tripId);
    if (r !== 'OK') throw new DispatchConflictError('INVALID_STATE', 'El chofer no tiene asignado ese viaje', { driverId, tripId });
    const state = await this.store.getDriver(driverId);
    if (state) await this.store.unindex(state);
  }

  /**
   * Fin del viaje. Si el chofer quedó fuera de su localidad base, pasa a RETURNING (Viaje de Vuelta),
   * con el sentido sobre RP11 hacia su base; si terminó en su base, queda AVAILABLE.
   */
  async releaseAfterTrip(driverId: string, tripId: string): Promise<DriverState> {
    const state = await this.store.getDriver(driverId);
    if (!state) throw new DriverNotOnShiftError(driverId);
    const now = this.clock.now().getTime();
    const backhaul = this.computeBackhaul(state, now);
    const r = await this.store.releaseAfterTrip(driverId, tripId, now, backhaul);
    if (r !== 'OK') throw new DispatchConflictError('INVALID_STATE', 'El chofer no tiene asignado ese viaje', { driverId, tripId });
    const updated = await this.store.getDriver(driverId);
    if (!updated) throw new DriverNotOnShiftError(driverId);
    await this.store.reindex(updated, now);
    return updated;
  }

  private computeBackhaul(
    state: DriverState,
    now: number,
  ): { returnToLocalityId: string; returnDirection: CorridorDirection; returningUntil: number } | null {
    if (!state.baseLocalityId || state.localityId === state.baseLocalityId || state.corridorPositionMeters === null) return null;
    const range = this.geo.require().localityRange(state.baseLocalityId);
    if (!range) return null;
    const pos = state.corridorPositionMeters;
    if (pos >= range.fromMeters && pos <= range.toMeters) return null; // sobre su base aunque fuera del polígono
    return {
      returnToLocalityId: state.baseLocalityId,
      returnDirection: range.fromMeters > pos ? 'SOUTHBOUND' : 'NORTHBOUND',
      returningUntil: now + this.config.dispatch.returningTtlMs,
    };
  }

  /**
   * Revalida la habilitación de los candidatos (caché por chofer). Si algo venció durante el turno,
   * el chofer deja de recibir ofertas: se le cierra el turno (si está en viaje, lo termina normalmente).
   */
  async filterEligible(states: readonly DriverState[]): Promise<DriverState[]> {
    const now = this.clock.now().getTime();
    const cacheMs = this.config.dispatch.eligibilityCacheMs;
    const fresh = states.filter((s) => s.eligibleCheckedAt !== null && now - s.eligibleCheckedAt < cacheMs);
    const toCheck = states.filter((s) => !fresh.includes(s));
    if (toCheck.length === 0) return fresh;

    const eligible = await this.repo.eligibleDriverIds(toCheck.map((s) => ({ driverId: s.driverId, vehicleId: s.vehicleId })));
    const passed: DriverState[] = [];
    for (const s of toCheck) {
      if (eligible.has(s.driverId)) {
        await this.store.setDriverFields(s.driverId, { eligibleCheckedAt: now });
        passed.push(s);
      } else {
        const r = await this.store.closeShift(s, false);
        this.logger.warn(`Chofer ${s.driverId} perdió la habilitación durante el turno (${r === 'OK' ? 'turno cerrado' : 'en viaje'})`);
      }
    }
    return [...fresh, ...passed];
  }

  /** Cierra el turno de quienes no reportan hace más de PRESENCE_STALE_MS (sin tocar a quien está en viaje). */
  async sweepStale(nowMs: number = this.clock.now().getTime()): Promise<string[]> {
    const ids = await this.store.staleDriverIds(nowMs - this.config.dispatch.heartbeatStaleMs);
    if (ids.length === 0) return [];
    const states = await this.store.getDrivers(ids);
    const known = new Set(states.map((s) => s.driverId));
    const orphans = ids.filter((id) => !known.has(id));
    if (orphans.length > 0) await this.store.redis.zrem('lc:drivers:lastseen', ...orphans);
    const closed: string[] = [];
    for (const s of states) {
      if (!DISPATCHABLE_STATUSES.includes(s.status)) continue; // OFFERED vence solo; ASSIGNED/ON_TRIP no se cortan
      if ((await this.store.closeShift(s, false)) === 'OK') closed.push(s.driverId);
    }
    if (closed.length > 0) this.logger.log(`Turnos cerrados por falta de señal: ${closed.length}`);
    return closed;
  }
}
