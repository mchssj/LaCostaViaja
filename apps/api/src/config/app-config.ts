import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const APP_CONFIG = Symbol('APP_CONFIG');

export type RoutingProviderKind = 'osrm' | 'straight-line';

export interface AppConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly database: {
    readonly poolMax: number;
    readonly statementTimeoutMs: number;
  };
  readonly routing: {
    readonly provider: RoutingProviderKind;
    readonly osrmBaseUrl: string;
    readonly timeoutMs: number;
    readonly breakerFailureThreshold: number;
    readonly breakerCooldownMs: number;
    readonly straightLineDetourFactor: number;
    readonly straightLineAvgSpeedKmh: number;
  };
  readonly geo: {
    readonly localityFallbackMaxMeters: number;
  };
  readonly tariffs: {
    readonly cacheTtlMs: number;
  };
  readonly redisUrl: string;
  readonly dispatch: {
    /** Identificador de esta réplica de la API (leases y auditoría de ofertas). */
    readonly instanceId: string;
    /** Timers de vencimiento, reanudación, barrido y consumidor de recorrido. */
    readonly workersEnabled: boolean;
    readonly offerTimeoutMs: number;
    readonly maxOffersPerRound: number;
    readonly maxSearchMs: number;
    readonly leaseTtlMs: number;
    readonly tripLockTtlMs: number;
    readonly heartbeatStaleMs: number;
    readonly returningTtlMs: number;
    readonly eligibilityCacheMs: number;
    readonly rejectionWindowMs: number;
    readonly expireTickMs: number;
    readonly resumeTickMs: number;
    readonly sweepTickMs: number;
    readonly geoIndexRefreshMs: number;
    /** Velocidad por encima de la cual un salto de GPS se descarta como imposible. */
    readonly maxPlausibleSpeedKmh: number;
  };
  readonly tracking: {
    readonly batchSize: number;
    readonly streamMaxLen: number;
  };
}

/** Carga .env (cwd o raíz del monorepo) sin pisar variables ya definidas en el entorno. */
export function loadDotEnvIfPresent(cwd: string = process.cwd()): void {
  for (const candidate of [resolve(cwd, '.env'), resolve(cwd, '../../.env')]) {
    if (!existsSync(candidate)) continue;
    const parsed = parseEnv(readFileSync(candidate, 'utf8')) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const errors: string[] = [];

  const num = (key: string, fallback: number, min: number, max: number, integer = true): number => {
    const raw = env[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      errors.push(`${key}=${raw} inválido (esperado ${integer ? 'entero' : 'número'} en [${min}, ${max}])`);
      return fallback;
    }
    return value;
  };

  const bool = (key: string, fallback: boolean): boolean => {
    const raw = env[key]?.trim().toLowerCase();
    if (raw === undefined || raw === '') return fallback;
    if (['1', 'true', 'yes', 'si', 'sí'].includes(raw)) return true;
    if (['0', 'false', 'no'].includes(raw)) return false;
    errors.push(`${key}=${env[key]} inválido (true | false)`);
    return fallback;
  };

  const redisUrl = env['REDIS_URL'] ?? 'redis://localhost:56379';
  if (!/^rediss?:\/\//.test(redisUrl)) errors.push('REDIS_URL debe ser una URL redis://');

  const databaseUrl = env['DATABASE_URL'] ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL debe ser una URL postgres://');

  const providerRaw = env['ROUTING_PROVIDER'] ?? 'straight-line';
  const provider: RoutingProviderKind = providerRaw === 'osrm' ? 'osrm' : 'straight-line';
  if (providerRaw !== 'osrm' && providerRaw !== 'straight-line') {
    errors.push(`ROUTING_PROVIDER=${providerRaw} inválido (osrm | straight-line)`);
  }
  const osrmBaseUrl = env['OSRM_BASE_URL'] ?? 'http://localhost:5000';
  if (provider === 'osrm' && !URL.canParse(osrmBaseUrl)) errors.push(`OSRM_BASE_URL=${osrmBaseUrl} no es una URL`);

  const config: AppConfig = {
    port: num('PORT', 3000, 1, 65_535),
    databaseUrl,
    database: {
      poolMax: num('DB_POOL_MAX', 20, 1, 500),
      statementTimeoutMs: num('DB_STATEMENT_TIMEOUT_MS', 5_000, 100, 120_000),
    },
    routing: {
      provider,
      osrmBaseUrl,
      timeoutMs: num('ROUTING_TIMEOUT_MS', 1_500, 100, 30_000),
      breakerFailureThreshold: num('ROUTING_BREAKER_FAILURES', 3, 1, 100),
      breakerCooldownMs: num('ROUTING_BREAKER_COOLDOWN_MS', 30_000, 1_000, 600_000),
      straightLineDetourFactor: num('STRAIGHT_LINE_DETOUR_FACTOR', 1.3, 1, 3, false),
      straightLineAvgSpeedKmh: num('STRAIGHT_LINE_AVG_SPEED_KMH', 30, 5, 120, false),
    },
    geo: {
      localityFallbackMaxMeters: num('LOCALITY_FALLBACK_MAX_METERS', 6_000, 0, 50_000),
    },
    tariffs: {
      cacheTtlMs: num('TARIFF_CACHE_TTL_MS', 60_000, 0, 3_600_000),
    },
    redisUrl,
    dispatch: {
      instanceId: env['DISPATCH_INSTANCE_ID'] || `${hostname()}-${process.pid}-${randomBytes(2).toString('hex')}`,
      workersEnabled: bool('DISPATCH_WORKERS_ENABLED', true),
      offerTimeoutMs: num('DISPATCH_OFFER_TIMEOUT_MS', 15_000, 500, 120_000),
      maxOffersPerRound: num('DISPATCH_MAX_OFFERS_PER_ROUND', 5, 1, 50),
      maxSearchMs: num('DISPATCH_MAX_SEARCH_MS', 180_000, 5_000, 3_600_000),
      leaseTtlMs: num('DISPATCH_LEASE_TTL_MS', 10_000, 500, 120_000),
      tripLockTtlMs: num('DISPATCH_TRIP_LOCK_TTL_MS', 6 * 3_600_000, 60_000, 48 * 3_600_000),
      heartbeatStaleMs: num('PRESENCE_STALE_MS', 45_000, 5_000, 600_000),
      returningTtlMs: num('PRESENCE_RETURNING_TTL_MS', 90 * 60_000, 60_000, 6 * 3_600_000),
      eligibilityCacheMs: num('PRESENCE_ELIGIBILITY_CACHE_MS', 60_000, 0, 3_600_000),
      rejectionWindowMs: num('DISPATCH_REJECTION_WINDOW_MS', 30 * 60_000, 60_000, 24 * 3_600_000),
      expireTickMs: num('DISPATCH_EXPIRE_TICK_MS', 1_000, 100, 60_000),
      resumeTickMs: num('DISPATCH_RESUME_TICK_MS', 5_000, 500, 300_000),
      sweepTickMs: num('PRESENCE_SWEEP_TICK_MS', 10_000, 1_000, 300_000),
      geoIndexRefreshMs: num('GEO_INDEX_REFRESH_MS', 5 * 60_000, 10_000, 24 * 3_600_000),
      maxPlausibleSpeedKmh: num('PRESENCE_MAX_SPEED_KMH', 180, 60, 1_000_000),
    },
    tracking: {
      batchSize: num('TRACKING_BATCH_SIZE', 500, 1, 10_000),
      streamMaxLen: num('TRACKING_STREAM_MAXLEN', 200_000, 1_000, 10_000_000),
    },
  };

  if (errors.length > 0) throw new Error(`Configuración inválida:\n  - ${errors.join('\n  - ')}`);
  return config;
}
