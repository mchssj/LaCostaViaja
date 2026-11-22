// Respuestas de la API que usan las apps cliente (subconjunto: solo lo que se muestra).
import type { DriverPresenceStatus, PaymentMethod, ServiceType, TripStatus } from '@lacosta/domain';

export type { DriverPresenceStatus, PaymentMethod, ServiceType, TripStatus };

export interface Point {
  readonly lat: number;
  readonly lng: number;
}

export interface LoginResponse {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly user: { readonly id: string; readonly kind: string; readonly role?: string };
}

export interface DriverProfile {
  readonly id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly phone: string | null;
  readonly status: string;
  readonly suspension_reason: string | null;
  readonly accepts_interurban: boolean;
  readonly agency_name: string | null;
  readonly base_locality_name: string | null;
  readonly municipal_driver_permit_number: string;
  readonly municipal_driver_permit_expires_on: string;
  readonly professional_license_class: string | null;
  readonly professional_license_expires_on: string;
  readonly criminal_record_expires_on: string;
}

export interface DriverVehicle {
  readonly vehicle_id: string;
  readonly plate: string;
  readonly make: string;
  readonly model: string;
  readonly model_year: number | null;
  readonly color: string | null;
  readonly service_type: ServiceType;
  readonly role: string;
  readonly is_eligible: boolean;
  readonly blocking_reasons: string[];
  readonly next_expiry_on: string | null;
  readonly agency_name: string | null;
}

export interface DriverState {
  readonly status: DriverPresenceStatus;
  readonly vehicleId?: string | null;
  readonly tripId?: string | null;
  readonly position?: { lat: number; lng: number; recordedAt: number } | null;
}

export interface CurrentOffer {
  readonly offer_id: string;
  readonly trip_id: string;
  readonly round: number;
  readonly rank: number;
  readonly eta_seconds: number;
  readonly expires_at: string;
  readonly backhaul_match: string | null;
  readonly public_code: string;
  readonly service_type: ServiceType;
  readonly scope: 'URBAN' | 'INTERURBAN';
  readonly quoted_fare_cents: number;
  readonly origin_lat: number;
  readonly origin_lng: number;
  readonly origin_address: string | null;
  readonly destination_lat: number;
  readonly destination_lng: number;
  readonly destination_address: string | null;
}

export interface TripPlace extends Point {
  readonly address: string | null;
  readonly locality: string;
}

/** Línea del desglose. La API ya trae la etiqueta y el detalle en castellano. */
export interface FareLine {
  readonly code: string;
  readonly label?: string;
  readonly detail?: string;
  readonly amountCents: number;
}

export interface TripView {
  readonly id: string;
  readonly public_code: string;
  readonly status: TripStatus;
  readonly service_type: ServiceType;
  readonly scope: 'URBAN' | 'INTERURBAN';
  readonly origin: TripPlace;
  readonly destination: TripPlace;
  readonly quoted_fare_cents: number;
  readonly final_fare_cents: number | null;
  readonly metered_fare_cents: number | null;
  readonly fare_lines: FareLine[];
  readonly payment_method: PaymentMethod;
  readonly payment_status: string;
  readonly is_backhaul_assignment: boolean;
  readonly requested_at: string;
  readonly assigned_at: string | null;
  readonly driver_arrived_at: string | null;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly cancelled_at: string | null;
  readonly cancellation_reason: string | null;
  readonly passenger_rating: number | null;
  readonly driver: { first_name: string | null; last_name: string | null; phone: string | null } | null;
  readonly vehicle: { plate: string | null; make: string | null; model: string | null; color: string | null } | null;
  readonly last_seq: number;
}

export interface Quote {
  readonly totalCents: number;
  readonly totalFormatted?: string;
  readonly scope: 'URBAN' | 'INTERURBAN';
  readonly lines: FareLine[];
  readonly tariff: { season: 'LOW' | 'HIGH'; timeBand: 'DAY' | 'NIGHT'; scheduleCode: string };
  readonly validUntil: string;
  readonly quoteToken: string;
  readonly serviceType: ServiceType;
  readonly route: { readonly distanceMeters: number; readonly durationSeconds: number; readonly degraded: boolean };
  readonly origin: { readonly point: Point; readonly locality: { readonly name: string } };
  readonly destination: { readonly point: Point; readonly locality: { readonly name: string } };
}

/** Mensaje de Socket.IO de un evento del viaje (trip.status, payment.status, trip.fare_changed). */
export interface TripEventMessage {
  readonly seq: number;
  readonly tripId: string;
  readonly type: string;
  readonly at: string;
  readonly data: Record<string, unknown>;
}

export interface OfferMessage {
  readonly type: 'offer.created' | 'offer.closed';
  readonly tripId: string;
  readonly replay?: boolean;
  readonly data: { offerId: string; expiresAt?: number; etaSeconds?: number; outcome?: string };
}
