import { ApiClient, ApiError, type Session } from '@lacosta/driver-core';

export { ApiError };

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
const KEY = 'lc_admin_session';

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

const expiredListeners = new Set<() => void>();
export function onSessionExpired(fn: () => void): () => void {
  expiredListeners.add(fn);
  return () => expiredListeners.delete(fn);
}

/** Cliente de la API con renovación automática del token (refresh rotativo). */
export const api = new ApiClient({
  baseUrl: API_BASE,
  storage: {
    get: read,
    set: (s) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {
        /* sin almacenamiento */
      }
    },
    clear: () => {
      try {
        localStorage.removeItem(KEY);
      } catch {
        /* nada */
      }
    },
  },
  onSessionExpired: () => expiredListeners.forEach((fn) => fn()),
});

export const hasSession = () => typeof window !== 'undefined' && read() !== null;

/**
 * Compatibilidad con las páginas existentes: apiFetch(path, { method, body }) sobre el cliente nuevo.
 * El body llega como string JSON (como en fetch).
 */
export async function apiFetch<T = any>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const body = init.body !== undefined ? JSON.parse(init.body) : undefined;
  return api.request<T>(method, path, body);
}

export interface OperatorProfile {
  id: string;
  username: string;
  fullName: string | null;
  email: string | null;
  role: string;
  roleName: string;
  agencyId: string | null;
  agencyName: string | null;
  permissions: string[];
  mfaEnabled: boolean;
  mfaRequired: boolean;
  setupRequired: Array<'PASSWORD' | 'MFA'>;
  lastLoginAt: string | null;
}

type LoginResult = { mfaRequired: true; mfaToken: string } | { mfaRequired?: false; user: OperatorProfile };

/** Paso 1: usuario y contraseña. Si la cuenta tiene 2FA devuelve el comprobante para el paso 2. */
export async function loginOperator(username: string, password: string): Promise<LoginResult> {
  const res = await api.public<{ mfaRequired?: boolean; mfaToken?: string; accessToken?: string; refreshToken?: string; user?: OperatorProfile }>(
    'POST',
    '/auth/operator/login',
    { username, password },
  );
  if (res.mfaRequired && res.mfaToken) return { mfaRequired: true, mfaToken: res.mfaToken };
  await api.saveSession({ accessToken: res.accessToken!, refreshToken: res.refreshToken! });
  return { user: res.user! };
}

export async function loginOperatorMfa(mfaToken: string, code: string): Promise<OperatorProfile> {
  const res = await api.public<{ accessToken: string; refreshToken: string; user: OperatorProfile }>('POST', '/auth/operator/mfa', { mfaToken, code });
  await api.saveSession({ accessToken: res.accessToken, refreshToken: res.refreshToken });
  return res.user;
}

/** Subida de archivos (multipart): el cliente JSON no sirve; se usa fetch con el token vigente. */
export async function uploadForm<T = any>(path: string, form: FormData): Promise<T> {
  const token = await api.freshAccessToken();
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body: form, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const text = await res.text();
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      msg = JSON.parse(text).message ?? msg;
    } catch {
      /* nada */
    }
    throw new Error(Array.isArray(msg) ? msg.join('. ') : msg);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** Abre un archivo protegido (documento) en una pestaña nueva. */
export async function openProtectedFile(path: string): Promise<void> {
  const token = await api.freshAccessToken();
  const res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`No se pudo abrir el archivo (error ${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '');
