import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import { RK } from '../../redis/redis.keys';
import { REDIS } from '../../redis/redis.tokens';

const GROUP = 'track-writers';
const RECLAIM_IDLE_MS = 60_000;

type StreamEntry = [id: string, fields: string[]];

interface TrackRow {
  tripId: string;
  driverId: string;
  t: number;
  lat: number;
  lng: number;
  s: number | null;
  h: number | null;
  a: number | null;
}

const optNum = (v: string | undefined): number | null => (v === undefined || v === '' ? null : Number(v));

function parseEntry([, fields]: StreamEntry): TrackRow | null {
  const m: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) m[fields[i]!] = fields[i + 1]!;
  const t = Number(m['t']);
  const lat = Number(m['lat']);
  const lng = Number(m['lng']);
  if (!m['tripId'] || !m['driverId'] || !Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const h = optNum(m['h']);
  return {
    tripId: m['tripId'],
    driverId: m['driverId'],
    t,
    lat,
    lng,
    s: optNum(m['s']),
    h: h === null ? null : ((Math.round(h) % 360) + 360) % 360,
    a: optNum(m['a']),
  };
}

/**
 * Consumidor del Redis Stream lc:gps:track → trip_track_points (por lotes, at-least-once).
 * La idempotencia la da la PK (trip_id, recorded_at): reintentos y reprocesos no duplican.
 * Si una réplica muere con mensajes sin confirmar, otra los reclama (XAUTOCLAIM) al minuto.
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);
  private readonly consumer: string;
  private reader: Redis | null = null;
  private running = false;
  private loop: Promise<void> | null = null;
  private groupReady = false;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.consumer = config.dispatch.instanceId;
  }

  private async ensureGroup(): Promise<void> {
    if (this.groupReady) return;
    try {
      await this.redis.xgroup('CREATE', RK.track, GROUP, '0', 'MKSTREAM');
    } catch (err) {
      if (!String((err as Error).message).includes('BUSYGROUP')) throw err;
    }
    this.groupReady = true;
  }

  /** Procesa un lote. blockMs > 0 espera mensajes (usa una conexión dedicada). Devuelve puntos leídos. */
  async flushOnce(blockMs = 0): Promise<number> {
    try {
      return await this.readAndPersist(blockMs);
    } catch (err) {
      // Redis reiniciado sin persistencia (o FLUSHDB): el grupo desapareció. Se recrea en el próximo intento
      // y, como se crea desde el id 0, no se pierde lo que quedó en el stream.
      if (String((err as Error).message).includes('NOGROUP')) this.groupReady = false;
      throw err;
    }
  }

  private async readAndPersist(blockMs: number): Promise<number> {
    await this.ensureGroup();
    const count = this.config.tracking.batchSize;

    const reclaimed = (await this.redis.xautoclaim(RK.track, GROUP, this.consumer, RECLAIM_IDLE_MS, '0-0', 'COUNT', count)) as [
      string,
      StreamEntry[],
      ...unknown[],
    ];
    let entries: StreamEntry[] = reclaimed?.[1] ?? [];

    if (entries.length === 0) {
      const client = blockMs > 0 ? this.blockingReader() : this.redis;
      const args: Array<string | number> = ['GROUP', GROUP, this.consumer, 'COUNT', count];
      if (blockMs > 0) args.push('BLOCK', blockMs);
      args.push('STREAMS', RK.track, '>');
      const res = (await (client.xreadgroup as (...a: Array<string | number>) => Promise<unknown>).call(client, ...args)) as
        | Array<[string, StreamEntry[]]>
        | null;
      entries = res?.[0]?.[1] ?? [];
    }
    if (entries.length === 0) return 0;

    const rows = entries.map(parseEntry).filter((r): r is TrackRow => r !== null);
    if (rows.length > 0) await this.insertBatch(rows);
    await this.redis.xack(RK.track, GROUP, ...entries.map(([id]) => id));
    return entries.length;
  }

  private async insertBatch(rows: readonly TrackRow[]): Promise<void> {
    try {
      await this.insert(rows);
    } catch (err) {
      // Un punto inválido (p. ej. viaje borrado) no debe trabar el resto: se reintenta de a uno.
      this.logger.warn(`Lote de recorrido rechazado (${(err as Error).message}); reintentando de a un punto`);
      for (const row of rows) {
        await this.insert([row]).catch((e: Error) => this.logger.error(`Punto de recorrido descartado (${row.tripId}): ${e.message}`));
      }
    }
  }

  private async insert(rows: readonly TrackRow[]): Promise<void> {
    await this.pool.query(
      `INSERT INTO trip_track_points (trip_id, driver_id, recorded_at, geom, speed_kmh, heading_deg, accuracy_m)
       SELECT u.trip_id, u.driver_id, to_timestamp(u.ms / 1000.0), ST_SetSRID(ST_MakePoint(u.lng, u.lat), 4326), u.s, u.h, u.a
       FROM unnest($1::uuid[], $2::uuid[], $3::float8[], $4::float8[], $5::float8[], $6::float8[], $7::int[], $8::float8[])
         AS u(trip_id, driver_id, ms, lng, lat, s, h, a)
       ON CONFLICT (trip_id, recorded_at) DO NOTHING`,
      [
        rows.map((r) => r.tripId),
        rows.map((r) => r.driverId),
        rows.map((r) => r.t),
        rows.map((r) => r.lng),
        rows.map((r) => r.lat),
        rows.map((r) => r.s),
        rows.map((r) => r.h),
        rows.map((r) => r.a),
      ],
    );
  }

  private blockingReader(): Redis {
    if (!this.reader) {
      this.reader = this.redis.duplicate();
      this.reader.on('error', () => undefined); // el cliente principal ya registra los errores
    }
    return this.reader;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        try {
          await this.flushOnce(1_000);
        } catch (err) {
          this.logger.warn(`Consumidor de recorrido: ${(err as Error).message}`);
          await new Promise((r) => setTimeout(r, 2_000));
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.reader?.disconnect();
    this.reader = null;
    await this.loop?.catch(() => undefined);
  }
}
