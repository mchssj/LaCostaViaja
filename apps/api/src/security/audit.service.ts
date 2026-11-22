import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database/database.module';
import { actorRole, type Principal, type RequestMeta } from './principal';

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'SUSPEND'
  | 'REVOKE'
  | 'APPROVE'
  | 'REJECT'
  | 'VERIFY'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'PASSWORD_RESET'
  | 'MFA_CHANGE'
  | 'SESSION_REVOKE';

export interface AuditEntry {
  readonly actor: Principal | null;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId?: string | null;
  /** Antes y después, o el detalle relevante. Nunca contraseñas, hashes ni secretos. */
  readonly changes?: Record<string, unknown>;
  readonly meta?: RequestMeta;
}

const SECRET_KEYS = /password|secret|hash|token|pin|recovery/i;

/** Quita del registro cualquier campo con aspecto de secreto (defensa en profundidad). */
export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[omitido]' : scrub(v)]));
  }
  return value;
}

/**
 * Registro de auditoría (audit_log). Se escribe dentro de la misma transacción que el cambio cuando
 * se pasa `client`, así no queda un cambio sin su registro ni un registro sin su cambio.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async record(entry: AuditEntry, client?: PoolClient): Promise<void> {
    const params = [
      entry.actor ? actorRole(entry.actor) : 'SYSTEM',
      entry.actor?.id ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      JSON.stringify(scrub(entry.changes ?? {})),
      entry.meta?.ip ?? null,
      entry.meta?.userAgent ?? null,
    ];
    const sql = `INSERT INTO audit_log (actor_kind, actor_id, action, entity_type, entity_id, changes, ip, user_agent)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`;
    if (client) {
      await client.query(sql, params);
      return;
    }
    // Fuera de transacción (p. ej. login fallido): un error de auditoría no debe tumbar el pedido.
    await this.pool.query(sql, params).catch((err: Error) => this.logger.error(`No se pudo auditar ${entry.action} ${entry.entityType}: ${err.message}`));
  }
}

/** Diferencias campo a campo entre dos objetos planos (para "antes / después"). */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = { before: before[key], after: after[key] };
  }
  return out;
}
