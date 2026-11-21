import { Logger, OnModuleInit } from '@nestjs/common';
import { SubscribeMessage, WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '../../common/jwt.service';
import { DispatchEvents } from '../dispatch/dispatch.events';

@WebSocketGateway({ namespace: '/passenger', cors: { origin: '*' } })
export class PassengerGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(PassengerGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService, private readonly events: DispatchEvents) {}

  onModuleInit() {
    this.events.on('trip.assigned', (p) => {
      this.server?.to(`trip:${p.tripId}`).emit('trip.status', { seq: Date.now(), tripId: p.tripId, type: 'trip.status', at: new Date().toISOString(), data: { status: 'ASSIGNED', ...p } });
    });
    this.events.on('trip.status_changed', (p) => {
      this.server?.to(`trip:${p.tripId}`).emit('trip.status', { seq: Date.now(), tripId: p.tripId, type: 'trip.status', at: p.at, data: { status: p.status } });
    });
    this.events.on('trip.fare_changed', (p) => {
      this.server?.to(`trip:${p.tripId}`).emit('trip.fare_changed', { seq: Date.now(), tripId: p.tripId, type: 'trip.fare_changed', at: new Date().toISOString(), data: { newFareCents: p.newFareCents } });
    });
    this.events.on('payment.status', (p) => {
      this.server?.to(`trip:${p.tripId}`).emit('payment.status', { seq: Date.now(), tripId: p.tripId, type: 'payment.status', at: new Date().toISOString(), data: { status: p.status } });
    });
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) ?? (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      if (!token) { client.disconnect(); return; }
      const subject = await this.jwt.verifyAccess(token);
      // El cliente envía el tripId por query o handshake; por defecto se une a la sala del viaje indicado.
      const tripId = (client.handshake.query?.tripId as string) ?? (client.handshake.auth?.tripId as string);
      if (tripId) client.join(`trip:${tripId}`);
      this.logger.log(`Passenger conectado: ${subject.id} trip=${tripId}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Passenger desconectado: ${client.id}`);
  }

  @SubscribeMessage('resume')
  handleResume(client: Socket, payload: { tripId: string; afterSeq: number }) {
    // Reenvío de eventos perdidos: TODO consultar trip_events.
    return { ok: true };
  }
}
