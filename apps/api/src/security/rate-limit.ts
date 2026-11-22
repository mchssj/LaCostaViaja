import { Inject, Injectable, Logger, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@lacosta/domain';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.tokens';
import type { Principal } from './principal';

export interface RateLimitSpec {
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
  /** ip: antes de tener sesión (login, cotizar). principal: por usuario. */
  readonly by: 'ip' | 'principal';
}

const RATE_LIMIT_KEY = 'lc:rate-limit';

/** Límite de pedidos por ventana fija (Redis). Frena abusos del modo invitado y fuerza bruta de PIN/OTP. */
export const RateLimit = (spec: RateLimitSpec): MethodDecorator => SetMetadata(RATE_LIMIT_KEY, spec);

@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Devuelve true si el pedido entra en el cupo. Si Redis no responde, deja pasar (no bloquea el servicio). */
  async consume(name: string, subject: string, limit: number, windowSeconds: number): Promise<boolean> {
    const key = `lc:rl:${name}:${subject}`;
    try {
      const results = await this.redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      return count <= limit;
    } catch (err) {
      this.logger.warn(`Límite de pedidos sin Redis (${name}): ${(err as Error).message}`);
      return true;
    }
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const spec = this.reflector.get<RateLimitSpec | undefined>(RATE_LIMIT_KEY, ctx.getHandler());
    if (!spec) return true;
    const req = ctx.switchToHttp().getRequest<{ ip?: string; user?: Principal }>();
    const subject = spec.by === 'principal' && req.user ? `${req.user.kind}:${req.user.id}` : `ip:${req.ip ?? 'desconocida'}`;
    if (!(await this.limiter.consume(spec.name, subject, spec.limit, spec.windowSeconds))) {
      throw new DomainError('RATE_LIMITED', 'Demasiados pedidos. Probá de nuevo en un momento.', {
        retryAfterSeconds: spec.windowSeconds,
      });
    }
    return true;
  }
}
