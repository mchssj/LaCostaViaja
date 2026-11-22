// Qué se muestra y qué se puede hacer en cada estado del viaje, desde el chofer y desde el pasajero.
// Las reglas de transición son las de @lacosta/domain (TRIP_TRANSITIONS); acá se repiten solo los
// estados de origen para no cargar el paquete de dominio en runtime (un test verifica que coincidan).
import type { TripStatus, TripView } from './types';

export const OPEN_STATUSES: readonly TripStatus[] = ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS'];

export function isOpen(status: TripStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export function isCancelled(status: TripStatus): boolean {
  return status.startsWith('CANCELLED') || status === 'NO_DRIVER_AVAILABLE';
}

/** Estados de origen permitidos por acción (espejo de TRIP_TRANSITIONS de @lacosta/domain). */
export const ACTION_FROM = {
  DRIVER_ARRIVED: ['ASSIGNED'],
  START: ['DRIVER_ARRIVED'],
  COMPLETE: ['IN_PROGRESS'],
  PASSENGER_CANCEL: ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'DRIVER_ARRIVED'],
  DRIVER_CANCEL: ['ASSIGNED'],
  DRIVER_NO_SHOW: ['DRIVER_ARRIVED'],
} as const satisfies Record<string, readonly TripStatus[]>;

type ActionKey = keyof typeof ACTION_FROM;

function allowed(action: ActionKey, status: TripStatus): boolean {
  return (ACTION_FROM[action] as readonly TripStatus[]).includes(status);
}

export type DriverActionKey = 'arrived' | 'start' | 'complete' | 'withdraw' | 'noShow';

export interface DriverAction {
  readonly key: DriverActionKey;
  readonly label: string;
  /** primary = acción principal del paso; danger = cancelaciones. */
  readonly tone: 'primary' | 'secondary' | 'danger';
  /** Pide confirmación antes de ejecutar. */
  readonly confirm?: string;
  /** Si todavía no se puede (espera de "no se presentó"), ms que faltan. */
  readonly availableInMs?: number;
}

/**
 * Acciones del chofer según el estado. "No se presentó" aparece recién después de la espera mínima
 * en la puerta (la API la vuelve a verificar; esto solo evita un botón que va a fallar).
 */
export function driverActions(trip: Pick<TripView, 'status' | 'driver_arrived_at'>, now = Date.now(), noShowWaitMs = 5 * 60_000): DriverAction[] {
  const out: DriverAction[] = [];
  if (allowed('DRIVER_ARRIVED', trip.status)) out.push({ key: 'arrived', label: 'Llegué al punto de encuentro', tone: 'primary' });
  if (allowed('START', trip.status)) out.push({ key: 'start', label: 'Pasajero a bordo: iniciar viaje', tone: 'primary' });
  if (allowed('COMPLETE', trip.status)) out.push({ key: 'complete', label: 'Finalizar viaje', tone: 'primary', confirm: '¿Llegaron a destino?' });
  if (allowed('DRIVER_NO_SHOW', trip.status)) {
    const arrived = trip.driver_arrived_at ? Date.parse(trip.driver_arrived_at) : now;
    const left = arrived + noShowWaitMs - now;
    out.push({
      key: 'noShow',
      label: 'El pasajero no se presentó',
      tone: 'danger',
      confirm: 'Se cierra el viaje como "no se presentó". ¿Confirmás?',
      ...(left > 0 ? { availableInMs: left } : {}),
    });
  }
  if (allowed('DRIVER_CANCEL', trip.status)) {
    out.push({ key: 'withdraw', label: 'No puedo tomar el viaje', tone: 'danger', confirm: 'El viaje vuelve a la búsqueda de otro chofer. ¿Confirmás?' });
  }
  return out;
}

export function passengerCanCancel(status: TripStatus): boolean {
  return allowed('PASSENGER_CANCEL', status);
}

/** Texto del estado visto por el chofer. */
export function driverStatusText(status: TripStatus): string {
  switch (status) {
    case 'ASSIGNED':
    case 'DRIVER_EN_ROUTE':
      return 'Yendo a buscar al pasajero';
    case 'DRIVER_ARRIVED':
      return 'Esperando al pasajero';
    case 'IN_PROGRESS':
      return 'En viaje hacia el destino';
    case 'COMPLETED':
      return 'Viaje finalizado';
    case 'CANCELLED_BY_PASSENGER':
      return 'El pasajero canceló el viaje';
    case 'CANCELLED_BY_DRIVER':
      return 'Viaje cerrado: el pasajero no se presentó';
    case 'CANCELLED_BY_OPERATOR':
      return 'El COM canceló el viaje';
    case 'SEARCHING':
    case 'REQUESTED':
      return 'El viaje volvió a la búsqueda';
    default:
      return status;
  }
}

/** Pasos que ve el pasajero, en orden. */
export const PASSENGER_STEPS = [
  { key: 'search', label: 'Buscando chofer' },
  { key: 'assigned', label: 'Chofer en camino' },
  { key: 'arrived', label: 'Tu chofer llegó' },
  { key: 'onboard', label: 'En viaje' },
  { key: 'done', label: 'Llegaste' },
] as const;

/** Índice del paso actual (0..4) o -1 si el viaje terminó sin realizarse. */
export function passengerStep(status: TripStatus): number {
  switch (status) {
    case 'REQUESTED':
    case 'SEARCHING':
      return 0;
    case 'ASSIGNED':
    case 'DRIVER_EN_ROUTE':
      return 1;
    case 'DRIVER_ARRIVED':
      return 2;
    case 'IN_PROGRESS':
      return 3;
    case 'COMPLETED':
      return 4;
    default:
      return -1;
  }
}

export function passengerStatusText(status: TripStatus): string {
  switch (status) {
    case 'REQUESTED':
    case 'SEARCHING':
      return 'Estamos buscando el chofer más cercano…';
    case 'ASSIGNED':
    case 'DRIVER_EN_ROUTE':
      return 'Tu chofer está en camino';
    case 'DRIVER_ARRIVED':
      return 'Tu chofer llegó al punto de encuentro';
    case 'IN_PROGRESS':
      return 'En viaje';
    case 'COMPLETED':
      return '¡Llegaste a destino!';
    case 'NO_DRIVER_AVAILABLE':
      return 'No encontramos choferes disponibles en este momento';
    case 'CANCELLED_BY_PASSENGER':
      return 'Cancelaste el viaje';
    case 'CANCELLED_BY_DRIVER':
      return 'El viaje se cerró porque el chofer no te encontró';
    case 'CANCELLED_BY_OPERATOR':
      return 'El viaje fue cancelado por la central';
    default:
      return status;
  }
}
