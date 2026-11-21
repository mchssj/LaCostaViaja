import { Logger } from '@nestjs/common';
import { SubscribeMessage, WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '../../common/jwt.service';

@WebSocketGateway({ namespace: '/com', cors: { origin: '*' } })
export class PanicGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(PanicGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth?.token as string) ?? (client.handshake.headers?.authorization as string)?.replace('Bearer ', '');
      if (!token) { client.disconnect(); return; }
      const subject = await this.jwt.verifyAccess(token);
      if (subject.kind !== 'OPERATOR' || subject.role !== 'COM_OPERATOR') { client.disconnect(); return; }
      client.join('com');
      this.logger.log(`COM conectado: ${subject.id}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`COM desconectado: ${client.id}`);
  }

  emitPanic(alert: any) {
    this.server?.to('com').emit('panic.alert', alert);
  }

  emitPanicLocation(alertId: string, location: any) {
    this.server?.to('com').emit('panic.location', { alertId, location });
  }
}
