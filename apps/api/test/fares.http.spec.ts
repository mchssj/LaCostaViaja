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
import {
  FakeRoutingProvider,
  FixedClock,
  fixedRoute,
  InMemoryLocalityResolver,
  InMemoryTariffRepository,
  POINTS,
} from './fakes/la-costa-fixtures';

/** Cableado HTTP real (pipes, filtros, versionado) con dobles en memoria en lugar de PostGIS/OSRM. */
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
});
