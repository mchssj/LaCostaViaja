import { RoutingUnavailableError } from '@lacosta/domain';
import { OsrmRoutingProvider } from './osrm-routing.provider';
import { ResilientRoutingProvider } from './resilient-routing.provider';
import type { IRoutingProvider, RouteResult } from './routing.types';
import { StraightLineRoutingProvider } from './straight-line-routing.provider';

const REQ = { origin: { lat: -36.6875, lng: -56.68 }, destination: { lat: -36.716, lng: -56.68 } };

const okResult: RouteResult = { distanceMeters: 3_400, durationSeconds: 420, geometry: null, provider: 'primary', degraded: false };

class ScriptedProvider implements IRoutingProvider {
  readonly name = 'primary';
  calls = 0;
  constructor(private readonly outcomes: ('ok' | 'fail')[]) {}
  async route(): Promise<RouteResult> {
    const outcome = this.outcomes[this.calls++] ?? 'ok';
    if (outcome === 'fail') throw new Error('timeout');
    return okResult;
  }
}

describe('StraightLineRoutingProvider', () => {
  it('aplica factor de desvío y siempre se marca degradado', async () => {
    const r = await new StraightLineRoutingProvider(1.3, 30).route(REQ);
    expect(r.degraded).toBe(true);
    expect(r.geometry).toBeNull();
    expect(r.distanceMeters).toBeGreaterThan(4_100);
    expect(r.distanceMeters).toBeLessThan(4_140);
  });
});

describe('ResilientRoutingProvider', () => {
  it('usa el primario cuando responde', async () => {
    const primary = new ScriptedProvider(['ok']);
    const r = await new ResilientRoutingProvider(primary, new StraightLineRoutingProvider(), { failureThreshold: 2, cooldownMs: 1_000 }).route(REQ);
    expect(r).toEqual(okResult);
  });

  it('cae al fallback, abre el circuito tras N fallos y vuelve a probar luego del cooldown', async () => {
    let now = 0;
    const primary = new ScriptedProvider(['fail', 'fail', 'ok']);
    const fallbackReasons: string[] = [];
    const provider = new ResilientRoutingProvider(primary, new StraightLineRoutingProvider(), {
      failureThreshold: 2,
      cooldownMs: 30_000,
      now: () => now,
      onFallback: (reason) => fallbackReasons.push(reason),
    });

    expect((await provider.route(REQ)).degraded).toBe(true); // fallo 1
    expect((await provider.route(REQ)).degraded).toBe(true); // fallo 2 → circuito abierto
    expect(provider.circuitOpen).toBe(true);
    await provider.route(REQ); // abierto: ni siquiera llama al primario
    expect(primary.calls).toBe(2);

    now = 30_001; // half-open
    expect(await provider.route(REQ)).toEqual(okResult);
    expect(primary.calls).toBe(3);
    expect(fallbackReasons).toEqual(['timeout', 'timeout']);
  });
});

describe('OsrmRoutingProvider', () => {
  it('parsea distancia, duración y geometría', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        code: 'Ok',
        routes: [{ distance: 3_512.4, duration: 401.2, geometry: { type: 'LineString', coordinates: [[-56.68, -36.6875], [-56.68, -36.716]] } }],
      }),
    });
    const r = await new OsrmRoutingProvider('http://osrm:5000/', 1_000, fetchImpl).route(REQ);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://osrm:5000/route/v1/driving/-56.68,-36.6875;-56.68,-36.716?overview=full&geometries=geojson&alternatives=false&steps=false',
    );
    expect(r).toMatchObject({ distanceMeters: 3_512.4, durationSeconds: 401.2, degraded: false, provider: 'osrm' });
    expect(r.geometry?.coordinates).toHaveLength(2);
  });

  it.each([
    ['HTTP 503', { ok: false, status: 503, json: async () => ({}) }],
    ['NoRoute', { ok: true, status: 200, json: async () => ({ code: 'NoRoute', routes: [] }) }],
  ])('traduce errores a RoutingUnavailableError (%s)', async (_name, response) => {
    const fetchImpl = jest.fn().mockResolvedValue(response);
    await expect(new OsrmRoutingProvider('http://osrm:5000', 1_000, fetchImpl).route(REQ)).rejects.toBeInstanceOf(
      RoutingUnavailableError,
    );
  });

  it('traduce errores de red/timeout', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'));
    await expect(new OsrmRoutingProvider('http://osrm:5000', 10, fetchImpl).route(REQ)).rejects.toBeInstanceOf(
      RoutingUnavailableError,
    );
  });
});
