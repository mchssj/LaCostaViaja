import {
  Inject,
  Injectable,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@lacosta/domain';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { PG_POOL } from '../database/database.module';
import { sha256Hex } from './crypto';
import { actorRole, type Principal } from './principal';

const IDEMPOTENT_KEY = 'lc:idempotent';
const TTL_HOURS = 24;
const MAX_KEY_LENGTH = 200;

/**
 * Header Idempotency-Key: el mismo pedido reintentado (mala señal, doble toque) devuelve la misma
 * respuesta sin repetir el efecto. La misma clave con otro cuerpo → 409. Sin header, el pedido
 * se procesa normalmente.
 */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT_KEY, true);

interface KeyRow {
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http' || !this.reflector.get<boolean>(IDEMPOTENT_KEY, ctx.getHandler())) return next.handle();
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown>; user?: Principal; body: unknown; method: string; originalUrl: string }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !req.user) return next.handle();
    if (key.length === 0 || key.length > MAX_KEY_LENGTH) {
      throw new DomainError('INVALID_INPUT', `Idempotency-Key debe tener entre 1 y ${MAX_KEY_LENGTH} caracteres`);
    }
    return from(this.run(req.user, key, sha256Hex(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`), res, next));
  }

  private async run(user: Principal, key: string, requestHash: string, res: Response, next: CallHandler): Promise<unknown> {
    const actor = actorRole(user);
    // Se reserva la clave ANTES de ejecutar: dos reintentos simultáneos no pueden correr los dos.
    const inserted = await this.pool.query(
      `INSERT INTO idempotency_keys (actor_kind, actor_id, key, request_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))
       ON CONFLICT (actor_kind, actor_id, key) DO NOTHING
       RETURNING id`,
      [actor, user.id, key, requestHash, TTL_HOURS],
    );
    if (inserted.rowCount === 0) {
      const { rows } = await this.pool.query<KeyRow>(
        `SELECT request_hash, response_status, response_body FROM idempotency_keys
         WHERE actor_kind = $1 AND actor_id = $2 AND key = $3`,
        [actor, user.id, key],
      );
      const row = rows[0];
      if (!row) throw new DomainError('IDEMPOTENCY_CONFLICT', 'La clave de idempotencia venció; reintentá con una nueva');
      if (row.request_hash !== requestHash) {
        throw new DomainError('IDEMPOTENCY_CONFLICT', 'Esta Idempotency-Key ya se usó con otro pedido');
      }
      if (row.response_status === null) {
        throw new DomainError('IDEMPOTENCY_CONFLICT', 'El pedido original todavía se está procesando');
      }
      res.status(row.response_status);
      res.setHeader('Idempotent-Replayed', 'true');
      return row.response_body;
    }
    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: null });
      await this.pool.query(
        `UPDATE idempotency_keys SET response_status = $4, response_body = $5::jsonb
         WHERE actor_kind = $1 AND actor_id = $2 AND key = $3`,
        [actor, user.id, key, res.statusCode, JSON.stringify(body ?? null)],
      );
      return body;
    } catch (err) {
      // El pedido falló: se libera la clave para poder reintentar.
      await this.pool.query(`DELETE FROM idempotency_keys WHERE actor_kind = $1 AND actor_id = $2 AND key = $3`, [actor, user.id, key]);
      throw err;
    }
  }
}
