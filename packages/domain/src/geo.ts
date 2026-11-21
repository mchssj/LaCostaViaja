import { InvalidInputError } from './errors';

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

/** GeoJSON LineString ([lng, lat]) tal como lo devuelven OSRM/Mapbox. */
export interface GeoJsonLineString {
  readonly type: 'LineString';
  readonly coordinates: ReadonlyArray<readonly [number, number]>;
}

export interface BBox {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLng: number;
  readonly maxLng: number;
}

/**
 * Envolvente del Partido de La Costa con margen. Filtro barato antes de ir a PostGIS:
 * corta pedidos absurdos (GPS en 0,0, otra provincia) sin consumir la base en temporada alta.
 */
export const LA_COSTA_SERVICE_BBOX: BBox = {
  minLat: -37.1,
  maxLat: -36.25,
  minLng: -56.9,
  maxLng: -56.55,
};

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Distancia geodésica (haversine) en metros. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isWithinBBox(p: GeoPoint, bbox: BBox = LA_COSTA_SERVICE_BBOX): boolean {
  return p.lat >= bbox.minLat && p.lat <= bbox.maxLat && p.lng >= bbox.minLng && p.lng <= bbox.maxLng;
}

export function assertValidGeoPoint(value: unknown, label: string): asserts value is GeoPoint {
  const p = value as Partial<GeoPoint> | null | undefined;
  const ok =
    p != null &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180;
  if (!ok) throw new InvalidInputError(`${label}: coordenadas inválidas`, { [label]: value });
}
