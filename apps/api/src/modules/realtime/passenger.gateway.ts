import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { JwtService } from '../../security/jwt.service';
import { PASSENGERS } from '../../security/principal';
import { RealtimeService, socketEventName } from './realtime.service';
import { afterSeqOf, authenticateSocket, socketPrincipal } from './socket-auth';
import { TripEventsRepository } from '../trip-events/trip-events.repository';

/**
 * Canal del pasajero (registrado o invitado). Solo puede seguir SUS viajes: la suscripción verifica
 * que sea el dueño antes de unirlo a la sala, y al suscribirse recibe los eventos que se perdió.
 */
@WebSocketGateway({ namespace: '/passenger', cors: { origin: true, credentials: true } })
export class PassengerGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
    private readonly events: TripEventsRepository,
  ) {}

  afterInit(ns: Namespace): void {
    this.realtime.register('passenger', ns);
  }

  async handleConnection(client: Socket): Promise<void> {
    if (!(await authenticateSocket(client, this.jwt, PASSENGERS))) return;
    // Compatibilidad: el viaje también puede venir en el handshake (se verifica igual).
    const tripId = client.handshake.auth?.['tripId'] ?? client.handshake.query?.['tripId'];
    if (typeof tripId === 'string') await this.join(client, tripId, afterSeqOf(client.handshake.auth?.['afterSeq']));
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { tripId?: string; afterSeq?: number }) {
    if (typeof body?.tripId !== 'string') return { ok: false, error: 'INVALID_INPUT' };
    return this.join(client, body.tripId, afterSeqOf(body.afterSeq));
  }

  /** Alias de subscribe para reconexiones (mismo comportamiento). */
  @SubscribeMessage('resume')
  resume(@ConnectedSocket() client: Socket, @MessageBody() body: { tripId?: string; afterSeq?: number }) {
    return this.subscribe(client, body);
  }

  private async join(client: Socket, tripId: string, afterSeq: number) {
    const principal = socketPrincipal(client);
    const parties = await this.events.parties(tripId).catch(() => null);
    if (!principal || !parties || parties.passengerId !== principal.id) return { ok: false, error: 'FORBIDDEN' };
    await client.join(`trip:${tripId}`);
    const missed = await this.events.listAfter(tripId, afterSeq);
    for (const e of missed) client.emit(socketEventName(e.type), e);
    return { ok: true, replayed: missed.length, lastSeq: missed.at(-1)?.seq ?? afterSeq };
  }
}
