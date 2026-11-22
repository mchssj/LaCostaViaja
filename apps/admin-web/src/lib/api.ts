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
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  const text = await res.text();
  if (!text) return null as any;
  return JSON.parse(text);
}

export async function loginOperator(username: string, password: string) {
  const data = await apiFetch<{ accessToken: string; refreshToken: string }>('/auth/operator/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setToken(data.accessToken);
  return data;
}