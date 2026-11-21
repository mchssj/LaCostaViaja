import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { FareCalculatorService } from '../src/modules/fares/fare-calculator.service';
import { LOCALITY_RESOLVER, type ILocalityResolver } from '../src/modules/geo/locality-resolver';
import { POINTS } from './fakes/la-costa-fixtures';

const DB_URL = process.env['TEST_DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

/** Integración real: PostgreSQL + PostGIS con migraciones y seeds aplicados (pnpm db:migrate && pnpm db:seed). */
describeDb('Integración PostGIS + motor tarifario', () => {
  let app: INestApplication;
  let fares: FareCalculatorService;
  let resolver: ILocalityResolver;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = DB_URL;
    process.env['ROUTING_PROVIDER'] = 'straight-line';
    process.env['DISPATCH_WORKERS_ENABLED'] = 'false';
    if (process.env['TEST_REDIS_URL']) process.env['REDIS_URL'] = process.env['TEST_REDIS_URL'];
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    fares = app.get(FareCalculatorService);
    resolver = app.get<ILocalityResolver>(LOCALITY_RESOLVER);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health informa PostGIS', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
    expect(res.body.postgis).toMatch(/^3\./);
  });

  it.each([
    [POINTS.SB_CHIOZZA, 'SAN_BERNARDO'],
    [POINTS.ST_CALLE_2, 'SANTA_TERESITA'],
    [POINTS.MDA_CENTRO, 'MAR_DE_AJO'],
    [{ lat: -36.357, lng: -56.724 }, 'SAN_CLEMENTE'],
  ])('resuelve %j en %s (ST_Covers)', async (point, code) => {
    await expect(resolver.resolve(point)).resolves.toMatchObject({ code, method: 'CONTAINED', distanceMeters: 0 });
  });

  it('tramo rural → NEAREST_FALLBACK; mar adentro → null', async () => {
    await expect(resolver.resolve(POINTS.RURAL_GAP_SC_LT)).resolves.toMatchObject({ code: 'LAS_TONINAS', method: 'NEAREST_FALLBACK' });
    await expect(resolver.resolve(POINTS.OPEN_SEA)).resolves.toBeNull();
  });

  it('mide el tramo exterior con ST_Difference sobre la geometría de ruta', async () => {
    const sb = await resolver.resolve(POINTS.SB_CHIOZZA);
    const stretch = await resolver.measureCorridorStretch({
      origin: POINTS.SB_CHIOZZA,
      destination: POINTS.MDA_CENTRO,
      originLocalityId: sb!.id,
      routeGeometry: { type: 'LineString', coordinates: [[-56.68, -36.6875], [-56.68, -36.716]] },
    });
    expect(stretch.destinationPositionMeters).toBeGreaterThan(stretch.originPositionMeters);
    expect(stretch.routeOutsideOriginMeters).toBeGreaterThan(1_400);
    expect(stretch.routeOutsideOriginMeters).toBeLessThan(1_500);
    expect(stretch.corridorOutsideOriginMeters).toBeGreaterThan(1_300);
  });

  it('cotiza San Bernardo → Mar de Ajó en temporada alta nocturna contra el cuadro sembrado', async () => {
    const q = await fares.quote({
      origin: POINTS.SB_CHIOZZA,
      destination: POINTS.MDA_CENTRO,
      serviceType: 'TAXI',
      pricingInstant: new Date('2027-01-16T02:30:00Z'),
    });
    expect(q.scope).toBe('INTERURBAN');
    expect(q.tariff).toMatchObject({ scheduleCode: 'CT-2026-2027', season: 'HIGH', timeBand: 'NIGHT' });
    expect(q.corridor).toMatchObject({ direction: 'SOUTHBOUND', crossedBoundaries: 1, measurement: 'CORRIDOR_PROJECTION' });
    expect(q.backhaul.eligible).toBe(true);
    expect(q.route.degraded).toBe(true);
    expect(q.lines.reduce((acc, l) => acc + l.amountCents, 0)).toBe(q.totalCents);
    expect(q.lines.find((l) => l.code === 'INTERURBAN_RETURN')?.amountCents).toBeGreaterThan(0);
  });

  it('cotiza Santa Teresita → San Clemente (3 límites cruzados, hacia el norte)', async () => {
    const q = await fares.quote({
      origin: POINTS.ST_CALLE_2,
      destination: { lat: -36.357, lng: -56.724 },
      serviceType: 'REMIS',
      pricingInstant: new Date('2026-11-20T15:00:00Z'),
    });
    expect(q.scope).toBe('INTERURBAN');
    expect(q.corridor.direction).toBe('NORTHBOUND');
    expect(q.corridor.crossedBoundaries).toBe(3);
    expect(q.backhaul.returnDirection).toBe('SOUTHBOUND');
    expect(q.tariff).toMatchObject({ season: 'LOW', timeBand: 'DAY' });
  });
});
