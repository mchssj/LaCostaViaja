import { Injectable, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../../database/database.module';
import { DispatchEvents } from '../dispatch/dispatch.events';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly events: DispatchEvents,
  ) {}

  async createMercadoPago(tripId: string, amountCents: number) {
    const providerReference = `MP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await this.pool.query(
      `INSERT INTO payments (trip_id, method, amount_cents, status, provider_reference, qr_data, payment_link)
       VALUES ($1, 'MERCADO_PAGO_QR', $2, 'PENDING', $3, $4, $5) RETURNING *`,
      [tripId, amountCents, providerReference, `qr://${providerReference}`, `https://mp.example/pay/${providerReference}`],
    );
    return rows[0];
  }

  async webhook(payload: any, signature: string | undefined) {
    const secret = process.env['MP_WEBHOOK_SECRET'];
    if (secret && signature) {
      const expected = createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw new BadRequestException('Firma inválida');
      }
    }
    const ref = payload?.data?.id ?? payload?.id;
    if (!ref) throw new BadRequestException('Sin referencia');
    // Idempotente: si ya está PAID, no hacer nada.
    const { rows } = await this.pool.query('SELECT id, status FROM payments WHERE provider_reference = $1', [ref]);
    if (!rows[0]) throw new BadRequestException('Pago no encontrado');
    if (rows[0].status === 'PAID') return { ok: true, idempotent: true };
    await this.pool.query(
      `UPDATE payments SET status = 'PAID', paid_at = now(), webhook_payload = $2::jsonb WHERE id = $1`,
      [rows[0].id, JSON.stringify(payload)],
    );
    await this.pool.query(`UPDATE trips SET payment_status = 'PAID' WHERE id = (SELECT trip_id FROM payments WHERE id = $1)`, [rows[0].id]);
    const { rows: t } = await this.pool.query('SELECT trip_id FROM payments WHERE id = $1', [rows[0].id]);
    if (t[0]) this.events.emit('payment.status', { tripId: t[0].trip_id, status: 'PAID' });
    return { ok: true };
  }
}
