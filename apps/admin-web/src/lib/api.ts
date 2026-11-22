const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('lc_token');
}

export function setToken(token: string) {
  localStorage.setItem('lc_token', token);
}

export function clearToken() {
  localStorage.removeItem('lc_token');
}

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as any) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(describeError(res.status, await res.text()));
  const text = await res.text();
  if (!text) return null as any;
  return JSON.parse(text);
}

const ROLES: Record<string, string> = {
  MUNICIPAL_ADMIN: 'administrador municipal',
  COM_OPERATOR: 'operador del COM',
  AGENCY_OPERATOR: 'operador de agencia',
};

/** Mensaje legible a partir de la respuesta de error de la API ({ error, message, details }). */
function describeError(status: number, body: string): string {
  let parsed: { message?: string; details?: { required?: string[] } } = {};
  try { parsed = JSON.parse(body); } catch { /* cuerpo no JSON */ }
  if (status === 401) return 'La sesión venció o no es válida. Volvé a ingresar.';
  if (status === 403) {
    const req = parsed.details?.required?.map((r) => ROLES[r] ?? r).join(' o ');
    return `No tenés permiso para ver o modificar esto${req ? ` (requiere el rol ${req})` : ''}.`;
  }
  return parsed.message ? `${parsed.message} (error ${status})` : `Error ${status} de la API.`;
}

export async function loginOperator(username: string, password: string) {
  const data = await apiFetch<{ accessToken: string; refreshToken: string }>('/auth/operator/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.accessToken);
  return data;
}