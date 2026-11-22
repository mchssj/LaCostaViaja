import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  computeFare,
  DispatchConflictError,
  DomainError,
  InvalidInputError,
  NotFoundError,
  OPEN_TRIP_STATUSES,
  planTripTransition,
  summarizeTrack,
  type FareQuote,
  type GeoPoint,
  type PaymentMethod,
  type ServiceType,
  type TripAction,
  type TripStatus,
} from '@lacosta/domain';
import type { Pool, PoolClient } from 'pg';
import { CLOCK, type Clock } from '../../common/clock';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import { RedisStateStore } from '../../redis/redis-state.store';
import { RK } from '../../redis/redis.keys';
import { actorRole, type Principal } from '../../security/principal';
import { QuoteTokenService } from '../../security/quote-token.service';
import { DispatchEvents } from '../dispatch/dispatch.events';
import { DispatchService } from '../dispatch/dispatch.service';
import { FareCalculatorService } from '../fares/fare-calculator.service';
import { PaymentsService } from '../payments/payments.service';
import { DriverPresenceService } from '../presence/driver-presence.service';
import { RealtimeService } from '../realtime/realtime.service';
import { TARIFF_REPOSITORY, type ITariffRepository } from '../tariffs/tariff-repository';
import { TripEventsRepository, type TripEvent } from '../trip-events/trip-events.repository';
import { VouchersService } from '../vouchers/vouchers.service';

const VOUCHER_METHODS: readonly string[] = ['VOUCHER', 'MUNICIPAL_ACCOUNT'];

interface TripRow {
  id: string;
  public_code: string;
  passenger_id: string;
  status: TripStatus;
  service_type: ServiceType;
  scope: string;
  olat: number;
  olng: number;
  dlat: number;
  dlng: number;
  origin_address: string | null;
  destination_address: string | null;
  origin_locality_id: string;
  destination_locality_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  agency_id: string | null;
  tariff_rule_id: string;
  pricing_instant: Date;
  quoted_fare_cents: number;
  final_fare_cents: number | null;
  metered_fare_cents: number | null;
  fare_breakdown: FareQuote;
  payment_method: PaymentMethod;
  payment_status: string;
  voucher_code: string | null;
  requested_at: Date;
  assigned_at: Date | null;
  driver_arrived_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  is_backhaul_assignment: boolean;
  passenger_rating: number | null;
}

const TRIP_SELECT = `
  SELECT t.id, t.public_code, t.passenger_id, t.status, t.service_type, t.scope,
         ST_Y(t.origin) AS olat, ST_X(t.origin) AS olng, ST_Y(t.destination) AS dlat, ST_X(t.destination) AS dlng,
         t.origin_address, t.destination_address, t.origin_locality_id, t.destination_locality_id,
         t.driver_id, t.vehicle_id, t.agency_id, t.tariff_rule_id, t.pricing_instant,
         t.quoted_fare_cents, t.final_fare_cents, t.metered_fare_cents, t.fare_breakdown,
         t.payment_method, t.payment_status, t.voucher_code,
         t.requested_at, t.assigned_at, t.driver_arrived_at, t.started_at, t.completed_at, t.cancelled_at,
         t.cancellation_reason, t.is_backhaul_assignment, t.passenger_rating
  FROM trips t`;

export interface TransitionOptions {
  readonly clientEventId?: string;
  readonly reason?: string;
  readonly location?: GeoPoint;
}

/**
 * Ciclo de vida del viaje. Cada acción: bloquea la fila, verifica que quien la pide sea la parte que
 * corresponde, aplica la máquina de estados del dominio, registra el evento (seq) y mueve el voucher en la
 * MISMA transacción. Después del commit: Redis (liberar chofer, retirar ofertas, re-despachar) y WebSocket.
 */
@Injectable()
export class TripsService implements OnModuleInit {
  private readonly logger = new Logger(TripsService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(TARIFF_REPOSITORY) private readonly tariffs: ITariffRepository,
    private readonly fares: FareCalculatorService,
    private readonly quoteTokens: QuoteTokenService,
    private readonly dispatch: DispatchService,
    private readonly dispatchEvents: DispatchEvents,
    private readonly presence: DriverPresenceService,
    private readonly store: RedisStateStore,
    private readonly vouchers: VouchersService,
    private readonly payments: PaymentsService,
    private readonly tripEvents: TripEventsRepository,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit(): void {
    // Sin chofer: el despacho cierra el viaje; acá se devuelve lo reservado del voucher.
    this.dispatchEvents.on('trip.no_driver', ({ tripId }) => {
      this.withTransaction((c) => this.vouchers.releaseForTrip(c, tripId)).catch((err: Error) =>
        this.logger.error(`No se pudo liberar el voucher del viaje sin chofer ${tripId}: ${err.message}`),
      );
    });
  }

  // ------------------------------------------------------------------ crear
  async create(
    principal: Principal,
    input: {
      origin: GeoPoint;
      destination: GeoPoint;
      serviceType: ServiceType;
      paymentMethod: PaymentMethod;
      voucherCode?: string;
      quoteToken?: string;
      originAddress?: string;
      destinationAddress?: string;
    },
  ) {
    if (VOUCHER_METHODS.includes(input.paymentMethod) && !input.voucherCode) {
      throw new InvalidInputError('Para pagar con voucher o cuenta municipal hay que indicar el código');
    }
    if (!VOUCHER_METHODS.includes(input.paymentMethod) && input.voucherCode) {
      throw new InvalidInputError('El código de voucher solo se usa con VOUCHER o MUNICIPAL_ACCOUNT');
    }
    // Precio: el de la cotización firmada (garantizado) o, si no viene, una cotización nueva.
    const quote = input.quoteToken
      ? this.quoteTokens.verify(input.quoteToken, input)
      : await this.fares.quote({ origin: input.origin, destination: input.destination, serviceType: input.serviceType });

    const { tripId, event } = await this.withTransaction(async (client) => {
      // Un pasajero, un viaje abierto: frena el doble toque aunque no mande Idempotency-Key.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`passenger-trip:${principal.id}`]);
      const open = await client.query(`SELECT id FROM trips WHERE passenger_id = $1 AND status = ANY($2) LIMIT 1`, [
        principal.id,
        OPEN_TRIP_STATUSES,
      ]);
      if (open.rows[0]) {
        throw new DispatchConflictError('PASSENGER_HAS_OPEN_TRIP', 'Ya tenés un viaje en curso', { tripId: open.rows[0].id });
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO trips (passenger_id, channel, service_type, status, origin, origin_address, destination, destination_address,
                            origin_locality_id, destination_locality_id, scope, crossed_boundaries, backhaul_eligible,
                            tariff_rule_id, pricing_instant, quoted_fare_cents, fare_breakdown, payment_method, voucher_code)
         VALUES ($1, $2, $3, 'REQUESTED', ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9,
                 $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20)
         RETURNING id`,
        [
          principal.id,
          principal.kind === 'GUEST' ? 'GUEST_QR_PWA' : 'PASSENGER_APP',
          quote.serviceType,
          input.origin.lng,
          input.origin.lat,
          input.originAddress ?? null,
          input.destination.lng,
          input.destination.lat,
          input.destinationAddress ?? null,
          quote.origin.locality.id,
          quote.destination.locality.id,
          quote.scope,
          quote.corridor.crossedBoundaries,
          quote.backhaul.eligible,
          quote.tariff.ruleId,
          quote.pricingInstant,
          quote.totalCents,
          JSON.stringify(quote),
          input.paymentMethod,
          input.voucherCode ?? null,
        ],
      );
      const id = rows[0]!.id;
      if (input.voucherCode) {
        await this.vouchers.reserveForTrip(client, { code: input.voucherCode, passengerId: principal.id, tripId: id, amountCents: quote.totalCents });
      }
      const ev = await this.tripEvents.insert(client, {
        tripId: id,
        type: 'TRIP_REQUESTED',
        actorRole: 'PASSENGER',
        actorId: principal.id,
        data: { status: 'REQUESTED', quotedFareCents: quote.totalCents, paymentMethod: input.paymentMethod },
      });
      return { tripId: id, event: ev };
    });
    this.realtime.publishTripEvent(event);

    // Si el despacho falla (Redis caído), el viaje queda REQUESTED/SEARCHING y lo retoma el reconciliador.
    await this.dispatch.startDispatch(tripId).catch((err: Error) => this.logger.warn(`Despacho diferido de ${tripId}: ${err.message}`));
    return this.view(await this.load(tripId), principal);
  }

  // ------------------------------------------------------------------ consultar
  async get(principal: Principal, tripId: string) {
    const trip = await this.load(tripId);
    await this.assertCanRead(principal, trip);
    return this.view(trip, principal);
  }

  async listMine(principal: Principal) {
    const column = principal.kind === 'DRIVER' ? 'driver_id' : 'passenger_id';
    const { rows } = await this.pool.query<TripRow>(`${TRIP_SELECT} WHERE t.${column} = $1 ORDER BY t.requested_at DESC LIMIT 20`, [principal.id]);
    return Promise.all(rows.map((r) => this.view(r, principal)));
  }

  async events(principal: Principal, tripId: string, afterSeq: number) {
    await this.assertCanRead(principal, await this.load(tripId));
    return this.tripEvents.listAfter(tripId, afterSeq);
  }

  // ------------------------------------------------------------------ transiciones
  arrived(p: Principal, tripId: string, o: TransitionOptions = {}) {
    return this.transition(p, tripId, 'DRIVER_ARRIVED', o);
  }

  start(p: Principal, tripId: string, o: TransitionOptions = {}) {
    return this.transition(p, tripId, 'START', o);
  }

  complete(p: Principal, tripId: string, o: TransitionOptions = {}) {
    return this.transition(p, tripId, 'COMPLETE', o);
  }

  /** Cancelar: la acción depende de quién la pide (pasajero, chofer antes de llegar, "no se presentó", operador). */
  cancel(p: Principal, tripId: string, o: TransitionOptions & { noShow?: boolean } = {}) {
    const action: TripAction =
      p.kind === 'DRIVER' ? (o.noShow ? 'DRIVER_NO_SHOW' : 'DRIVER_CANCEL') : p.kind === 'OPERATOR' ? 'OPERATOR_CANCEL' : 'PASSENGER_CANCEL';
    return this.transition(p, tripId, action, o);
  }

  private async transition(principal: Principal, tripId: string, action: TripAction, o: TransitionOptions) {
    const result = await this.withTransaction(async (client) => {
      const trip = await this.lock(client, tripId);
      this.assertParty(principal, trip, action);
      if (o.clientEventId && (await this.tripEvents.existsClientEvent(client, o.clientEventId))) {
        return { trip, event: null as TripEvent | null, replay: true };
      }
      const plan = planTripTransition(trip.status, action, actorRole(principal), {
        driverArrivedAt: trip.driver_arrived_at,
        now: this.clock.now(),
        noShowWaitMs: this.config.trips.noShowWaitMs,
      });
      const extra: Record<string, unknown> = {};
      switch (action) {
        case 'DRIVER_ARRIVED':
          await client.query(`UPDATE trips SET status = $2, driver_arrived_at = now(), version = version + 1 WHERE id = $1`, [tripId, plan.to]);
          break;
        case 'START':
          await client.query(`UPDATE trips SET status = $2, started_at = now(), version = version + 1 WHERE id = $1`, [tripId, plan.to]);
          break;
        case 'COMPLETE': {
          const meter = await this.referenceMeter(client, trip);
          const finalFare = trip.quoted_fare_cents; // tarifa cerrada
          await client.query(
            `UPDATE trips SET status = $2, completed_at = now(), final_fare_cents = $3, metered_fare_cents = $4,
                              final_breakdown = $5::jsonb, version = version + 1
             WHERE id = $1`,
            [tripId, plan.to, finalFare, meter?.totalCents ?? null, JSON.stringify({ closedFareCents: finalFare, referenceMeter: meter })],
          );
          if (VOUCHER_METHODS.includes(trip.payment_method)) {
            await this.vouchers.settleForTrip(client, tripId, finalFare);
            await this.payments.recordVoucherPayment(client, tripId, trip.payment_method, finalFare);
          }
          Object.assign(extra, { finalFareCents: finalFare, meteredFareCents: meter?.totalCents ?? null });
          break;
        }
        case 'DRIVER_CANCEL':
          // El viaje vuelve a búsqueda con el reloj de búsqueda reiniciado; el chofer queda excluido (ya tuvo oferta).
          await client.query(
            `UPDATE trips SET status = 'SEARCHING', driver_id = NULL, vehicle_id = NULL, agency_id = NULL, assigned_at = NULL,
                              driver_arrived_at = NULL, is_backhaul_assignment = false, dispatch_round = 1,
                              dispatch_started_at = now(), version = version + 1
             WHERE id = $1`,
            [tripId],
          );
          Object.assign(extra, { withdrawnDriverId: trip.driver_id });
          break;
        default:
          // Cancelaciones definitivas: se devuelve lo reservado del voucher.
          await client.query(
            `UPDATE trips SET status = $2, cancelled_at = now(), cancellation_reason = $3, version = version + 1 WHERE id = $1`,
            [tripId, plan.to, o.reason ?? null],
          );
          await this.vouchers.releaseForTrip(client, tripId);
          Object.assign(extra, { reason: o.reason ?? null });
      }
      const event = await this.tripEvents.insert(client, {
        tripId,
        type: plan.eventType,
        actorRole: actorRole(principal),
        actorId: principal.id,
        clientEventId: o.clientEventId ?? null,
        location: o.location ?? null,
        data: { status: plan.to, from: plan.from, ...extra },
      });
      return { trip, event, replay: false };
    });

    if (result.event) {
      this.realtime.publishTripEvent(result.event, { driverIds: [result.trip.driver_id] });
      await this.afterTransition(action, result.trip);
    }
    const view = await this.view(await this.load(tripId), principal);
    return result.replay ? { ...view, idempotent: true } : view;
  }

  /** Efectos en Redis después del commit. Si fallan, el reconciliador los completa. */
  private async afterTransition(action: TripAction, before: TripRow): Promise<void> {
    const driverId = before.driver_id;
    const tripId = before.id;
    const safe = (what: string, p: Promise<unknown>) => p.catch((err: Error) => this.logger.warn(`${what} (${tripId}): ${err.message}`));
    switch (action) {
      case 'START':
        if (driverId) await safe('markOnTrip', this.presence.markOnTrip(driverId, tripId));
        return;
      case 'COMPLETE':
        if (driverId) await safe('releaseAfterTrip', this.presence.releaseAfterTrip(driverId, tripId));
        return;
      case 'DRIVER_CANCEL':
        if (driverId) {
          await safe('releaseAfterTrip', this.presence.releaseAfterTrip(driverId, tripId));
          await safe('penalización', this.penalize(driverId, tripId));
        }
        await safe('re-despacho', this.dispatch.startDispatch(tripId));
        return;
      case 'DRIVER_ARRIVED':
        return;
      default:
        if (driverId) {
          await safe('releaseAfterTrip', this.presence.releaseAfterTrip(driverId, tripId));
          this.realtime.tripCancelledForDriver(driverId, tripId, action);
        } else {
          await safe('retirar oferta', this.dispatch.withdrawOffer(tripId));
        }
    }
  }

  /** Devolver un viaje aceptado cuenta como rechazo en el ranking del despacho. */
  private async penalize(driverId: string, tripId: string): Promise<void> {
    const now = this.clock.now().getTime();
    const windowMs = this.config.dispatch.rejectionWindowMs;
    await this.store.redis.multi().zadd(RK.rejections(driverId), now, `withdraw:${tripId}`).pexpire(RK.rejections(driverId), windowMs).exec();
  }

  // ------------------------------------------------------------------ cambio de destino y calificación
  /** Sin quoteToken devuelve la propuesta; con el token de esa propuesta la aplica. */
  async changeDestination(principal: Principal, tripId: string, input: { destination: GeoPoint; destinationAddress?: string; quoteToken?: string }) {
    const current = await this.load(tripId);
    this.assertParty(principal, current, 'PASSENGER_CANCEL'); // mismo dueño que puede cancelar: el pasajero del viaje
    if (!['ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(current.status)) {
      throw new DomainError('INVALID_TRANSITION', 'El destino se cambia con el viaje asignado o en curso');
    }
    const origin = { lat: current.olat, lng: current.olng };
    if (!input.quoteToken) {
      // Misma franja y temporada que el viaje original (pricingInstant fijo).
      const quote = await this.fares.quote({ origin, destination: input.destination, serviceType: current.service_type, pricingInstant: current.pricing_instant });
      return { applied: false, previousFareCents: current.quoted_fare_cents, quote, quoteToken: this.quoteTokens.sign(quote) };
    }
    const quote = this.quoteTokens.verify(input.quoteToken, { origin, destination: input.destination, serviceType: current.service_type });
    if (new Date(quote.pricingInstant).getTime() !== current.pricing_instant.getTime()) {
      throw new InvalidInputError('La cotización no corresponde a este viaje');
    }
    const result = await this.withTransaction(async (client) => {
      const trip = await this.lock(client, tripId);
      if (!['ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status)) {
        throw new DomainError('INVALID_TRANSITION', 'El viaje cambió de estado: volvé a intentar');
      }
      if (VOUCHER_METHODS.includes(trip.payment_method)) await this.vouchers.adjustForTrip(client, tripId, quote.totalCents);
      await client.query(
        `UPDATE trips SET destination = ST_SetSRID(ST_MakePoint($2, $3), 4326), destination_address = $4, destination_locality_id = $5,
                          scope = $6, crossed_boundaries = $7, backhaul_eligible = $8, tariff_rule_id = $9,
                          quoted_fare_cents = $10, fare_breakdown = $11::jsonb, version = version + 1
         WHERE id = $1`,
        [
          tripId,
          input.destination.lng,
          input.destination.lat,
          input.destinationAddress ?? null,
          quote.destination.locality.id,
          quote.scope,
          quote.corridor.crossedBoundaries,
          quote.backhaul.eligible,
          quote.tariff.ruleId,
          quote.totalCents,
          JSON.stringify(quote),
        ],
      );
      const event = await this.tripEvents.insert(client, {
        tripId,
        type: 'FARE_CHANGED',
        actorRole: 'PASSENGER',
        actorId: principal.id,
        data: { previousFareCents: trip.quoted_fare_cents, newFareCents: quote.totalCents, destination: input.destination },
      });
      return { trip, event };
    });
    this.realtime.publishTripEvent(result.event, { driverIds: [result.trip.driver_id] });
    return { applied: true, trip: await this.view(await this.load(tripId), principal) };
  }

  async rate(principal: Principal, tripId: string, rating: number) {
    const trip = await this.load(tripId);
    this.assertParty(principal, trip, 'PASSENGER_CANCEL');
    if (trip.status !== 'COMPLETED') throw new DomainError('INVALID_TRANSITION', 'Solo se califica un viaje completado');
    const r = await this.pool.query(`UPDATE trips SET passenger_rating = $2 WHERE id = $1 AND passenger_rating IS NULL`, [tripId, rating]);
    if (r.rowCount !== 1) throw new DomainError('INVALID_TRANSITION', 'El viaje ya fue calificado');
    return { ok: true };
  }

  // ------------------------------------------------------------------ reconciliación (después de fallas de Redis)
  /** Choferes que Redis cree en viaje pero cuyo viaje ya terminó (o es de otro) → se liberan. */
  async reconcile(): Promise<{ released: number; onTrip: number; restarted: number }> {
    let released = 0;
    let onTrip = 0;
    const ids: string[] = await this.store.redis.zrange(RK.lastSeen, 0, -1);
    const busy = (await this.store.getDrivers(ids)).filter((s) => s.tripId && (s.status === 'ASSIGNED' || s.status === 'ON_TRIP'));
    if (busy.length > 0) {
      const { rows } = await this.pool.query<{ id: string; status: TripStatus; driver_id: string | null }>(
        `SELECT id, status, driver_id FROM trips WHERE id = ANY($1)`,
        [busy.map((s) => s.tripId)],
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const s of busy) {
        const trip = byId.get(s.tripId!);
        const stillTheirs = trip && trip.driver_id === s.driverId && ['ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status);
        if (!stillTheirs) {
          await this.presence.releaseAfterTrip(s.driverId, s.tripId!).then(() => released++, () => undefined);
        } else if (trip.status === 'IN_PROGRESS' && s.status === 'ASSIGNED') {
          await this.presence.markOnTrip(s.driverId, s.tripId!).then(() => onTrip++, () => undefined);
        }
      }
    }
    // Viajes que quedaron REQUESTED porque el despacho no arrancó.
    const { rows: stuck } = await this.pool.query<{ id: string }>(
      `SELECT id FROM trips WHERE status = 'REQUESTED' AND requested_at < now() - interval '10 seconds' LIMIT 50`,
    );
    let restarted = 0;
    for (const t of stuck) await this.dispatch.startDispatch(t.id).then(() => restarted++, () => undefined);
    return { released, onTrip, restarted };
  }

  // ------------------------------------------------------------------ internos
  private async referenceMeter(client: PoolClient, trip: TripRow) {
    const { rows } = await client.query<{ lat: number; lng: number; t: number; accuracy_m: string | null }>(
      `SELECT ST_Y(geom) AS lat, ST_X(geom) AS lng, (extract(epoch FROM recorded_at) * 1000)::float8 AS t, accuracy_m
       FROM trip_track_points WHERE trip_id = $1 ORDER BY recorded_at`,
      [trip.id],
    );
    const summary = summarizeTrack(rows.map((r) => ({ lat: r.lat, lng: r.lng, recordedAt: r.t, accuracyM: r.accuracy_m === null ? null : Number(r.accuracy_m) })));
    if (summary.usedPoints < 2) return null;
    const rule = await this.tariffs.findRuleById(trip.tariff_rule_id);
    const schedule = await this.tariffs.findScheduleAt(trip.pricing_instant);
    if (!rule || !schedule) return null;
    const fare = computeFare({
      rule,
      distanceMeters: summary.distanceMeters,
      durationSeconds: summary.durationSeconds,
      interurbanOutsideMeters: trip.fare_breakdown?.corridor?.outsideOriginMeters ?? 0,
      roundingStepCents: schedule.roundingStepCents,
    });
    return { ...summary, totalCents: fare.totalCents, lines: fare.lines };
  }

  private async load(tripId: string): Promise<TripRow> {
    const { rows } = await this.pool.query<TripRow>(`${TRIP_SELECT} WHERE t.id = $1`, [tripId]);
    if (!rows[0]) throw new NotFoundError('Viaje inexistente', { tripId });
    return rows[0];
  }

  private async lock(client: PoolClient, tripId: string): Promise<TripRow> {
    const { rows } = await client.query<TripRow>(`${TRIP_SELECT} WHERE t.id = $1 FOR UPDATE OF t`, [tripId]);
    if (!rows[0]) throw new NotFoundError('Viaje inexistente', { tripId });
    return rows[0];
  }

  /** ¿Es la parte que corresponde a esta acción? (dueño, chofer asignado u operador con alcance). */
  private assertParty(p: Principal, trip: TripRow, action: TripAction): void {
    const isPassengerAction = action === 'PASSENGER_CANCEL';
    const isDriverAction = ['DRIVER_ARRIVED', 'START', 'COMPLETE', 'DRIVER_CANCEL', 'DRIVER_NO_SHOW'].includes(action);
    if ((p.kind === 'PASSENGER' || p.kind === 'GUEST') && isPassengerAction && trip.passenger_id === p.id) return;
    if (p.kind === 'DRIVER' && isDriverAction && trip.driver_id === p.id) return;
    if (p.kind === 'OPERATOR' && action === 'OPERATOR_CANCEL') {
      if (p.role === 'COM_OPERATOR' || p.role === 'MUNICIPAL_ADMIN') return;
      if (p.role === 'AGENCY_OPERATOR' && trip.agency_id && trip.agency_id === p.agencyId) return;
    }
    // No se distingue "no existe" de "no es tuyo" para no filtrar ids de viajes ajenos.
    throw new NotFoundError('Viaje inexistente', { tripId: trip.id });
  }

  private async assertCanRead(p: Principal, trip: TripRow): Promise<void> {
    if ((p.kind === 'PASSENGER' || p.kind === 'GUEST') && trip.passenger_id === p.id) return;
    if (p.kind === 'DRIVER') {
      if (trip.driver_id === p.id) return;
      // Un chofer con oferta abierta puede ver el viaje para decidir.
      const { rowCount } = await this.pool.query(`SELECT 1 FROM trip_offers WHERE trip_id = $1 AND driver_id = $2 AND outcome = 'PENDING'`, [trip.id, p.id]);
      if ((rowCount ?? 0) > 0) return;
    }
    if (p.kind === 'OPERATOR' && (p.role === 'COM_OPERATOR' || p.role === 'MUNICIPAL_ADMIN')) return;
    if (p.kind === 'OPERATOR' && p.role === 'AGENCY_OPERATOR' && trip.agency_id === p.agencyId) return;
    throw new NotFoundError('Viaje inexistente', { tripId: trip.id });
  }

  /** Vista del viaje (snake_case, compatible con los prototipos). Cada parte ve lo que necesita. */
  private async view(t: TripRow, viewer: Principal) {
    const [{ rows: people }, { rows: seq }] = await Promise.all([
      this.pool.query<{
        driver_first_name: string | null;
        driver_last_name: string | null;
        driver_phone: string | null;
        plate: string | null;
        make: string | null;
        model: string | null;
        color: string | null;
        passenger_kind: string;
        passenger_phone: string | null;
        origin_locality: string;
        destination_locality: string;
      }>(
        `SELECT d.first_name AS driver_first_name, d.last_name AS driver_last_name, d.phone AS driver_phone,
                v.plate, v.make, v.model, v.color, p.kind AS passenger_kind, p.phone AS passenger_phone,
                lo.name AS origin_locality, ld.name AS destination_locality
         FROM trips t
         JOIN passengers p ON p.id = t.passenger_id
         JOIN localities lo ON lo.id = t.origin_locality_id
         JOIN localities ld ON ld.id = t.destination_locality_id
         LEFT JOIN drivers d ON d.id = t.driver_id
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
         WHERE t.id = $1`,
        [t.id],
      ),
      this.pool.query<{ last_seq: string | null }>(`SELECT max(id) AS last_seq FROM trip_events WHERE trip_id = $1`, [t.id]),
    ]);
    const x = people[0]!;
    const isOperator = viewer.kind === 'OPERATOR';
    return {
      id: t.id,
      public_code: t.public_code,
      status: t.status,
      service_type: t.service_type,
      scope: t.scope,
      origin: { lat: t.olat, lng: t.olng, address: t.origin_address, locality: x.origin_locality },
      destination: { lat: t.dlat, lng: t.dlng, address: t.destination_address, locality: x.destination_locality },
      quoted_fare_cents: t.quoted_fare_cents,
      final_fare_cents: t.final_fare_cents,
      metered_fare_cents: t.metered_fare_cents,
      fare_lines: t.fare_breakdown?.lines ?? [],
      payment_method: t.payment_method,
      payment_status: t.payment_status,
      is_backhaul_assignment: t.is_backhaul_assignment,
      requested_at: t.requested_at,
      assigned_at: t.assigned_at,
      driver_arrived_at: t.driver_arrived_at,
      started_at: t.started_at,
      completed_at: t.completed_at,
      cancelled_at: t.cancelled_at,
      cancellation_reason: t.cancellation_reason,
      passenger_rating: t.passenger_rating,
      driver_id: t.driver_id,
      driver: t.driver_id
        ? {
            first_name: x.driver_first_name,
            // El pasajero ve nombre e inicial; el COM ve todo.
            last_name: isOperator || viewer.kind === 'DRIVER' ? x.driver_last_name : x.driver_last_name ? `${x.driver_last_name[0]}.` : null,
            phone: isOperator ? x.driver_phone : null,
          }
        : null,
      vehicle: t.vehicle_id ? { plate: x.plate, make: x.make, model: x.model, color: x.color } : null,
      passenger: isOperator ? { kind: x.passenger_kind, phone: x.passenger_phone } : { kind: x.passenger_kind },
      last_seq: seq[0]?.last_seq ? Number(seq[0].last_seq) : 0,
    };
  }

  private async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
