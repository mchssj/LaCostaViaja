import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PanicService } from './panic.service';

/** Escalamiento de alertas sin atender. Seguro con varias réplicas: el UPDATE … RETURNING toma cada alerta una vez. */
@Injectable()
export class PanicWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PanicWorkers.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly panic: PanicService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.dispatch.workersEnabled) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.panic
        .escalateOverdue()
        .catch((err: Error) => this.logger.error(`Escalamiento de alertas: ${err.message}`))
        .finally(() => {
          this.running = false;
        });
    }, this.config.panic.escalationTickMs);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
