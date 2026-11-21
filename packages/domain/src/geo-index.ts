import type { GeoPoint } from './geo';

/**
 * Geometría pura para el camino caliente (cada ping GPS): pertenencia a localidad/parada y
 * progresiva sobre RP11 sin ir a PostGIS. Los datos se cargan desde PostGIS (fuente de verdad)
 * y se refrescan periódicamente; un test de integración compara ambos cálculos.
 */

/** [lng, lat] como en GeoJSON. */
export type LngLat = readonly [number, number];
/** Polígono GeoJSON: anillo exterior + agujeros. */
export type PolygonRings = ReadonlyArray<ReadonlyArray<LngLat>>;

export interface IndexedLocality {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly corridorOrder: number;
  readonly polygons: ReadonlyArray<PolygonRings>;
}

export interface IndexedZone {
  readonly id: string;
  readonly code: string;
  readonly localityId: string;
  readonly dispatchPriority: number;
  readonly polygon: PolygonRings;
}

export interface CorridorProjection {
  /** Progresiva en metros desde el inicio (norte) del eje. */
  readonly positionMeters: number;
  /** Distancia perpendicular al eje, en metros. */
  readonly lateralMeters: number;
}

/** Punto en anillo (ray casting). El borde exacto puede caer de cualquier lado: se desempata arriba. */
function pointInRing(lng: number, lat: number, ring: ReadonlyArray<LngLat>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(p: GeoPoint, polygon: PolygonRings): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || !pointInRing(p.lng, p.lat, outer)) return false;
  return !holes.some((h) => pointInRing(p.lng, p.lat, h));
}

/**
 * Proyección equirectangular local (metros) alrededor de una latitud de referencia.
 * Para una franja de ~1° de latitud y pocos km de ancho, el error frente a UTM es de decenas de metros
 * sobre 80 km: suficiente para despacho (PostGIS sigue siendo la referencia para tarifas).
 */
export class LocalMetricProjection {
  private readonly mPerDegLat: number;
  private readonly mPerDegLng: number;

  constructor(referenceLat: number) {
    const phi = (referenceLat * Math.PI) / 180;
    this.mPerDegLat = 111_132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
    this.mPerDegLng = 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  }

  toXY(lng: number, lat: number): readonly [number, number] {
    return [lng * this.mPerDegLng, lat * this.mPerDegLat];
  }
}

/** Referenciación lineal sobre una polilínea (el eje RP11 dibujado de norte a sur). */
export class CorridorProjector {
  private readonly projection: LocalMetricProjection;
  private readonly points: ReadonlyArray<readonly [number, number]>;
  private readonly cumulative: readonly number[];
  readonly lengthMeters: number;

  constructor(axis: ReadonlyArray<LngLat>) {
    if (axis.length < 2) throw new Error('El eje del corredor necesita al menos 2 puntos');
    const meanLat = axis.reduce((acc, [, lat]) => acc + lat, 0) / axis.length;
    this.projection = new LocalMetricProjection(meanLat);
    this.points = axis.map(([lng, lat]) => this.projection.toXY(lng, lat));
    const cumulative = [0];
    for (let i = 1; i < this.points.length; i++) {
      const [x0, y0] = this.points[i - 1]!;
      const [x1, y1] = this.points[i]!;
      cumulative.push(cumulative[i - 1]! + Math.hypot(x1 - x0, y1 - y0));
    }
    this.cumulative = cumulative;
    this.lengthMeters = cumulative[cumulative.length - 1]!;
  }

  project(p: GeoPoint): CorridorProjection {
    const [px, py] = this.projection.toXY(p.lng, p.lat);
    let best: CorridorProjection = { positionMeters: 0, lateralMeters: Number.POSITIVE_INFINITY };
    for (let i = 1; i < this.points.length; i++) {
      const [x0, y0] = this.points[i - 1]!;
      const [x1, y1] = this.points[i]!;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
      const cx = x0 + t * dx;
      const cy = y0 + t * dy;
      const lateral = Math.hypot(px - cx, py - cy);
      if (lateral < best.lateralMeters) {
        best = { positionMeters: this.cumulative[i - 1]! + t * Math.sqrt(len2), lateralMeters: lateral };
      }
    }
    return best;
  }
}

/** Índice en memoria de localidades, zonas de despacho y eje del corredor. */
export class GeoIndex {
  private readonly localities: readonly IndexedLocality[];
  private readonly zones: readonly IndexedZone[];
  readonly corridor: CorridorProjector;

  constructor(input: {
    localities: readonly IndexedLocality[];
    zones: readonly IndexedZone[];
    corridorAxis: ReadonlyArray<LngLat>;
  }) {
    // Mismo desempate que resolve_locality(): ante un borde compartido gana la del norte.
    this.localities = [...input.localities].sort((a, b) => a.corridorOrder - b.corridorOrder);
    this.zones = [...input.zones].sort((a, b) => b.dispatchPriority - a.dispatchPriority || a.code.localeCompare(b.code));
    this.corridor = new CorridorProjector(input.corridorAxis);
  }

  localityAt(p: GeoPoint): IndexedLocality | null {
    return this.localities.find((l) => l.polygons.some((poly) => pointInPolygon(p, poly))) ?? null;
  }

  zoneAt(p: GeoPoint): IndexedZone | null {
    return this.zones.find((z) => pointInPolygon(p, z.polygon)) ?? null;
  }

  corridorPosition(p: GeoPoint): CorridorProjection {
    return this.corridor.project(p);
  }

  localityById(id: string): IndexedLocality | null {
    return this.localities.find((l) => l.id === id) ?? null;
  }

  private readonly ranges = new Map<string, { fromMeters: number; toMeters: number }>();

  /** "Sombra" de la localidad sobre el corredor (proyección de sus vértices), como v_locality_corridor_ranges. */
  localityRange(id: string): { fromMeters: number; toMeters: number } | null {
    const cached = this.ranges.get(id);
    if (cached) return cached;
    const locality = this.localityById(id);
    if (!locality) return null;
    let fromMeters = Number.POSITIVE_INFINITY;
    let toMeters = Number.NEGATIVE_INFINITY;
    for (const polygon of locality.polygons) {
      for (const [lng, lat] of polygon[0] ?? []) {
        const pos = this.corridor.project({ lng, lat }).positionMeters;
        fromMeters = Math.min(fromMeters, pos);
        toMeters = Math.max(toMeters, pos);
      }
    }
    const range = { fromMeters, toMeters };
    this.ranges.set(id, range);
    return range;
  }

  get localityCount(): number {
    return this.localities.length;
  }

  get zoneCount(): number {
    return this.zones.length;
  }
}
