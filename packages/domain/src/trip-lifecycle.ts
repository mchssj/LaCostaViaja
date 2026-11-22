import type { TripStatus } from './enums';
import { DomainError } from './errors';

/**
 * Máquina de estados del viaje (pura). Define qué transición se permite, desde qué estados y quién
 * puede pedirla. La API solo la aplica dentro de una transacción con bloqueo de fila; así las reglas
 * no quedan repartidas en cada endpoint.
 */

export type TripAction =
  | 'DRIVER_ARRIVED'
  | 'START'
  | 'COMPLETE'
  | 'PASSENGER_CANCEL'
  | 'DRIVER_CANCEL'
  | 'DRIVER_NO_SHOW'
  | 'OPERATOR_CANCEL';

export type TripActor = 'PASSENGER' | 'DRIVER' | 'OPERATOR' | 'SYSTEM';

interface TransitionRule {
  readonly from: readonly TripStatus[];
  readonly to: TripStatus;
  readonly actors: readonly TripActor[];
  readonly eventType: string;
}

export const TRIP_TRANSITIONS: Readonly<Record<TripAction, TransitionRule>> = {
  DRIVER_ARRIVED: { from: ['ASSIGNED'], to: 'DRIVER_ARRIVED', actors: ['DRIVER'], eventType: 'DRIVER_ARRIVED' },
  START: { from: ['DRIVER_ARRIVED'], to: 'IN_PROGRESS', actors: ['DRIVER'], eventType: 'TRIP_STARTED' },
  COMPLETE: { from: ['IN_PROGRESS'], to: 'COMPLETED', actors: ['DRIVER'], eventType: 'TRIP_COMPLETED' },
  PASSENGER_CANCEL: {
    from: ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'],
    to: 'CANCELLED_BY_PASSENGER',
    actors: ['PASSENGER'],
    eventType: 'CANCELLED_BY_PASSENGER',
  },
  // El chofer se baja antes de llegar: el viaje vuelve a búsqueda (no se le corta al pasajero).
  DRIVER_CANCEL: { from: ['ASSIGNED'], to: 'SEARCHING', actors: ['DRIVER'], eventType: 'DRIVER_WITHDREW' },
  // El pasajero no se presentó: solo después de esperar el mínimo en la puerta.
  DRIVER_NO_SHOW: { from: ['DRIVER_ARRIVED'], to: 'CANCELLED_BY_DRIVER', actors: ['DRIVER'], eventType: 'PASSENGER_NO_SHOW' },
  OPERATOR_CANCEL: {
    from: ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED', 'IN_PROGRESS'],
    to: 'CANCELLED_BY_OPERATOR',
    actors: ['OPERATOR'],
    eventType: 'CANCELLED_BY_OPERATOR',
  },
};

export const ACTIVE_TRIP_STATUSES: readonly TripStatus[] = ['ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS'];
export const OPEN_TRIP_STATUSES: readonly TripStatus[] = ['REQUESTED', 'SEARCHING', ...ACTIVE_TRIP_STATUSES];

export class InvalidTransitionError extends DomainError {
  constructor(action: TripAction, current: TripStatus, details: Readonly<Record<string, unknown>> = {}) {
    super('INVALID_TRANSITION', `No se puede ${ACTION_LABELS[action]} un viaje en estado ${current}`, { action, current, ...details });
  }
}

const ACTION_LABELS: Record<TripAction, string> = {
  DRIVER_ARRIVED: 'marcar la llegada en',
  START: 'iniciar',
  COMPLETE: 'completar',
  PASSENGER_CANCEL: 'cancelar (pasajero)',
  DRIVER_CANCEL: 'devolver',
  DRIVER_NO_SHOW: 'cerrar por ausencia del pasajero',
  OPERATOR_CANCEL: 'cancelar (operador)',
};

export interface TransitionContext {
  /** Instante de llegada del chofer (para "no se presentó"). */
  readonly driverArrivedAt?: Date | null;
  readonly now?: Date;
  /** Espera mínima en la puerta antes de poder cerrar por ausencia. */
  readonly noShowWaitMs?: number;
}

export interface PlannedTransition {
  readonly action: TripAction;
  readonly from: TripStatus;
  readonly to: TripStatus;
  readonly eventType: string;
}

export function planTripTransition(
  current: TripStatus,
  action: TripAction,
  actor: TripActor,
  ctx: TransitionContext = {},
): PlannedTransition {
  const rule = TRIP_TRANSITIONS[action];
  if (!rule.actors.includes(actor)) {
    throw new DomainError('FORBIDDEN', `Un ${actor} no puede ${ACTION_LABELS[action]} un viaje`, { action, actor });
  }
  if (!rule.from.includes(current)) throw new InvalidTransitionError(action, current);
  if (action === 'DRIVER_NO_SHOW') {
    const waitMs = ctx.noShowWaitMs ?? 5 * 60_000;
    const arrived = ctx.driverArrivedAt?.getTime();
    const now = (ctx.now ?? new Date()).getTime();
    if (arrived === undefined || now - arrived < waitMs) {
      const remainingSeconds = arrived === undefined ? Math.ceil(waitMs / 1000) : Math.ceil((waitMs - (now - arrived)) / 1000);
      throw new InvalidTransitionError(action, current, { reason: 'NO_SHOW_WAIT_NOT_REACHED', remainingSeconds });
    }
  }
  return { action, from: current, to: rule.to, eventType: rule.eventType };
}
