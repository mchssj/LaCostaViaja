import type { GeoPoint } from './geo';

export type DomainErrorCode =
  | 'INVALID_INPUT'
  | 'OUT_OF_SERVICE_AREA'
  | 'TARIFF_NOT_CONFIGURED'
  | 'ROUTING_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'DRIVER_NOT_ELIGIBLE'
  | 'DRIVER_NOT_ON_SHIFT'
  | 'DISPATCH_CONFLICT'
  | 'SERVICE_DEGRADED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYMENT_ERROR'
  | 'VOUCHER_REJECTED';

/** Error de negocio con código estable (la API lo traduce a HTTP sin acoplar el dominio a Nest). */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidInputError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('INVALID_INPUT', message, details);
  }
}

export type OutOfServiceReason = 'OUTSIDE_DISTRICT_BBOX' | 'NO_LOCALITY_NEARBY';

export class OutOfServiceAreaError extends DomainError {
  constructor(which: 'ORIGIN' | 'DESTINATION', point: GeoPoint, reason: OutOfServiceReason) {
    super(
      'OUT_OF_SERVICE_AREA',
      `${which === 'ORIGIN' ? 'El origen' : 'El destino'} está fuera del área de servicio del Partido de La Costa`,
      { which, point, reason },
    );
  }
}

export class TariffNotConfiguredError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('TARIFF_NOT_CONFIGURED', message, details);
  }
}

export class RoutingUnavailableError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('ROUTING_UNAVAILABLE', message, details);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('NOT_FOUND', message, details);
  }
}

export class DriverNotEligibleError extends DomainError {
  constructor(reasons: readonly string[], details: Readonly<Record<string, unknown>> = {}) {
    super('DRIVER_NOT_ELIGIBLE', `El chofer no está habilitado para operar: ${reasons.join(', ')}`, { reasons, ...details });
  }
}

export class DriverNotOnShiftError extends DomainError {
  constructor(driverId: string) {
    super('DRIVER_NOT_ON_SHIFT', 'El chofer no tiene un turno abierto', { driverId });
  }
}

/** Motivos de conflicto del despacho (estables: la app del chofer los muestra). */
export type DispatchConflictReason =
  | 'OFFER_EXPIRED'
  | 'ALREADY_TAKEN'
  | 'TRIP_CANCELLED'
  | 'TRIP_NOT_SEARCHING'
  | 'CLAIM_FAILED'
  | 'DRIVER_BUSY'
  | 'VEHICLE_IN_USE'
  | 'INVALID_STATE'
  | 'PASSENGER_HAS_OPEN_TRIP';

export class DispatchConflictError extends DomainError {
  constructor(
    readonly reason: DispatchConflictReason,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super('DISPATCH_CONFLICT', message, { reason, ...details });
  }
}

export class ServiceDegradedError extends DomainError {
  constructor(message: string, details: Readonly<Record<string, unknown>> = {}) {
    super('SERVICE_DEGRADED', message, details);
  }
}
