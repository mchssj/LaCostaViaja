import { Inject } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Pool } from 'pg';
import type { Namespace, Socket } from 'socket.io';
import { PG_POOL } from '../../database/database.module';
import { JwtService } from '../../security/jwt.service';
import { RealtimeService, socketEventName } from './realtime.service';
import { afterSeqOf, authenticateSocket } from './socket-auth';
import { TripEventsRepository } from '../trip-events/trip-events.repository';

/** Consola del Centro de Operaciones Municipal: alertas de pánico en vivo y seguimiento de viajes. */
@WebSocketGateway({ namespace: '/com', cors: { origin: true, credentials: true } })
export class ComGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
    private readonly events: TripEventsRepository,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  afterInit(ns: Namespace): void {
    this.realtime.register('com', ns);
  }

  async handleConnection(client: Socket): Promise<void> {
    if (!(await authenticateSocket(client, this.jwt, ['COM_OPERATOR', 'MUNICIPAL_ADMIN']))) return;
    await client.join('com');
    // Al conectar (o reconectar) recibe el estado actual: no se pierde una alerta por un corte.
    const { rows } = await this.pool.query(
      `SELECT id, trip_id, trip_public_code, raised_by, status, channel, locality_id, received_at, occurred_at,
              acknowledged_at, escalation_count, driver_first_name, driver_last_name, vehicle_plate,
              ST_Y(location) AS lat, ST_X(location) AS lng
       FROM v_com_open_alerts ORDER BY received_at DESC`,
    );
    client.emit('panic.snapshot', rows);
  }

  /** Seguir un viaje puntual (por ejemplo, el de una alerta). */
  @SubscribeMessage('watch_trip')
  async watchTrip(@ConnectedSocket() client: Socket, @MessageBody() body: { tripId?: string; afterSeq?: number }) {
    if (typeof body?.tripId !== 'string') return { ok: false, error: 'INVALID_INPUT' };
    if (!(await this.events.parties(body.tripId))) return { ok: false, error: 'NOT_FOUND' };
    await client.join(`trip:${body.tripId}`);
    const missed = await this.events.listAfter(body.tripId, afterSeqOf(body.afterSeq));
    for (const e of missed) client.emit(socketEventName(e.type), e);
    return { ok: true, replayed: missed.length };
  }
}
