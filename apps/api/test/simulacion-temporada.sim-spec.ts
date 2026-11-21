import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { GeoPoint } from '@lacosta/domain';
import type Redis from 'ioredis';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PG_POOL } from '../src/database/database.module';
import { DispatchEvents } from '../src/modules/dispatch/dispatch.events';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { FareCalculatorService } from '../src/modules/fares/fare-calculator.service';
import { DriverPresenceService } from '../src/modules/presence/driver-presence.service';
import { REDIS } from '../src/redis/redis.tokens';
import { cleanupTestData, createTestFleet, createTestTrip, offset, randomTag, sleep, type TestDriver } from './support/dispatch-fixtures';

/**
 * Simulación de un pico de temporada en tiempo comprimido, con workers reales (vencimientos, reanudación,
 * barrido y recorrido), Redis y PostGIS reales. Mide tiempos de asignación y verifica que nunca haya
 * doble asignación. No es una prueba de carga completa (Fase 6).
 *
 *   pnpm --filter @lacosta/api test:sim
 */

const DB_URL = process.env['TEST_DATABASE_URL'];
const REDIS_URL = process.env['TEST_REDIS_URL'];
const describeIf = DB_URL && REDIS_URL ? describe : describe.skip;

const PARAMS = {
  drivers: 300,
  trips: 200,
  burstMs: 40_000,
  pingEveryMs: 2_000,
  offerTimeoutMs: 3_000,
  maxSearchMs: 60_000,
  acceptProbability: 0.85,
  rejectProbability: 0.1, // el resto (5 %) ignora la oferta y vence
  settleTimeoutMs: 150_000,
};

// Centro aproximado de cada localidad, oferta de choferes y peso de demanda.
const LOCALITIES: Array<{ code: string; center: GeoPoint; drivers: number; demand: number }> = [
  { code: 'SAN_CLEMENTE', center: { lat: -36.357, lng: -56.724 }, drivers: 40, demand: 10 },
  { code: 'LAS_TONINAS', center: { lat: -36.486, lng: -56.7 }, drivers: 20, demand: 5 },
  { code: 'SANTA_TERESITA', center: { lat: -36.536, lng: -56.692 }, drivers: 50, demand: 20 },
  { code: 'MAR_DEL_TUYU', center: { lat: -36.575, lng: -56.69 }, drivers: 30, demand: 8 },
  { code: 'COSTA_DEL_ESTE', center: { lat: -36.604, lng: -56.69 }, drivers: 10, demand: 3 },
  { code: 'AGUAS_VERDES', center: { lat: -36.632, lng: -56.69 }, drivers: 15, demand: 4 },
  { code: 'LA_LUCILA_DEL_MAR', center: { lat: -36.657, lng: -56.69 }, drivers: 15, demand: 5 },
  { code: 'SAN_BERNARDO', center: { lat: -36.69, lng: -56.685 }, drivers: 60, demand: 25 },
  { code: 'MAR_DE_AJO', center: { lat: -36.722, lng: -56.685 }, drivers: 50, demand: 17 },
  { code: 'NUEVA_ATLANTIS', center: { lat: -36.767, lng: -56.69 }, drivers: 10, demand: 3 },
];

let seed = 20261120;
const rnd = (): number => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
  return seed / 2 ** 31;
};
const between = (a: number, b: number): number => a + (b - a) * rnd();
const near = (p: GeoPoint, northM: number, eastM: number): GeoPoint => offset(p, between(-northM, northM), between(-eastM, eastM));
const pick = <T extends { demand: number }>(items: T[]): T => {
  const total = items.reduce((a, i) => a + i.demand, 0);
  let r = rnd() * total;
  for (const i of items) if ((r -= i.demand) <= 0) return i;
  return items[items.length - 1]!;
};
const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

interface SimDriver extends TestDriver {
  position: GeoPoint;
  busyWith: string | null;
}

describeIf('Simulación de temporada alta', () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: Redis;
  const tag = randomTag();

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB_URL,
      REDIS_URL,
      ROUTING_PROVIDER: 'straight-line',
      DISPATCH_WORKERS_ENABLED: 'true',
      DISPATCH_INSTANCE_ID: 'sim',
      DISPATCH_OFFER_TIMEOUT_MS: String(PARAMS.offerTimeoutMs),
      DISPATCH_MAX_SEARCH_MS: String(PARAMS.maxSearchMs),
      DISPATCH_EXPIRE_TICK_MS: '250',
      DISPATCH_RESUME_TICK_MS: '1000',
      PRESENCE_SWEEP_TICK_MS: '5000',
      PRESENCE_MAX_SPEED_KMH: '100000', // tiempo comprimido: los autos "viajan" km en segundos
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    pool = app.get(PG_POOL);
    redis = app.get(REDIS);
    await redis.flushdb();
  });

  afterAll(async () => {
    await app?.close(); // primero se apagan los workers
    if (pool) {
      const cleanup = app.get(PG_POOL) as Pool;
      await cleanupTestData(cleanup, tag).catch(() => undefined);
    }
  });

  it(`${PARAMS.drivers} choferes, ${PARAMS.trips} pedidos en ${PARAMS.burstMs / 1000} s`, async () => {
    const presence = app.get(DriverPresenceService);
    const dispatch = app.get(DispatchService);
    const events = app.get(DispatchEvents);
    const fares = app.get(FareCalculatorService);

    // --- Flota ----------------------------------------------------------------------------
    const drivers = new Map<string, SimDriver>();
    for (const l of LOCALITIES) {
      for (const d of await createTestFleet(pool, { tag, count: l.drivers, baseLocalityCode: l.code })) {
        drivers.set(d.id, { ...d, position: near(l.center, 900, 600), busyWith: null });
      }
    }
    await Promise.all(
      [...drivers.values()].map(async (d) => {
        await presence.startShift(d.id, d.vehicleId);
        await presence.ingest(d.id, [{ ...d.position, recordedAt: Date.now(), accuracyM: 8 }]);
      }),
    );

    // --- Comportamiento de los choferes ---------------------------------------------------
    const trips = new Map<string, { createdAt: number; assignedAt?: number; destination: GeoPoint; offers: number; interurban: boolean }>();
    const counters = { accepted: 0, rejected: 0, ignored: 0, acceptConflicts: 0, assignedEvents: 0, doubleAssignments: 0, backhaul: 0, repriced: 0, noDriver: 0 };
    const timers = new Set<NodeJS.Timeout>();
    const later = (ms: number, fn: () => Promise<unknown>): void => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn().catch(() => undefined);
      }, ms);
      timers.add(t);
    };

    events.on('offer.created', (o) => {
      const t = trips.get(o.tripId);
      if (t) t.offers++;
      const r = rnd();
      if (r < PARAMS.acceptProbability) {
        later(between(300, 1_500), async () => {
          try {
            await dispatch.accept(o.tripId, o.driverId, o.offerId);
            counters.accepted++;
          } catch {
            counters.acceptConflicts++;
          }
        });
      } else if (r < PARAMS.acceptProbability + PARAMS.rejectProbability) {
        later(between(300, 1_500), async () => {
          await dispatch.reject(o.tripId, o.driverId, o.offerId);
          counters.rejected++;
        });
      } else {
        counters.ignored++;
      }
    });

    events.on('trip.no_driver', () => counters.noDriver++);
    events.on('trip.assigned', (a) => {
      counters.assignedEvents++;
      if (a.isBackhaul) counters.backhaul++;
      if (a.repriced) counters.repriced++;
      const t = trips.get(a.tripId);
      const d = drivers.get(a.driverId);
      if (!t || !d) return;
      if (t.assignedAt !== undefined || d.busyWith !== null) counters.doubleAssignments++;
      t.assignedAt = Date.now();
      d.busyWith = a.tripId;
      // Busca al pasajero, viaja y termina (tiempo comprimido).
      later(between(1_500, 3_000), async () => {
        await presence.markOnTrip(d.id, a.tripId);
        await pool.query(`UPDATE trips SET status = 'IN_PROGRESS', started_at = now() WHERE id = $1`, [a.tripId]);
        later(between(3_000, 6_000), async () => {
          d.position = near(t.destination, 50, 50);
          await presence.ingest(d.id, [{ ...d.position, recordedAt: Date.now(), accuracyM: 6 }]);
          await pool.query(
            `UPDATE trips SET status = 'COMPLETED', completed_at = now(), final_fare_cents = quoted_fare_cents WHERE id = $1`,
            [a.tripId],
          );
          await presence.releaseAfterTrip(d.id, a.tripId);
          d.busyWith = null;
        });
      });
    });

    // --- Pings periódicos -------------------------------------------------------------------
    let pinging = true;
    const pinger = (async () => {
      while (pinging) {
        await Promise.all(
          [...drivers.values()].map((d) => {
            if (!d.busyWith) d.position = near(d.position, 15, 15);
            return presence.ingest(d.id, [{ ...d.position, recordedAt: Date.now(), accuracyM: 8 }]).catch(() => undefined);
          }),
        );
        await sleep(PARAMS.pingEveryMs);
      }
    })();

    // --- Ráfaga de pedidos ----------------------------------------------------------------
    const started = Date.now();
    for (let i = 0; i < PARAMS.trips; i++) {
      const from = pick(LOCALITIES);
      const interurban = rnd() < 0.3;
      const to = interurban ? pick(LOCALITIES.filter((l) => l.code !== from.code)) : from;
      const origin = near(from.center, 500, 400);
      const destination = interurban ? near(to.center, 500, 400) : near(from.center, 1_500, 500);
      const created = await createTestTrip(pool, fares, { tag, origin, destination });
      trips.set(created.tripId, { createdAt: Date.now(), destination, offers: 0, interurban: created.scope === 'INTERURBAN' });
      await dispatch.startDispatch(created.tripId);
      await sleep(Math.max(0, started + ((i + 1) * PARAMS.burstMs) / PARAMS.trips - Date.now()));
    }

    // --- Esperar a que todo se resuelva -------------------------------------------------------
    const deadline = Date.now() + PARAMS.settleTimeoutMs;
    let pending = PARAMS.trips;
    while (Date.now() < deadline) {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM trips WHERE origin_address = $1 AND status IN ('REQUESTED', 'SEARCHING')`,
        [`TEST-${tag}`],
      );
      pending = rows[0]!.n;
      if (pending === 0) break;
      await sleep(1_000);
    }
    await sleep(8_000); // dejar terminar los viajes en curso
    pinging = false;
    await pinger;
    for (const t of timers) clearTimeout(t);

    // --- Resultados -------------------------------------------------------------------------
    const waits = [...trips.values()].filter((t) => t.assignedAt !== undefined).map((t) => (t.assignedAt! - t.createdAt) / 1000);
    const { rows: statusRows } = await pool.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM trips WHERE origin_address = $1 GROUP BY status ORDER BY status`,
      [`TEST-${tag}`],
    );
    const { rows: offerRows } = await pool.query<{ outcome: string; n: number }>(
      `SELECT o.outcome, count(*)::int AS n FROM trip_offers o JOIN trips t ON t.id = o.trip_id
       WHERE t.origin_address = $1 GROUP BY o.outcome ORDER BY o.outcome`,
      [`TEST-${tag}`],
    );
    const { rows: overlap } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM trips a JOIN trips b
         ON a.driver_id = b.driver_id AND a.id < b.id
        AND tstzrange(a.assigned_at, COALESCE(a.completed_at, 'infinity')) && tstzrange(b.assigned_at, COALESCE(b.completed_at, 'infinity'))
       WHERE a.origin_address = $1 AND b.origin_address = $1`,
      [`TEST-${tag}`],
    );
    const { rows: track } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM trip_track_points p JOIN trips t ON t.id = p.trip_id WHERE t.origin_address = $1`,
      [`TEST-${tag}`],
    );

    const result = {
      fecha: new Date().toISOString(),
      parametros: PARAMS,
      viajes: Object.fromEntries(statusRows.map((r) => [r.status, r.n])),
      interurbanos: [...trips.values()].filter((t) => t.interurban).length,
      ofertas: Object.fromEntries(offerRows.map((r) => [r.outcome, r.n])),
      ofertasPorViajeAsignado: +(waits.length ? [...trips.values()].reduce((a, t) => a + t.offers, 0) / waits.length : 0).toFixed(2),
      esperaHastaAsignacionSegundos: {
        p50: +percentile(waits, 50).toFixed(2),
        p95: +percentile(waits, 95).toFixed(2),
        max: +percentile(waits, 100).toFixed(2),
      },
      choferes: { aceptaron: counters.accepted, rechazaron: counters.rejected, ignoraron: counters.ignored },
      aceptacionesEnConflicto: counters.acceptConflicts,
      asignacionesViajeDeVuelta: counters.backhaul,
      viajesDeVueltaRecotizados: counters.repriced,
      sinChofer: counters.noDriver,
      pendientesAlFinal: pending,
      dobleAsignacionEventos: counters.doubleAssignments,
      dobleAsignacionEnBase: overlap[0]!.n,
      puntosDeRecorridoGuardados: track[0]!.n,
      duracionSegundos: Math.round((Date.now() - started) / 1000),
    };

    const outDir = resolve(__dirname, '../../../docs/bitacora/2026-11-20-fase-2-redis-gps-despacho/pruebas');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'resultado-simulacion.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));

    expect(result.dobleAsignacionEventos).toBe(0);
    expect(result.dobleAsignacionEnBase).toBe(0);
    expect(result.pendientesAlFinal).toBe(0);
    expect(counters.assignedEvents).toBe(waits.length);
  });
});
