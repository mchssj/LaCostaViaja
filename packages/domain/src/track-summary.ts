import { haversineMeters } from './geo';

/**
 * Resumen de un recorrido GPS para el taxímetro de referencia (auditoría y reclamos; no se cobra).
 * Descarta puntos imprecisos y saltos imposibles, igual que el filtro de presencia.
 */

export interface TrackPoint {
  readonly lat: number;
  readonly lng: number;
  /** epoch ms */
  readonly recordedAt: number;
  readonly accuracyM?: number | null;
}

export interface TrackSummary {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly usedPoints: number;
  readonly discardedPoints: number;
}

export function summarizeTrack(
  points: readonly TrackPoint[],
  opts: { maxAccuracyMeters?: number; maxPlausibleSpeedKmh?: number } = {},
): TrackSummary {
  const maxAccuracy = opts.maxAccuracyMeters ?? 100;
  const maxSpeed = opts.maxPlausibleSpeedKmh ?? 180;
  const sorted = [...points].sort((a, b) => a.recordedAt - b.recordedAt);
  let distance = 0;
  let used = 0;
  let last: TrackPoint | null = null;
  let first: TrackPoint | null = null;
  for (const p of sorted) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || (p.accuracyM ?? 0) > maxAccuracy) continue;
    if (last) {
      const seconds = (p.recordedAt - last.recordedAt) / 1000;
      if (seconds <= 0) continue;
      const meters = haversineMeters(last, p);
      if ((meters / seconds) * 3.6 > maxSpeed) continue;
      distance += meters;
    } else {
      first = p;
    }
    last = p;
    used++;
  }
  return {
    distanceMeters: Math.round(distance),
    durationSeconds: first && last ? Math.round((last.recordedAt - first.recordedAt) / 1000) : 0,
    usedPoints: used,
    discardedPoints: sorted.length - used,
  };
}
