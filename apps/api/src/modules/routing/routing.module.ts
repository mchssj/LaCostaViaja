import { Logger, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { OsrmRoutingProvider } from './osrm-routing.provider';
import { ResilientRoutingProvider } from './resilient-routing.provider';
import { ROUTING_PROVIDER, type IRoutingProvider } from './routing.types';
import { StraightLineRoutingProvider } from './straight-line-routing.provider';

@Module({
  providers: [
    {
      provide: ROUTING_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: ({ routing }: AppConfig): IRoutingProvider => {
        const logger = new Logger('Routing');
        const fallback = new StraightLineRoutingProvider(routing.straightLineDetourFactor, routing.straightLineAvgSpeedKmh);
        if (routing.provider === 'straight-line') {
          logger.warn('Ruteo en modo straight-line (sin red vial): las cotizaciones se marcan como degradadas');
          return fallback;
        }
        return new ResilientRoutingProvider(new OsrmRoutingProvider(routing.osrmBaseUrl, routing.timeoutMs), fallback, {
          failureThreshold: routing.breakerFailureThreshold,
          cooldownMs: routing.breakerCooldownMs,
          onFallback: (reason) => logger.warn(`OSRM no disponible, usando fallback: ${reason}`),
        });
      },
    },
  ],
  exports: [ROUTING_PROVIDER],
})
export class RoutingModule {}
