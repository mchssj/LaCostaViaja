import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { CLOCK } from '../src/common/clock';
import { PG_POOL } from '../src/database/database.module';
import { LOCALITY_RESOLVER } from '../src/modules/geo/locality-resolver';
import { ROUTING_PROVIDER } from '../src/modules/routing/routing.types';
import { TARIFF_REPOSITORY } from '../src/modules/tariffs/tariff-repository';
import { REDIS } from '../src/redis/redis.tokens';
import {
  FakeRoutingProvider,
  FixedClock,
  fixedRoute,
  InMemoryLocalityResolver,
  InMemoryTariffRepository,
  POINTS,
} from './fakes/la-costa-fixtures';

/** Redis mínimo en memoria: alcanza para el límite de pedidos (INCR + EXPIRE en MULTI). */
function fakeRedisForRateLimit() {
  const counters = new Map<string, number>();
  return {
    status: 'end',
    disconnect: () => undefined,
    quit: async () => 'OK',
    on: () => undefined,
    defineCommand: () => undefined,
    multi() {
      const ops: Array<() => [null, number]> = [];
      const chain = {
        incr(key: string) {
          ops.push(() => {
            counters.set(key, (counters.get(key) ?? 0) + 1);
            return [null, counters.get(key)!];
          });
          return chain;
        },
        expire() {
          ops.push(() => [null, 1]);
          return chain;
        },
        exec: async () => ops.map((op) => op()),
      };
      return chain;
    },
  };
}

/** Cableado HTTP real (pipes, filtros, versionado, guard global) con dobles en memoria en lugar de PostGIS/OSRM/Redis. */
describe('POST /api/v1/fares/quote', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:1/test';
    process.env['DISPATCH_WORKERS_ENABLED'] = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PG_POOL)
      .useValue({ end: async () => undefined, query: async () => Promise.reject(new Error('sin base en este test')) })
      .overrideProvider(LOCALITY_RESOLVER)
      .useValue(new InMemoryLocalityResolver())
      .overrideProvider(TARIFF_REPOSITORY)
      .useValue(new InMemoryTariffRepository())
      .overrideProvider(ROUTING_PROVIDER)
      .useValue(new FakeRoutingProvider(fixedRoute(3_600, 432)))
      .overrideProvider(CLOCK)
      .useValue(new FixedClock(new Date('2026-11-20T15:00:00Z')))
      .overrideProvider(REDIS)
      .useValue(fakeRedisForRateLimit())
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('200 con cotización desglosada', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/fares/quote')
      .send({ origin: POINTS.SB_CHIOZZA, destination: POINTS.MDA_CENTRO, serviceType: 'TAXI' })
      .expect(200);
    expect(res.body).toMatchObject({ scope: 'INTERURBAN', totalCents: 783_000, currency: 'ARS' });
    expect(res.body.lines.map((l: { code: string }) => l.code)).toEqual(['FLAG_FALL', 'DISTANCE', 'INTERURBAN_RETURN', 'ROUNDING']);
  });

  it('400 ante coordenadas inválidas', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/fares/quote')
      .send({ origin: { lat: 123, lng: -56.68 }, destination: POINTS.MDA_CENTRO, serviceType: 'TAXI' })
      .expect(400);
  });

  it('400 si se intenta inyectar parámetros internos (bonificación de retorno)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/fares/quote')
      .send({ origin: POINTS.SB_CHIOZZA, destination: POINTS.MDA_CENTRO, serviceType: 'TAXI', assignedDriverBaseLocalityId: 'x' })
      .expect(400);
  });

  it('422 fuera del área de servicio, con código de error estable', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/fares/quote')
      .send({ origin: POINTS.CABA, destination: POINTS.MDA_CENTRO, serviceType: 'REMIS' })
      .expect(422);
    expect(res.body).toMatchObject({ error: 'OUT_OF_SERVICE_AREA', details: { which: 'ORIGIN', reason: 'OUTSIDE_DISTRICT_BBOX' } });
  });

  it('la cotización trae un quoteToken firmado', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/fares/quote')
      .send({ origin: POINTS.SB_CHIOZZA, destination: POINTS.MDA_CENTRO, serviceType: 'TAXI' })
      .expect(200);
    expect(res.body.quoteToken).toMatch(/^q1\.[\w-]+\.[\w-]+$/);
  });

  it('guard global: sin token 401, con token inválido 401 (cerrado por defecto)', async () => {
    const a = await request(app.getHttpServer()).get('/api/trips/mine').expect(401);
    expect(a.body.error).toBe('UNAUTHORIZED');
    await request(app.getHttpServer()).get('/api/drivers').set('Authorization', 'Bearer x.y.z').expect(401);
    await request(app.getHttpServer()).post('/api/vouchers').send({}).expect(401);
  });
});
