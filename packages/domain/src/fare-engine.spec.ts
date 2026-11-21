import { computeFare, type FareComputationInput } from './fare-engine';
import { InvalidInputError } from './errors';
import type { TariffRule } from './tariff';

const TAXI_URBAN_LOW_DAY: TariffRule = {
  id: 'taxi-urban-low-day',
  scheduleId: 's',
  serviceType: 'TAXI',
  scope: 'URBAN',
  season: 'LOW',
  timeBand: 'DAY',
  flagFallCents: 220_000,
  unitValueCents: 22_000,
  distanceUnitMeters: 150,
  timeUnitSeconds: 60,
  referenceSpeedKmh: 20,
  minimumFareCents: 350_000,
  returnCoefficientBps: 0,
  backhaulWaivesReturn: false,
};

const TAXI_INTERURBAN_LOW_DAY: TariffRule = {
  ...TAXI_URBAN_LOW_DAY,
  id: 'taxi-interurban-low-day',
  scope: 'INTERURBAN',
  distanceUnitMeters: 170,
  referenceSpeedKmh: 30,
  returnCoefficientBps: 4_000,
  backhaulWaivesReturn: true,
};

const base = (overrides: Partial<FareComputationInput>): FareComputationInput => ({
  rule: TAXI_URBAN_LOW_DAY,
  distanceMeters: 0,
  durationSeconds: 0,
  roundingStepCents: 1_000,
  ...overrides,
});

const amount = (lines: readonly { code: string; amountCents: number }[], code: string): number | undefined =>
  lines.find((l) => l.code === code)?.amountCents;

describe('computeFare', () => {
  it('urbano sin espera: bandera + ceil(distancia / 150 m) fichas', () => {
    // 2000 m a 20 km/h = 360 s exactos → sin espera. ceil(2000/150) = 14 fichas × $220.
    const r = computeFare(base({ distanceMeters: 2_000, durationSeconds: 360 }));
    expect(amount(r.lines, 'FLAG_FALL')).toBe(220_000);
    expect(amount(r.lines, 'DISTANCE')).toBe(14 * 22_000);
    expect(amount(r.lines, 'WAIT_TIME')).toBeUndefined();
    expect(r.totalCents).toBe(528_000);
  });

  it('suma fichas de espera por tránsito lento y espera solicitada', () => {
    // 1500 m a 20 km/h = 270 s; duración 600 s → 330 s lentos + 120 s pedidos = 450 s → 7 fichas.
    const r = computeFare(base({ distanceMeters: 1_500, durationSeconds: 600, extraWaitSeconds: 120 }));
    expect(r.metrics.waitUnits).toBe(7);
    expect(amount(r.lines, 'WAIT_TIME')).toBe(7 * 22_000);
    expect(r.totalCents).toBe(220_000 + 10 * 22_000 + 7 * 22_000);
  });

  it('aplica la tarifa mínima en viajes muy cortos', () => {
    const r = computeFare(base({ distanceMeters: 300, durationSeconds: 54 }));
    expect(amount(r.lines, 'MINIMUM_FARE_ADJUSTMENT')).toBe(350_000 - 264_000);
    expect(r.totalCents).toBe(350_000);
  });

  it('interurbano: Retorno = 40 % de las fichas recorridas fuera del origen, y redondea a $10', () => {
    // 4600 m → ceil(4600/170) = 28 fichas. Fuera: 1450 m → ceil(1450/170) = 9 fichas → 198000 × 40 % = 79200.
    const r = computeFare(
      base({ rule: TAXI_INTERURBAN_LOW_DAY, distanceMeters: 4_600, durationSeconds: 552, interurbanOutsideMeters: 1_450 }),
    );
    expect(amount(r.lines, 'DISTANCE')).toBe(28 * 22_000);
    expect(amount(r.lines, 'INTERURBAN_RETURN')).toBe(79_200);
    expect(r.metrics.returnUnits).toBe(9);
    expect(amount(r.lines, 'ROUNDING')).toBe(-200); // 915200 → 915000
    expect(r.totalCents).toBe(915_000);
  });

  it('bonifica el retorno cuando el chofer termina en su base y la regla lo permite', () => {
    const r = computeFare(
      base({
        rule: TAXI_INTERURBAN_LOW_DAY,
        distanceMeters: 4_600,
        durationSeconds: 552,
        interurbanOutsideMeters: 1_450,
        returnWaived: true,
      }),
    );
    expect(amount(r.lines, 'INTERURBAN_RETURN')).toBe(79_200);
    expect(amount(r.lines, 'INTERURBAN_RETURN_WAIVER')).toBe(-79_200);
    expect(r.metrics.returnWaived).toBe(true);
    expect(r.totalCents).toBe(836_000);
  });

  it('no bonifica si la regla no lo habilita', () => {
    const r = computeFare(
      base({
        rule: { ...TAXI_INTERURBAN_LOW_DAY, backhaulWaivesReturn: false },
        distanceMeters: 4_600,
        durationSeconds: 552,
        interurbanOutsideMeters: 1_450,
        returnWaived: true,
      }),
    );
    expect(amount(r.lines, 'INTERURBAN_RETURN_WAIVER')).toBeUndefined();
    expect(r.totalCents).toBe(915_000);
  });

  it('acota el tramo exterior a la distancia total (datos inconsistentes del ruteo)', () => {
    const r = computeFare(
      base({ rule: TAXI_INTERURBAN_LOW_DAY, distanceMeters: 1_700, durationSeconds: 204, interurbanOutsideMeters: 99_999 }),
    );
    expect(r.metrics.returnUnits).toBe(r.metrics.distanceUnits);
  });

  it('una regla urbana nunca cobra retorno aunque reciba metros exteriores', () => {
    const r = computeFare(base({ distanceMeters: 3_000, durationSeconds: 540, interurbanOutsideMeters: 2_000 }));
    expect(amount(r.lines, 'INTERURBAN_RETURN')).toBeUndefined();
  });

  it('nunca redondea por debajo de la mínima aunque la mínima no sea múltiplo del paso', () => {
    const r = computeFare(
      base({ rule: { ...TAXI_URBAN_LOW_DAY, minimumFareCents: 350_400 }, distanceMeters: 100, durationSeconds: 18 }),
    );
    expect(r.totalCents).toBeGreaterThanOrEqual(350_400);
    expect(r.totalCents % 1_000).toBe(0);
  });

  it('invariante: la suma de las líneas es exactamente el total', () => {
    let seed = 42;
    const rnd = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 500; i++) {
      const distanceMeters = rnd() * 40_000;
      const r = computeFare(
        base({
          rule: rnd() > 0.5 ? TAXI_INTERURBAN_LOW_DAY : TAXI_URBAN_LOW_DAY,
          distanceMeters,
          durationSeconds: rnd() * 3_600,
          extraWaitSeconds: Math.floor(rnd() * 600),
          interurbanOutsideMeters: rnd() * distanceMeters,
          returnWaived: rnd() > 0.5,
          roundingStepCents: [100, 1_000, 5_000][Math.floor(rnd() * 3)]!,
        }),
      );
      expect(r.lines.reduce((acc, l) => acc + l.amountCents, 0)).toBe(r.totalCents);
      expect(Number.isSafeInteger(r.totalCents)).toBe(true);
    }
  });

  it.each([
    ['distancia negativa', { distanceMeters: -1 }],
    ['duración NaN', { durationSeconds: Number.NaN }],
    ['paso de redondeo 0', { roundingStepCents: 0 }],
    ['regla inválida', { rule: { ...TAXI_URBAN_LOW_DAY, unitValueCents: 0 } }],
    ['regla urbana con retorno', { rule: { ...TAXI_URBAN_LOW_DAY, returnCoefficientBps: 4_000 } }],
  ])('rechaza entradas inválidas: %s', (_name, overrides) => {
    expect(() => computeFare(base(overrides as Partial<FareComputationInput>))).toThrow(InvalidInputError);
  });
});
