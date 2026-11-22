import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { TripsService } from './trips.service';

const RECONCILE_EVERY_MS = 30_000;

/**
 * Red de seguridad: si después de un commit falló Redis (chofer no liberado, viaje no despachado),
 * cada 30 s se compara Redis con PostgreSQL y se corrige. PostgreSQL manda.
 */
@Injectable()
export class TripsWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(TripsWorkers.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly trips: TripsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.dispatch.workersEnabled) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.trips
        .reconcile()
        .then((r) => {
          if (r.released + r.onTrip + r.restarted > 0) this.logger.warn(`Reconciliación: ${JSON.stringify(r)}`);
        })
        .catch((err: Error) => this.logger.error(`Reconciliación: ${err.message}`))
        .finally(() => {
          this.running = false;
        });
    }, RECONCILE_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
