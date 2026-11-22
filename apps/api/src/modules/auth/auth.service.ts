import { Inject, Injectable } from '@nestjs/common';
import { DomainError, MFA_REQUIRED_ROLES, permissionsOf, ROLE_LABELS } from '@lacosta/domain';
import { randomInt, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import { hashSecret, randomToken, sha256Hex, verifySecret } from '../../security/crypto';
import { JwtService } from '../../security/jwt.service';
import { AuditService } from '../../security/audit.service';
import type { OperatorRole, Principal, RequestMeta } from '../../security/principal';
import { MfaService } from './mfa.service';
import { QrCodeService } from './qr-code.service';
import { SMS_PROVIDER, type ISmsProvider } from './sms.provider';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_PER_WINDOW = 3;
const OTP_WINDOW_MINUTES = 10;

export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

type SubjectKind = 'PASSENGER' | 'DRIVER' | 'OPERATOR';

const invalidCredentials = (): DomainError => new DomainError('UNAUTHORIZED', 'Credenciales inválidas');

/**
 * Las cuatro formas de entrar: operador (usuario + contraseña), chofer (DNI + PIN), pasajero
 * registrado (teléfono + código SMS) e invitado (QR firmado). Todas terminan en un JWT de acceso
 * corto + refresh token rotativo (se guarda solo su hash).
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SMS_PROVIDER) private readonly sms: ISmsProvider,
    private readonly jwt: JwtService,
    private readonly qr: QrCodeService,
    private readonly audit: AuditService,
    private readonly mfa: MfaService,
  ) {}

  // ------------------------------------------------------------ operadores
  /**
   * Paso 1: usuario y contraseña. Si la cuenta tiene segundo factor, NO se emite sesión: se devuelve
   * un comprobante corto (mfaToken) para el paso 2. Si el rol exige 2FA y todavía no lo activó, o
   * la contraseña es temporal, la sesión queda en modo "configuración pendiente" (ver AuthGuard).
   */
  async loginOperator(username: string, password: string, meta?: RequestMeta) {
    const { rows } = await this.pool.query<{
      id: string;
      username: string;
      password_hash: string;
      role: OperatorRole;
      agency_id: string | null;
      is_active: boolean;
      locked_until: Date | null;
      totp_enabled_at: Date | null;
    }>(
      `SELECT id, username, password_hash, role, agency_id, is_active, locked_until, totp_enabled_at
       FROM operator_users WHERE lower(username) = lower($1)`,
      [username],
    );
    const op = rows[0];
    const ok = await verifySecret(password, op?.password_hash);
    if (!op || !op.is_active) throw invalidCredentials();
    if (op.locked_until && op.locked_until > new Date()) {
      throw new DomainError('UNAUTHORIZED', 'Cuenta bloqueada temporalmente por intentos fallidos. Pedile a un administrador que la desbloquee o esperá.');
    }
    if (!ok) {
      const { maxFailedLogins, lockMinutes } = await this.lockPolicy();
      await this.pool.query(
        `UPDATE operator_users
         SET failed_attempts = failed_attempts + 1,
             locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
         WHERE id = $1`,
        [op.id, maxFailedLogins, lockMinutes],
      );
      await this.audit.record({ actor: null, action: 'LOGIN_FAILED', entityType: 'operator_user', entityId: op.id, changes: { username: op.username }, ...(meta ? { meta } : {}) });
      throw invalidCredentials();
    }
    if (op.totp_enabled_at) {
      return { mfaRequired: true as const, mfaToken: await this.jwt.signMfaChallenge(op.id) };
    }
    return this.completeOperatorLogin(op.id, meta);
  }

  /** Paso 2 (si tiene 2FA): código de la app o uno de recuperación. */
  async loginOperatorMfa(mfaToken: string, code: string, meta?: RequestMeta) {
    const id = await this.jwt.verifyMfaChallenge(mfaToken);
    await this.mfa.verifyLoginCode(id, code, meta);
    return this.completeOperatorLogin(id, meta);
  }

  private async completeOperatorLogin(id: string, meta?: RequestMeta) {
    await this.pool.query(`UPDATE operator_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [id]);
    const principal = await this.loadPrincipal('OPERATOR', id);
    await this.audit.record({ actor: principal, action: 'LOGIN', entityType: 'operator_user', entityId: id, ...(meta ? { meta } : {}) });
    return { ...(await this.issueSession(principal, 'OPERATOR')), user: await this.operatorProfile(id) };
  }

  /** Perfil del operador con permisos y configuración pendiente (lo usa el panel para armar el menú). */
  async operatorProfile(id: string) {
    const { rows } = await this.pool.query<{
      id: string;
      username: string;
      full_name: string | null;
      email: string | null;
      role: OperatorRole;
      agency_id: string | null;
      agency_name: string | null;
      must_change_password: boolean;
      totp_enabled_at: Date | null;
      last_login_at: Date | null;
    }>(
      `SELECT o.id, o.username, o.full_name, o.email, o.role, o.agency_id, a.trade_name AS agency_name,
              o.must_change_password, o.totp_enabled_at, o.last_login_at
       FROM operator_users o LEFT JOIN agencies a ON a.id = o.agency_id WHERE o.id = $1`,
      [id],
    );
    const o = rows[0];
    if (!o) throw new DomainError('UNAUTHORIZED', 'Usuario inexistente');
    const mfaRequired = MFA_REQUIRED_ROLES.includes(o.role);
    const setupRequired = [...(o.must_change_password ? ['PASSWORD'] : []), ...(mfaRequired && !o.totp_enabled_at ? ['MFA'] : [])];
    return {
      id: o.id,
      kind: 'OPERATOR' as const,
      username: o.username,
      fullName: o.full_name,
      email: o.email,
      role: o.role,
      roleName: ROLE_LABELS[o.role].name,
      agencyId: o.agency_id,
      agencyName: o.agency_name,
      permissions: permissionsOf(o.role),
      mfaEnabled: o.totp_enabled_at !== null,
      mfaRequired,
      setupRequired,
      lastLoginAt: o.last_login_at,
    };
  }

  /** Política de bloqueo editable desde Configuración (con el valor de código como respaldo). */
  private async lockPolicy(): Promise<{ maxFailedLogins: number; lockMinutes: number }> {
    const { rows } = await this.pool
      .query<{ key: string; value: number }>(`SELECT key, value FROM system_settings WHERE key IN ('security.max_failed_logins', 'security.lock_minutes')`)
      .catch(() => ({ rows: [] as Array<{ key: string; value: number }> }));
    const get = (k: string, d: number) => Number(rows.find((r) => r.key === k)?.value ?? d);
    return { maxFailedLogins: get('security.max_failed_logins', MAX_FAILED_ATTEMPTS), lockMinutes: get('security.lock_minutes', LOCK_MINUTES) };
  }

  // ------------------------------------------------------------ choferes
  async loginDriver(dni: string, pin: string) {
    const { rows } = await this.pool.query<{
      id: string;
      first_name: string;
      last_name: string;
      pin_hash: string | null;
      pin_locked_until: Date | null;
    }>(`SELECT id, first_name, last_name, pin_hash, pin_locked_until FROM drivers WHERE dni = $1`, [dni]);
    const d = rows[0];
    const ok = await verifySecret(pin, d?.pin_hash);
    if (!d || !d.pin_hash) throw invalidCredentials();
    if (d.pin_locked_until && d.pin_locked_until > new Date()) {
      throw new DomainError('UNAUTHORIZED', 'PIN bloqueado temporalmente por intentos fallidos. Consultá en Tránsito.');
    }
    if (!ok) {
      await this.pool.query(
        `UPDATE drivers
         SET pin_failed_attempts = pin_failed_attempts + 1,
             pin_locked_until = CASE WHEN pin_failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE pin_locked_until END
         WHERE id = $1`,
        [d.id, MAX_FAILED_ATTEMPTS, LOCK_MINUTES],
      );
      throw invalidCredentials();
    }
    await this.pool.query(`UPDATE drivers SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`, [d.id]);
    // Vehículos que puede manejar hoy (para elegir al abrir turno).
    const { rows: vehicles } = await this.pool.query(
      `SELECT e.vehicle_id AS "vehicleId", v.plate, v.make, v.model, v.service_type AS "serviceType",
              e.is_eligible AS "isEligible", e.blocking_reasons AS "blockingReasons"
       FROM v_driver_vehicle_eligibility e JOIN vehicles v ON v.id = e.vehicle_id
       WHERE e.driver_id = $1 ORDER BY e.is_eligible DESC, v.plate`,
      [d.id],
    );
    return {
      ...(await this.issueSession({ kind: 'DRIVER', id: d.id }, 'DRIVER')),
      user: { id: d.id, firstName: d.first_name, lastName: d.last_name, vehicles },
    };
  }

  // ------------------------------------------------------------ pasajero registrado
  async requestOtp(phone: string): Promise<{ ok: true; expiresInSeconds: number }> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM otp_challenges WHERE phone = $1 AND created_at > now() - make_interval(mins => $2)`,
      [phone, OTP_WINDOW_MINUTES],
    );
    if ((rows[0]?.n ?? 0) >= OTP_MAX_PER_WINDOW) {
      throw new DomainError('RATE_LIMITED', 'Ya pediste varios códigos. Esperá unos minutos.', { retryAfterSeconds: OTP_WINDOW_MINUTES * 60 });
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.pool.query(
      `INSERT INTO otp_challenges (phone, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [phone, await hashSecret(code), OTP_TTL_MINUTES],
    );
    await this.sms.send(phone, `La Costa Viaja: tu código es ${code}. Vence en ${OTP_TTL_MINUTES} minutos.`);
    return { ok: true, expiresInSeconds: OTP_TTL_MINUTES * 60 };
  }

  async verifyOtp(phone: string, code: string) {
    const { rows } = await this.pool.query<{ id: string; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts FROM otp_challenges
       WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    const ch = rows[0];
    if (!ch) throw new DomainError('UNAUTHORIZED', 'Código inválido o vencido');
    if (ch.attempts >= OTP_MAX_ATTEMPTS) throw new DomainError('UNAUTHORIZED', 'Demasiados intentos: pedí un código nuevo');
    if (!(await verifySecret(code, ch.code_hash))) {
      await this.pool.query(`UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1`, [ch.id]);
      throw new DomainError('UNAUTHORIZED', 'Código incorrecto');
    }
    // Consumo atómico: el mismo código no sirve dos veces aunque lleguen dos pedidos juntos.
    const consumed = await this.pool.query(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`, [ch.id]);
    if (consumed.rowCount !== 1) throw new DomainError('UNAUTHORIZED', 'Código ya utilizado');

    const { rows: found } = await this.pool.query<{ id: string }>(
      `INSERT INTO passengers (kind, phone) SELECT 'REGISTERED', $1::text
       WHERE NOT EXISTS (SELECT 1 FROM passengers WHERE kind = 'REGISTERED' AND phone = $1)
       RETURNING id`,
      [phone],
    );
    const passengerId =
      found[0]?.id ??
      (await this.pool.query<{ id: string }>(`SELECT id FROM passengers WHERE kind = 'REGISTERED' AND phone = $1 ORDER BY created_at LIMIT 1`, [phone]))
        .rows[0]!.id;
    await this.pool.query(`UPDATE passengers SET last_seen_at = now() WHERE id = $1`, [passengerId]);
    return {
      ...(await this.issueSession({ kind: 'PASSENGER', id: passengerId }, 'PASSENGER')),
      user: { id: passengerId, kind: 'REGISTERED', phone },
    };
  }

  // ------------------------------------------------------------ invitado (QR)
  async createGuestSession(qrCode: string) {
    const qr = this.qr.verify(qrCode);
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO passengers (kind, guest_session_hash, last_seen_at) VALUES ('GUEST', $1, now()) RETURNING id`,
      [sha256Hex(randomToken(32))],
    );
    const passengerId = rows[0]!.id;
    return {
      ...(await this.issueSession({ kind: 'GUEST', id: passengerId }, 'PASSENGER')),
      user: { id: passengerId, kind: 'GUEST', origin: { label: qr.label, zoneCode: qr.zoneCode } },
    };
  }

  issueQr(label: string, zoneCode: string | null): { qrCode: string; label: string; zoneCode: string | null } {
    return { qrCode: this.qr.issue(label, zoneCode), label, zoneCode };
  }

  // ------------------------------------------------------------ refresh / logout
  /**
   * Rotación: cada refresh token sirve una sola vez. Si alguien presenta uno ya usado (robado),
   * se revoca toda la familia y hay que volver a entrar.
   */
  async refresh(refreshToken: string): Promise<SessionTokens> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        subject_kind: SubjectKind;
        subject_id: string;
        family: string;
        expires_at: Date;
        revoked_at: Date | null;
        replaced_by: string | null;
      }>(
        `SELECT id, subject_kind, subject_id, family, expires_at, revoked_at, replaced_by
         FROM auth_refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [sha256Hex(refreshToken)],
      );
      const t = rows[0];
      if (!t) throw new DomainError('UNAUTHORIZED', 'Sesión inválida');
      if (t.replaced_by) {
        await client.query(`UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE family = $1`, [t.family]);
        await client.query('COMMIT');
        throw new DomainError('UNAUTHORIZED', 'Sesión revocada por reutilización del token. Volvé a ingresar.');
      }
      if (t.revoked_at || t.expires_at < new Date()) throw new DomainError('UNAUTHORIZED', 'Sesión vencida');

      const principal = await this.loadPrincipal(t.subject_kind, t.subject_id);
      const next = randomToken();
      const { rows: inserted } = await client.query<{ id: string }>(
        `INSERT INTO auth_refresh_tokens (token_hash, subject_kind, subject_id, family, expires_at)
         VALUES ($1, $2, $3, $4, now() + make_interval(days => $5)) RETURNING id`,
        [sha256Hex(next), t.subject_kind, t.subject_id, t.family, this.config.security.refreshTokenTtlDays],
      );
      await client.query(`UPDATE auth_refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1`, [t.id, inserted[0]!.id]);
      await client.query('COMMIT');
      return { accessToken: await this.jwt.signAccess(principal), refreshToken: next, expiresIn: this.jwt.accessTtlSeconds };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async logout(refreshToken: string): Promise<{ ok: true }> {
    await this.pool.query(
      `UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
       WHERE family = (SELECT family FROM auth_refresh_tokens WHERE token_hash = $1)`,
      [sha256Hex(refreshToken)],
    );
    return { ok: true };
  }

  /** Al refrescar se relee el sujeto: un operador desactivado o un rol cambiado no sobreviven a su token. */
  private async loadPrincipal(kind: SubjectKind, id: string): Promise<Principal> {
    if (kind === 'OPERATOR') {
      const { rows } = await this.pool.query<{ role: OperatorRole; agency_id: string | null; is_active: boolean }>(
        `SELECT role, agency_id, is_active FROM operator_users WHERE id = $1`,
        [id],
      );
      if (!rows[0]?.is_active) throw new DomainError('UNAUTHORIZED', 'Usuario inactivo');
      return { kind: 'OPERATOR', id, role: rows[0].role, agencyId: rows[0].agency_id };
    }
    if (kind === 'PASSENGER') {
      const { rows } = await this.pool.query<{ kind: 'REGISTERED' | 'GUEST' }>(`SELECT kind FROM passengers WHERE id = $1`, [id]);
      if (!rows[0]) throw new DomainError('UNAUTHORIZED', 'Pasajero inexistente');
      return { kind: rows[0].kind === 'GUEST' ? 'GUEST' : 'PASSENGER', id };
    }
    const { rows } = await this.pool.query<{ status: string }>(`SELECT status FROM drivers WHERE id = $1`, [id]);
    if (!rows[0] || rows[0].status === 'REVOKED') throw new DomainError('UNAUTHORIZED', 'Chofer dado de baja');
    return { kind: 'DRIVER', id };
  }

  /** Nueva sesión para un operador (tras cambiar su contraseña o activar 2FA se emite una limpia). */
  async issueOperatorSession(id: string): Promise<SessionTokens> {
    return this.issueSession(await this.loadPrincipal('OPERATOR', id), 'OPERATOR');
  }

  private async issueSession(principal: Principal, subjectKind: SubjectKind): Promise<SessionTokens> {
    const refreshToken = randomToken();
    await this.pool.query(
      `INSERT INTO auth_refresh_tokens (token_hash, subject_kind, subject_id, family, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(days => $5))`,
      [sha256Hex(refreshToken), subjectKind, principal.id, randomUUID(), this.config.security.refreshTokenTtlDays],
    );
    return { accessToken: await this.jwt.signAccess(principal), refreshToken, expiresIn: this.jwt.accessTtlSeconds };
  }
}
