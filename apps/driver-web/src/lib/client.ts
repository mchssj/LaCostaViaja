import { ApiClient, DriverApi, type Session } from '@lacosta/driver-core';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
const KEY = 'lc_driver_session';

/** Herramientas de prueba (GPS simulado, crear viaje): solo con NEXT_PUBLIC_DEV_TOOLS=true o en desarrollo. */
export const DEV_TOOLS = process.env.NEXT_PUBLIC_DEV_TOOLS === 'true' || process.env.NODE_ENV === 'development';

function read(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let onExpired: () => void = () => undefined;
export function setSessionExpiredHandler(fn: () => void) {
  onExpired = fn;
}

export const api = new ApiClient({
  baseUrl: API_BASE,
  storage: {
    get: read,
    set: (s) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {
        /* sin almacenamiento: la sesión dura lo que la pestaña */
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
  onSessionExpired: () => onExpired(),
});

export const driverApi = new DriverApi(api);

export function hasSession(): boolean {
  return typeof window !== 'undefined' && read() !== null;
}
