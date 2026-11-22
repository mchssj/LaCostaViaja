import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiClient, DriverApi, type Session } from '@lacosta/driver-core';

/**
 * URL de la API. En un teléfono real o en el emulador `localhost` es el propio dispositivo:
 * usar EXPO_PUBLIC_API_URL=http://<IP de la PC>:3000/api (emulador Android: http://10.0.2.2:3000/api).
 */
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api';
const KEY = 'lc_driver_session';

// AsyncStorage es asíncrono; se mantiene una copia en memoria para no leer el disco en cada llamada.
let cached: Session | null | undefined;

let onExpired: () => void = () => undefined;
export function setSessionExpiredHandler(fn: () => void) {
  onExpired = fn;
}

export const api = new ApiClient({
  baseUrl: API_BASE,
  storage: {
    async get() {
      if (cached !== undefined) return cached;
      const raw = await AsyncStorage.getItem(KEY).catch(() => null);
      cached = raw ? (JSON.parse(raw) as Session) : null;
      return cached;
    },
    async set(s) {
      cached = s;
      await AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => undefined);
    },
    async clear() {
      cached = null;
      await AsyncStorage.removeItem(KEY).catch(() => undefined);
    },
  },
  onSessionExpired: () => onExpired(),
});

export const driverApi = new DriverApi(api);

export async function hasSession(): Promise<boolean> {
  return (await api.session()) !== null;
}
