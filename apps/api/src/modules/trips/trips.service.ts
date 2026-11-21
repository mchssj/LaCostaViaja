import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../../database/database.module';
import { DispatchEvents } from '../dispatch/dispatch.events';
import { DispatchService } from '../dispatch/dispatch.service';
import { FareCalculatorService } from '../fares/fare-calculator.service';
import type { Pool } from 'pg';

@Injectable()
export class TripsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly dispatch: DispatchService,
    private readonly fares: FareCalculatorService,
    private readonly events: DispatchEvents,
  ) {}

  async createTrip(input: {
    passengerId: string;
    channel: string;
    serviceType: 'TAXI' | 'REMIS';
    origin: { lat: number; lng: number };
    destination: { lat: number; lng: number };
    originAddress?: string;
    destinationAddress?: string;
    paymentMethod: string;
    voucherCode?: string;
  }) {
    // Cotizar con el motor tarifario (precio cerrado).
    const quote = await this.fares.quote({
      origin: input.origin,
      destination: input.destination,
      serviceType: input.serviceType as any,
      pricingInstant: new Date(),
    });

    const originLocality = quote.origin.locality.id;
    const destLocality = quote.destination.locality.id;

    const { rows } = await this.pool.query(
      `INSERT INTO trips (
        passenger_id, channel, service_type, status, origin, destination, origin_address, destination_address,
        origin_locality_id, destination_locality_id, scope, tariff_rule_id, pricing_instant,
        quoted_fare_cents, fare_breakdown, payment_method, voucher_code
      ) VALUES (
        $1, $2, $3, 'REQUESTED', ST_SetSRID(ST_MakePoint($4, $5), 4326), ST_SetSRID(ST_MakePoint($6, $7), 4326),
        $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18
      ) RETURNING id, public_code, status, quoted_fare_cents`,
      [
        input.passengerId, input.channel, input.serviceType,
        input.origin.lng, input.origin.lat, input.destination.lng, input.destination.lat,
        input.originAddress ?? null, input.destinationAddress ?? null,
        originLocality, destLocality, quote.scope, quote.tariff.ruleId, quote.pricingInstant,
        quote.totalCents, JSON.stringify(quote), input.paymentMethod, input.voucherCode ?? null,
      ],
    );
    const trip = rows[0];

    // Iniciar despacho.
    try {
      await this.dispatch.startDispatch(trip.id);
    } catch {
      // Si falla el despacho, el viaje queda en REQUESTED para reintento.
    }

    return trip;
  }

  async getTrip(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM trips WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundException('Viaje no encontrado');
    return rows[0];
  }

  async cancelTrip(id: string, passengerId: string, reason?: string) {
    const trip = await this.getTrip(id);
    if (trip.passenger_id !== passengerId) throw new BadRequestException('No autorizado');
    if (['COMPLETED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_OPERATOR'].includes(trip.status)) {
      throw new ConflictException('El viaje ya fue cerrado');
    }
    await this.pool.query(
      `UPDATE trips SET status = 'CANCELLED_BY_PASSENGER', cancelled_at = now(), cancellation_reason = $2, version = version + 1 WHERE id = $1`,
      [id, reason ?? null],
    );
    this.events.emit('trip.status_changed', { tripId: id, status: 'CANCELLED_BY_PASSENGER', at: new Date().toISOString() });
    // Liberar voucher si corresponde (reserva → liberación).
    if (trip.voucher_code && trip.payment_method === 'VOUCHER') {
      // La liberación real del saldo la hace el servicio de vouchers (pendiente).
    }
    return { ok: true };
  }

  async changeDestination(id: string, passengerId: string, newDestination: { lat: number; lng: number }) {
    const trip = await this.getTrip(id);
    if (trip.passenger_id !== passengerId) throw new BadRequestException('No autorizado');
    if (!['ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status)) {
      throw new ConflictException('No se puede cambiar el destino en este estado');
    }
    const { rows: geo } = await this.pool.query('SELECT ST_X(origin) AS lng, ST_Y(origin) AS lat FROM trips WHERE id = $1', [id]);
    const origin = { lat: geo[0].lat, lng: geo[0].lng };
    const quote = await this.fares.quote({
      origin,
      destination: newDestination,
      serviceType: trip.service_type,
      pricingInstant: trip.started_at ? new Date(trip.started_at) : new Date(),
    });
    await this.pool.query(
      `UPDATE trips SET destination = ST_SetSRID(ST_MakePoint($2, $3), 4326), destination_locality_id = $4,
        quoted_fare_cents = $5, fare_breakdown = $6::jsonb, version = version + 1 WHERE id = $1`,
      [id, newDestination.lng, newDestination.lat, quote.destination.locality.id, quote.totalCents, JSON.stringify(quote)],
    );
    this.events.emit('trip.fare_changed', { tripId: id, newFareCents: quote.totalCents });
    return { newFareCents: quote.totalCents, quote };
  }

  async rateTrip(id: string, passengerId: string, rating: number) {
    const trip = await this.getTrip(id);
    if (trip.passenger_id !== passengerId) throw new BadRequestException('No autorizado');
    if (trip.status !== 'COMPLETED') throw new ConflictException('Solo se puede calificar un viaje completado');
    if (rating < 1 || rating > 5) throw new BadRequestException('Calificación 1-5');
    await this.pool.query('UPDATE trips SET passenger_rating = $2 WHERE id = $1', [id, rating]);
    return { ok: true };
  }

  // ---- Chofer ----
  async driverArrived(id: string) {
    await this.pool.query(
      `UPDATE trips SET status = 'DRIVER_ARRIVED', driver_arrived_at = now(), version = version + 1 WHERE id = $1 AND status = 'ASSIGNED'`,
      [id],
    );
    this.events.emit('trip.status_changed', { tripId: id, status: 'DRIVER_ARRIVED', at: new Date().toISOString() });
    return { ok: true };
  }

  async startTrip(id: string) {
    await this.pool.query(
      `UPDATE trips SET status = 'IN_PROGRESS', started_at = now(), version = version + 1 WHERE id = $1 AND status = 'DRIVER_ARRIVED'`,
      [id],
    );
    this.events.emit('trip.status_changed', { tripId: id, status: 'IN_PROGRESS', at: new Date().toISOString() });
    return { ok: true };
  }

  async completeTrip(id: string, meteredFareCents?: number) {
    const trip = await this.getTrip(id);
    if (trip.status !== 'IN_PROGRESS') throw new ConflictException('El viaje no está en curso');
    await this.pool.query(
      `UPDATE trips SET status = 'COMPLETED', completed_at = now(), final_fare_cents = quoted_fare_cents,
        metered_fare_cents = $2, version = version + 1 WHERE id = $1`,
      [id, meteredFareCents ?? null],
    );
    this.events.emit('trip.status_changed', { tripId: id, status: 'COMPLETED', at: new Date().toISOString() });
    // TODO: releaseAfterTrip en Redis (Viaje de Vuelta) + iniciar cobro según método de pago.
    return { ok: true };
  }

  async driverCancel(id: string, reason?: string) {
    const trip = await this.getTrip(id);
    if (!['ASSIGNED', 'DRIVER_ARRIVED'].includes(trip.status)) {
      throw new ConflictException('No se puede cancelar en este estado');
    }
    // Vuelve a búsqueda.
    await this.pool.query(
      `UPDATE trips SET status = 'SEARCHING', driver_id = NULL, vehicle_id = NULL, agency_id = NULL,
        assigned_at = NULL, driver_arrived_at = NULL, cancellation_reason = $2, version = version + 1 WHERE id = $1`,
      [id, reason ?? null],
    );
    try { await this.dispatch.startDispatch(id); } catch { /* reintento posterior */ }
    return { ok: true };
  }

  async cashPayment(id: string, amountCents: number) {
    const trip = await this.getTrip(id);
    await this.pool.query(
      `INSERT INTO payments (trip_id, method, amount_cents, status, paid_at) VALUES ($1, 'CASH', $2, 'PAID', now())`,
      [id, amountCents],
    );
    await this.pool.query(`UPDATE trips SET payment_status = 'PAID' WHERE id = $1`, [id]);
    this.events.emit('payment.status', { tripId: id, status: 'PAID' });
    return { ok: true };
  }
}
