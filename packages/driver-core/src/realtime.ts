// Conexión Socket.IO compartida. `io` se inyecta (socket.io-client) para no atar el paquete a una
// plataforma. Al reconectar pide los eventos que se perdió (resume con afterSeq).
import type { ApiClient } from './api';
import type { OfferMessage, TripEventMessage } from './types';

/** Lo mínimo de socket.io-client que se usa. */
export interface SocketLike {
  connected: boolean;
  on(event: string, cb: (...args: any[]) => void): unknown;
  emit(event: string, ...args: any[]): unknown;
  disconnect(): unknown;
  auth?: unknown;
}
export type IoFactory = (url: string, opts: Record<string, unknown>) => SocketLike;

export interface RealtimeHandlers {
  onOffer?(msg: OfferMessage): void;
  onOfferClosed?(msg: OfferMessage): void;
  onTripEvent?(msg: TripEventMessage): void;
  onTripCancelled?(msg: { tripId: string; data: { reason?: string } }): void;
  onDriverLocation?(msg: { tripId: string; data: { lat: number; lng: number; recordedAt?: number } }): void;
  onConnectionChange?(connected: boolean): void;
}

export interface RealtimeConnection {
  /** Sigue un viaje (pasajero) o pide lo perdido (chofer). */
  follow(tripId: string, afterSeq: number): void;
  close(): void;
  readonly connected: boolean;
}

export function connectRealtime(
  io: IoFactory,
  api: ApiClient,
  channel: 'driver' | 'passenger',
  handlers: RealtimeHandlers,
): RealtimeConnection {
  let followed: { tripId: string; afterSeq: number } | null = null;
  const socket = io(`${api.origin}/${channel}`, {
    transports: ['websocket'],
    // Se evalúa en cada intento de conexión: siempre con el token vigente.
    auth: (cb: (data: Record<string, unknown>) => void) => {
      api
        .freshAccessToken()
        .then((token) => cb({ token: token ?? '' }))
        .catch(() => cb({ token: '' }));
    },
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  const resume = () => {
    if (!followed) return;
    socket.emit(channel === 'passenger' ? 'subscribe' : 'resume', followed);
  };

  socket.on('connect', () => {
    handlers.onConnectionChange?.(true);
    resume();
  });
  socket.on('disconnect', () => handlers.onConnectionChange?.(false));
  socket.on('connect_error', () => handlers.onConnectionChange?.(false));
  socket.on('offer.created', (m: OfferMessage) => handlers.onOffer?.(m));
  socket.on('offer.closed', (m: OfferMessage) => handlers.onOfferClosed?.(m));
  socket.on('trip.cancelled', (m: { tripId: string; data: { reason?: string } }) => handlers.onTripCancelled?.(m));
  socket.on('trip.driver_location', (m: { tripId: string; data: { lat: number; lng: number } }) => handlers.onDriverLocation?.(m));
  const onTrip = (m: TripEventMessage) => {
    if (followed && m.tripId === followed.tripId && typeof m.seq === 'number') followed.afterSeq = Math.max(followed.afterSeq, m.seq);
    handlers.onTripEvent?.(m);
  };
  socket.on('trip.status', onTrip);
  socket.on('payment.status', onTrip);
  socket.on('trip.fare_changed', onTrip);

  return {
    follow(tripId: string, afterSeq: number) {
      followed = { tripId, afterSeq };
      if (socket.connected) resume();
    },
    close() {
      socket.disconnect();
    },
    get connected() {
      return socket.connected;
    },
  };
}
