import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError, NotFoundError, type GeoPoint } from '@lacosta/domain';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import { RedisStateStore } from '../../redis/redis-state.store';
import { REDIS } from '../../redis/redis.tokens';
import type { Principal } from '../../security/principal';
import { activePanicKey, RealtimeService } from '../realtime/realtime.service';
import { TripEventsRepository } from '../trip-events/trip-events.repository';
import { ALERT_NOTIFIER, type IAlertNotifier } from './alert-notifier';

const ACTIVE_KEY_TTL_SECONDS = 4 * 3600;

const ALERT_SELECT = `
  SELECT pa.id, pa.client_event_id, pa.trip_id, t.public_code AS trip_public_code, pa.raised_by, pa.status, pa.channel,
         pa.locality_id, l.name AS locality_name, ST_Y(pa.location) AS lat, ST_X(pa.location) AS lng, pa.accuracy_m,
         pa.snapshot, pa.occurred_at, pa.received_at, pa.acknowledged_at, pa.acknowledged_by, pa.resolved_at,
         pa.resolution_notes, pa.escalated_at, pa.escalation_count, pa.passenger_id, pa.driver_id, pa.vehicle_id,
         d.first_name AS driver_first_name, d.last_name AS driver_last_name, v.plate AS vehicle_plate
  FROM panic_alerts pa
  LEFT JOIN trips t ON t.id = pa.trip_id
  LEFT JOIN localities l ON l.id = pa.locality_id
  LEFT JOIN drivers d ON d.id = pa.driver_id
  LEFT JOIN vehicles v ON v.id = pa.vehicle_id`;

export interface CreatePanicInput {
  readonly clientEventId: string;
  readonly location: GeoPoint;
  readonly accuracyM?: number;
  readonly tripId?: string;
  readonly channel?: 'APP' | 'PWA' | 'SMS_FALLBACK' | 'HARDWARE_BUTTON';
  readonly occurredAt?: string;
}

/**
 * Botón de pánico. Quién la dispara sale de la sesión (no del cuerpo): nadie puede generar una alerta
 * a nombre de otro. La foto (snapshot) la arma el servidor con datos reales del viaje, chofer y vehículo.
 */
@Injectable()
export class PanicService {
  private readonly logger = new Logger(PanicService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ALERT_NOTIFIER) private readonly notifier: IAlertNotifier,
    private readonly store: RedisStateStore,
    private readonly realtime: RealtimeService,
    private readonly tripEvents: TripEventsRepository,
  ) {}

  async create(principal: Principal, input: CreatePanicInput) {
    if (principal.kind === 'OPERATOR') throw new DomainError('FORBIDDEN', 'El botón de pánico es del pasajero o del chofer');
    const raisedBy = principal.kind === 'DRIVER' ? 'DRIVER' : 'PASSENGER';
    const tripId = await this.resolveTrip(principal, input.tripId);

    let driverId: string | null = null;
    let vehicleId: string | null = null;
    let passengerId: string | null = null;
    if (tripId) {
      const { rows } = await this.pool.query<{ driver_id: string | null; vehicle_id: string | null; passenger_id: string }>(
        `SELECT driver_id, vehicle_id, passenger_id FROM trips WHERE id = $1`,
        [tripId],
      );
      ({ driver_id: driverId, vehicle_id: vehicleId, passenger_id: passengerId } = rows[0]!);
    }
    if (raisedBy === 'DRIVER') {
      driverId = principal.id;
      vehicleId ??= (await this.store.getDriver(principal.id).catch(() => null))?.vehicleId ?? null;
    } else {
      passengerId = principal.id;
    }
    const snapshot = await this.buildSnapshot(tripId, driverId, vehicleId, passengerId);

    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO panic_alerts (client_event_id, trip_id, raised_by, passenger_id, driver_id, vehicle_id,
                                 location, accuracy_m, channel, snapshot, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9, $10, $11::jsonb, $12)
       ON CONFLICT (client_event_id) DO NOTHING
       RETURNING id`,
      [
        input.clientEventId,
        tripId,
        raisedBy,
        passengerId,
        driverId,
        vehicleId,
        input.location.lng,
        input.location.lat,
        input.accuracyM ?? null,
        input.channel ?? (principal.kind === 'GUEST' ? 'PWA' : 'APP'),
        JSON.stringify(snapshot),
        this.sanitizeOccurredAt(input.occurredAt),
      ],
    );

    if (!inserted.rows[0]) {
      // Reintento (mala señal): misma alerta, sin duplicar. Solo si es del mismo autor.
      const alert = await this.findByClientEvent(input.clientEventId);
      // Mismo autor = mismo rol Y misma persona (el chofer del viaje no puede "reclamar" la alerta del pasajero).
      const sameAuthor =
        alert.raised_by === raisedBy && (raisedBy === 'DRIVER' ? alert.driver_id === principal.id : alert.passenger_id === principal.id);
      if (!sameAuthor) throw new DomainError('IDEMPOTENCY_CONFLICT', 'clientEventId ya usado');
      return { ...alert, idempotent: true };
    }
    const alert = await this.get(inserted.rows[0].id);
    await this.redis
      .set(activePanicKey(raisedBy, principal.id), alert.id, 'EX', ACTIVE_KEY_TTL_SECONDS)
      .catch((err: Error) => this.logger.warn(`Sin Redis para seguir la alerta en vivo: ${err.message}`));
    if (tripId) {
      const event = await this.tripEvents.insert(this.pool, {
        tripId,
        type: 'PANIC_RAISED',
        actorRole: raisedBy,
        actorId: principal.id,
        location: input.location,
        data: { alertId: alert.id },
      });
      // El evento queda en la bitácora del viaje para el COM; no se reenvía a la otra parte.
      this.realtime.panicUpdated({ ...alert, tripEventSeq: event.seq });
    }
    this.realtime.panicAlert(alert);
    return { ...alert, idempotent: false };
  }

  /** Posición en vivo mientras la alerta está abierta (pasajero; la del chofer llega sola con sus pings). */
  async updateLocation(principal: Principal, alertId: string, location: GeoPoint) {
    const alert = await this.get(alertId);
    const isAuthor = principal.kind === 'DRIVER' ? alert.driver_id === principal.id && alert.raised_by === 'DRIVER' : alert.passenger_id === principal.id;
    if (!isAuthor) throw new NotFoundError('Alerta inexistente', { alertId });
    if (['RESOLVED', 'FALSE_ALARM'].includes(alert.status)) throw new DomainError('INVALID_TRANSITION', 'La alerta ya está cerrada');
    this.realtime.panicLocation(alertId, { ...location, recordedAt: Date.now() });
    return { ok: true };
  }

  async listOpen() {
    const { rows } = await this.pool.query(`${ALERT_SELECT} WHERE pa.status IN ('OPEN', 'ACKNOWLEDGED', 'UNITS_DISPATCHED') ORDER BY pa.received_at DESC`);
    return rows;
  }

  async get(alertId: string) {
    const { rows } = await this.pool.query(`${ALERT_SELECT} WHERE pa.id = $1`, [alertId]);
    if (!rows[0]) throw new NotFoundError('Alerta inexistente', { alertId });
    return rows[0];
  }

  async acknowledge(operator: Principal, alertId: string) {
    return this.update(
      alertId,
      `UPDATE panic_alerts SET status = 'ACKNOWLEDGED', acknowledged_at = now(), acknowledged_by = $2
       WHERE id = $1 AND status = 'OPEN' RETURNING id`,
      [alertId, operator.id],
      'La alerta ya fue tomada por otro operador o está cerrada',
    );
  }

  async unitsDispatched(operator: Principal, alertId: string) {
    return this.update(
      alertId,
      `UPDATE panic_alerts SET status = 'UNITS_DISPATCHED',
              acknowledged_at = COALESCE(acknowledged_at, now()), acknowledged_by = COALESCE(acknowledged_by, $2)
       WHERE id = $1 AND status IN ('OPEN', 'ACKNOWLEDGED') RETURNING id`,
      [alertId, operator.id],
      'La alerta no admite ese cambio en su estado actual',
    );
  }

  async resolve(operator: Principal, alertId: string, notes: string | undefined, falseAlarm: boolean) {
    const updated = await this.update(
      alertId,
      `UPDATE panic_alerts SET status = $3::panic_status, resolved_at = now(), resolution_notes = $4,
              acknowledged_at = COALESCE(acknowledged_at, now()), acknowledged_by = COALESCE(acknowledged_by, $2)
       WHERE id = $1 AND status IN ('OPEN', 'ACKNOWLEDGED', 'UNITS_DISPATCHED') RETURNING id`,
      [alertId, operator.id, falseAlarm ? 'FALSE_ALARM' : 'RESOLVED', notes ?? null],
      'La alerta ya está cerrada',
    );
    const author = updated.raised_by === 'DRIVER' ? updated.driver_id : updated.passenger_id;
    if (author) await this.redis.del(activePanicKey(updated.raised_by, author)).catch(() => undefined);
    return updated;
  }

  /** Alertas OPEN sin atender en el plazo: se marcan, se reenvían al COM y se avisa por el canal externo. */
  async escalateOverdue(): Promise<number> {
    const afterMs = this.config.panic.escalateAfterMs;
    const { rows } = await this.pool.query<{ id: string }>(
      `UPDATE panic_alerts SET escalated_at = now(), escalation_count = escalation_count + 1
       WHERE status = 'OPEN'
         AND received_at < now() - make_interval(secs => $1::float8 / 1000)
         AND (escalated_at IS NULL OR escalated_at < now() - make_interval(secs => $1::float8 / 1000))
       RETURNING id`,
      [afterMs],
    );
    for (const { id } of rows) {
      const alert = await this.get(id);
      this.realtime.panicEscalated(alert);
      await this.notifier
        .notifyEscalation({
          id,
          tripPublicCode: alert.trip_public_code,
          raisedBy: alert.raised_by,
          lat: alert.lat,
          lng: alert.lng,
          escalationCount: alert.escalation_count,
          receivedAt: new Date(alert.received_at).toISOString(),
        })
        .catch((err: Error) => this.logger.error(`No se pudo notificar la escalada de ${id}: ${err.message}`));
    }
    return rows.length;
  }

  private async update(alertId: string, sql: string, params: unknown[], conflictMessage: string) {
    const r = await this.pool.query(sql, params);
    if (r.rowCount !== 1) {
      await this.get(alertId); // 404 si no existe
      throw new DomainError('INVALID_TRANSITION', conflictMessage);
    }
    const alert = await this.get(alertId);
    this.realtime.panicUpdated(alert);
    return alert;
  }

  /** El viaje de la alerta: el indicado (si es parte) o el viaje activo del autor. */
  private async resolveTrip(principal: Principal, tripId: string | undefined): Promise<string | null> {
    const column = principal.kind === 'DRIVER' ? 'driver_id' : 'passenger_id';
    if (tripId) {
      const { rows } = await this.pool.query(`SELECT id FROM trips WHERE id = $1 AND ${column} = $2`, [tripId, principal.id]);
      if (!rows[0]) throw new DomainError('FORBIDDEN', 'El viaje indicado no es tuyo');
      return tripId;
    }
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM trips WHERE ${column} = $1 AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
       ORDER BY requested_at DESC LIMIT 1`,
      [principal.id],
    );
    return rows[0]?.id ?? null;
  }

  private async buildSnapshot(tripId: string | null, driverId: string | null, vehicleId: string | null, passengerId: string | null) {
    const [trip, driver, vehicle, passenger] = await Promise.all([
      tripId
        ? this.pool.query(
            `SELECT t.public_code, t.status, t.service_type, ST_Y(t.origin) AS origin_lat, ST_X(t.origin) AS origin_lng, t.origin_address,
                    ST_Y(t.destination) AS destination_lat, ST_X(t.destination) AS destination_lng, t.destination_address
             FROM trips t WHERE t.id = $1`,
            [tripId],
          )
        : null,
      driverId ? this.pool.query(`SELECT first_name, last_name, dni, phone FROM drivers WHERE id = $1`, [driverId]) : null,
      vehicleId ? this.pool.query(`SELECT plate, make, model, color, service_type FROM vehicles WHERE id = $1`, [vehicleId]) : null,
      passengerId ? this.pool.query(`SELECT kind, phone, full_name FROM passengers WHERE id = $1`, [passengerId]) : null,
    ]);
    return {
      takenAt: new Date().toISOString(),
      trip: trip?.rows[0] ?? null,
      driver: driver?.rows[0] ?? null,
      vehicle: vehicle?.rows[0] ?? null,
      passenger: passenger?.rows[0] ?? null,
    };
  }

  private sanitizeOccurredAt(value: string | undefined): string {
    const t = value ? Date.parse(value) : NaN;
    const now = Date.now();
    // Reloj del dispositivo fuera de rango (más de 1 h atrás o 2 min adelante): se usa la hora del servidor.
    return Number.isFinite(t) && t > now - 3_600_000 && t < now + 120_000 ? new Date(t).toISOString() : new Date(now).toISOString();
  }

  private async findByClientEvent(clientEventId: string) {
    const { rows } = await this.pool.query(`${ALERT_SELECT} WHERE pa.client_event_id = $1`, [clientEventId]);
    if (!rows[0]) throw new NotFoundError('Alerta inexistente');
    return rows[0];
  }
}
