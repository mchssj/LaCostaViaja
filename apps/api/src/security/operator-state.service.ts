import { Inject, Injectable } from '@nestjs/common';
import { MFA_REQUIRED_ROLES, type OperatorRole } from '@lacosta/domain';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface OperatorState {
  readonly role: OperatorRole;
  readonly agencyId: string | null;
  readonly isActive: boolean;
  /** epoch ms; los tokens emitidos antes dejan de valer. */
  readonly sessionsRevokedAt: number | null;
  readonly mustChangePassword: boolean;
  readonly mfaEnabled: boolean;
  /** El rol exige 2FA y todavía no lo activó. */
  readonly mfaSetupRequired: boolean;
}

const TTL_MS = 15_000;

/**
 * Estado vigente de un operador, leído de la base con caché corta. El guard lo usa en cada pedido
 * para que un cambio de rol, una baja o un reseteo de contraseña tengan efecto en segundos (sin
 * esperar a que venza el token de acceso). Entre réplicas, el retraso máximo es TTL_MS.
 */
@Injectable()
export class OperatorStateService {
  private readonly cache = new Map<string, { at: number; state: OperatorState | null }>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async get(id: string): Promise<OperatorState | null> {
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.state;
    const { rows } = await this.pool.query<{
      role: OperatorRole;
      agency_id: string | null;
      is_active: boolean;
      sessions_revoked_at: Date | null;
      must_change_password: boolean;
      totp_enabled_at: Date | null;
    }>(
      `SELECT role, agency_id, is_active, sessions_revoked_at, must_change_password, totp_enabled_at
       FROM operator_users WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    const state: OperatorState | null = r
      ? {
          role: r.role,
          agencyId: r.agency_id,
          isActive: r.is_active,
          sessionsRevokedAt: r.sessions_revoked_at?.getTime() ?? null,
          mustChangePassword: r.must_change_password,
          mfaEnabled: r.totp_enabled_at !== null,
          mfaSetupRequired: MFA_REQUIRED_ROLES.includes(r.role) && r.totp_enabled_at === null,
        }
      : null;
    this.cache.set(id, { at: Date.now(), state });
    return state;
  }

  /** Tras un cambio hecho en esta réplica: que se note en el próximo pedido. */
  invalidate(id: string): void {
    this.cache.delete(id);
  }
}

export function setupPending(s: OperatorState): Array<'PASSWORD' | 'MFA'> {
  return [...(s.mustChangePassword ? (['PASSWORD'] as const) : []), ...(s.mfaSetupRequired ? (['MFA'] as const) : [])];
}
