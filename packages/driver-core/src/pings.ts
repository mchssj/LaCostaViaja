// Buffer de posiciones GPS: junta los puntos del dispositivo y los manda en lotes. Si el envío falla
// (sin señal), los conserva y reintenta en el próximo ciclo, descartando los más viejos si se acumulan.

export interface Ping {
  readonly lat: number;
  readonly lng: number;
  /** epoch ms del dispositivo */
  readonly recordedAt: number;
  readonly accuracyM?: number;
  readonly speedKmh?: number;
  readonly headingDeg?: number;
}

export interface PingBufferOptions {
  /** Máximo por lote (la API acepta hasta MAX_PINGS_PER_BATCH). */
  readonly batchSize?: number;
  /** Máximo guardado sin conexión; se descartan los más viejos. */
  readonly maxBuffered?: number;
  /** Puntos con precisión peor que esta se descartan (m). */
  readonly maxAccuracyM?: number;
}

export class PingBuffer {
  private readonly items: Ping[] = [];
  private sending = false;
  private readonly batchSize: number;
  private readonly maxBuffered: number;
  private readonly maxAccuracyM: number;
  lastSentAt: number | null = null;
  lastError: string | null = null;

  constructor(opts: PingBufferOptions = {}) {
    this.batchSize = opts.batchSize ?? 50;
    this.maxBuffered = opts.maxBuffered ?? 500;
    this.maxAccuracyM = opts.maxAccuracyM ?? 100;
  }

  get size(): number {
    return this.items.length;
  }

  get last(): Ping | null {
    return this.items.at(-1) ?? null;
  }

  /** Devuelve false si el punto se descartó (impreciso o repetido). */
  add(p: Ping): boolean {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
    if (p.accuracyM !== undefined && p.accuracyM > this.maxAccuracyM) return false;
    const prev = this.items.at(-1);
    if (prev && prev.recordedAt >= p.recordedAt) return false;
    this.items.push(p);
    if (this.items.length > this.maxBuffered) this.items.splice(0, this.items.length - this.maxBuffered);
    return true;
  }

  /**
   * Manda lo acumulado en lotes con `send`. Si un lote falla, lo deja en el buffer y corta.
   * Devuelve la cantidad enviada. No corre dos envíos a la vez.
   */
  async flush(send: (pings: Ping[]) => Promise<unknown>, now: () => number = Date.now): Promise<number> {
    if (this.sending || this.items.length === 0) return 0;
    this.sending = true;
    let sent = 0;
    try {
      while (this.items.length > 0) {
        const batch = this.items.slice(0, this.batchSize);
        try {
          await send(batch);
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err);
          break;
        }
        this.items.splice(0, batch.length);
        sent += batch.length;
        this.lastSentAt = now();
        this.lastError = null;
      }
    } finally {
      this.sending = false;
    }
    return sent;
  }
}

/**
 * Simulador de GPS para probar sin moverse: recorre en línea recta de `from` a `to` a la velocidad
 * indicada y devuelve el punto para un instante. Solo para desarrollo.
 */
export function simulatedPosition(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  startedAt: number,
  now: number,
  speedKmh = 30,
): Ping {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(to.lat - from.lat);
  const dLng = rad(to.lng - from.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLng / 2) ** 2;
  const total = 2 * R * Math.asin(Math.sqrt(h));
  const travelled = ((now - startedAt) / 1000) * (speedKmh / 3.6);
  const f = total === 0 ? 1 : Math.min(1, travelled / total);
  const moving = f < 1;
  return {
    lat: from.lat + (to.lat - from.lat) * f,
    lng: from.lng + (to.lng - from.lng) * f,
    recordedAt: now,
    accuracyM: 5,
    speedKmh: moving ? speedKmh : 0,
  };
}
