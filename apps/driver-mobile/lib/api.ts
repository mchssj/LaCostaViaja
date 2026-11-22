import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = 'http://localhost:3000/api';

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem('lc_driver_token');
}

export async function setToken(token: string) {
  await AsyncStorage.setItem('lc_driver_token', token);
}

export async function clearToken() {
  await AsyncStorage.removeItem('lc_driver_token');
}

export async function getTripId(): Promise<string | null> {
  return AsyncStorage.getItem('lc_trip_id');
}

export async function setTripId(id: string) {
  await AsyncStorage.setItem('lc_trip_id', id);
}

export async function clearTripId() {
  await AsyncStorage.removeItem('lc_trip_id');
}

export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as any) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}