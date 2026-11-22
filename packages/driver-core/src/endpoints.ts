// Llamadas a la API agrupadas por app. Cada acción que cambia estado lleva clientEventId para que un
// reintento (red inestable) no se aplique dos veces.
import { ApiClient, uuid } from './api';
import type { Ping } from './pings';
import type {
  CurrentOffer,
  DriverProfile,
  DriverState,
  DriverVehicle,
  LoginResponse,
  PaymentMethod,
  Point,
  Quote,
  ServiceType,
  TripView,
} from './types';

export class DriverApi {
  constructor(readonly api: ApiClient) {}

  async login(dni: string, pin: string): Promise<LoginResponse> {
    const res = await this.api.public<LoginResponse>('POST', '/auth/driver/login', { dni: dni.replace(/\D/g, ''), pin });
    await this.api.saveSession({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    return res;
  }

  logout(): Promise<void> {
    return this.api.logout();
  }

  me(): Promise<DriverProfile> {
    return this.api.get('/drivers/me');
  }

  vehicles(): Promise<DriverVehicle[]> {
    return this.api.get('/drivers/me/vehicles');
  }

  state(): Promise<DriverState> {
    return this.api.get('/drivers/me/state');
  }

  startShift(vehicleId: string): Promise<{ status: string; vehicleId: string; serviceType: ServiceType }> {
    return this.api.post('/drivers/me/shift', { vehicleId });
  }

  endShift(): Promise<{ ok: true }> {
    return this.api.delete('/drivers/me/shift');
  }

  positions(pings: Ping[]): Promise<unknown> {
    return this.api.post('/drivers/me/positions', { pings });
  }

  currentOffer(): Promise<CurrentOffer | null> {
    return this.api.get('/drivers/me/offer');
  }

  accept(offerId: string, tripId: string): Promise<unknown> {
    return this.api.post(`/offers/${offerId}/accept`, { tripId });
  }

  reject(offerId: string, tripId: string): Promise<unknown> {
    return this.api.post(`/offers/${offerId}/reject`, { tripId });
  }

  trip(id: string): Promise<TripView> {
    return this.api.get(`/trips/${id}`);
  }

  arrived(id: string, location?: Point): Promise<TripView> {
    return this.api.post(`/trips/${id}/arrived`, { clientEventId: uuid(), ...(location ? { location } : {}) });
  }

  start(id: string, location?: Point): Promise<TripView> {
    return this.api.post(`/trips/${id}/start`, { clientEventId: uuid(), ...(location ? { location } : {}) });
  }

  complete(id: string, location?: Point): Promise<TripView> {
    return this.api.post(`/trips/${id}/complete`, { clientEventId: uuid(), ...(location ? { location } : {}) });
  }

  /** El chofer devuelve el viaje antes de llegar (vuelve a búsqueda). */
  withdraw(id: string, reason = 'El chofer no puede tomar el viaje'): Promise<TripView> {
    return this.api.post(`/trips/${id}/cancel`, { clientEventId: uuid(), reason });
  }

  noShow(id: string, location?: Point): Promise<TripView> {
    return this.api.post(`/trips/${id}/cancel`, { clientEventId: uuid(), noShow: true, reason: 'El pasajero no se presentó', ...(location ? { location } : {}) });
  }

  confirmCash(id: string): Promise<unknown> {
    return this.api.post(`/trips/${id}/payment/cash`, {});
  }

  panic(input: { clientEventId: string; location: Point; accuracyM?: number; tripId?: string | null; channel: 'APP' | 'PWA' }): Promise<{ id: string }> {
    return this.api.post('/panic', {
      clientEventId: input.clientEventId,
      location: input.location,
      ...(input.accuracyM !== undefined ? { accuracyM: input.accuracyM } : {}),
      ...(input.tripId ? { tripId: input.tripId } : {}),
      channel: input.channel,
      occurredAt: new Date().toISOString(),
    });
  }
}

export class PassengerApi {
  constructor(readonly api: ApiClient) {}

  async guestLogin(qrCode: string): Promise<LoginResponse> {
    const res = await this.api.public<LoginResponse>('POST', '/auth/guest', { qrCode });
    await this.api.saveSession({ accessToken: res.accessToken, refreshToken: res.refreshToken });
    return res;
  }

  localities(): Promise<Array<{ code: string; name: string; lat: number; lng: number }>> {
    return this.api.public('GET', '/localities');
  }

  quote(origin: Point, destination: Point, serviceType: ServiceType): Promise<Quote> {
    return this.api.public('POST', '/v1/fares/quote', { origin, destination, serviceType });
  }

  createTrip(input: {
    origin: Point;
    destination: Point;
    serviceType: ServiceType;
    paymentMethod: PaymentMethod;
    quoteToken: string;
    originAddress?: string;
    destinationAddress?: string;
  }): Promise<TripView> {
    return this.api.post('/trips', input, { 'Idempotency-Key': uuid() });
  }

  trip(id: string): Promise<TripView> {
    return this.api.get(`/trips/${id}`);
  }

  mine(): Promise<TripView[]> {
    return this.api.get('/trips/mine');
  }

  cancel(id: string, reason = 'Cancelado por el pasajero'): Promise<TripView> {
    return this.api.post(`/trips/${id}/cancel`, { clientEventId: uuid(), reason });
  }

  rate(id: string, rating: number): Promise<unknown> {
    return this.api.post(`/trips/${id}/rate`, { rating });
  }

  /** Genera (o devuelve el abierto) el cobro de Mercado Pago por el monto final del viaje. */
  payWithMercadoPago(id: string): Promise<{ id: string; status: string; amount_cents: number; payment_link: string | null; paid_at: string | null }> {
    return this.api.post(`/trips/${id}/payment/mercadopago`, {}, { 'Idempotency-Key': uuid() });
  }

  panic(input: { clientEventId: string; location: Point; accuracyM?: number; tripId?: string | null }): Promise<{ id: string }> {
    return this.api.post('/panic', {
      clientEventId: input.clientEventId,
      location: input.location,
      ...(input.accuracyM !== undefined ? { accuracyM: input.accuracyM } : {}),
      ...(input.tripId ? { tripId: input.tripId } : {}),
      channel: 'PWA',
      occurredAt: new Date().toISOString(),
    });
  }
}
