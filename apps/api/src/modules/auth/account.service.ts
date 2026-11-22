import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@lacosta/domain';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { AuditService } from '../../security/audit.service';
import { hashSecret, verifySecret } from '../../security/crypto';
import { OperatorStateService } from '../../security/operator-state.service';
import { assertPasswordPolicy } from '../../security/password-policy';
import type { Principal, RequestMeta } from '../../security/principal';
import { AuthService } from './auth.service';

/** "Mi cuenta" del operador: cambio de contraseña (obligatorio si es temporal). */
@Injectable()
export class AccountService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly operators: OperatorStateService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Cambia la contraseña y cierra TODAS las demás sesiones (sessions_revoked_at + refresh tokens).
   * Devuelve una sesión nueva para seguir trabajando en este navegador.
   */
  async changePassword(p: Principal, currentPassword: string, newPassword: string, meta?: RequestMeta) {
    const { rows } = await this.pool.query<{ username: string; password_hash: string }>(`SELECT username, password_hash FROM operator_users WHERE id = $1`, [p.id]);
    const op = rows[0];
    if (!op || !(await verifySecret(currentPassword, op.password_hash))) throw new DomainError('UNAUTHORIZED', 'La contraseña actual no es correcta');
    if (await verifySecret(newPassword, op.password_hash)) throw new DomainError('INVALID_INPUT', 'La contraseña nueva tiene que ser distinta de la actual');
    assertPasswordPolicy(newPassword, op.username);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE operator_users
         SET password_hash = $2, must_change_password = false, password_changed_at = now(),
             sessions_revoked_at = clock_timestamp(), failed_attempts = 0, locked_until = NULL
         WHERE id = $1`,
        [p.id, await hashSecret(newPassword)],
      );
      await client.query(`UPDATE auth_refresh_tokens SET revoked_at = now() WHERE subject_kind = 'OPERATOR' AND subject_id = $1 AND revoked_at IS NULL`, [p.id]);
      await this.audit.record({ actor: p, action: 'PASSWORD_RESET', entityType: 'operator_user', entityId: p.id, changes: { by: 'self' }, ...(meta ? { meta } : {}) }, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    this.operators.invalidate(p.id);
    return { ...(await this.auth.issueOperatorSession(p.id)), user: await this.auth.operatorProfile(p.id) };
  }
}
