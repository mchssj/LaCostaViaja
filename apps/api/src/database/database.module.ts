import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export const PG_POOL = Symbol('PG_POOL');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Pool => {
        const logger = new Logger('PostgreSQL');
        const pool = new Pool({
          connectionString: config.databaseUrl,
          max: config.database.poolMax,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          statement_timeout: config.database.statementTimeoutMs,
          application_name: 'lacosta-api',
        });
        // Un cliente inactivo que pierde la conexión no debe tirar abajo el proceso.
        pool.on('error', (err) => logger.error(`Error en cliente inactivo del pool: ${err.message}`));
        return pool;
      },
    },
    DatabaseLifecycle,
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
