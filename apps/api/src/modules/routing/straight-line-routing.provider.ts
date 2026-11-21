import { haversineMeters } from '@lacosta/domain';
import type { IRoutingProvider, RouteRequest, RouteResult } from './routing.types';

/**
 * Estimación sin red vial: distancia geodésica × factor de desvío (grilla urbana + acceso a RP11).
 * Siempre se marca como degradada; sin geometría, el tramo interurbano se mide sobre el eje RP11.
 */
export class StraightLineRoutingProvider implements IRoutingProvider {
  readonly name = 'straight-line';

  constructor(
    private readonly detourFactor = 1.3,
    private readonly averageSpeedKmh = 30,
  ) {}

  async route({ origin, destination }: RouteRequest): Promise<RouteResult> {
    const distanceMeters = Math.round(haversineMeters(origin, destination) * this.detourFactor);
    return {
      distanceMeters,
      durationSeconds: Math.round(distanceMeters / (this.averageSpeedKmh / 3.6)),
      geometry: null,
      provider: this.name,
      degraded: true,
    };
  }
}
