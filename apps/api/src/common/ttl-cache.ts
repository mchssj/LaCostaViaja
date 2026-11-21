interface Entry<V> {
  readonly value: V;
  readonly expiresAt: number;
}

/**
 * Caché en memoria con TTL pensada para datos casi estáticos (cuadro tarifario, calendario).
 *  - Deduplica cargas concurrentes (evita estampida contra la base en el pico de temporada).
 *  - stale-if-error: si la recarga falla y hay un valor vencido, lo sigue sirviendo.
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async getOrLoad(key: string, loader: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const load = (async (): Promise<V> => {
      try {
        const value = await loader();
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
        return value;
      } catch (err) {
        if (hit) return hit.value;
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, load);
    return load;
  }

  invalidate(key?: string): void {
    if (key === undefined) this.entries.clear();
    else this.entries.delete(key);
  }
}
