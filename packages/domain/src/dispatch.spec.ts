import { backhaulMatch, rankCandidates, type DispatchCandidate } from './dispatch-ranking';
import { CorridorProjector, GeoIndex, pointInPolygon, type PolygonRings } from './geo-index';
import { classifyPing } from './presence';

const box = (x0: number, y0: number, x1: number, y1: number): PolygonRings => [
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ],
];

describe('geometría en memoria', () => {
  it('punto en polígono con agujero', () => {
    const withHole: PolygonRings = [box(0, 0, 10, 10)[0]!, box(4, 4, 6, 6)[0]!];
    expect(pointInPolygon({ lng: 1, lat: 1 }, withHole)).toBe(true);
    expect(pointInPolygon({ lng: 5, lat: 5 }, withHole)).toBe(false);
    expect(pointInPolygon({ lng: 11, lat: 5 }, withHole)).toBe(false);
  });

  it('progresiva sobre un eje N→S: crece hacia el sur y mide la distancia lateral', () => {
    const axis = new CorridorProjector([
      [-56.7, -36.3],
      [-56.7, -36.8],
    ]);
    const north = axis.project({ lng: -56.7, lat: -36.4 });
    const south = axis.project({ lng: -56.69, lat: -36.7 });
    expect(south.positionMeters).toBeGreaterThan(north.positionMeters);
    expect(south.positionMeters - north.positionMeters).toBeGreaterThan(33_100); // 0,3° ≈ 33,3 km
    expect(south.positionMeters - north.positionMeters).toBeLessThan(33_400);
    expect(south.lateralMeters).toBeGreaterThan(850); // 0,01° de longitud ≈ 0,89 km
    expect(south.lateralMeters).toBeLessThan(920);
    expect(axis.project({ lng: -56.7, lat: -36.0 }).positionMeters).toBe(0); // antes del inicio
  });

  it('GeoIndex: localidad con desempate al norte y zona por prioridad', () => {
    const index = new GeoIndex({
      localities: [
        { id: 'mda', code: 'MAR_DE_AJO', name: 'Mar de Ajó', corridorOrder: 11, polygons: [box(-56.728, -36.745, -56.655, -36.703)] },
        { id: 'sb', code: 'SAN_BERNARDO', name: 'San Bernardo', corridorOrder: 10, polygons: [box(-56.728, -36.703, -56.655, -36.677)] },
      ],
      zones: [
        { id: 'z1', code: 'SB_CENTRO', localityId: 'sb', dispatchPriority: 5, polygon: box(-56.69, -36.692, -56.668, -36.683) },
        { id: 'z2', code: 'SB_PARADA', localityId: 'sb', dispatchPriority: 9, polygon: box(-56.672, -36.6895, -56.669, -36.687) },
      ],
      corridorAxis: [
        [-56.694, -36.68],
        [-56.694, -36.72],
      ],
    });
    expect(index.localityAt({ lng: -56.68, lat: -36.6875 })?.code).toBe('SAN_BERNARDO');
    expect(index.localityAt({ lng: -56.68, lat: -36.716 })?.code).toBe('MAR_DE_AJO');
    expect(index.localityAt({ lng: -56.5, lat: -36.7 })).toBeNull();
    expect(index.zoneAt({ lng: -56.6705, lat: -36.688 })?.code).toBe('SB_PARADA'); // dentro de ambas: gana prioridad 9
    expect(index.zoneAt({ lng: -56.685, lat: -36.69 })?.code).toBe('SB_CENTRO');
  });
});

describe('classifyPing', () => {
  const t0 = Date.UTC(2026, 10, 20, 15, 0, 0);
  const last = { lat: -36.6875, lng: -56.68, recordedAt: t0 };

  it('aplica un ping normal', () => {
    expect(classifyPing(last, { lat: -36.688, lng: -56.68, recordedAt: t0 + 5_000, accuracyM: 8 }, t0 + 6_000)).toEqual({
      kind: 'APPLY',
      recordedAt: t0 + 5_000,
    });
  });

  it('descarta pings más viejos que el último aplicado', () => {
    expect(classifyPing(last, { lat: -36.69, lng: -56.68, recordedAt: t0 - 1 }, t0 + 1_000).kind).toBe('STALE');
    expect(classifyPing(last, { lat: -36.69, lng: -56.68, recordedAt: t0 }, t0 + 1_000).kind).toBe('STALE');
  });

  it('precisión mala o salto imposible: solo señal de vida', () => {
    expect(classifyPing(last, { lat: -36.69, lng: -56.68, recordedAt: t0 + 5_000, accuracyM: 350 }, t0 + 6_000)).toMatchObject({
      kind: 'HEARTBEAT_ONLY',
      reason: 'LOW_ACCURACY',
    });
    // 3 km en 5 s ≈ 2160 km/h
    expect(classifyPing(last, { lat: -36.7145, lng: -56.68, recordedAt: t0 + 5_000 }, t0 + 6_000)).toMatchObject({
      kind: 'HEARTBEAT_ONLY',
      reason: 'IMPOSSIBLE_JUMP',
    });
  });

  it('reloj adelantado: usa la hora del servidor', () => {
    expect(classifyPing(null, { lat: -36.69, lng: -56.68, recordedAt: t0 + 3_600_000 }, t0)).toEqual({ kind: 'APPLY', recordedAt: t0 });
  });
});

describe('rankCandidates', () => {
  const base: DispatchCandidate = {
    driverId: 'd',
    vehicleId: 'v',
    etaSeconds: 300,
    corridorDistanceMeters: 2_000,
    idleSeconds: 0,
    recentRejections: 0,
    queuePosition: null,
    backhaul: null,
  };
  const trip = { destinationLocalityId: 'SB', direction: 'NORTHBOUND' as const };

  it('ordena por ETA cuando no hay otros factores, con desempate determinístico', () => {
    const r = rankCandidates(
      [
        { ...base, driverId: 'c', etaSeconds: 400 },
        { ...base, driverId: 'b', etaSeconds: 200 },
        { ...base, driverId: 'a', etaSeconds: 200 },
      ],
      trip,
    );
    expect(r.map((c) => c.driverId)).toEqual(['a', 'b', 'c']);
  });

  it('Viaje de Vuelta: HOME vale más que DIRECTION y supera un ETA peor', () => {
    const r = rankCandidates(
      [
        { ...base, driverId: 'cerca', etaSeconds: 120 },
        { ...base, driverId: 'sentido', etaSeconds: 300, backhaul: { baseLocalityId: 'ST', returnDirection: 'NORTHBOUND' } },
        { ...base, driverId: 'casa', etaSeconds: 500, backhaul: { baseLocalityId: 'SB', returnDirection: 'NORTHBOUND' } },
      ],
      trip,
    );
    expect(r.map((c) => [c.driverId, c.backhaulMatch, c.scoreSeconds])).toEqual([
      ['casa', 'HOME', -100],
      ['sentido', 'DIRECTION', 0],
      ['cerca', null, 120],
    ]);
  });

  it('sin coincidencia de sentido no hay bonificación de vuelta', () => {
    expect(backhaulMatch({ baseLocalityId: 'MDA', returnDirection: 'SOUTHBOUND' }, trip)).toBeNull();
    expect(backhaulMatch({ baseLocalityId: 'MDA', returnDirection: 'NONE' }, { destinationLocalityId: 'X', direction: 'NONE' })).toBeNull();
  });

  it('cola de parada, espera y rechazos', () => {
    const [first, second, third] = rankCandidates(
      [
        { ...base, driverId: 'rechaza', recentRejections: 9, etaSeconds: 60 }, // tope 5 × 60 = 300
        { ...base, driverId: 'cola-0', queuePosition: 0, etaSeconds: 200 },
        { ...base, driverId: 'espera', idleSeconds: 3_600, etaSeconds: 150 }, // tope 60
      ],
      trip,
    );
    expect(first?.driverId).toBe('cola-0'); // 200 − 120 = 80
    expect(second?.driverId).toBe('espera'); // 150 − 60 = 90
    expect(third).toMatchObject({ driverId: 'rechaza', scoreSeconds: 360 });
  });

  it('rechaza ETA inválido', () => {
    expect(() => rankCandidates([{ ...base, etaSeconds: Number.NaN }], trip)).toThrow();
  });
});
