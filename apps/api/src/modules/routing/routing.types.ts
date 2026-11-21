import type { GeoJsonLineString, GeoPoint } from '@lacosta/domain';

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
export const MAP_PROVIDER = Symbol('MAP_PROVIDER');

export interface RouteRequest {
  readonly origin: GeoPoint;
  readonly destination: GeoPoint;
}

export interface RouteResult {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /** Geometría de la ruta (permite medir con precisión el tramo fuera de la localidad). */
  readonly geometry: GeoJsonLineString | null;
  readonly provider: string;
  /** true si la estimación no proviene de un motor de ruteo vial real. */
  readonly degraded: boolean;
}

/** Puerto de ruteo: desacopla OSRM / Mapbox / Google Directions. */
export interface IRoutingProvider {
  readonly name: string;
  route(request: RouteRequest): Promise<RouteResult>;
}

export interface GeocodeResult {
  readonly label: string;
  readonly point: GeoPoint;
  readonly confidence: number;
}

/**
 * Puerto de mapas/geocodificación (búsqueda de direcciones en la PWA y el panel).
 * Se implementa en Fase 4 (Nominatim/Mapbox/Google) detrás de esta interfaz.
 */
export interface IMapProvider {
  readonly name: string;
  geocode(query: string, options?: { near?: GeoPoint; limit?: number }): Promise<GeocodeResult[]>;
  reverseGeocode(point: GeoPoint): Promise<GeocodeResult | null>;
}
