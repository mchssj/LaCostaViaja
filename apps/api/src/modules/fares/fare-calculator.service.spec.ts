import { OutOfServiceAreaError, TariffNotConfiguredError, type FareQuote } from '@lacosta/domain';
import {
  FakeRoutingProvider,
  FixedClock,
  fixedRoute,
  InMemoryLocalityResolver,
  InMemoryTariffRepository,
  localityId,
  POINTS,
} from '../../../test/fakes/la-costa-fixtures';
import type { RouteRequest, RouteResult } from '../routing/routing.types';
import { FareCalculatorService } from './fare-calculator.service';

// 12:00 hora argentina de un viernes de noviembre → temporada baja, franja diurna.
const NOV_NOON = new Date('2026-11-20T15:00:00Z');

function build(route: (req: RouteRequest) => RouteResult, tariffs = new InMemoryTariffRepository()) {
  const routing = new FakeRoutingProvider(route);
  const service = new FareCalculatorService(new InMemoryLocalityResolver(), routing, tariffs, new FixedClock(NOV_NOON));
  return { service, routing };
}

const line = (q: FareQuote, code: string): number | undefined => q.lines.find((l) => l.code === code)?.amountCents;
const sum = (q: FareQuote): number => q.lines.reduce((acc, l) => acc + l.amountCents, 0);

describe('FareCalculatorService', () => {
  it('viaje urbano dentro de San Bernardo (diurno, temporada baja)', async () => {
    const { service } = build(fixedRoute(1_800, 324));
    const q = await service.quote({ origin: POINTS.SB_CHIOZZA, destination: POINTS.SB_SOUTH, serviceType: 'TAXI' });

    expect(q.scope).toBe('URBAN');
    expect(q.origin.locality.code).toBe('SAN_BERNARDO');
    expect(q.destination.locality.code).toBe('SAN_BERNARDO');
    expect(q.tariff).toMatchObject({ season: 'LOW', timeBand: 'DAY', ruleId: 'TAXI-URBAN-LOW-DAY' });
    // bandera 220000 + ceil(1800/150)=12 fichas × 22000
    expect(q.totalCents).toBe(484_000);
    expect(line(q, 'INTERURBAN_RETURN')).toBeUndefined();
    expect(q.backhaul.eligible).toBe(false);
    expect(q.corridor.measurement).toBe('NOT_APPLICABLE');
    expect(sum(q)).toBe(q.totalCents);
    expect(new Date(q.validUntil).getTime() - new Date(q.quotedAt).getTime()).toBe(600_000);
  });

  it('San Bernardo → Mar de Ajó: interurbano por RP11 con Retorno y elegible para Viaje de Vuelta', async () => {
    const { service } = build(fixedRoute(3_600, 432));
    const q = await service.quote({ origin: POINTS.SB_CHIOZZA, destination: POINTS.MDA_CENTRO, serviceType: 'TAXI' });

    expect(q.scope).toBe('INTERURBAN');
    expect(q.tariff.ruleId).toBe('TAXI-INTERURBAN-LOW-DAY');
    expect(q.corridor).toMatchObject({
      direction: 'SOUTHBOUND',
      crossedBoundaries: 1,
      measurement: 'CORRIDOR_PROJECTION',
      outsideOriginMeters: 1_447,
    });
    // ceil(3600/170)=22 fichas → 484000. Retorno: ceil(1447/170)=9 fichas × 22000 × 40 % = 79200.
    expect(line(q, 'DISTANCE')).toBe(484_000);
    expect(line(q, 'INTERURBAN_RETURN')).toBe(79_200);
    expect(q.totalCents).toBe(783_000); // 783200 redondeado a $10
    expect(q.backhaul).toEqual({
      eligible: true,
      availableFromLocalityId: localityId('MAR_DE_AJO'),
      returnToLocalityId: localityId('SAN_BERNARDO'),
      returnDirection: 'NORTHBOUND',
      returnSurchargeWaived: false,
    });
    expect(q.warnings.map((w) => w.code)).toContain('CORRIDOR_PROJECTION_USED');
    expect(sum(q)).toBe(q.totalCents);
  });

  it('bonifica el Retorno si el chofer asignado tiene base en la localidad de destino', async () => {
    const { service } = build(fixedRoute(3_600, 432));
    const q = await service.quote({
      origin: POINTS.SB_CHIOZZA,
      destination: POINTS.MDA_CENTRO,
      serviceType: 'TAXI',
      assignedDriverBaseLocalityId: localityId('MAR_DE_AJO'),
    });
    expect(line(q, 'INTERURBAN_RETURN_WAIVER')).toBe(-79_200);
    expect(q.totalCents).toBe(704_000);
    expect(q.backhaul.returnSurchargeWaived).toBe(true);
    expect(q.warnings.map((w) => w.code)).toContain('RETURN_WAIVED_DRIVER_HOME');
  });

  it('no bonifica si la base del chofer es otra localidad', async () => {
    const { service } = build(fixedRoute(3_600, 432));
    const q = await service.quote({
      origin: POINTS.SB_CHIOZZA,
      destination: POINTS.MDA_CENTRO,
      serviceType: 'TAXI',
      assignedDriverBaseLocalityId: localityId('SANTA_TERESITA'),
    });
    expect(q.totalCents).toBe(783_000);
  });

  it('con geometría de ruta mide el tramo exterior sobre la ruta real', async () => {
    const { service } = build(fixedRoute(3_600, 432, true));
    const q = await service.quote({ origin: POINTS.SB_CHIOZZA, destination: POINTS.MDA_CENTRO, serviceType: 'TAXI' });
    expect(q.corridor.measurement).toBe('ROUTE_GEOMETRY');
    expect(q.corridor.outsideOriginMeters).toBeGreaterThan(1_400);
    expect(q.corridor.outsideOriginMeters).toBeLessThan(1_480);
    expect(q.warnings.map((w) => w.code)).not.toContain('CORRIDOR_PROJECTION_USED');
  });

  it('cruzar el límite por pocos metros (SB → Costa Azul) se cobra urbano, sin retorno', async () => {
    const { service } = build(fixedRoute(700, 126));
    const q = await service.quote({ origin: POINTS.SB_NEAR_NORTH_EDGE, destination: POINTS.COSTA_AZUL, serviceType: 'TAXI' });
    expect(q.destination.locality.code).toBe('COSTA_AZUL');
    expect(q.scope).toBe('URBAN');
    expect(q.corridor.outsideOriginMeters).toBe(334);
    expect(q.corridor.direction).toBe('NORTHBOUND');
    expect(q.warnings.map((w) => w.code)).toContain('CROSSING_BELOW_INTERURBAN_THRESHOLD');
    expect(line(q, 'MINIMUM_FARE_ADJUSTMENT')).toBe(20_000); // 330000 → mínima 350000
    expect(q.totalCents).toBe(350_000);
    expect(q.backhaul.eligible).toBe(false);
  });

  it('franja nocturna + temporada alta usan pricingInstant (no el reloj) — re-cotización a mitad de viaje', async () => {
    const { service } = build(fixedRoute(1_800, 324));
    const q = await service.quote({
      origin: POINTS.SB_CHIOZZA,
      destination: POINTS.SB_SOUTH,
      serviceType: 'TAXI',
      pricingInstant: new Date('2027-01-16T02:30:00Z'), // 23:30 del 15/01 en Argentina
    });
    expect(q.tariff).toMatchObject({
      season: 'HIGH',
      timeBand: 'NIGHT',
      seasonPeriodName: 'Temporada de verano 2026/2027',
      ruleId: 'TAXI-URBAN-HIGH-NIGHT',
    });
    // bandera 290000 + 12 fichas × 29000
    expect(q.totalCents).toBe(638_000);
    expect(q.quotedAt).toBe(NOV_NOON.toISOString());
    expect(q.pricingInstant).toBe('2027-01-16T02:30:00.000Z');
  });

  it('remis usa su propia regla', async () => {
    const { service } = build(fixedRoute(1_800, 324));
    const q = await service.quote({ origin: POINTS.SB_CHIOZZA, destination: POINTS.SB_SOUTH, serviceType: 'REMIS' });
    expect(q.tariff.ruleId).toBe('REMIS-URBAN-LOW-DAY');
    expect(q.totalCents).toBe(250_000 + 12 * 24_000);
  });

  it('origen en tramo rural entre San Clemente y Las Toninas → localidad más cercana con advertencia', async () => {
    const { service } = build(fixedRoute(5_000, 600));
    const q = await service.quote({ origin: POINTS.RURAL_GAP_SC_LT, destination: POINTS.LT_CENTRO, serviceType: 'TAXI' });
    expect(q.origin.locality).toMatchObject({ code: 'LAS_TONINAS', method: 'NEAREST_FALLBACK' });
    expect(q.origin.locality.distanceMeters).toBeGreaterThan(2_500);
    expect(q.scope).toBe('URBAN');
    expect(q.warnings.map((w) => w.code)).toContain('ORIGIN_NEAREST_FALLBACK');
  });

  it('marca ruteo degradado cuando el proveedor lo indica', async () => {
    const { service } = build((req) => ({ ...fixedRoute(1_800, 324)(req), degraded: true, provider: 'straight-line' }));
    const q = await service.quote({ origin: POINTS.SB_CHIOZZA, destination: POINTS.SB_SOUTH, serviceType: 'TAXI' });
    expect(q.route.degraded).toBe(true);
    expect(q.warnings.map((w) => w.code)).toContain('ROUTING_DEGRADED');
  });

  it('rechaza puntos fuera del partido sin consultar ruteo ni PostGIS', async () => {
    const { service, routing } = build(fixedRoute(1_000, 120));
    await expect(
      service.quote({ origin: POINTS.CABA, destination: POINTS.SB_CHIOZZA, serviceType: 'TAXI' }),
    ).rejects.toBeInstanceOf(OutOfServiceAreaError);
    expect(routing.calls).toBe(0);
  });

  it('rechaza un destino mar adentro (sin localidad cercana)', async () => {
    const { service } = build(fixedRoute(1_000, 120));
    await expect(
      service.quote({ origin: POINTS.SB_CHIOZZA, destination: POINTS.OPEN_SEA, serviceType: 'TAXI' }),
    ).rejects.toMatchObject({ code: 'OUT_OF_SERVICE_AREA', details: { which: 'DESTINATION', reason: 'NO_LOCALITY_NEARBY' } });
  });

  it('falla explícitamente si no hay cuadro tarifario vigente', async () => {
    const { service } = build(fixedRoute(1_000, 120), new InMemoryTariffRepository(null));
    await expect(
      service.quote({ origin: POINTS.SB_CHIOZZA, destination: POINTS.SB_SOUTH, serviceType: 'TAXI' }),
    ).rejects.toBeInstanceOf(TariffNotConfiguredError);
  });

  it('falla explícitamente si el cuadro no define la combinación pedida', async () => {
    const { service } = build(fixedRoute(1_000, 120), new InMemoryTariffRepository(undefined, undefined, []));
    await expect(
      service.quote({ origin: POINTS.SB_CHIOZZA, destination: POINTS.SB_SOUTH, serviceType: 'TAXI' }),
    ).rejects.toMatchObject({ code: 'TARIFF_NOT_CONFIGURED' });
  });

  it('valida espera solicitada', async () => {
    const { service } = build(fixedRoute(1_000, 120));
    await expect(
      service.quote({ origin: POINTS.SB_CHIOZZA, destination: POINTS.SB_SOUTH, serviceType: 'TAXI', extraWaitSeconds: -5 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
