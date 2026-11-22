import { Inject, Injectable } from '@nestjs/common';
import type { BackhaulMatch, FareQuote, GeoPoint, ScoreBreakdown, ServiceType, TripScope, TripStatus } from '@lacosta/domain';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { TripEventsRepository, type TripEvent } from '../trip-events/trip-events.repository';

export interface DispatchTrip {
  readonly id: string;
  readonly status: TripStatus;
  readonly serviceType: ServiceType;
  readonly scope: TripScope;
  readonly origin: GeoPoint;
  readonly destination: GeoPoint;
  readonly originLocalityId: string;
  readonly destinationLocalityId: string;
  readonly dispatchRound: number;
  readonly dispatchStartedAt: Date | null;
  readonly pricingInstant: Date;
  readonly quotedFareCents: number;
  readonly driverId: string | null;
  readonly vehicleId: string | null;
  readonly isBackhaulAssignment: boolean;
}

interface TripRow {
  id: string;
  status: TripStatus;
  service_type: ServiceType;
  scope: TripScope;
  olng: number;
  olat: number;
  dlng: number;
  dlat: number;
  origin_locality_id: string;
  destination_locality_id: string;
  dispatch_round: number;
  dispatch_started_at: Date | null;
  pricing_instant: Date;
  quoted_fare_cents: number;
  driver_id: string | null;
  vehicle_id: string | null;
  is_backhaul_assignment: boolean;
}

export interface OfferRecord {
  readonly id: string;
  readonly tripId: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly round: number;
  readonly rank: number;
  readonly scoreSeconds: number;
  readonly etaSeconds: number;
  readonly backhaulMatch: BackhaulMatch;
  readonly breakdown: ScoreBreakdown;
  readonly expiresAt: Date;
  readonly instanceId: string;
}

export type OfferOutcome = 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'CLAIM_FAILED';

export interface AssignParams {
  readonly tripId: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly offerId: string;
  readonly isBackhaul: boolean;
  /** Recotización con Viaje de Vuelta (solo si baja la tarifa). */
  readonly repriced: FareQuote | null;
}

const TRIP_COLUMNS = `
  id, status, service_type, scope,
  ST_X(origin) AS olng, ST_Y(origin) AS olat, ST_X(destination) AS dlng, ST_Y(destination) AS dlat,
  origin_locality_id, destination_locality_id, dispatch_round, dispatch_started_at, pricing_instant,
  quoted_fare_cents, driver_id, vehicle_id, is_backhaul_assignment`;

const toTrip = (r: TripRow): DispatchTrip => ({
  id: r.id,
  status: r.status,
  serviceType: r.service_type,
  scope: r.scope,
  origin: { lat: r.olat, lng: r.olng },
  destination: { lat: r.dlat, lng: r.dlng },
  originLocalityId: r.origin_locality_id,
  destinationLocalityId: r.destination_locality_id,
  dispatchRound: r.dispatch_round,
  dispatchStartedAt: r.dispatch_started_at,
  pricingInstant: r.pricing_instant,
  quotedFareCents: r.quoted_fare_cents,
  driverId: r.driver_id,
  vehicleId: r.vehicle_id,
  isBackhaulAssignment: r.is_backhaul_assignment,
});

/** Persistencia del despacho en PostgreSQL: estado del viaje y auditoría de ofertas. */
@Injectable()
export class DispatchRepository {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tripEvents: TripEventsRepository,
  ) {}

  async loadTrip(tripId: string): Promise<DispatchTrip | null> {
    const { rows } = await this.pool.query<TripRow>(`SELECT ${TRIP_COLUMNS} FROM trips WHERE id = $1`, [tripId]);
    return rows[0] ? toTrip(rows[0]) : null;
  }

  /** REQUESTED → SEARCHING (idempotente). Registra SEARCH_STARTED solo en la primera transición. */
  async startSearching(tripId: string): Promise<{ trip: DispatchTrip; event: TripEvent | null } | null> {
    return this.inTransaction(async (client) => {
      const { rows: current } = await client.query<{ status: string }>(`SELECT status FROM trips WHERE id = $1 FOR UPDATE`, [tripId]);
      const previous = current[0]?.status;
      if (previous !== 'REQUESTED' && previous !== 'SEARCHING') return null;
      const { rows } = await client.query<TripRow>(
        `UPDATE trips
         SET status = 'SEARCHING',
             dispatch_round = GREATEST(dispatch_round, 1),
             dispatch_started_at = COALESCE(dispatch_started_at, now())
         WHERE id = $1
         RETURNING ${TRIP_COLUMNS}`,
        [tripId],
      );
      const event =
        previous === 'REQUESTED'
          ? await this.tripEvents.insert(client, { tripId, type: 'SEARCH_STARTED', actorRole: 'SYSTEM', actorId: null, data: { status: 'SEARCHING' } })
          : null;
      return { trip: toTrip(rows[0]!), event };
    });
  }

  private async inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
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

  async setRound(tripId: string, round: number): Promise<void> {
    await this.pool.query(`UPDATE trips SET dispatch_round = $2 WHERE id = $1 AND status = 'SEARCHING' AND dispatch_round < $2`, [
      tripId,
      round,
    ]);
  }

  async markNoDriver(tripId: string): Promise<TripEvent | null> {
    return this.inTransaction(async (client) => {
      const r = await client.query(`UPDATE trips SET status = 'NO_DRIVER_AVAILABLE' WHERE id = $1 AND status = 'SEARCHING'`, [tripId]);
      if (r.rowCount !== 1) return null;
      return this.tripEvents.insert(client, {
        tripId,
        type: 'NO_DRIVER_AVAILABLE',
        actorRole: 'SYSTEM',
        actorId: null,
        data: { status: 'NO_DRIVER_AVAILABLE' },
      });
    });
  }

  async cancelSearching(tripId: string, reason: string): Promise<TripEvent | null> {
    return this.inTransaction(async (client) => {
      const r = await client.query(
        `UPDATE trips SET status = 'CANCELLED_BY_PASSENGER', cancelled_at = now(), cancellation_reason = $2
         WHERE id = $1 AND status IN ('REQUESTED', 'SEARCHING')`,
        [tripId, reason],
      );
      if (r.rowCount !== 1) return null;
      return this.tripEvents.insert(client, {
        tripId,
        type: 'CANCELLED_BY_PASSENGER',
        actorRole: 'PASSENGER',
        actorId: null,
        data: { status: 'CANCELLED_BY_PASSENGER', reason },
      });
    });
  }

  async offerHistory(tripId: string): Promise<{ offeredDriverIds: Set<string>; countByRound: Map<number, number> }> {
    const { rows } = await this.pool.query<{ driver_id: string; round: number }>(
      `SELECT driver_id, round FROM trip_offers WHERE trip_id = $1`,
      [tripId],
    );
    const countByRound = new Map<number, number>();
    for (const r of rows) countByRound.set(r.round, (countByRound.get(r.round) ?? 0) + 1);
    return { offeredDriverIds: new Set(rows.map((r) => r.driver_id)), countByRound };
  }

  async insertOffer(o: OfferRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO trip_offers (id, trip_id, driver_id, vehicle_id, round, rank, score_seconds, eta_seconds,
                                backhaul_match, score_breakdown, expires_at, dispatcher_instance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        o.id,
        o.tripId,
        o.driverId,
        o.vehicleId,
        o.round,
        o.rank,
        o.scoreSeconds,
        Math.round(o.etaSeconds),
        o.backhaulMatch,
        JSON.stringify(o.breakdown),
        o.expiresAt,
        o.instanceId,
      ],
    );
  }

  /** Cierra una oferta abierta. Devuelve false si ya estaba cerrada. */
  async closeOffer(offerId: string, outcome: OfferOutcome): Promise<boolean> {
    const r = await this.pool.query(
      `UPDATE trip_offers SET outcome = $2, responded_at = now() WHERE id = $1 AND outcome = 'PENDING'`,
      [offerId, outcome],
    );
    return r.rowCount === 1;
  }

  /**
   * Confirmación definitiva en PostgreSQL (después del lock de Redis). Si el viaje ya no está en búsqueda
   * o el trigger de habilitación lo rechaza, no cambia nada y devuelve false / lanza.
   */
  async assign(p: AssignParams): Promise<TripEvent | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE trips
         SET status = 'ASSIGNED', driver_id = $2, vehicle_id = $3, assigned_at = now(), version = version + 1,
             is_backhaul_assignment = $4,
             quoted_fare_cents = COALESCE($5, quoted_fare_cents),
             fare_breakdown    = COALESCE($6::jsonb, fare_breakdown),
             tariff_rule_id    = COALESCE($7::uuid, tariff_rule_id)
         WHERE id = $1 AND status = 'SEARCHING' AND driver_id IS NULL`,
        [
          p.tripId,
          p.driverId,
          p.vehicleId,
          p.isBackhaul,
          p.repriced?.totalCents ?? null,
          p.repriced ? JSON.stringify(p.repriced) : null,
          p.repriced?.tariff.ruleId ?? null,
        ],
      );
      if (updated.rowCount !== 1) {
        await client.query('ROLLBACK');
        return null;
      }
      await client.query(`UPDATE trip_offers SET outcome = 'ACCEPTED', responded_at = now() WHERE id = $1`, [p.offerId]);
      const event = await this.tripEvents.insert(client, {
        tripId: p.tripId,
        type: 'DRIVER_ASSIGNED',
        actorRole: 'DRIVER',
        actorId: p.driverId,
        data: {
          status: 'ASSIGNED',
          driverId: p.driverId,
          vehicleId: p.vehicleId,
          isBackhaul: p.isBackhaul,
          repricedFareCents: p.repriced?.totalCents ?? null,
        },
      });
      await client.query('COMMIT');
      return event;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async searchingTripIds(limit: number): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM trips WHERE status = 'SEARCHING' ORDER BY requested_at LIMIT $1`,
      [limit],
    );
    return rows.map((r) => r.id);
  }
}
