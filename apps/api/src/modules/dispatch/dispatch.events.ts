import { Injectable } from '@nestjs/common';
import type { BackhaulMatch } from '@lacosta/domain';
import { EventEmitter } from 'node:events';
import type { TripEvent } from '../trip-events/trip-events.repository';

/**
 * Eventos del despacho dentro del proceso. El módulo realtime los reenvía por WebSocket
 * (y el adaptador de Redis los lleva a las demás réplicas).
 */
export interface DispatchEventMap {
  'offer.created': {
    tripId: string;
    driverId: string;
    offerId: string;
    expiresAt: number;
    etaSeconds: number;
    round: number;
    rank: number;
    backhaulMatch: BackhaulMatch;
  };
  'offer.closed': { tripId: string; driverId: string; offerId: string; outcome: 'REJECTED' | 'EXPIRED' | 'CANCELLED' | 'CLAIM_FAILED' };
  'trip.assigned': { tripId: string; driverId: string; vehicleId: string; isBackhaul: boolean; fareCents: number; repriced: boolean };
  'trip.no_driver': { tripId: string };
  /** Evento persistido en trip_events (con seq) generado por el despacho. */
  'trip.event': { event: TripEvent; driverIds: string[] };
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
