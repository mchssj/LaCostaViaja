import { Controller, Get, Inject, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { REDIS } from '../../redis/redis.tokens';
import { Public } from '../../security/principal';
import { GeoIndexService } from '../presence/geo-index.service';

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export interface HealthReport {
  /** ok: todo arriba · degraded: sin Redis (cotiza, pero el despacho automático está pausado). */
  status: 'ok' | 'degraded';
  database: 'up';
  postgis: string | null;
  redis: 'up' | 'down';
  dispatch: 'active' | 'paused';
  geoIndex: { loaded: boolean; loadedAt: string | null; localities: number; zones: number };
  time: string;
}

@Public()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly geo: GeoIndexService,
  ) {}

  @Get()
  async check(): Promise<HealthReport> {
    let postgis: string | null;
    try {
      const { rows } = await this.pool.query<{ postgis: string }>('SELECT postgis_lib_version() AS postgis');
      postgis = rows[0]?.postgis ?? null;
    } catch {
      throw new ServiceUnavailableException({ status: 'down', database: 'down' });
    }
    const redisUp = await withTimeout(this.redis.ping(), 1_500).then(
      (r) => r === 'PONG',
      () => false,
    );
    const geoIndex = this.geo.status();
    const dispatchActive = redisUp && geoIndex.loaded;
    return {
      status: dispatchActive ? 'ok' : 'degraded',
      database: 'up',
      postgis,
      redis: redisUp ? 'up' : 'down',
      dispatch: dispatchActive ? 'active' : 'paused',
      geoIndex,
      time: new Date().toISOString(),
    };
  }
}
