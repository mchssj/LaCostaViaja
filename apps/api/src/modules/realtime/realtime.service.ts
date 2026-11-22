import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Namespace } from 'socket.io';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { RedisStateStore } from '../../redis/redis-state.store';
import { REDIS } from '../../redis/redis.tokens';
import { DispatchEvents } from '../dispatch/dispatch.events';
import type { TripEvent } from '../trip-events/trip-events.repository';

type Channel = 'driver' | 'passenger' | 'com';

/** Nombre del mensaje Socket.IO según el tipo de evento del viaje (compatible con los prototipos). */
export function socketEventName(type: string): string {
  if (type === 'FARE_CHANGED') return 'trip.fare_changed';
  if (type.startsWith('PAYMENT_')) return 'payment.status';
  return 'trip.status';
}

export const activePanicKey = (kind: 'PASSENGER' | 'DRIVER', id: string): string => `lc:panic:active:${kind}:${id}`;

/**
 * Punto único de salida en tiempo real. Emite a salas; con el adaptador de Redis el mensaje llega
 * a los sockets conectados a CUALQUIER réplica.
 */
@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly namespaces = new Map<Channel, Namespace>();

  constructor(
    private readonly dispatchEvents: DispatchEvents,
    private readonly store: RedisStateStore,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  register(channel: Channel, ns: Namespace): void {
    this.namespaces.set(channel, ns);
  }

  private emit(channel: Channel, room: string, event: string, payload: unknown): void {
    this.namespaces.get(channel)?.to(room).emit(event, payload);
  }

  onModuleInit(): void {
    // Ofertas: solo al chofer destinatario.
    this.dispatchEvents.on('offer.created', (o) =>
      this.emit('driver', `driver:${o.driverId}`, 'offer.created', { type: 'offer.created', tripId: o.tripId, at: new Date().toISOString(), data: o }),
    );
    this.dispatchEvents.on('offer.closed', (o) =>
      this.emit('driver', `driver:${o.driverId}`, 'offer.closed', { type: 'offer.closed', tripId: o.tripId, at: new Date().toISOString(), data: o }),
    );
    // Eventos persistidos del despacho (búsqueda, asignación, sin chofer) → pasajero y chofer.
    this.dispatchEvents.on('trip.event', ({ event, driverIds }) => this.publishTripEvent(event, { driverIds }));
  }

  /** Evento persistido de un viaje → pasajero (sala del viaje) y chofer asignado. */
  publishTripEvent(event: TripEvent, recipients: { driverIds?: ReadonlyArray<string | null> } = {}): void {
    const name = socketEventName(event.type);
    this.emit('passenger', `trip:${event.tripId}`, name, event);
    for (const driverId of new Set(recipients.driverIds ?? [])) {
      if (driverId) this.emit('driver', `driver:${driverId}`, name, event);
    }
    this.emit('com', `trip:${event.tripId}`, name, event); // operadores que siguen ese viaje
  }

  /** Posición del chofer → pasajero del viaje (con freno entre réplicas) y COM si hay una alerta abierta. */
  async driverPositionUpdated(driverId: string): Promise<void> {
    const state = await this.store.getDriver(driverId);
    if (!state?.position) return;
    const location = { lat: state.position.lat, lng: state.position.lng, recordedAt: state.position.recordedAt };
    if (state.tripId && (state.status === 'ASSIGNED' || state.status === 'ON_TRIP')) {
      const throttleMs = this.config.trips.driverLocationThrottleMs;
      const allowed =
        throttleMs === 0 || (await this.redis.set(`lc:loc-throttle:${state.tripId}`, '1', 'PX', throttleMs, 'NX').catch(() => 'OK')) === 'OK';
      if (allowed) {
        this.emit('passenger', `trip:${state.tripId}`, 'trip.driver_location', {
          type: 'trip.driver_location',
          tripId: state.tripId,
          at: new Date().toISOString(),
          data: location,
        });
      }
    }
    const alertId = await this.redis.get(activePanicKey('DRIVER', driverId)).catch(() => null);
    if (alertId) this.panicLocation(alertId, location);
  }

  panicAlert(alert: unknown): void {
    this.emit('com', 'com', 'panic.alert', alert);
  }

  panicLocation(alertId: string, location: { lat: number; lng: number; recordedAt?: number }): void {
    this.emit('com', 'com', 'panic.location', { alertId, location });
  }

  panicUpdated(alert: unknown): void {
    this.emit('com', 'com', 'panic.updated', alert);
  }

  panicEscalated(alert: unknown): void {
    this.emit('com', 'com', 'panic.escalated', alert);
  }

  tripCancelledForDriver(driverId: string, tripId: string, reason: string): void {
    this.emit('driver', `driver:${driverId}`, 'trip.cancelled', { type: 'trip.cancelled', tripId, at: new Date().toISOString(), data: { reason } });
  }
}
