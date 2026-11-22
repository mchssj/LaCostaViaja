import {
  AR_TIMEZONE,
  haversineMeters,
  tariffRuleKey,
  type GeoPoint,
  type ResolvedLocality,
  type Season,
  type SeasonPeriod,
  type ServiceType,
  type TariffRule,
  type TariffRuleKey,
  type TariffSchedule,
  type TimeBand,
  type TripScope,
} from '@lacosta/domain';
import type { Clock } from '../../src/common/clock';
import type { CorridorStretch, CorridorStretchRequest, ILocalityResolver } from '../../src/modules/geo/locality-resolver';
import type { IRoutingProvider, RouteRequest, RouteResult } from '../../src/modules/routing/routing.types';
import type { ITariffRepository } from '../../src/modules/tariffs/tariff-repository';

/** Mismas envolventes que packages/db/seeds/20261120130000_localidades_y_zonas.sql: [lonMin, latMin, lonMax, latMax]. */
export const LOCALITIES = [
  { code: 'SAN_CLEMENTE', name: 'San Clemente del Tuyú', order: 1, bbox: [-56.79, -36.405, -56.68, -36.3] },
  { code: 'LAS_TONINAS', name: 'Las Toninas', order: 2, bbox: [-56.735, -36.505, -56.665, -36.465] },
  { code: 'COSTA_CHICA', name: 'Costa Chica', order: 3, bbox: [-56.735, -36.515, -56.665, -36.505] },
  { code: 'SANTA_TERESITA', name: 'Santa Teresita', order: 4, bbox: [-56.735, -36.56, -56.665, -36.515] },
  { code: 'MAR_DEL_TUYU', name: 'Mar del Tuyú', order: 5, bbox: [-56.73, -36.59, -56.662, -36.56] },
  { code: 'COSTA_DEL_ESTE', name: 'Costa del Este', order: 6, bbox: [-56.73, -36.618, -56.662, -36.59] },
  { code: 'AGUAS_VERDES', name: 'Aguas Verdes', order: 7, bbox: [-56.728, -36.645, -56.66, -36.618] },
  { code: 'LA_LUCILA_DEL_MAR', name: 'La Lucila del Mar', order: 8, bbox: [-56.728, -36.668, -56.658, -36.645] },
  { code: 'COSTA_AZUL', name: 'Costa Azul', order: 9, bbox: [-56.728, -36.677, -56.658, -36.668] },
  { code: 'SAN_BERNARDO', name: 'San Bernardo del Tuyú', order: 10, bbox: [-56.728, -36.703, -56.655, -36.677] },
  { code: 'MAR_DE_AJO', name: 'Mar de Ajó', order: 11, bbox: [-56.728, -36.745, -56.655, -36.703] },
  { code: 'NUEVA_ATLANTIS', name: 'Nueva Atlantis', order: 12, bbox: [-56.728, -36.79, -56.655, -36.745] },
  { code: 'PINAR_DEL_SOL', name: 'Pinar del Sol', order: 13, bbox: [-56.735, -36.88, -56.65, -36.84] },
  { code: 'COSTA_ESMERALDA', name: 'Costa Esmeralda', order: 14, bbox: [-56.82, -37.03, -56.74, -36.975] },
] as const;

export type LocalityCode = (typeof LOCALITIES)[number]['code'];
export const localityId = (code: LocalityCode): string => `loc-${code}`;

export const POINTS = {
  SB_CHIOZZA: { lat: -36.6875, lng: -56.68 },
  SB_SOUTH: { lat: -36.695, lng: -56.69 },
  SB_NEAR_NORTH_EDGE: { lat: -36.679, lng: -56.68 },
  COSTA_AZUL: { lat: -36.674, lng: -56.68 },
  MDA_CENTRO: { lat: -36.716, lng: -56.68 },
  ST_CALLE_2: { lat: -36.536, lng: -56.692 },
  LT_CENTRO: { lat: -36.486, lng: -56.7 },
  RURAL_GAP_SC_LT: { lat: -36.44, lng: -56.72 },
  OPEN_SEA: { lat: -36.6, lng: -56.56 },
  CABA: { lat: -34.6037, lng: -58.3816 },
} satisfies Record<string, GeoPoint>;

const M_PER_DEG_LAT = 111_320;
const AXIS_START_LAT = -36.3;

type Bbox = readonly [number, number, number, number];
const contains = ([x0, y0, x1, y1]: Bbox, p: GeoPoint): boolean => p.lng >= x0 && p.lng <= x1 && p.lat >= y0 && p.lat <= y1;
const distanceToBbox = ([x0, y0, x1, y1]: Bbox, p: GeoPoint): number => {
  const dx = Math.max(x0 - p.lng, 0, p.lng - x1) * M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180);
  const dy = Math.max(y0 - p.lat, 0, p.lat - y1) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
};

/** Doble en memoria de PostGIS: rectángulos + corredor N-S lineal por latitud. */
export class InMemoryLocalityResolver implements ILocalityResolver {
  constructor(private readonly fallbackMaxMeters = 6_000) {}

  static position(p: GeoPoint): number {
    return (AXIS_START_LAT - p.lat) * M_PER_DEG_LAT;
  }

  async resolve(point: GeoPoint): Promise<ResolvedLocality | null> {
    const contained = LOCALITIES.find((l) => contains(l.bbox, point));
    if (contained) return this.toResolved(contained, 'CONTAINED', 0);
    const nearest = LOCALITIES.map((l) => ({ l, d: distanceToBbox(l.bbox, point) })).sort((a, b) => a.d - b.d)[0];
    if (!nearest || nearest.d > this.fallbackMaxMeters) return null;
    return this.toResolved(nearest.l, 'NEAREST_FALLBACK', Math.round(nearest.d));
  }

  async measureCorridorStretch(req: CorridorStretchRequest): Promise<CorridorStretch> {
    const loc = LOCALITIES.find((l) => localityId(l.code) === req.originLocalityId);
    if (!loc) throw new Error(`Localidad desconocida ${req.originLocalityId}`);
    const o = InMemoryLocalityResolver.position(req.origin);
    const d = InMemoryLocalityResolver.position(req.destination);
    const from = InMemoryLocalityResolver.position({ lat: loc.bbox[3], lng: 0 });
    const to = InMemoryLocalityResolver.position({ lat: loc.bbox[1], lng: 0 });
    const corridorOutside = Math.max(0, d > to ? d - Math.max(to, o) : d < from ? Math.min(from, o) - d : 0);

    let routeOutside: number | null = null;
    if (req.routeGeometry) {
      routeOutside = 0;
      const coords = req.routeGeometry.coordinates;
      for (let i = 1; i < coords.length; i++) {
        const [ax, ay] = coords[i - 1]!;
        const [bx, by] = coords[i]!;
        const steps = 50;
        for (let s = 0; s < steps; s++) {
          const p1 = { lng: ax + ((bx - ax) * s) / steps, lat: ay + ((by - ay) * s) / steps };
          const p2 = { lng: ax + ((bx - ax) * (s + 1)) / steps, lat: ay + ((by - ay) * (s + 1)) / steps };
          const mid = { lng: (p1.lng + p2.lng) / 2, lat: (p1.lat + p2.lat) / 2 };
          if (!contains(loc.bbox, mid)) routeOutside += haversineMeters(p1, p2);
        }
      }
    }

    return {
      corridorCode: 'RP11',
      originPositionMeters: o,
      destinationPositionMeters: d,
      originLocalityFromMeters: from,
      originLocalityToMeters: to,
      corridorOutsideOriginMeters: corridorOutside,
      routeOutsideOriginMeters: routeOutside,
    };
  }

  private toResolved(
    l: (typeof LOCALITIES)[number],
    method: ResolvedLocality['method'],
    distanceMeters: number,
  ): ResolvedLocality {
    return { id: localityId(l.code), code: l.code, name: l.name, corridorOrder: l.order, method, distanceMeters };
  }
}

export const SCHEDULE: TariffSchedule = {
  id: 'sched-CT-2026-2027',
  code: 'CT-2026-2027',
  legalInstrument: 'EJEMPLO DE DESARROLLO',
  timeZone: AR_TIMEZONE,
  nightStartsAt: '22:00',
  nightEndsAt: '06:00',
  interurbanMinOutsideMeters: 800,
  roundingStepCents: 1_000,
  quoteTtlSeconds: 600,
};

export const SEASON_PERIODS: SeasonPeriod[] = [
  { name: 'Temporada de verano 2026/2027', season: 'HIGH', startsOn: '2026-12-15', endsOnExclusive: '2027-03-15' },
  { name: 'Semana Santa 2027', season: 'HIGH', startsOn: '2027-03-25', endsOnExclusive: '2027-03-29' },
];

/** Replica la generación de 20261120130100_cuadro_tarifario_2026_2027.sql (base LOW/DAY × coeficientes). */
export function buildSeedLikeRules(scheduleId: string): TariffRule[] {
  const bases: [ServiceType, TripScope, number, number, number, number, number, number, boolean][] = [
    ['TAXI', 'URBAN', 220_000, 22_000, 150, 20, 350_000, 0, false],
    ['TAXI', 'INTERURBAN', 220_000, 22_000, 170, 30, 350_000, 4_000, true],
    ['REMIS', 'URBAN', 250_000, 24_000, 150, 20, 400_000, 0, false],
    ['REMIS', 'INTERURBAN', 250_000, 24_000, 170, 30, 400_000, 4_000, true],
  ];
  const factors: [Season, TimeBand, number][] = [
    ['LOW', 'DAY', 1],
    ['LOW', 'NIGHT', 1.2],
    ['HIGH', 'DAY', 1.1],
    ['HIGH', 'NIGHT', 1.32],
  ];
  return bases.flatMap(([serviceType, scope, flag, unit, meters, speed, min, bps, waives]) =>
    factors.map(([season, timeBand, f]) => ({
      id: `${serviceType}-${scope}-${season}-${timeBand}`,
      scheduleId,
      serviceType,
      scope,
      season,
      timeBand,
      flagFallCents: Math.round((flag * f) / 1_000) * 1_000,
      unitValueCents: Math.round((unit * f) / 100) * 100,
      distanceUnitMeters: meters,
      timeUnitSeconds: 60,
      referenceSpeedKmh: speed,
      minimumFareCents: Math.round((min * f) / 1_000) * 1_000,
      returnCoefficientBps: bps,
      backhaulWaivesReturn: waives,
    })),
  );
}

export class InMemoryTariffRepository implements ITariffRepository {
  constructor(
    private readonly schedule: TariffSchedule | null = SCHEDULE,
    private readonly periods: readonly SeasonPeriod[] = SEASON_PERIODS,
    private readonly rules: readonly TariffRule[] = buildSeedLikeRules(SCHEDULE.id),
  ) {}

  async findScheduleAt(): Promise<TariffSchedule | null> {
    return this.schedule;
  }

  async findSeasonPeriodsOn(isoDate: string): Promise<readonly SeasonPeriod[]> {
    return this.periods.filter((p) => p.startsOn <= isoDate && isoDate < p.endsOnExclusive);
  }

  async findRule(key: TariffRuleKey): Promise<TariffRule | null> {
    return this.rules.find((r) => tariffRuleKey(r) === tariffRuleKey(key)) ?? null;
  }

  async findRuleById(ruleId: string): Promise<TariffRule | null> {
    return this.rules.find((r) => r.id === ruleId) ?? null;
  }
}

export class FakeRoutingProvider implements IRoutingProvider {
  readonly name = 'fake';
  calls = 0;

  constructor(private readonly impl: (req: RouteRequest) => RouteResult) {}

  async route(req: RouteRequest): Promise<RouteResult> {
    this.calls++;
    return this.impl(req);
  }
}

export const fixedRoute =
  (distanceMeters: number, durationSeconds: number, withGeometry = false) =>
  (req: RouteRequest): RouteResult => ({
    distanceMeters,
    durationSeconds,
    geometry: withGeometry
      ? {
          type: 'LineString',
          coordinates: [
            [req.origin.lng, req.origin.lat],
            [req.destination.lng, req.destination.lat],
          ],
        }
      : null,
    provider: 'fake',
    degraded: false,
  });

export class FixedClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return new Date(this.instant.getTime());
  }

  set(instant: Date): void {
    this.instant = instant;
  }
}
