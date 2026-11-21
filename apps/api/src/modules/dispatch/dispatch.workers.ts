import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DriverPresenceService } from '../presence/driver-presence.service';
import { TrackingService } from '../tracking/tracking.service';
import { DispatchService } from './dispatch.service';

/**
 * Tareas periódicas de cada réplica. Son seguras en paralelo entre réplicas: los vencimientos se toman
 * con Lua (uno por réplica), los viajes con lease y el barrido usa scripts que verifican el estado.
 */
@Injectable()
export class DispatchWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DispatchWorkers.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly lastError = new Map<string, number>();

  constructor(
    private readonly dispatch: DispatchService,
    private readonly presence: DriverPresenceService,
    private readonly tracking: TrackingService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.dispatch.workersEnabled) return;
    const c = this.config.dispatch;
    this.every('vencimiento de ofertas', c.expireTickMs, () => this.dispatch.expireDueOffers());
    this.every('reanudación de búsquedas', c.resumeTickMs, () => this.dispatch.resumeSearching());
    this.every('barrido de desconectados', c.sweepTickMs, () => this.presence.sweepStale());
    this.tracking.start();
    this.logger.log(`Workers de despacho activos (réplica ${this.dispatch.instanceId})`);
  }

  private every(name: string, ms: number, task: () => Promise<unknown>): void {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      task()
        .catch((err: Error) => {
          const last = this.lastError.get(name) ?? 0;
          if (Date.now() - last > 30_000) {
            this.lastError.set(name, Date.now());
            this.logger.error(`${name}: ${err.message}`);
          }
        })
        .finally(() => {
          running = false;
        });
    }, ms);
    timer.unref();
    this.timers.push(timer);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    await this.tracking.stop();
  }
}
