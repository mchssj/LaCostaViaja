/**
 * Cliente HTTP de la API, sin dependencias de plataforma: sirve en el navegador, en Next.js y en
 * React Native. El almacenamiento de la sesión y `fetch` se inyectan.
 *
 * - Agrega el token de acceso y, ante un 401, lo renueva UNA vez con el refresh token (en paralelo,
 *   varias llamadas comparten la misma renovación) y reintenta.
 * - Los errores llegan como ApiError con un mensaje en castellano para mostrar al usuario.
 */

export interface Session {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface SessionStorage {
  get(): Promise<Session | null> | Session | null;
  set(session: Session): Promise<void> | void;
  clear(): Promise<void> | void;
}

export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ApiClientOptions {
  /** URL base con el prefijo, por ejemplo http://localhost:3000/api */
  readonly baseUrl: string;
  readonly storage: SessionStorage;
  readonly fetch?: FetchLike;
  /** Se llama cuando la sesión no se pudo renovar (hay que volver a ingresar). */
  readonly onSessionExpired?: () => void;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Sin conexión o la API no respondió. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

const FRIENDLY_BY_STATUS: Record<number, string> = {
  0: 'No hay conexión con el servidor. Revisá tu internet y volvé a intentar.',
  401: 'La sesión venció. Volvé a ingresar.',
  403: 'No tenés permiso para hacer esto.',
  404: 'No se encontró lo que buscabas.',
  429: 'Demasiados intentos seguidos. Esperá un momento.',
  502: 'El servicio de pagos no respondió. Probá de nuevo.',
  503: 'El servicio no está disponible en este momento. Probá en unos segundos.',
};

/** Arma el ApiError a partir de la respuesta { error, message, details } de la API. */
export function toApiError(status: number, body: string): ApiError {
  let parsed: { error?: string; message?: string | string[]; details?: Record<string, unknown> } = {};
  try {
    parsed = JSON.parse(body);
  } catch {
    /* cuerpo no JSON */
  }
  const code = parsed.error ?? `HTTP_${status}`;
  const apiMessage = Array.isArray(parsed.message) ? parsed.message.join('. ') : parsed.message;
  // Los mensajes del dominio ya están en castellano; para los genéricos se usa uno amigable.
  const generic = status === 401 || status === 403 || status === 429 || status >= 500 || !apiMessage;
  const message = generic ? (FRIENDLY_BY_STATUS[status] ?? apiMessage ?? `Error ${status}.`) : apiMessage!;
  return new ApiError(status, code, message, parsed.details ?? {});
}

export class ApiClient {
  private refreshing: Promise<Session | null> | null = null;
  private readonly doFetch: FetchLike;

  constructor(private readonly opts: ApiClientOptions) {
    // fetch del navegador falla con "Illegal invocation" si se llama con otro `this`: se envuelve.
    const f = opts.fetch ?? (globalThis.fetch ? (input: string, init?: Parameters<FetchLike>[1]) => globalThis.fetch(input, init) : undefined);
    if (!f) throw new Error('No hay fetch disponible');
    this.doFetch = f as FetchLike;
  }

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  /** Origen de la API (sin /api), para Socket.IO. */
  get origin(): string {
    return this.opts.baseUrl.replace(/\/api\/?$/, '');
  }

  async session(): Promise<Session | null> {
    return this.opts.storage.get();
  }

  async saveSession(s: Session): Promise<void> {
    await this.opts.storage.set(s);
  }

  async logout(): Promise<void> {
    const s = await this.opts.storage.get();
    await this.opts.storage.clear();
    if (s) await this.raw('POST', '/auth/logout', { refreshToken: s.refreshToken }, null).catch(() => undefined);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>('POST', path, body ?? {}, headers);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  /** Llamada sin sesión (login, cotización pública). */
  public<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.raw<T>(method, path, body, null);
  }

  async request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    const session = await this.opts.storage.get();
    try {
      return await this.raw<T>(method, path, body, session?.accessToken ?? null, headers);
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401 || !session) throw err;
      const renewed = await this.refresh(session);
      if (!renewed) {
        this.opts.onSessionExpired?.();
        throw err;
      }
      return this.raw<T>(method, path, body, renewed.accessToken, headers);
    }
  }

  /** Token de acceso vigente, renovándolo si hace falta (para el handshake del socket). */
  async freshAccessToken(): Promise<string | null> {
    const session = await this.opts.storage.get();
    if (!session) return null;
    try {
      await this.raw('GET', '/auth/me', undefined, session.accessToken);
      return session.accessToken;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 401) return session.accessToken;
      const renewed = await this.refresh(session);
      if (!renewed) this.opts.onSessionExpired?.();
      return renewed?.accessToken ?? null;
    }
  }

  private refresh(current: Session): Promise<Session | null> {
    this.refreshing ??= (async () => {
      try {
        const latest = await this.opts.storage.get();
        // Otra llamada ya la renovó mientras esperábamos.
        if (latest && latest.accessToken !== current.accessToken) return latest;
        const next = await this.raw<Session>('POST', '/auth/refresh', { refreshToken: current.refreshToken }, null);
        const session = { accessToken: next.accessToken, refreshToken: next.refreshToken };
        await this.opts.storage.set(session);
        return session;
      } catch {
        await this.opts.storage.clear();
        return null;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async raw<T>(method: string, path: string, body: unknown, token: string | null, extra?: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(extra ?? {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await this.doFetch(`${this.opts.baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError(0, 'NETWORK', FRIENDLY_BY_STATUS[0]!);
    }
    const text = await res.text();
    if (!res.ok) throw toApiError(res.status, text);
    return (text ? JSON.parse(text) : null) as T;
  }
}

/** UUID v4 para clientEventId / Idempotency-Key. Usa crypto si existe (React Native puede no tenerlo). */
export function uuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
