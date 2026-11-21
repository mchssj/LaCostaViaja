import { Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { LUA_SCRIPTS } from './lua-scripts';
import { RedisStateStore } from './redis-state.store';
import { REDIS } from './redis.tokens';

export { REDIS };

export function createRedisClient(url: string, logger = new Logger('Redis')): Redis {
  const client = new Redis(url, {
    lazyConnect: true, // no conecta hasta el primer comando (los tests sin Redis no quedan colgados)
    maxRetriesPerRequest: 2, // falla rápido: el despacho se pausa en lugar de apilar pedidos
    connectTimeout: 3_000,
    enableAutoPipelining: true,
  });
  let lastLog = 0;
  client.on('error', (err: Error) => {
    if (Date.now() - lastLog > 10_000) {
      lastLog = Date.now();
      logger.error(`Redis no disponible: ${err.message}`);
    }
  });
  for (const [name, script] of Object.entries(LUA_SCRIPTS)) {
    client.defineCommand(name, { numberOfKeys: script.numberOfKeys, lua: script.lua });
  }
  return client;
}

export async function closeRedisClient(client: Redis): Promise<void> {
  if (client.status === 'ready') {
    await client.quit().catch(() => client.disconnect());
  } else {
    client.disconnect();
  }
}

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient(this.redis);
  }
}

@Global()
@Module({
  providers: [
    { provide: REDIS, inject: [APP_CONFIG], useFactory: (config: AppConfig): Redis => createRedisClient(config.redisUrl) },
    RedisLifecycle,
    RedisStateStore,
  ],
  exports: [REDIS, RedisStateStore],
})
export class RedisModule {}
