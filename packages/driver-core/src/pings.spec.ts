import { distancia, duracion, motivoBloqueo, pesos, regresiva } from './format';
import { PingBuffer, simulatedPosition } from './pings';

describe('PingBuffer', () => {
  const p = (t: number, accuracyM = 5) => ({ lat: -36.68, lng: -56.68, recordedAt: t, accuracyM });

  it('descarta puntos imprecisos o fuera de orden', () => {
    const b = new PingBuffer({ maxAccuracyM: 50 });
    expect(b.add(p(1))).toBe(true);
    expect(b.add(p(2, 200))).toBe(false);
    expect(b.add(p(1))).toBe(false);
    expect(b.size).toBe(1);
  });

  it('manda en lotes y, si falla, conserva lo pendiente para el próximo intento', async () => {
    const b = new PingBuffer({ batchSize: 2 });
    for (let t = 1; t <= 5; t++) b.add(p(t));
    let calls = 0;
    const sent = await b.flush(async (batch) => {
      calls++;
      if (calls === 2) throw new Error('sin señal');
      expect(batch.length).toBeLessThanOrEqual(2);
    });
    expect(sent).toBe(2);
    expect(b.size).toBe(3);
    expect(b.lastError).toBe('sin señal');
    expect(await b.flush(async () => undefined)).toBe(3);
    expect(b.size).toBe(0);
  });

  it('sin conexión guarda como máximo maxBuffered (los más nuevos)', () => {
    const b = new PingBuffer({ maxBuffered: 3 });
    for (let t = 1; t <= 10; t++) b.add(p(t));
    expect(b.size).toBe(3);
    expect(b.last?.recordedAt).toBe(10);
  });

  it('simulador: avanza a la velocidad pedida y se detiene en el destino', () => {
    const from = { lat: -36.6875, lng: -56.68 };
    const to = { lat: -36.716, lng: -56.68 }; // ~3,2 km
    const mid = simulatedPosition(from, to, 0, 60_000, 36); // 600 m en 1 min
    expect(mid.lat).toBeLessThan(from.lat);
    expect(mid.lat).toBeGreaterThan(to.lat);
    const end = simulatedPosition(from, to, 0, 3_600_000, 36);
    expect(end).toMatchObject({ lat: to.lat, lng: to.lng, speedKmh: 0 });
  });
});

describe('format', () => {
  it('importes, distancias y tiempos', () => {
    expect(pesos(220000).replace(/\s/g, ' ')).toBe('$ 2.200,00');
    expect(pesos(220000, true).replace(/\s/g, ' ')).toBe('$ 2.200');
    expect(pesos(null)).toBe('—');
    expect(distancia(846)).toBe('850 m');
    expect(distancia(2340)).toBe('2,3 km');
    expect(duracion(30)).toBe('menos de 1 min');
    expect(duracion(260)).toBe('4 min');
    expect(regresiva(14_200)).toBe('0:15');
  });

  it('motivos de bloqueo en castellano', () => {
    expect(motivoBloqueo('VTV_VENCIDA')).toBe('La VTV del vehículo está vencida');
    expect(motivoBloqueo('CHOFER_SUSPENDED')).toBe('Tu habilitación está suspendida');
    expect(motivoBloqueo('ALGO_NUEVO')).toBe('ALGO_NUEVO');
  });
});
