import { Injectable } from '@nestjs/common';
import type { BackhaulMatch } from '@lacosta/domain';
import { EventEmitter } from 'node:events';

/**
 * Eventos del despacho dentro del proceso. En la Fase 3 el gateway WebSocket se suscribe acá y los
 * reenvía a la app del chofer / pasajero (entre réplicas, vía Redis Pub/Sub).
 */
export interface DispatchEventMap {
  'offer.created': { tripId: string; driverId: string; offerId: string; expiresAt: number; etaSeconds: number; round: number; rank: number; backhaulMatch: BackhaulMatch };
  'offer.closed': { tripId: string; driverId: string; offerId: string; outcome: 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'CLAIM_FAILED' };
  'trip.assigned': { tripId: string; driverId: string; vehicleId: string; isBackhaul: boolean; fareCents: number; repriced: boolean };
  'trip.no_driver': { tripId: string };
  'trip.status_changed': { tripId: string; status: string; at: string };
  'trip.fare_changed': { tripId: string; newFareCents: number };
  'payment.status': { tripId: string; status: string };
}

@Injectable()
export class DispatchEvents {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  emit<K extends keyof DispatchEventMap>(event: K, payload: DispatchEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  on<K extends keyof DispatchEventMap>(event: K, listener: (payload: DispatchEventMap[K]) => void): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }
}
