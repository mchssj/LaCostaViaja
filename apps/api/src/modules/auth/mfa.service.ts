import { Inject, Injectable } from '@nestjs/common';
import { DomainError, MFA_REQUIRED_ROLES, type OperatorRole } from '@lacosta/domain';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import { REDIS } from '../../redis/redis.tokens';
import { AuditService } from '../../security/audit.service';
import { decryptSecret, deriveKey, encryptSecret, hashSecret, newTotpSecret, verifySecret, verifyTotp } from '../../security/crypto';
import { OperatorStateService } from '../../security/operator-state.service';
import { recoveryCodes } from '../../security/password-policy';
import type { Principal, RequestMeta } from '../../security/principal';

const ISSUER = 'La Costa Viaja';
const MAX_MFA_ATTEMPTS = 5;

/**
 * Segundo factor TOTP (RFC 6238, compatible con Google Authenticator / Microsoft Authenticator).
 * El secreto se guarda cifrado (AES-256-GCM, clave derivada de JWT_SECRET con propósito propio).
 * Cada código sirve una sola vez (se recuerda el último paso usado en Redis).
 */
@Injectable()
export class MfaService {
  private readonly key: Buffer;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly audit: AuditService,
    private readonly operators: OperatorStateService,
  ) {
    this.key = deriveKey(config.security.jwtSecret, 'totp-secret-encryption');
  }

  /** Login paso 2: código TOTP o código de recuperación (se consume). */
  async verifyLoginCode(id: string, rawCode: string, meta?: RequestMeta): Promise<void> {
    const attemptsKey = `lc:mfa:attempts:${id}`;
    const attempts = await this.redis.incr(attemptsKey).catch(() => 0);
    if (attempts === 1) await this.redis.pexpire(attemptsKey, 5 * 60_000).catch(() => undefined);
    if (attempts > MAX_MFA_ATTEMPTS) throw new DomainError('RATE_LIMITED', 'Demasiados códigos incorrectos. Esperá unos minutos e ingresá de nuevo.');

    const { rows } = await this.pool.query<{ totp_secret_enc: string | null; totp_enabled_at: Date | null; recovery_codes_hash: string[]; is_active: boolean }>(
      `SELECT totp_secret_enc, totp_enabled_at, recovery_codes_hash, is_active FROM operator_users WHERE id = $1`,
      [id],
    );
    const op = rows[0];
    if (!op?.is_active || !op.totp_enabled_at || !op.totp_secret_enc) throw new DomainError('UNAUTHORIZED', 'Credenciales inválidas');
    const code = rawCode.trim().toLowerCase();

    if (/^\d{6}$/.test(code)) {
      if (await this.acceptTotp(id, decryptSecret(this.key, op.totp_secret_enc), code)) {
        await this.redis.del(attemptsKey).catch(() => undefined);
        return;
      }
    } else if (/^[a-z0-9]{4}-[a-z0-9]{4}$/.test(code)) {
      for (const [i, hash] of op.recovery_codes_hash.entries()) {
        if (await verifySecret(code, hash)) {
          const remaining = op.recovery_codes_hash.filter((_, j) => j !== i);
          await this.pool.query(`UPDATE operator_users SET recovery_codes_hash = $2 WHERE id = $1`, [id, remaining]);
          await this.audit.record({ actor: { kind: 'OPERATOR', id }, action: 'MFA_CHANGE', entityType: 'operator_user', entityId: id, changes: { recoveryCodeUsed: true, remaining: remaining.length }, ...(meta ? { meta } : {}) });
          await this.redis.del(attemptsKey).catch(() => undefined);
          return;
        }
      }
    }
    await this.audit.record({ actor: null, action: 'LOGIN_FAILED', entityType: 'operator_user', entityId: id, changes: { step: 'mfa' }, ...(meta ? { meta } : {}) });
    throw new DomainError('UNAUTHORIZED', 'Código incorrecto');
  }

  /** Genera un secreto nuevo PENDIENTE (no reemplaza el activo hasta confirmar con un código). */
  async setup(p: Principal): Promise<{ secret: string; otpauthUrl: string }> {
    const { rows } = await this.pool.query<{ username: string; totp_enabled_at: Date | null }>(`SELECT username, totp_enabled_at FROM operator_users WHERE id = $1`, [p.id]);
    const op = rows[0]!;
    if (op.totp_enabled_at) throw new DomainError('INVALID_TRANSITION', 'Ya tenés el segundo factor activo. Desactivalo antes de configurar otro.');
    const secret = newTotpSecret();
    await this.redis.set(`lc:mfa:pending:${p.id}`, encryptSecret(this.key, secret), 'PX', 15 * 60_000);
    const label = encodeURIComponent(`${ISSUER}:${op.username}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauthUrl };
  }

  /** Confirma el secreto pendiente con un código y devuelve los códigos de recuperación (una sola vez). */
  async enable(p: Principal, code: string, meta?: RequestMeta): Promise<{ recoveryCodes: string[] }> {
    const pending = await this.redis.get(`lc:mfa:pending:${p.id}`);
    if (!pending) throw new DomainError('INVALID_TRANSITION', 'La configuración venció. Empezá de nuevo.');
    const secret = decryptSecret(this.key, pending);
    if (!(await this.acceptTotp(p.id, secret, code.trim()))) throw new DomainError('INVALID_INPUT', 'El código no coincide. Revisá la hora del teléfono y probá con el siguiente.');
    const codes = recoveryCodes();
    const hashes = await Promise.all(codes.map((c) => hashSecret(c)));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE operator_users SET totp_secret_enc = $2, totp_enabled_at = now(), recovery_codes_hash = $3 WHERE id = $1`,
        [p.id, encryptSecret(this.key, secret), hashes],
      );
      await this.audit.record({ actor: p, action: 'MFA_CHANGE', entityType: 'operator_user', entityId: p.id, changes: { mfa: 'enabled' }, ...(meta ? { meta } : {}) }, client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.redis.del(`lc:mfa:pending:${p.id}`);
    this.operators.invalidate(p.id);
    return { recoveryCodes: codes };
  }

  /** Desactivar el propio 2FA: solo si el rol no lo exige, y con un código válido. */
  async disable(p: Principal, code: string, meta?: RequestMeta): Promise<{ ok: true }> {
    if (MFA_REQUIRED_ROLES.includes(p.role as OperatorRole)) throw new DomainError('FORBIDDEN', 'Tu rol exige el segundo factor: no se puede desactivar.');
    await this.verifyLoginCode(p.id, code, meta);
    await this.pool.query(`UPDATE operator_users SET totp_secret_enc = NULL, totp_enabled_at = NULL, recovery_codes_hash = '{}' WHERE id = $1`, [p.id]);
    await this.audit.record({ actor: p, action: 'MFA_CHANGE', entityType: 'operator_user', entityId: p.id, changes: { mfa: 'disabled' }, ...(meta ? { meta } : {}) });
    this.operators.invalidate(p.id);
    return { ok: true };
  }

  private async acceptTotp(id: string, secret: string, code: string): Promise<boolean> {
    const lastKey = `lc:mfa:last-step:${id}`;
    const last = Number(await this.redis.get(lastKey).catch(() => null)) || null;
    const step = verifyTotp(secret, code, Date.now(), last);
    if (step === null) return false;
    await this.redis.set(lastKey, String(step), 'PX', 5 * 60_000).catch(() => undefined);
    return true;
  }
}
