import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DispatchConflictError, DriverNotEligibleError, DriverNotOnShiftError, type GeoPoint } from '@lacosta/domain';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { CLOCK, type Clock } from '../src/common/clock';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config';
import { PG_POOL } from '../src/database/database.module';
import { DispatchEvents } from '../src/modules/dispatch/dispatch.events';
import { DispatchRepository } from '../src/modules/dispatch/dispatch.repository';
import { DispatchService } from '../src/modules/dispatch/dispatch.service';
import { FareCalculatorService } from '../src/modules/fares/fare-calculator.service';
import { DriverPresenceService } from '../src/modules/presence/driver-presence.service';
import { GeoIndexService } from '../src/modules/presence/geo-index.service';
import { ROUTING_PROVIDER, type IRoutingProvider } from '../src/modules/routing/routing.types';
import { TrackingService } from '../src/modules/tracking/tracking.service';
import { RedisStateStore } from '../src/redis/redis-state.store';
import { RK } from '../src/redis/redis.keys';
import { REDIS } from '../src/redis/redis.tokens';
import {
  cleanupTestData,
  closeOpenTestTrips,
  createTestFleet,
  createTestTrip,
  offset,
  randomTag,
  sleep,
  type TestDriver,
} from './support/dispatch-fixtures';

const DB_URL = process.env['TEST_DATABASE_URL'];
const REDIS_URL = process.env['TEST_REDIS_URL'];
const describeIf = DB_URL && REDIS_URL ? describe : describe.skip;

const CHIOZZA: GeoPoint = { lat: -36.6875, lng: -56.68 };
const SB_SOUTH: GeoPoint = { lat: -36.695, lng: -56.69 };
const MDA_CENTRO: GeoPoint = { lat: -36.716, lng: -56.68 };
const OFFER_TIMEOUT_MS = 1_500;

/** Integración real: Redis + PostgreSQL/PostGIS. Requiere TEST_DATABASE_URL y TEST_REDIS_URL (usa una base de Redis aparte). */
describeIf('Despacho: Redis + PostGIS (integración)', () => {
  let app: INestApplication;
  let pool: Pool;
  let redis: Redis;
  let store: RedisStateStore;
  let presence: DriverPresenceService;
  let dispatch: DispatchService;
  let fares: FareCalculatorService;
  let geo: GeoIndexService;
  let tracking: TrackingService;
  let config: AppConfig;
  const tag = randomTag();

  /** Abre el turno y reporta una posición. */
  async function onShiftAt(d: TestDriver, p: GeoPoint, recordedAt = Date.now()): Promise<void> {
    await presence.startShift(d.id, d.vehicleId);
    await presence.ingest(d.id, [{ ...p, recordedAt, accuracyM: 8 }]);
  }

  /** Simula el cierre del viaje en la base (Fase 3: ciclo de vida del viaje). */
  const completeInDb = (tripId: string) =>
    pool.query(
      `UPDATE trips SET status = 'COMPLETED', started_at = now(), completed_at = now(), final_fare_cents = quoted_fare_cents WHERE id = $1`,
      [tripId],
    );

  const fleet = (count: number, baseLocalityCode = 'SAN_BERNARDO'): Promise<TestDriver[]> =>
    createTestFleet(pool, { tag, count, baseLocalityCode });
  const trip = (origin: GeoPoint, destination: GeoPoint) => createTestTrip(pool, fares, { tag, origin, destination });
  const offerOutcomes = async (tripId: string) =>
    (
      await pool.query<{ driver_id: string; outcome: string; rank: number; round: number }>(
        `SELECT driver_id, outcome, rank, round FROM trip_offers WHERE trip_id = $1 ORDER BY offered_at`,
        [tripId],
      )
    ).rows;

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB_URL,
      REDIS_URL,
      ROUTING_PROVIDER: 'straight-line',
      DISPATCH_WORKERS_ENABLED: 'false',
      DISPATCH_OFFER_TIMEOUT_MS: String(OFFER_TIMEOUT_MS),
      DISPATCH_INSTANCE_ID: 'test-A',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    pool = app.get(PG_POOL);
    redis = app.get(REDIS);
    store = app.get(RedisStateStore);
    presence = app.get(DriverPresenceService);
    dispatch = app.get(DispatchService);
    fares = app.get(FareCalculatorService);
    geo = app.get(GeoIndexService);
    tracking = app.get(TrackingService);
    config = app.get(APP_CONFIG);
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterEach(async () => {
    await closeOpenTestTrips(pool, tag);
  });

  afterAll(async () => {
    if (pool) await cleanupTestData(pool, tag);
    await redis?.flushdb();
    await app?.close();
  });

  it('el índice en memoria coincide con PostGIS (localidad, parada y progresiva)', async () => {
    const points: GeoPoint[] = [
      CHIOZZA,
      SB_SOUTH,
      MDA_CENTRO,
      { lat: -36.536, lng: -56.692 }, // Santa Teresita, Calle 2
      { lat: -36.357, lng: -56.724 }, // San Clemente
      { lat: -36.6882, lng: -56.6705 }, // parada Chiozza y Costanera
      { lat: -36.44, lng: -56.72 }, // tramo rural
      { lat: -36.99, lng: -56.78 }, // Costa Esmeralda
      { lat: -36.6, lng: -56.56 }, // mar
    ];
    const index = geo.require();
    for (const p of points) {
      const { rows } = await pool.query<{ locality: string | null; zone: string | null; pos: number }>(
        `SELECT (SELECT locality_code FROM resolve_locality($1, $2, 0)) AS locality,
                (SELECT code FROM dispatch_zones z WHERE ST_Covers(z.geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
                 ORDER BY dispatch_priority DESC, code LIMIT 1) AS zone,
                corridor_position_m(ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS pos`,
        [p.lng, p.lat],
      );
      const sql = rows[0]!;
      expect(index.localityAt(p)?.code ?? null).toBe(sql.locality);
      expect(index.zoneAt(p)?.code ?? null).toBe(sql.zone);
      expect(Math.abs(index.corridorPosition(p).positionMeters - sql.pos)).toBeLessThan(100);
    }
  });

  it('turno: exige habilitación vigente y no permite el mismo auto con dos choferes', async () => {
    const { rows } = await pool.query<{ driver_id: string; vehicle_id: string }>(
      `SELECT d.id AS driver_id, v.id AS vehicle_id FROM drivers d, vehicles v WHERE d.dni = '35666777' AND v.plate = 'AC321HJ'`,
    );
    const lucia = rows[0]!;
    await expect(presence.startShift(lucia.driver_id, lucia.vehicle_id)).rejects.toMatchObject({
      code: 'DRIVER_NOT_ELIGIBLE',
      details: { reasons: expect.arrayContaining(['LICENCIA_PROFESIONAL_VENCIDA', 'VTV_VENCIDA']) },
    });

    const [a, b] = await fleet(2);
    await expect(presence.startShift(b!.id, a!.vehicleId)).rejects.toBeInstanceOf(DriverNotEligibleError); // sin autorización para ese auto
    await pool.query(
      `INSERT INTO driver_vehicle_compliance (driver_id, vehicle_id, role, authorization_number, validity, status, verified_by, verified_at)
       VALUES ($1, $2, 'RELIEF_DRIVER', $3, daterange(ar_today() - 1, ar_today() + 30, '[)'), 'ACTIVE', 'test', now())`,
      [b!.id, a!.vehicleId, `TEST-${tag}-DISP-relevo-${Date.now()}`],
    );
    const state = await presence.startShift(a!.id, a!.vehicleId);
    expect(state.status).toBe('AVAILABLE');
    await expect(presence.startShift(b!.id, a!.vehicleId)).rejects.toMatchObject({ details: { reason: 'VEHICLE_IN_USE' } });
    await presence.endShift(a!.id);
    await expect(presence.startShift(b!.id, a!.vehicleId)).resolves.toMatchObject({ status: 'AVAILABLE' });
  });

  it('ingesta: cola de parada, pings viejos, baja precisión y saltos imposibles', async () => {
    const [d] = await fleet(1);
    const t0 = Date.now() - 60_000;
    await presence.startShift(d!.id, d!.vehicleId);
    const parada = { lat: -36.6882, lng: -56.6705 };
    const zoneId = geo.require().zoneAt(parada)!.id;

    let r = await presence.ingest(d!.id, [{ ...parada, recordedAt: t0, accuracyM: 6 }]);
    expect(r.applied).toBe(1);
    expect(await redis.zscore(RK.zoneQueue(zoneId), d!.id)).not.toBeNull();
    const joinedAt = await redis.zscore(RK.zoneQueue(zoneId), d!.id);

    r = await presence.ingest(d!.id, [
      { ...parada, recordedAt: t0 - 5_000 }, // viejo
      { ...offset(parada, 5, 0), recordedAt: t0 + 5_000, accuracyM: 400 }, // impreciso
      { ...MDA_CENTRO, recordedAt: t0 + 10_000 }, // 3 km en 10 s
      { ...offset(parada, 10, 0), recordedAt: t0 + 15_000, accuracyM: 5 }, // válido
    ]);
    expect(r).toMatchObject({ applied: 1, stale: 1, heartbeatOnly: 2, suspiciousJumps: 1 });
    expect(await redis.zscore(RK.zoneQueue(zoneId), d!.id)).toBe(joinedAt); // no pierde el lugar

    await presence.ingest(d!.id, [{ ...SB_SOUTH, recordedAt: t0 + 120_000 }]);
    expect(await redis.zscore(RK.zoneQueue(zoneId), d!.id)).toBeNull(); // salió de la parada
    await expect(presence.ingest(randomUUID(), [{ ...CHIOZZA, recordedAt: t0 }])).rejects.toBeInstanceOf(DriverNotOnShiftError);
  });

  it('ofrece primero al de la cola de la parada, pasa al siguiente si rechaza y asigna al aceptar', async () => {
    const [a, b, c] = await fleet(3);
    await onShiftAt(a!, { lat: -36.69, lng: -56.685 }); // en la zona centro (cola), a ~530 m
    await onShiftAt(b!, { lat: -36.6875, lng: -56.666 }); // fuera de la zona, a ~1,25 km
    await onShiftAt(c!, MDA_CENTRO); // a ~3,2 km
    const { tripId } = await trip(CHIOZZA, SB_SOUTH);

    const first = await dispatch.startDispatch(tripId);
    expect(first).toMatchObject({ kind: 'OFFERED', driverId: a!.id, rank: 1, round: 1 });

    const second = await dispatch.reject(tripId, a!.id, (first as { offerId: string }).offerId);
    expect(second).toMatchObject({ kind: 'OFFERED', driverId: b!.id });

    const accepted = await dispatch.accept(tripId, b!.id, (second as { offerId: string }).offerId);
    expect(accepted).toMatchObject({ driverId: b!.id, idempotent: false, isBackhaul: false });

    const t = await app.get(DispatchRepository).loadTrip(tripId);
    expect(t).toMatchObject({ status: 'ASSIGNED', driverId: b!.id, vehicleId: b!.vehicleId });
    expect(await offerOutcomes(tripId)).toEqual([
      expect.objectContaining({ driver_id: a!.id, outcome: 'REJECTED' }),
      expect.objectContaining({ driver_id: b!.id, outcome: 'ACCEPTED' }),
    ]);
    expect((await store.getDriver(b!.id))?.status).toBe('ASSIGNED');
    expect(await redis.zscore(RK.geo('TAXI'), b!.id)).toBeNull();
    expect((await store.getDriver(a!.id))?.status).toBe('AVAILABLE');
    expect(await redis.zcard(RK.rejections(a!.id))).toBe(1);
    expect(await store.tripLockOwner(tripId)).toBe(b!.id);
  });

  it('concurrencia: 20 avances desde 2 réplicas → una sola oferta; 60 aceptaciones en paralelo → un solo ganador', async () => {
    const drivers = await fleet(50);
    await Promise.all(drivers.map((d, i) => onShiftAt(d, offset(CHIOZZA, (i % 10) * 60 - 300, Math.floor(i / 10) * 60 - 150))));
    const { tripId } = await trip(CHIOZZA, SB_SOUTH);
    const repo = app.get(DispatchRepository);
    await repo.startSearching(tripId);

    const replicaB = new DispatchService(
      store,
      presence,
      geo,
      repo,
      app.get(DispatchEvents),
      fares,
      app.get<IRoutingProvider>(ROUTING_PROVIDER),
      app.get<Clock>(CLOCK),
      { ...config, dispatch: { ...config.dispatch, instanceId: 'test-B' } },
    );
    const advances = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? dispatch : replicaB).advance(tripId)));
    // Los avances concurrentes de una misma réplica comparten la promesa en curso: puede haber varios
    // resultados OFFERED, pero tienen que ser la MISMA oferta.
    const offered = advances.filter((o) => o.kind === 'OFFERED') as Array<{ driverId: string; offerId: string }>;
    expect(new Set(offered.map((o) => o.offerId)).size).toBe(1);
    expect(advances.every((o) => ['OFFERED', 'WAITING_OFFER', 'LEASE_HELD'].includes(o.kind))).toBe(true);
    expect((await pool.query(`SELECT count(*)::int AS n FROM trip_offers WHERE trip_id = $1`, [tripId])).rows[0].n).toBe(1);

    const winner = offered[0] as { driverId: string; offerId: string };
    const attempts = [
      ...drivers.map((d) => ({ d: d.id, o: d.id === winner.driverId ? winner.offerId : randomUUID() })),
      ...Array.from({ length: 10 }, () => ({ d: winner.driverId, o: winner.offerId })), // reintentos del ganador
    ];
    const results = await Promise.allSettled(
      attempts.map((a, i) => (i % 2 === 0 ? dispatch : replicaB).accept(tripId, a.d, a.o)),
    );
    const fresh = results.filter((r) => r.status === 'fulfilled' && !r.value.idempotent);
    expect(fresh).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(DispatchConflictError);
    }

    const t = await repo.loadTrip(tripId);
    expect(t).toMatchObject({ status: 'ASSIGNED', driverId: winner.driverId });
    const assignedInRedis = (await store.getDrivers(drivers.map((d) => d.id))).filter((s) => s.status === 'ASSIGNED');
    expect(assignedInRedis.map((s) => s.driverId)).toEqual([winner.driverId]);
    expect(
      (await pool.query(`SELECT count(*)::int AS n FROM trip_offers WHERE trip_id = $1 AND outcome = 'ACCEPTED'`, [tripId])).rows[0].n,
    ).toBe(1);
  });

  it('oferta vencida: pasa al siguiente, penaliza al que no respondió y rechaza la aceptación tardía', async () => {
    const [a, b] = await fleet(2);
    await onShiftAt(a!, offset(CHIOZZA, 0, 50));
    await onShiftAt(b!, offset(CHIOZZA, 0, 900));
    const { tripId } = await trip(CHIOZZA, SB_SOUTH);
    const first = (await dispatch.startDispatch(tripId)) as { kind: string; driverId: string; offerId: string };
    expect(first).toMatchObject({ kind: 'OFFERED', driverId: a!.id });

    expect(await dispatch.expireDueOffers()).toBe(0); // todavía no venció
    await sleep(OFFER_TIMEOUT_MS + 200);
    expect(await dispatch.expireDueOffers()).toBe(1);

    expect((await store.currentOffer(tripId))?.driverId).toBe(b!.id);
    await expect(dispatch.accept(tripId, a!.id, first.offerId)).rejects.toMatchObject({ details: { reason: 'OFFER_EXPIRED' } });
    expect((await store.getDriver(a!.id))?.status).toBe('AVAILABLE');
    expect(await redis.zcard(RK.rejections(a!.id))).toBe(1);
    expect((await offerOutcomes(tripId)).map((o) => o.outcome)).toEqual(['EXPIRED', 'PENDING']);
  });

  it('si PostgreSQL rechaza la asignación (VTV vencida a mitad de la oferta), Redis se deshace y se sigue buscando', async () => {
    const [a] = await fleet(1);
    await onShiftAt(a!, offset(CHIOZZA, 0, 50));
    const { tripId } = await trip(CHIOZZA, SB_SOUTH);
    const offer = (await dispatch.startDispatch(tripId)) as { offerId: string };
    await pool.query(`UPDATE vehicles SET vtv_expires_on = ar_today() - 1 WHERE id = $1`, [a!.vehicleId]);
    try {
      await expect(dispatch.accept(tripId, a!.id, offer.offerId)).rejects.toMatchObject({ details: { reason: 'CLAIM_FAILED' } });
      expect(await store.tripLockOwner(tripId)).toBeNull();
      expect((await store.getDriver(a!.id))?.status).toBe('AVAILABLE');
      expect(await app.get(DispatchRepository).loadTrip(tripId)).toMatchObject({ status: 'SEARCHING', driverId: null });
      expect((await offerOutcomes(tripId))[0]?.outcome).toBe('CLAIM_FAILED');
    } finally {
      await pool.query(`UPDATE vehicles SET vtv_expires_on = ar_today() + 365 WHERE id = $1`, [a!.vehicleId]);
    }
  });

  it('cancelación del pasajero durante la oferta', async () => {
    const [a] = await fleet(1);
    await onShiftAt(a!, offset(CHIOZZA, 0, 50));
    const { tripId } = await trip(CHIOZZA, SB_SOUTH);
    const offer = (await dispatch.startDispatch(tripId)) as { offerId: string };
    expect(await dispatch.cancelSearching(tripId)).toBe(true);
    expect(await store.currentOffer(tripId)).toBeNull();
    expect((await store.getDriver(a!.id))?.status).toBe('AVAILABLE');
    await expect(dispatch.accept(tripId, a!.id, offer.offerId)).rejects.toMatchObject({ details: { reason: 'TRIP_CANCELLED' } });
    expect((await offerOutcomes(tripId))[0]?.outcome).toBe('CANCELLED');
  });

  it('barrido: cierra el turno de quien no reporta, pero no corta a quien está en viaje', async () => {
    const [idle, busy] = await fleet(2);
    await onShiftAt(idle!, offset(CHIOZZA, 0, 1_500));
    await onShiftAt(busy!, offset(CHIOZZA, 0, 40));
    const { tripId } = await trip(CHIOZZA, SB_SOUTH);
    const offer = (await dispatch.startDispatch(tripId)) as { driverId: string; offerId: string };
    expect(offer.driverId).toBe(busy!.id);
    await dispatch.accept(tripId, busy!.id, offer.offerId);

    const closed = await presence.sweepStale(Date.now() + config.dispatch.heartbeatStaleMs + 5_000);
    expect(closed).toEqual([idle!.id]);
    expect(await store.getDriver(idle!.id)).toBeNull();
    expect(await redis.zscore(RK.geo('TAXI'), idle!.id)).toBeNull();
    expect((await store.getDriver(busy!.id))?.status).toBe('ASSIGNED');
  });

  it('lease: si otra réplica está despachando el viaje, esta no interviene hasta que el lease vence', async () => {
    const [a] = await fleet(1);
    await onShiftAt(a!, offset(CHIOZZA, 0, 50));
    const { tripId } = await trip(CHIOZZA, SB_SOUTH);
    await app.get(DispatchRepository).startSearching(tripId);
    await store.acquireLease(tripId, 'replica-caida', 300);
    expect(await dispatch.advance(tripId)).toEqual({ kind: 'LEASE_HELD' });
    await sleep(350);
    expect(await dispatch.advance(tripId)).toMatchObject({ kind: 'OFFERED', driverId: a!.id });
  });

  it('Viaje de Vuelta: prioriza al chofer que vuelve a su base, bonifica el retorno y guarda el recorrido', async () => {
    const [ret] = await fleet(1, 'SAN_BERNARDO');
    const [local] = await fleet(1, 'MAR_DE_AJO');
    const t0 = Date.now() - 600_000;
    await onShiftAt(ret!, offset(CHIOZZA, 0, 30), t0);

    // 1) San Bernardo → Mar de Ajó con el chofer de San Bernardo.
    const trip1 = await trip(CHIOZZA, MDA_CENTRO);
    expect(trip1.scope).toBe('INTERURBAN');
    const o1 = (await dispatch.startDispatch(trip1.tripId)) as { driverId: string; offerId: string };
    expect(o1.driverId).toBe(ret!.id);
    await dispatch.accept(trip1.tripId, ret!.id, o1.offerId);
    await presence.markOnTrip(ret!.id, trip1.tripId);

    // Recorrido durante el viaje, con un reintento del mismo lote (no debe duplicar).
    const route = [0.2, 0.4, 0.6, 0.8, 1].map((f, i) => ({
      lat: CHIOZZA.lat + (MDA_CENTRO.lat - CHIOZZA.lat) * f,
      lng: CHIOZZA.lng,
      recordedAt: t0 + (i + 1) * 60_000,
      speedKmh: 40,
      accuracyM: 6,
    }));
    await presence.ingest(ret!.id, route);
    await presence.ingest(ret!.id, route);
    while ((await tracking.flushOnce()) > 0);
    const points = await pool.query(`SELECT count(*)::int AS n FROM trip_track_points WHERE trip_id = $1`, [trip1.tripId]);
    expect(points.rows[0].n).toBe(route.length);

    await completeInDb(trip1.tripId); // en la Fase 3 lo hace el ciclo de vida del viaje
    const afterTrip1 = await presence.releaseAfterTrip(ret!.id, trip1.tripId);
    expect(afterTrip1).toMatchObject({ status: 'RETURNING', returnToLocalityId: afterTrip1.baseLocalityId, returnDirection: 'NORTHBOUND' });

    // 2) Mar de Ajó → San Bernardo: hay un chofer local más cerca, pero gana el que vuelve a casa.
    await onShiftAt(local!, offset(MDA_CENTRO, 0, 20));
    await presence.ingest(ret!.id, [{ ...offset(MDA_CENTRO, 300, 300), recordedAt: Date.now() - 240_000, accuracyM: 6 }]);
    const trip2 = await trip(MDA_CENTRO, CHIOZZA);
    const o2 = (await dispatch.startDispatch(trip2.tripId)) as { driverId: string; offerId: string };
    expect(o2.driverId).toBe(ret!.id);
    const accepted = await dispatch.accept(trip2.tripId, ret!.id, o2.offerId);
    expect(accepted).toMatchObject({ isBackhaul: true, repriced: true });
    expect(accepted.fareCents).toBeLessThan(trip2.quotedFareCents);
    const row = (
      await pool.query(`SELECT is_backhaul_assignment, quoted_fare_cents FROM trips WHERE id = $1`, [trip2.tripId])
    ).rows[0];
    expect(row).toEqual({ is_backhaul_assignment: true, quoted_fare_cents: accepted.fareCents });
    expect((await offerOutcomes(trip2.tripId))[0]).toMatchObject({ driver_id: ret!.id, outcome: 'ACCEPTED' });

    // 3) Al terminar en su base, queda AVAILABLE (sin Viaje de Vuelta).
    await presence.markOnTrip(ret!.id, trip2.tripId);
    // ~3 km en 4 minutos (un salto instantáneo se descartaría como imposible).
    const arrival = await presence.ingest(ret!.id, [{ ...CHIOZZA, recordedAt: Date.now(), accuracyM: 6 }]);
    expect(arrival.applied).toBe(1);
    await completeInDb(trip2.tripId);
    expect((await presence.releaseAfterTrip(ret!.id, trip2.tripId)).status).toBe('AVAILABLE');
  });

  it('Viaje de Vuelta: termina al entrar a la localidad base', async () => {
    const [d] = await fleet(1, 'SAN_BERNARDO');
    const t0 = Date.now() - 600_000;
    await onShiftAt(d!, offset(CHIOZZA, 0, 30), t0);
    const t = await trip(CHIOZZA, MDA_CENTRO);
    const o = (await dispatch.startDispatch(t.tripId)) as { offerId: string };
    await dispatch.accept(t.tripId, d!.id, o.offerId);
    await presence.ingest(d!.id, [{ ...MDA_CENTRO, recordedAt: t0 + 300_000, accuracyM: 6 }]);
    expect((await presence.releaseAfterTrip(d!.id, t.tripId)).status).toBe('RETURNING');
    const r = await presence.ingest(d!.id, [{ ...SB_SOUTH, recordedAt: t0 + 500_000, accuracyM: 6 }]);
    expect(r.returningEnded).toBe(true);
    expect((await store.getDriver(d!.id))?.status).toBe('AVAILABLE');
  });

  it('recorrido: el consumidor se recupera si Redis pierde el grupo (reinicio sin persistencia)', async () => {
    const [d] = await fleet(1);
    await onShiftAt(d!, offset(CHIOZZA, 0, 30));
    const t = await trip(CHIOZZA, SB_SOUTH);
    const o = (await dispatch.startDispatch(t.tripId)) as { offerId: string };
    await dispatch.accept(t.tripId, d!.id, o.offerId);
    const point = (i: number) => ({ tripId: t.tripId, driverId: d!.id, ...CHIOZZA, recordedAt: Date.now() - 60_000 + i * 1_000 });

    // Otros tests ya vaciaron Redis (beforeEach): el consumidor puede venir con el grupo perdido.
    await tracking.flushOnce().catch(() => 0);
    await store.appendTrack([point(1)], 1_000);
    expect(await tracking.flushOnce()).toBe(1);
    await redis.flushdb(); // se pierde el stream y el grupo de consumidores
    await store.appendTrack([point(2), point(3)], 1_000);
    await expect(tracking.flushOnce()).rejects.toThrow(/NOGROUP/);
    expect(await tracking.flushOnce()).toBe(2);
    const n = (await pool.query(`SELECT count(*)::int AS n FROM trip_track_points WHERE trip_id = $1`, [t.tripId])).rows[0].n;
    expect(n).toBe(3);
  });

  it('sin choferes: espera hasta el tope de búsqueda y luego NO_DRIVER_AVAILABLE', async () => {
    const { tripId } = await trip(CHIOZZA, SB_SOUTH);
    expect(await dispatch.startDispatch(tripId)).toEqual({ kind: 'NO_CANDIDATES_YET', round: 3 });
    await pool.query(`UPDATE trips SET dispatch_started_at = now() - interval '10 minutes' WHERE id = $1`, [tripId]);
    expect(await dispatch.advance(tripId)).toEqual({ kind: 'NO_DRIVER' });
    expect((await app.get(DispatchRepository).loadTrip(tripId))?.status).toBe('NO_DRIVER_AVAILABLE');
  });
});
