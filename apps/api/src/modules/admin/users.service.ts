import { Inject, Injectable } from '@nestjs/common';
import { DomainError, InvalidInputError, NotFoundError, ROLE_LABELS, type OperatorRole } from '@lacosta/domain';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { AuditService, diff } from '../../security/audit.service';
import { hashSecret } from '../../security/crypto';
import { OperatorStateService } from '../../security/operator-state.service';
import { temporaryPassword } from '../../security/password-policy';
import type { Principal, RequestMeta } from '../../security/principal';

interface UserRow {
  id: string;
  username: string;
  full_name: string | null;
  email: string | null;
  role: OperatorRole;
  agency_id: string | null;
  is_active: boolean;
}

const SELECT_USER = `
  SELECT o.id, o.username, o.full_name, o.email, o.role, o.agency_id, a.trade_name AS agency_name, o.is_active,
         (o.locked_until > now()) AS locked, o.failed_attempts, (o.totp_enabled_at IS NOT NULL) AS mfa_enabled,
         o.must_change_password, o.last_login_at, o.created_at, o.password_changed_at
  FROM operator_users o LEFT JOIN agencies a ON a.id = o.agency_id`;

/**
 * Gestión de usuarios del panel (permiso users.manage). Reglas:
 *  - Nunca se devuelven hashes ni secretos. La contraseña temporal se muestra UNA vez.
 *  - Nadie cambia su propio rol ni se desactiva a sí mismo.
 *  - Siempre queda al menos un Administrador activo.
 *  - Cambiar rol/agencia, desactivar o resetear contraseña/2FA cierra las sesiones del usuario.
 *  - Todo queda en la auditoría, en la misma transacción que el cambio.
 */
@Injectable()
export class UsersService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly operators: OperatorStateService,
  ) {}

  async list() {
    const { rows } = await this.pool.query(`${SELECT_USER} ORDER BY o.is_active DESC, o.role, lower(o.username)`);
    return rows.map((r) => ({ ...r, role_name: ROLE_LABELS[r.role as OperatorRole]?.name ?? r.role }));
  }

  async get(id: string) {
    const { rows } = await this.pool.query(`${SELECT_USER} WHERE o.id = $1`, [id]);
    if (!rows[0]) throw new NotFoundError('Usuario inexistente', { id });
    return { ...rows[0], role_name: ROLE_LABELS[rows[0].role as OperatorRole]?.name ?? rows[0].role };
  }

  async create(actor: Principal, input: { username: string; fullName: string; email?: string; role: OperatorRole; agencyId?: string }, meta: RequestMeta) {
    this.assertAgencyShape(input.role, input.agencyId);
    const password = temporaryPassword();
    const id = await this.tx(async (c) => {
      const { rows } = await c
        .query<{ id: string }>(
          `INSERT INTO operator_users (username, password_hash, role, agency_id, full_name, email, must_change_password, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING id`,
          [input.username.trim().toLowerCase(), await hashSecret(password), input.role, input.agencyId ?? null, input.fullName.trim(), input.email?.trim() || null, actor.id],
        )
        .catch((err: { code?: string; constraint?: string }) => {
          if (err.code === '23505') throw new InvalidInputError(err.constraint?.includes('email') ? 'Ya hay un usuario con ese correo' : 'Ya existe un usuario con ese nombre', {});
          throw err;
        });
      const newId = rows[0]!.id;
      await this.audit.record(
        { actor, action: 'CREATE', entityType: 'operator_user', entityId: newId, changes: { username: input.username, role: input.role, agencyId: input.agencyId ?? null, fullName: input.fullName }, meta },
        c,
      );
      return newId;
    });
    return { user: await this.get(id), temporaryPassword: password };
  }

  async update(actor: Principal, id: string, input: { fullName?: string; email?: string | null; role?: OperatorRole; agencyId?: string | null }, meta: RequestMeta) {
    return this.tx(async (c) => {
      const before = await this.lock(c, id);
      const role = input.role ?? before.role;
      const agencyId = input.agencyId !== undefined ? input.agencyId : role === 'AGENCY_OPERATOR' ? before.agency_id : null;
      if (input.role && input.role !== before.role && actor.id === id) throw new DomainError('FORBIDDEN', 'No podés cambiar tu propio rol');
      if (before.role === 'MUNICIPAL_ADMIN' && role !== 'MUNICIPAL_ADMIN') await this.assertAnotherAdmin(c, id);
      this.assertAgencyShape(role, agencyId ?? undefined);
      const after = {
        full_name: input.fullName?.trim() ?? before.full_name,
        email: input.email !== undefined ? input.email?.trim() || null : before.email,
        role,
        agency_id: role === 'AGENCY_OPERATOR' ? agencyId : null,
      };
      const accessChanged = after.role !== before.role || after.agency_id !== before.agency_id;
      await c
        .query(
          `UPDATE operator_users SET full_name = $2, email = $3, role = $4, agency_id = $5,
                  sessions_revoked_at = CASE WHEN $6 THEN clock_timestamp() ELSE sessions_revoked_at END
           WHERE id = $1`,
          [id, after.full_name, after.email, after.role, after.agency_id, accessChanged],
        )
        .catch((err: { code?: string }) => {
          if (err.code === '23505') throw new InvalidInputError('Ya hay un usuario con ese correo', {});
          throw err;
        });
      if (accessChanged) await this.revokeRefreshTokens(c, id);
      const changes = diff(
        { fullName: before.full_name, email: before.email, role: before.role, agencyId: before.agency_id },
        { fullName: after.full_name, email: after.email, role: after.role, agencyId: after.agency_id },
      );
      await this.audit.record({ actor, action: 'UPDATE', entityType: 'operator_user', entityId: id, changes: { ...changes, sessionsRevoked: accessChanged }, meta }, c);
      return id;
    }).then(async (uid) => {
      this.operators.invalidate(uid);
      return this.get(uid);
    });
  }

  async setActive(actor: Principal, id: string, active: boolean, reason: string | undefined, meta: RequestMeta) {
    await this.tx(async (c) => {
      const before = await this.lock(c, id);
      if (!active && actor.id === id) throw new DomainError('FORBIDDEN', 'No podés desactivar tu propia cuenta');
      if (!active && before.role === 'MUNICIPAL_ADMIN') await this.assertAnotherAdmin(c, id);
      await c.query(
        `UPDATE operator_users SET is_active = $2, sessions_revoked_at = CASE WHEN $2 THEN sessions_revoked_at ELSE clock_timestamp() END WHERE id = $1`,
        [id, active],
      );
      if (!active) await this.revokeRefreshTokens(c, id);
      await this.audit.record({ actor, action: active ? 'UPDATE' : 'SUSPEND', entityType: 'operator_user', entityId: id, changes: { isActive: { before: before.is_active, after: active }, ...(reason ? { reason } : {}) }, meta }, c);
    });
    this.operators.invalidate(id);
    return this.get(id);
  }

  async unlock(actor: Principal, id: string, meta: RequestMeta) {
    await this.tx(async (c) => {
      await this.lock(c, id);
      await c.query(`UPDATE operator_users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`, [id]);
      await this.audit.record({ actor, action: 'UPDATE', entityType: 'operator_user', entityId: id, changes: { unlocked: true }, meta }, c);
    });
    return this.get(id);
  }

  /** Contraseña temporal nueva (se muestra una vez) y cierre de todas las sesiones. */
  async resetPassword(actor: Principal, id: string, meta: RequestMeta) {
    const password = temporaryPassword();
    await this.tx(async (c) => {
      await this.lock(c, id);
      await c.query(
        `UPDATE operator_users SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL,
                sessions_revoked_at = clock_timestamp() WHERE id = $1`,
        [id, await hashSecret(password)],
      );
      await this.revokeRefreshTokens(c, id);
      await this.audit.record({ actor, action: 'PASSWORD_RESET', entityType: 'operator_user', entityId: id, changes: { by: 'admin' }, meta }, c);
    });
    this.operators.invalidate(id);
    return { user: await this.get(id), temporaryPassword: password };
  }

  /** Para quien perdió el teléfono: borra el 2FA; si el rol lo exige, lo vuelve a configurar al entrar. */
  async resetMfa(actor: Principal, id: string, meta: RequestMeta) {
    await this.tx(async (c) => {
      await this.lock(c, id);
      await c.query(
        `UPDATE operator_users SET totp_secret_enc = NULL, totp_enabled_at = NULL, recovery_codes_hash = '{}',
                sessions_revoked_at = clock_timestamp() WHERE id = $1`,
        [id],
      );
      await this.revokeRefreshTokens(c, id);
      await this.audit.record({ actor, action: 'MFA_CHANGE', entityType: 'operator_user', entityId: id, changes: { mfa: 'reset by admin' }, meta }, c);
    });
    this.operators.invalidate(id);
    return this.get(id);
  }

  // ------------------------------------------------------------------ apoyo
  private assertAgencyShape(role: OperatorRole, agencyId: string | undefined | null): void {
    if (role === 'AGENCY_OPERATOR' && !agencyId) throw new InvalidInputError('El operador de agencia necesita una agencia', { field: 'agencyId' });
  }

  private async assertAnotherAdmin(c: PoolClient, exceptId: string): Promise<void> {
    // Se bloquean las filas de administradores para que dos bajas simultáneas no dejen el sistema sin ninguno.
    const { rows } = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT id FROM operator_users WHERE role = 'MUNICIPAL_ADMIN' AND is_active AND id <> $1 FOR UPDATE) x`,
      [exceptId],
    );
    if ((rows[0]?.n ?? 0) < 1) throw new DomainError('FORBIDDEN', 'Tiene que quedar al menos un Administrador activo');
  }

  private async lock(c: PoolClient, id: string): Promise<UserRow> {
    const { rows } = await c.query<UserRow>(
      `SELECT id, username, full_name, email, role, agency_id, is_active FROM operator_users WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Usuario inexistente', { id });
    return rows[0];
  }

  private revokeRefreshTokens(c: PoolClient, id: string) {
    return c.query(`UPDATE auth_refresh_tokens SET revoked_at = now() WHERE subject_kind = 'OPERATOR' AND subject_id = $1 AND revoked_at IS NULL`, [id]);
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
