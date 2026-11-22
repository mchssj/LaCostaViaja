import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { DomainError, type GpsPing } from '@lacosta/domain';
import type { Namespace, Socket } from 'socket.io';
import { RedisStateStore } from '../../redis/redis-state.store';
import { JwtService } from '../../security/jwt.service';
import { DriverPresenceService } from '../presence/driver-presence.service';
import { RealtimeService, socketEventName } from './realtime.service';
import { afterSeqOf, authenticateSocket, socketPrincipal } from './socket-auth';
import { TripEventsRepository } from '../trip-events/trip-events.repository';

/** Canal del chofer: ofertas, estado de su viaje y envío de posiciones (alternativa a REST). */
@WebSocketGateway({ namespace: '/driver', cors: { origin: true, credentials: true } })
export class DriverGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(DriverGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
    private readonly store: RedisStateStore,
    private readonly presence: DriverPresenceService,
    private readonly events: TripEventsRepository,
  ) {}

  afterInit(ns: Namespace): void {
    this.realtime.register('driver', ns);
  }

  async handleConnection(client: Socket): Promise<void> {
    const principal = await authenticateSocket(client, this.jwt, ['DRIVER']);
    if (!principal) return;
    await client.join(`driver:${principal.id}`);
    // Reconexión: si tenía una oferta abierta, se la reenvía (no depende de haber estado conectado).
    try {
      const state = await this.store.getDriver(principal.id);
      if (state?.status === 'OFFERED' && state.offerTripId && state.offerId && (state.offerDeadline ?? 0) > Date.now()) {
        client.emit('offer.created', {
          type: 'offer.created',
          tripId: state.offerTripId,
          at: new Date().toISOString(),
          replay: true,
          data: { tripId: state.offerTripId, driverId: principal.id, offerId: state.offerId, expiresAt: state.offerDeadline },
        });
      }
    } catch (err) {
      this.logger.warn(`No se pudo reenviar la oferta vigente: ${(err as Error).message}`);
    }
  }

  /** Reenvía los eventos del viaje posteriores a afterSeq (solo si es el chofer asignado). */
  @SubscribeMessage('resume')
  async resume(@ConnectedSocket() client: Socket, @MessageBody() body: { tripId?: string; afterSeq?: number }) {
    const principal = socketPrincipal(client);
    if (!principal || typeof body?.tripId !== 'string') return { ok: false, error: 'INVALID_INPUT' };
    const parties = await this.events.parties(body.tripId);
    if (!parties || parties.driverId !== principal.id) return { ok: false, error: 'FORBIDDEN' };
    const missed = await this.events.listAfter(body.tripId, afterSeqOf(body.afterSeq));
    for (const e of missed) client.emit(socketEventName(e.type), e);
    return { ok: true, replayed: missed.length, lastSeq: missed.at(-1)?.seq ?? afterSeqOf(body.afterSeq) };
  }

  @SubscribeMessage('position')
  async position(@ConnectedSocket() client: Socket, @MessageBody() body: { pings?: GpsPing[] }) {
    const principal = socketPrincipal(client);
    if (!principal) return { ok: false, error: 'UNAUTHORIZED' };
    try {
      const summary = await this.presence.ingest(principal.id, Array.isArray(body?.pings) ? body.pings : []);
      await this.realtime.driverPositionUpdated(principal.id);
      return { ok: true, ...summary };
    } catch (err) {
      return { ok: false, error: err instanceof DomainError ? err.code : 'INTERNAL', message: (err as Error).message };
    }
  }
}
