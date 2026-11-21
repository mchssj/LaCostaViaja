/** Zona horaria oficial (Argentina no aplica horario de verano desde 2009; se usa tzdata igualmente). */
export const AR_TIMEZONE = 'America/Argentina/Buenos_Aires';

export const SERVICE_TYPES = ['TAXI', 'REMIS'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const TRIP_SCOPES = ['URBAN', 'INTERURBAN'] as const;
export type TripScope = (typeof TRIP_SCOPES)[number];

export const SEASONS = ['LOW', 'HIGH'] as const;
export type Season = (typeof SEASONS)[number];

export const TIME_BANDS = ['DAY', 'NIGHT'] as const;
export type TimeBand = (typeof TIME_BANDS)[number];

export const PAYMENT_METHODS = ['CASH', 'MERCADO_PAGO_QR', 'MERCADO_PAGO_LINK', 'VOUCHER', 'MUNICIPAL_ACCOUNT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const TRIP_STATUSES = [
  'REQUESTED',
  'SEARCHING',
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_OPERATOR',
  'NO_DRIVER_AVAILABLE',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

/** Cómo se asignó la localidad a un punto. */
export type LocalityResolutionMethod = 'CONTAINED' | 'NEAREST_FALLBACK';

/** Sentido sobre el corredor RP11 (la progresiva crece de norte a sur). */
export type CorridorDirection = 'NORTHBOUND' | 'SOUTHBOUND' | 'NONE';

/** Cómo se midió la porción del viaje fuera de la localidad de origen. */
export type InterurbanMeasurement = 'ROUTE_GEOMETRY' | 'CORRIDOR_PROJECTION' | 'NOT_APPLICABLE';
