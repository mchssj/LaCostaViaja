import { ApiClient, ApiError, toApiError, uuid, type FetchLike, type Session } from './api';

function memoryStorage(initial: Session | null) {
  let s = initial;
  return {
    get: () => s,
    set: (v: Session) => {
      s = v;
    },
    clear: () => {
      s = null;
    },
    peek: () => s,
  };
}

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}

describe('ApiClient', () => {
  it('agrega el token y devuelve el JSON', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, auth: init?.headers?.['Authorization'] });
      return res(200, { ok: 1 });
    };
    const api = new ApiClient({ baseUrl: 'http://x/api', storage: memoryStorage({ accessToken: 'A', refreshToken: 'R' }), fetch });
    await expect(api.get('/algo')).resolves.toEqual({ ok: 1 });
    expect(calls).toEqual([{ url: 'http://x/api/algo', auth: 'Bearer A' }]);
    expect(api.origin).toBe('http://x');
  });

  it('ante un 401 renueva una sola vez aunque haya llamadas en paralelo, y reintenta', async () => {
    let refreshes = 0;
    const fetch: FetchLike = async (url, init) => {
      if (url.endsWith('/auth/refresh')) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        return res(200, { accessToken: 'A2', refreshToken: 'R2', expiresIn: 900 });
      }
      return init?.headers?.['Authorization'] === 'Bearer A2' ? res(200, { url }) : res(401, { error: 'UNAUTHORIZED', message: 'vencido' });
    };
    const storage = memoryStorage({ accessToken: 'A', refreshToken: 'R' });
    const api = new ApiClient({ baseUrl: 'http://x/api', storage, fetch });
    const out = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
    expect(out).toHaveLength(3);
    expect(refreshes).toBe(1);
    expect(storage.peek()).toEqual({ accessToken: 'A2', refreshToken: 'R2' });
  });

  it('si la renovación falla, borra la sesión y avisa', async () => {
    const fetch: FetchLike = async (url) => (url.endsWith('/auth/refresh') ? res(401, { error: 'UNAUTHORIZED' }) : res(401, { error: 'UNAUTHORIZED' }));
    const storage = memoryStorage({ accessToken: 'A', refreshToken: 'R' });
    const expired = jest.fn();
    const api = new ApiClient({ baseUrl: 'http://x/api', storage, fetch, onSessionExpired: expired });
    await expect(api.get('/a')).rejects.toMatchObject({ status: 401, message: 'La sesión venció. Volvé a ingresar.' });
    expect(storage.peek()).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('sin red devuelve un ApiError de red con mensaje amigable', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    const api = new ApiClient({ baseUrl: 'http://x/api', storage: memoryStorage(null), fetch });
    const err = await api.get('/a').catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).isNetwork).toBe(true);
  });
});

describe('toApiError', () => {
  it('usa el mensaje del dominio (ya en castellano) para los 4xx de negocio', () => {
    const e = toApiError(409, JSON.stringify({ error: 'INVALID_TRANSITION', message: 'No se puede iniciar un viaje en estado ASSIGNED' }));
    expect(e).toMatchObject({ status: 409, code: 'INVALID_TRANSITION', message: 'No se puede iniciar un viaje en estado ASSIGNED' });
  });

  it('reemplaza los mensajes genéricos (403, 5xx) y tolera cuerpos no JSON', () => {
    expect(toApiError(403, '{"error":"FORBIDDEN","message":"Forbidden resource"}').message).toBe('No tenés permiso para hacer esto.');
    expect(toApiError(503, '<html>').message).toMatch(/no está disponible/);
  });
});

it('uuid genera v4 válidos', () => {
  for (let i = 0; i < 20; i++) expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
