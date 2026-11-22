import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError, NotFoundError } from '@lacosta/domain';
import type { Pool, PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import type { Principal } from '../../security/principal';
import { RealtimeService } from '../realtime/realtime.service';
import { TripEventsRepository } from '../trip-events/trip-events.repository';
import { PAYMENT_PROVIDER, verifyMercadoPagoSignature, type IPaymentProvider } from './payment-provider';

type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'REFUNDED';

const MP_METHODS = ['MERCADO_PAGO_QR', 'MERCADO_PAGO_LINK'];

function mapProviderStatus(status: string): PaymentStatus {
  switch (status) {
    case 'approved':
      return 'PAID';
    case 'authorized':
      return 'AUTHORIZED';
    case 'rejected':
    case 'cancelled':
      return 'FAILED';
    case 'refunded':
    case 'charged_back':
      return 'REFUNDED';
    default:
      return 'PENDING';
  }
}

interface TripPaymentRow {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  status: string;
  payment_method: string;
  payment_status: string;
  quoted_fare_cents: number;
  final_fare_cents: number | null;
  public_code: string;
}

/**
 * Cobros. El monto SIEMPRE sale del viaje (nunca del cliente). Efectivo lo confirma el chofer;
 * Mercado Pago se confirma solo por webhook firmado y consultando el estado real al proveedor;
 * vouchers se liquidan dentro de la transacción de fin de viaje.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: IPaymentProvider,
    private readonly tripEvents: TripEventsRepository,
    private readonly realtime: RealtimeService,
  ) {}

  /** El chofer confirma que cobró en efectivo el monto final. Idempotente. */
  async confirmCash(principal: Principal, tripId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const trip = await this.lockTrip(client, tripId);
      if (principal.kind !== 'DRIVER' || trip.driver_id !== principal.id) {
        throw new DomainError('FORBIDDEN', 'Solo el chofer del viaje puede confirmar el cobro en efectivo');
      }
      if (trip.status !== 'COMPLETED') throw new DomainError('INVALID_TRANSITION', 'El cobro se confirma al terminar el viaje');
      if (trip.payment_method !== 'CASH') {
        throw new DomainError('INVALID_INPUT', `El viaje se paga con ${trip.payment_method}, no en efectivo`);
      }
      const amount = trip.final_fare_cents ?? trip.quoted_fare_cents;
      const existing = await client.query(`SELECT * FROM payments WHERE trip_id = $1 AND method = 'CASH' AND status = 'PAID'`, [tripId]);
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { ...this.view(existing.rows[0]), idempotent: true };
      }
      const { rows } = await client.query(
        `INSERT INTO payments (trip_id, method, amount_cents, status, paid_at) VALUES ($1, 'CASH', $2, 'PAID', now()) RETURNING *`,
        [tripId, amount],
      );
      await client.query(`UPDATE trips SET payment_status = 'PAID' WHERE id = $1`, [tripId]);
      const event = await this.tripEvents.insert(client, {
        tripId,
        type: 'PAYMENT_PAID',
        actorRole: 'DRIVER',
        actorId: principal.id,
        data: { status: 'PAID', method: 'CASH', amountCents: amount },
      });
      await client.query('COMMIT');
      this.realtime.publishTripEvent(event, { driverIds: [trip.driver_id] });
      return { ...this.view(rows[0]), idempotent: false };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Link / QR de Mercado Pago por el monto del viaje. Reintentar devuelve el mismo cobro abierto. */
  async createMercadoPago(principal: Principal, tripId: string) {
    const client = await this.pool.connect();
    let paymentId: string;
    let amount: number;
    let trip: TripPaymentRow;
    try {
      await client.query('BEGIN');
      trip = await this.lockTrip(client, tripId);
      const isPassenger = (principal.kind === 'PASSENGER' || principal.kind === 'GUEST') && trip.passenger_id === principal.id;
      const isDriver = principal.kind === 'DRIVER' && trip.driver_id === principal.id;
      if (!isPassenger && !isDriver) throw new DomainError('FORBIDDEN', 'Solo el pasajero o el chofer del viaje pueden generar el cobro');
      if (!MP_METHODS.includes(trip.payment_method)) {
        throw new DomainError('INVALID_INPUT', `El viaje se paga con ${trip.payment_method}, no con Mercado Pago`);
      }
      if (!['IN_PROGRESS', 'COMPLETED'].includes(trip.status)) {
        throw new DomainError('INVALID_TRANSITION', 'El cobro con Mercado Pago se genera durante o al final del viaje');
      }
      if (trip.payment_status === 'PAID') throw new DomainError('INVALID_TRANSITION', 'El viaje ya está pagado');
      amount = trip.final_fare_cents ?? trip.quoted_fare_cents;
      const open = await client.query(`SELECT * FROM payments WHERE trip_id = $1 AND method::text = ANY($2::text[]) AND status = 'PENDING'`, [
        tripId,
        MP_METHODS,
      ]);
      if (open.rows[0] && open.rows[0].amount_cents === amount && open.rows[0].payment_link) {
        await client.query('COMMIT');
        return { ...this.view(open.rows[0]), idempotent: true };
      }
      if (open.rows[0]) await client.query(`UPDATE payments SET status = 'FAILED', provider_status = 'superseded' WHERE id = $1`, [open.rows[0].id]);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO payments (trip_id, method, amount_cents, status) VALUES ($1, $2, $3, 'PENDING') RETURNING id`,
        [tripId, trip.payment_method, amount],
      );
      paymentId = rows[0]!.id;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    try {
      const checkout = await this.provider.createCheckout({
        paymentId,
        tripId,
        amountCents: amount,
        description: `Viaje ${trip.public_code} · La Costa Viaja`,
        notificationUrl: `${this.config.payments.publicBaseUrl}/api/payments/mercadopago/webhook`,
      });
      const { rows } = await this.pool.query(
        `UPDATE payments SET provider_preference_id = $2, payment_link = $3, qr_data = $3 WHERE id = $1 RETURNING *`,
        [paymentId, checkout.preferenceId, checkout.link],
      );
      return { ...this.view(rows[0]), idempotent: false };
    } catch (err) {
      await this.pool.query(`UPDATE payments SET status = 'FAILED', provider_status = 'checkout_error' WHERE id = $1`, [paymentId]);
      throw err;
    }
  }

  /**
   * Webhook de Mercado Pago. Firma obligatoria (sin secreto configurado se rechaza todo).
   * El estado y el monto se consultan al proveedor; external_reference es nuestro id de pago.
   */
  async handleMercadoPagoWebhook(p: {
    dataId: string | undefined;
    type: string | undefined;
    xSignature: string | undefined;
    xRequestId: string | undefined;
    rawBody: unknown;
  }): Promise<{ ok: true; result: string }> {
    const secret = this.config.payments.mpWebhookSecret;
    if (!secret) throw new DomainError('SERVICE_DEGRADED', 'Webhook de pagos sin configurar (MP_WEBHOOK_SECRET)');
    if (!verifyMercadoPagoSignature({ xSignature: p.xSignature, xRequestId: p.xRequestId, dataId: p.dataId, secret })) {
      throw new DomainError('UNAUTHORIZED', 'Firma de webhook inválida');
    }
    if (p.type !== 'payment' || !p.dataId) return { ok: true, result: 'ignored' };

    const remote = await this.provider.getPayment(p.dataId);
    if (!remote.externalReference) return { ok: true, result: 'unknown_reference' };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT * FROM payments WHERE id::text = $1 FOR UPDATE`, [remote.externalReference]);
      const payment = rows[0];
      if (!payment) {
        await client.query('COMMIT');
        this.logger.warn(`Webhook con external_reference desconocido: ${remote.externalReference}`);
        return { ok: true, result: 'unknown_reference' };
      }
      let next = mapProviderStatus(remote.status);
      if (next === 'PAID' && remote.amountCents !== payment.amount_cents) {
        this.logger.error(`Pago ${payment.id}: Mercado Pago informó ${remote.amountCents} y se esperaba ${payment.amount_cents}`);
        next = 'FAILED';
      }
      if (payment.status === next || payment.status === 'PAID' && next !== 'REFUNDED') {
        await client.query('COMMIT');
        return { ok: true, result: 'unchanged' };
      }
      await client.query(
        `UPDATE payments SET status = $2::payment_status, provider_reference = $3, provider_status = $4, webhook_payload = $5::jsonb,
                             paid_at = CASE WHEN $2::text = 'PAID' THEN now() ELSE paid_at END
         WHERE id = $1`,
        [payment.id, next, remote.providerPaymentId, remote.status, JSON.stringify(p.rawBody ?? {})],
      );
      const tripStatus = next === 'PAID' ? 'PAID' : next === 'REFUNDED' ? 'REFUNDED' : next === 'FAILED' ? 'FAILED' : 'PENDING';
      const { rows: t } = await client.query<{ driver_id: string | null }>(
        `UPDATE trips SET payment_status = $2 WHERE id = $1 RETURNING driver_id`,
        [payment.trip_id, tripStatus],
      );
      const event = await this.tripEvents.insert(client, {
        tripId: payment.trip_id,
        type: `PAYMENT_${next}`,
        actorRole: 'SYSTEM',
        actorId: null,
        data: { status: next, method: payment.method, amountCents: payment.amount_cents },
      });
      await client.query('COMMIT');
      this.realtime.publishTripEvent(event, { driverIds: [t[0]?.driver_id ?? null] });
      return { ok: true, result: next };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Registra el pago con voucher dentro de la transacción de fin de viaje. */
  async recordVoucherPayment(client: PoolClient, tripId: string, method: string, amountCents: number): Promise<void> {
    await client.query(`INSERT INTO payments (trip_id, method, amount_cents, status, paid_at) VALUES ($1, $2, $3, 'PAID', now())`, [
      tripId,
      method,
      amountCents,
    ]);
    await client.query(`UPDATE trips SET payment_status = 'PAID' WHERE id = $1`, [tripId]);
  }

  private async lockTrip(client: PoolClient, tripId: string): Promise<TripPaymentRow> {
    const { rows } = await client.query<TripPaymentRow>(
      `SELECT id, passenger_id, driver_id, status, payment_method, payment_status, quoted_fare_cents, final_fare_cents, public_code
       FROM trips WHERE id = $1 FOR UPDATE`,
      [tripId],
    );
    if (!rows[0]) throw new NotFoundError('Viaje inexistente', { tripId });
    return rows[0];
  }

  private view(row: Record<string, unknown>) {
    return {
      id: row['id'],
      trip_id: row['trip_id'],
      method: row['method'],
      amount_cents: row['amount_cents'],
      status: row['status'],
      payment_link: row['payment_link'] ?? null,
      qr_data: row['qr_data'] ?? null,
      paid_at: row['paid_at'] ?? null,
    };
  }
}
