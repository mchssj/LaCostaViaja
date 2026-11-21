import { Injectable, NotFoundException, forwardRef, Inject } from '@nestjs/common';
import { PG_POOL } from '../../database/database.module';
import { PanicGateway } from './panic.gateway';
import type { Pool } from 'pg';

@Injectable()
export class PanicService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(forwardRef(() => PanicGateway)) private readonly gateway: PanicGateway,
  ) {}

  async create(input: {
    clientEventId: string;
    tripId?: string;
    raisedBy: 'PASSENGER' | 'DRIVER';
    passengerId?: string;
    driverId?: string;
    vehicleId?: string;
    location: { lat: number; lng: number };
    accuracyM?: number;
    channel: string;
    snapshot: any;
    occurredAt: string;
  }) {
    // Idempotente por clientEventId.
    const { rows: existing } = await this.pool.query(
      'SELECT id FROM panic_alerts WHERE client_event_id = $1',
      [input.clientEventId],
    );
    if (existing[0]) return { id: existing[0].id, idempotent: true };

    const { rows } = await this.pool.query(
      `INSERT INTO panic_alerts (client_event_id, trip_id, raised_by, passenger_id, driver_id, vehicle_id,
        location, accuracy_m, channel, snapshot, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9, $10, $11::jsonb, $12)
       RETURNING id`,
      [
        input.clientEventId, input.tripId ?? null, input.raisedBy, input.passengerId ?? null,
        input.driverId ?? null, input.vehicleId ?? null, input.location.lng, input.location.lat,
        input.accuracyM ?? null, input.channel, JSON.stringify(input.snapshot ?? {}), input.occurredAt,
      ],
    );
    const alertId = rows[0].id;
    try { this.gateway.emitPanic({ id: alertId, ...input }); } catch { /* no bloquear */ }
    return { id: alertId, idempotent: false };
  }

  async listOpen() {
    const { rows } = await this.pool.query(
      `SELECT * FROM v_com_open_alerts ORDER BY received_at DESC`,
    );
    return rows;
  }

  async ack(id: string, acknowledgedBy: string) {
    await this.pool.query(
      `UPDATE panic_alerts SET status = 'ACKNOWLEDGED', acknowledged_at = now(), acknowledged_by = $2 WHERE id = $1 AND status = 'OPEN'`,
      [id, acknowledgedBy],
    );
    return { ok: true };
  }

  async unitsDispatched(id: string) {
    await this.pool.query(
      `UPDATE panic_alerts SET status = 'UNITS_DISPATCHED' WHERE id = $1 AND status IN ('OPEN','ACKNOWLEDGED')`,
      [id],
    );
    return { ok: true };
  }

  async resolve(id: string, notes?: string) {
    await this.pool.query(
      `UPDATE panic_alerts SET status = 'RESOLVED', resolved_at = now(), resolution_notes = $2 WHERE id = $1`,
      [id, notes ?? null],
    );
    return { ok: true };
  }
}
