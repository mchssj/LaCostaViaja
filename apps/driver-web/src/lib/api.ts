const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
export function getToken(): string | null { if (typeof window === 'undefined') return null; return localStorage.getItem('lc_driver_token'); }
export function setToken(t: string) { localStorage.setItem('lc_driver_token', t); }
export function clearToken() { localStorage.removeItem('lc_driver_token'); }
export function getTripId(): string | null { if (typeof window === 'undefined') return null; return localStorage.getItem('lc_trip_id'); }
export function setTripId(id: string) { localStorage.setItem('lc_trip_id', id); }
export function clearTripId() { localStorage.removeItem('lc_trip_id'); }
export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as any) };
  if (token && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) { const t = await res.text(); throw new Error(`API ${res.status}: ${t}`); }
  const text = await res.text();
  if (!text) return null as any;
  return JSON.parse(text);
}