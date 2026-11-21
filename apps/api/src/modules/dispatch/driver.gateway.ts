import { Logger, OnModuleInit } from '@nestjs/common';
import { SubscribeMessage, WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '../../common/jwt.service';
import { DispatchEvents } from './dispatch.events';

@WebSocketGateway({ namespace: '/driver', cors: { origin: '*' } })
export class DriverGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  private readonly logger = new Logger(DriverGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService, private readonly events: DispatchEvents) {}

  onModuleInit() {
    this.events.on('offer.created', (p) => {
      this.server?.to(`driver:${p.driverId}`).emit('offer.created', { seq: Date.now(), tripId: p.tripId, type: 'offer.created', at: new Date().toISOString(), data: p });
    });
    this.events.on('offer.closed', (p) => {
      this.server?.to(`driver:${p.driverId}`).emit('offer.closed', { seq: Date.now(), tripId: p.tripId, type: 'offer.closed', at: new Date().toISOString(), data: p });
    });
    this.events.on('trip.assigned', (p) => {
      this.server?.to(`driver:${p.driverId}`).emit('trip.status', { seq: Date.now(), tripId: p.tripId, type: 'trip.status', at: new Date().toISOString(), data: { status: 'ASSIGNED', ...p } });
    });
    this.events.on('trip.status_changed', (p) => {
      // Emit to all drivers is not targeted; targeted emit happens via trip.assigned above.
    });
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) ?? (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      if (!token) { client.disconnect(); return; }
      const subject = await this.jwt.verifyAccess(token);
      if (subject.kind !== 'DRIVER') { client.disconnect(); return; }
      client.join(`driver:${subject.id}`);
      this.logger.log(`Driver conectado: ${subject.id}`);
      // TODO: al reconectar, enviar la oferta vigente (consultar trip_offers PENDING).
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Driver desconectado: ${client.id}`);
  }

  @SubscribeMessage('resume')
  handleResume(client: Socket, payload: any) {
    // Reenvío de eventos perdidos: simplificado (TODO: consultar trip_events por tripId/afterSeq).
    return { ok: true };
  }
}
