import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../database/database.module';

/** Evento de un viaje tal como se guarda en trip_events y se envía por WebSocket. */
export interface TripEvent {
  /** Creciente por viaje (id de trip_events): el cliente reconecta con el último que vio. */
  readonly seq: number;
  readonly tripId: string;
  readonly type: string;
  readonly at: string;
  readonly actorRole: 'PASSENGER' | 'DRIVER' | 'OPERATOR' | 'SYSTEM';
  readonly data: Record<string, unknown>;
}

export interface NewTripEvent {
  readonly tripId: string;
  readonly type: string;
  readonly actorRole: TripEvent['actorRole'];
  readonly actorId: string | null;
  readonly data?: Record<string, unknown>;
  readonly clientEventId?: string | null;
  readonly location?: { lat: number; lng: number } | null;
}

interface EventRow {
  id: string;
  trip_id: string;
  event_type: string;
  actor_role: TripEvent['actorRole'];
  payload: Record<string, unknown>;
  occurred_at: Date;
}

const toEvent = (r: EventRow): TripEvent => ({
  seq: Number(r.id),
  tripId: r.trip_id,
  type: r.event_type,
  at: r.occurred_at.toISOString(),
  actorRole: r.actor_role,
  data: r.payload,
});

export interface TripParties {
  readonly passengerId: string;
  readonly driverId: string | null;
  readonly agencyId: string | null;
  readonly status: string;
}

@Injectable()
export class TripEventsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Inserta el evento (idealmente dentro de la misma transacción que el cambio de estado). */
  async insert(db: Pool | PoolClient, e: NewTripEvent): Promise<TripEvent> {
    const { rows } = await db.query<EventRow>(
      `INSERT INTO trip_events (trip_id, client_event_id, event_type, actor_role, actor_id, location, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($6, $7), 4326) END,
               $8::jsonb, now())
       RETURNING id, trip_id, event_type, actor_role, payload, occurred_at`,
      [
        e.tripId,
        e.clientEventId ?? null,
        e.type,
        e.actorRole,
        e.actorId,
        e.location?.lng ?? null,
        e.location?.lat ?? null,
        JSON.stringify(e.data ?? {}),
      ],
    );
    return toEvent(rows[0]!);
  }

  async existsClientEvent(db: Pool | PoolClient, clientEventId: string): Promise<boolean> {
    const { rowCount } = await db.query(`SELECT 1 FROM trip_events WHERE client_event_id = $1`, [clientEventId]);
    return (rowCount ?? 0) > 0;
  }

  async listAfter(tripId: string, afterSeq: number, limit = 200): Promise<TripEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT id, trip_id, event_type, actor_role, payload, occurred_at
       FROM trip_events WHERE trip_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
      [tripId, afterSeq, limit],
    );
    return rows.map(toEvent);
  }

  async parties(tripId: string): Promise<TripParties | null> {
    const { rows } = await this.pool.query<{ passenger_id: string; driver_id: string | null; agency_id: string | null; status: string }>(
      `SELECT passenger_id, driver_id, agency_id, status FROM trips WHERE id = $1`,
      [tripId],
    );
    const r = rows[0];
    return r ? { passengerId: r.passenger_id, driverId: r.driver_id, agencyId: r.agency_id, status: r.status } : null;
  }
}
