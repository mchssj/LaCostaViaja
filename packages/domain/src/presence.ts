import { haversineMeters, type GeoPoint } from './geo';

/** Estados de presencia de un chofer en turno (viven en Redis). */
export const DRIVER_PRESENCE_STATUSES = ['OFFLINE', 'AVAILABLE', 'OFFERED', 'ASSIGNED', 'ON_TRIP', 'RETURNING'] as const;
export type DriverPresenceStatus = (typeof DRIVER_PRESENCE_STATUSES)[number];

/** Estados en los que el chofer puede recibir una oferta. */
export const DISPATCHABLE_STATUSES: readonly DriverPresenceStatus[] = ['AVAILABLE', 'RETURNING'];

export interface GpsPing {
  readonly lat: number;
  readonly lng: number;
  /** Hora del dispositivo, epoch ms. */
  readonly recordedAt: number;
  readonly speedKmh?: number;
  readonly headingDeg?: number;
  readonly accuracyM?: number;
}

export interface PingLimits {
  /** Peor precisión aceptada para mover al chofer en el despacho. */
  readonly maxAccuracyMeters: number;
  /** Velocidad por encima de la cual un salto se considera imposible. */
  readonly maxPlausibleSpeedKmh: number;
  /** Tolerancia de reloj adelantado del dispositivo. */
  readonly maxFutureSkewMs: number;
  /** Saltos menores a esto no se evalúan (ruido GPS con pings muy seguidos). */
  readonly minJumpMeters: number;
}

export const DEFAULT_PING_LIMITS: PingLimits = {
  maxAccuracyMeters: 100,
  maxPlausibleSpeedKmh: 180,
  maxFutureSkewMs: 120_000,
  minJumpMeters: 200,
};

export type PingVerdict =
  /** Mueve al chofer en el despacho. */
  | { readonly kind: 'APPLY'; readonly recordedAt: number }
  /** Señal de vida, sin mover la posición de despacho. */
  | { readonly kind: 'HEARTBEAT_ONLY'; readonly recordedAt: number; readonly reason: 'LOW_ACCURACY' | 'IMPOSSIBLE_JUMP' }
  /** Más viejo que la última posición aplicada (lote offline tardío o reintento). */
  | { readonly kind: 'STALE'; readonly recordedAt: number };

export interface LastFix extends GeoPoint {
  readonly recordedAt: number;
}

/** Clasifica un ping respecto de la última posición aplicada. Puro y determinístico. */
export function classifyPing(
  last: LastFix | null,
  ping: GpsPing,
  nowMs: number,
  limits: PingLimits = DEFAULT_PING_LIMITS,
): PingVerdict {
  // Reloj del celular adelantado: se usa la hora del servidor.
  const recordedAt = ping.recordedAt > nowMs + limits.maxFutureSkewMs ? nowMs : ping.recordedAt;
  if (last && recordedAt <= last.recordedAt) return { kind: 'STALE', recordedAt };
  if (ping.accuracyM !== undefined && ping.accuracyM > limits.maxAccuracyMeters) {
    return { kind: 'HEARTBEAT_ONLY', recordedAt, reason: 'LOW_ACCURACY' };
  }
  if (last) {
    const meters = haversineMeters(last, ping);
    const seconds = (recordedAt - last.recordedAt) / 1000;
    if (meters >= limits.minJumpMeters && (meters / seconds) * 3.6 > limits.maxPlausibleSpeedKmh) {
      return { kind: 'HEARTBEAT_ONLY', recordedAt, reason: 'IMPOSSIBLE_JUMP' };
    }
  }
  return { kind: 'APPLY', recordedAt };
}
