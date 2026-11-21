import { isValidCuit } from './cuit';
import { haversineMeters, isWithinBBox } from './geo';
import { applyBasisPoints, roundHalfUpToStep } from './money';

describe('dinero en centavos', () => {
  it('redondeo half-up al paso', () => {
    expect(roundHalfUpToStep(915_200, 1_000)).toBe(915_000);
    expect(roundHalfUpToStep(915_500, 1_000)).toBe(916_000);
    expect(roundHalfUpToStep(915_499, 1_000)).toBe(915_000);
    expect(roundHalfUpToStep(0, 1_000)).toBe(0);
  });

  it('puntos básicos half-up en aritmética entera', () => {
    expect(applyBasisPoints(198_000, 4_000)).toBe(79_200);
    expect(applyBasisPoints(1, 5_000)).toBe(1); // 0,5 → 1
    expect(applyBasisPoints(1, 4_999)).toBe(0);
  });

  it('rechaza importes no enteros', () => {
    expect(() => roundHalfUpToStep(10.5, 1_000)).toThrow();
  });
});

describe('CUIT/CUIL', () => {
  it.each(['20284567898', '27259873210', '20312223334', '27356667773', '20301112220', '27334445556', '30712345671', '30709876542', '30715558889', '20-28456789-8'])(
    'acepta %s (seeds demo)',
    (cuit) => expect(isValidCuit(cuit)).toBe(true),
  );

  it.each(['20284567890', '99284567898', '2028456789', 'abc'])('rechaza %s', (cuit) => expect(isValidCuit(cuit)).toBe(false));
});

describe('geo', () => {
  it('haversine: 0,0285° de latitud ≈ 3,17 km (Av. Chiozza → centro de Mar de Ajó)', () => {
    const d = haversineMeters({ lat: -36.6875, lng: -56.68 }, { lat: -36.716, lng: -56.68 });
    expect(d).toBeGreaterThan(3_150);
    expect(d).toBeLessThan(3_190);
  });

  it('bbox del partido', () => {
    expect(isWithinBBox({ lat: -36.6875, lng: -56.68 })).toBe(true); // San Bernardo
    expect(isWithinBBox({ lat: -34.6037, lng: -58.3816 })).toBe(false); // CABA
  });
});
