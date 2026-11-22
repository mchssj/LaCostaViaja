import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.tokens';

type IoServer = ReturnType<IoAdapter['createIOServer']>;

/**
 * Socket.IO con adaptador de Redis: un mensaje emitido en cualquier réplica de la API llega a los
 * clientes conectados a cualquier otra (necesario con auto-escalado en temporada).
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterFactory: ReturnType<typeof createAdapter> | null = null;
  private clients: Redis[] = [];

  constructor(private readonly appContext: INestApplicationContext) {
    super(appContext);
  }

  async connectToRedis(): Promise<void> {
    const base = this.appContext.get<Redis>(REDIS);
    const pub = base.duplicate();
    const sub = base.duplicate();
    for (const c of [pub, sub]) c.on('error', () => undefined); // el cliente principal ya informa los errores
    await Promise.all([pub.connect(), sub.connect()]);
    this.clients = [pub, sub];
    this.adapterFactory = createAdapter(pub, sub);
  }

  override createIOServer(port: number, options?: Parameters<IoAdapter['createIOServer']>[1]): IoServer {
    const server = super.createIOServer(port, options) as IoServer;
    if (this.adapterFactory) (server as unknown as { adapter(f: unknown): void }).adapter(this.adapterFactory);
    return server;
  }

  override async close(server: Parameters<IoAdapter['close']>[0]): Promise<void> {
    await super.close(server);
    // quit() (no disconnect()): espera las respuestas pendientes, p. ej. los UNSUBSCRIBE que manda el
    // adaptador al cerrar; cortar de golpe deja esos comandos rechazados con "Connection is closed".
    const clients = this.clients;
    this.clients = [];
    // El adaptador manda sus UNSUBSCRIBE de forma asíncrona después de server.close(): se le da un
    // momento para que salgan antes del QUIT.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
  }
}
