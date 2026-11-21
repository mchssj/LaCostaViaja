import type { IRoutingProvider, RouteRequest, RouteResult } from './routing.types';

export interface ResilientRoutingOptions {
  /** Fallos consecutivos que abren el circuito. */
  readonly failureThreshold: number;
  /** Tiempo con el circuito abierto (se usa directo el fallback, sin esperar timeouts). */
  readonly cooldownMs: number;
  readonly now?: () => number;
  readonly onFallback?: (reason: string) => void;
}

/**
 * Primario (OSRM) con fallback y circuit breaker. En temporada alta, si OSRM se satura,
 * no apilamos timeouts de 1,5 s por cotización: abrimos el circuito y cotizamos en modo degradado.
 * Pasado el cooldown, el siguiente pedido vuelve a probar el primario (half-open).
 */
export class ResilientRoutingProvider implements IRoutingProvider {
  readonly name: string;
  private consecutiveFailures = 0;
  private openUntil = 0;
  private readonly now: () => number;

  constructor(
    private readonly primary: IRoutingProvider,
    private readonly fallback: IRoutingProvider,
    private readonly options: ResilientRoutingOptions,
  ) {
    this.name = `${primary.name}|${fallback.name}`;
    this.now = options.now ?? Date.now;
  }

  get circuitOpen(): boolean {
    return this.now() < this.openUntil;
  }

  async route(request: RouteRequest): Promise<RouteResult> {
    if (!this.circuitOpen) {
      try {
        const result = await this.primary.route(request);
        this.consecutiveFailures = 0;
        return result;
      } catch (err) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.options.failureThreshold) {
          this.openUntil = this.now() + this.options.cooldownMs;
          this.consecutiveFailures = 0;
        }
        this.options.onFallback?.((err as Error).message);
      }
    }
    const result = await this.fallback.route(request);
    return { ...result, degraded: true };
  }
}
