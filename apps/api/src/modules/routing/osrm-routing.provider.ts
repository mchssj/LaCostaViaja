import { RoutingUnavailableError, type GeoJsonLineString } from '@lacosta/domain';
import type { IRoutingProvider, RouteRequest, RouteResult } from './routing.types';

interface OsrmRoute {
  distance: number;
  duration: number;
  geometry?: { type: string; coordinates: [number, number][] };
}

interface OsrmRouteResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
}

type FetchLike = (input: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Cliente OSRM (/route/v1/driving) con timeout duro. */
export class OsrmRoutingProvider implements IRoutingProvider {
  readonly name = 'osrm';

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async route({ origin, destination }: RouteRequest): Promise<RouteResult> {
    const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
    const url = `${this.baseUrl.replace(/\/+$/, '')}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=false&steps=false`;

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { accept: 'application/json' },
      });
    } catch (err) {
      throw new RoutingUnavailableError(`OSRM no respondió: ${(err as Error).message}`);
    }
    if (!response.ok) throw new RoutingUnavailableError(`OSRM respondió HTTP ${response.status}`);

    const body = (await response.json()) as OsrmRouteResponse;
    const route = body.routes?.[0];
    if (body.code !== 'Ok' || !route) {
      throw new RoutingUnavailableError(`OSRM sin ruta (${body.code}${body.message ? `: ${body.message}` : ''})`);
    }
    if (!Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
      throw new RoutingUnavailableError('OSRM devolvió distancia/duración inválidas');
    }

    const geometry: GeoJsonLineString | null =
      route.geometry?.type === 'LineString' && route.geometry.coordinates.length >= 2
        ? { type: 'LineString', coordinates: route.geometry.coordinates }
        : null;

    return {
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry,
      provider: this.name,
      degraded: false,
    };
  }
}
