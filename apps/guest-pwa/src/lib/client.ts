import { ApiClient, PassengerApi, type Session } from '@lacosta/driver-core';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
const KEY = 'lc_guest_session';
const TRIP_KEY = 'lc_guest_trip';

/** Atajos de prueba (código QR sin firmar): solo en desarrollo o con NEXT_PUBLIC_DEV_TOOLS=true. */
export const DEV_TOOLS = process.env.NEXT_PUBLIC_DEV_TOOLS === 'true' || process.env.NODE_ENV === 'development';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function read(): Session | null {
  return safe(() => {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  }, null);
}

let onExpired: () => void = () => undefined;
export function setSessionExpiredHandler(fn: () => void) {
  onExpired = fn;
}

export const api = new ApiClient({
  baseUrl: API_BASE,
  storage: {
    get: read,
    set: (s) => safe(() => localStorage.setItem(KEY, JSON.stringify(s)), undefined),
    clear: () => safe(() => localStorage.removeItem(KEY), undefined),
  },
  onSessionExpired: () => onExpired(),
});

export const passengerApi = new PassengerApi(api);

export const hasSession = () => typeof window !== 'undefined' && read() !== null;
export const savedTripId = () => safe(() => localStorage.getItem(TRIP_KEY), null);
export const saveTripId = (id: string) => safe(() => localStorage.setItem(TRIP_KEY, id), undefined);
export const clearTripId = () => safe(() => localStorage.removeItem(TRIP_KEY), undefined);

/** El QR impreso puede traer el código solo o una URL de la PWA con ?qr=… */
export function extractQrCode(scanned: string): string {
  const text = scanned.trim();
  try {
    const u = new URL(text);
    return u.searchParams.get('qr') ?? text;
  } catch {
    return text;
  }
}
