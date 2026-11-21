import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../../database/database.module';
import { JwtService } from '../../common/jwt.service';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool } from 'pg';

const scrypt = promisify(scryptCb);

async function hashSecret(value: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scrypt(value, salt, 64)) as Buffer;
  return `${salt}:${buf.toString('hex')}`;
}

async function verifySecret(value: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const buf = (await scrypt(value, salt, 64)) as Buffer;
  try {
    return timingSafeEqual(Buffer.from(hash, 'hex'), buf);
  } catch {
    return false;
  }
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwt: JwtService,
  ) {}

  // ---------- Operadores (usuario + contraseña) ----------
  async loginOperator(username: string, password: string) {
    const { rows } = await this.pool.query(
      'SELECT id, username, password_hash, role, is_active, failed_attempts, locked_until FROM operator_users WHERE username = $1',
      [username],
    );
    const op = rows[0];
    if (!op || !op.is_active) throw new UnauthorizedException('Credenciales inválidas');
    if (op.locked_until && new Date(op.locked_until) > new Date()) {
      throw new UnauthorizedException('Cuenta bloqueada');
    }
    const ok = await verifySecret(password, op.password_hash);
    if (!ok) {
      await this.pool.query(
        'UPDATE operator_users SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval \'15 minutes\' ELSE locked_until END WHERE id = $1',
        [op.id],
      );
      throw new UnauthorizedException('Credenciales inválidas');
    }
    await this.pool.query('UPDATE operator_users SET failed_attempts = 0, locked_until = NULL, last_seen_at = now() WHERE id = $1', [op.id]).catch(() => {});
    const accessToken = await this.jwt.signAccess({ kind: 'OPERATOR', id: op.id, role: op.role });
    const refreshToken = await this.issueRefreshToken('OPERATOR', op.id);
    return { accessToken, refreshToken, user: { id: op.id, username: op.username, role: op.role } };
  }

  // ---------- Chofer (DNI + PIN) ----------
  async loginDriver(dni: string, pin: string) {
    const { rows } = await this.pool.query(
      'SELECT id, dni, pin_hash, pin_failed_attempts, pin_locked_until, status FROM drivers WHERE dni = $1',
      [dni],
    );
    const d = rows[0];
    if (!d || !d.pin_hash) throw new UnauthorizedException('Credenciales inválidas');
    if (d.pin_locked_until && new Date(d.pin_locked_until) > new Date()) {
      throw new UnauthorizedException('PIN bloqueado');
    }
    const ok = await verifySecret(pin, d.pin_hash);
    if (!ok) {
      await this.pool.query(
        'UPDATE drivers SET pin_failed_attempts = pin_failed_attempts + 1, pin_locked_until = CASE WHEN pin_failed_attempts + 1 >= 5 THEN now() + interval \'15 minutes\' ELSE pin_locked_until END WHERE id = $1',
        [d.id],
      );
      throw new UnauthorizedException('Credenciales inválidas');
    }
    await this.pool.query('UPDATE drivers SET pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1', [d.id]);
    const accessToken = await this.jwt.signAccess({ kind: 'DRIVER', id: d.id });
    const refreshToken = await this.issueRefreshToken('DRIVER', d.id);
    return { accessToken, refreshToken, user: { id: d.id, dni: d.dni } };
  }

  // ---------- Pasajero registrado (teléfono + OTP) ----------
  async requestOtp(phone: string) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const hash = await hashSecret(code);
    await this.pool.query(
      'INSERT INTO otp_challenges (phone, code_hash, expires_at) VALUES ($1, $2, now() + interval \'5 minutes\')',
      [phone, hash],
    );
    // En desarrollo el código se escribe en el log (proveedor SMS real se define con el municipio).
    // eslint-disable-next-line no-console
    console.log(`[OTP] ${phone} -> ${code}`);
    return { ok: true };
  }

  async verifyOtp(phone: string, code: string) {
    const { rows } = await this.pool.query(
      'SELECT id, code_hash, attempts, expires_at, consumed_at FROM otp_challenges WHERE phone = $1 ORDER BY created_at DESC LIMIT 1',
      [phone],
    );
    const ch = rows[0];
    if (!ch || ch.consumed_at || new Date(ch.expires_at) < new Date()) {
      throw new UnauthorizedException('Código inválido o vencido');
    }
    if (ch.attempts >= 5) throw new UnauthorizedException('Demasiados intentos');
    const ok = await verifySecret(code, ch.code_hash);
    if (!ok) {
      await this.pool.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [ch.id]);
      throw new UnauthorizedException('Código inválido');
    }
    await this.pool.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [ch.id]);
    // Buscar o crear pasajero registrado.
    let passengerId: string;
    const { rows: pRows } = await this.pool.query('SELECT id FROM passengers WHERE kind = \'REGISTERED\' AND phone = $1', [phone]);
    if (pRows[0]) {
      passengerId = pRows[0].id;
    } else {
      const { rows: ins } = await this.pool.query(
        'INSERT INTO passengers (kind, full_name, phone) VALUES (\'REGISTERED\', NULL, $1) RETURNING id',
        [phone],
      );
      passengerId = ins[0].id;
    }
    const accessToken = await this.jwt.signAccess({ kind: 'PASSENGER', id: passengerId });
    const refreshToken = await this.issueRefreshToken('PASSENGER', passengerId);
    return { accessToken, refreshToken, user: { id: passengerId, phone } };
  }

  // ---------- Sesión invitada (QR) ----------
  async createGuestSession(qrCode: string) {
    // El QR trae un código firmado; en desarrollo aceptamos cualquier código no vacío
    // y creamos una sesión invitada. La verificación de firma se agrega con el backend de Fase 4.
    if (!qrCode) throw new BadRequestException('Código QR requerido');
    const sessionToken = randomBytes(32).toString('hex');
    const hash = (await (async () => {
      const { createHash } = await import('node:crypto');
      return createHash('sha256').update(sessionToken).digest('hex');
    })());
    const { rows } = await this.pool.query(
      'INSERT INTO passengers (kind, guest_session_hash) VALUES (\'GUEST\', $1) RETURNING id',
      [hash],
    );
    const passengerId = rows[0].id;
    const accessToken = await this.jwt.signAccess({ kind: 'GUEST', id: passengerId });
    return { accessToken, guestSessionToken: sessionToken, user: { id: passengerId, kind: 'GUEST' } };
  }

  // ---------- Refresh rotativo ----------
  async refresh(refreshToken: string) {
    const { rows } = await this.pool.query(
      'SELECT id, subject_kind, subject_id, family, expires_at, revoked_at, replaced_by FROM auth_refresh_tokens WHERE token_hash = $1',
      [refreshToken],
    );
    const t = rows[0];
    if (!t || t.revoked_at || new Date(t.expires_at) < new Date()) {
      throw new UnauthorizedException('Refresh token inválido');
    }
    // Detectar reutilización: si ya fue reemplazado, revocar toda la familia.
    if (t.replaced_by) {
      await this.pool.query('UPDATE auth_refresh_tokens SET revoked_at = now() WHERE family = $1', [t.family]);
      throw new UnauthorizedException('Refresh token reutilizado');
    }
    const newToken = randomBytes(48).toString('hex');
    const newHash = (await (async () => {
      const { createHash } = await import('node:crypto');
      return createHash('sha256').update(newToken).digest('hex');
    })());
    await this.pool.query('UPDATE auth_refresh_tokens SET revoked_at = now(), replaced_by = NULL WHERE id = $1', [t.id]);
    // Insertar el nuevo token con replaced_by apuntando al anterior (para detección).
    const { rows: ins } = await this.pool.query(
      'INSERT INTO auth_refresh_tokens (token_hash, subject_kind, subject_id, family, expires_at) VALUES ($1, $2, $3, $4, now() + interval \'30 days\') RETURNING id',
      [newHash, t.subject_kind, t.subject_id, t.family],
    );
    await this.pool.query('UPDATE auth_refresh_tokens SET replaced_by = $1 WHERE id = $2', [ins[0].id, t.id]);
    const accessToken = await this.jwt.signAccess({ kind: t.subject_kind as 'PASSENGER' | 'DRIVER' | 'OPERATOR', id: t.subject_id });
    return { accessToken, refreshToken: newToken };
  }

  async logout(refreshToken: string) {
    await this.pool.query('UPDATE auth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [refreshToken]);
    return { ok: true };
  }

  private async issueRefreshToken(kind: string, subjectId: string): Promise<string> {
    const token = randomBytes(48).toString('hex');
    const hash = (await (async () => {
      const { createHash } = await import('node:crypto');
      return createHash('sha256').update(token).digest('hex');
    })());
    const family = (await (async () => {
      const { randomUUID } = await import('node:crypto');
      return randomUUID();
    })());
    await this.pool.query(
      'INSERT INTO auth_refresh_tokens (token_hash, subject_kind, subject_id, family, expires_at) VALUES ($1, $2, $3, $4, now() + interval \'30 days\')',
      [hash, kind, subjectId, family],
    );
    return token;
  }
}