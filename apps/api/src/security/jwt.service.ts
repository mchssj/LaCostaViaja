import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@lacosta/domain';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { deriveKey } from './crypto';
import type { OperatorRole, Principal, PrincipalKind } from './principal';

const ISSUER = 'la-costa-viaja';
const KINDS: readonly PrincipalKind[] = ['PASSENGER', 'GUEST', 'DRIVER', 'OPERATOR'];

/** JWT de acceso (HS256, vida corta). El secreto es obligatorio (ver app-config). */
@Injectable()
export class JwtService {
  private readonly key: Uint8Array;
  private readonly mfaKey: Uint8Array;
  private readonly ttlSeconds: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = deriveKey(config.security.jwtSecret, 'jwt-access');
    this.mfaKey = deriveKey(config.security.jwtSecret, 'jwt-mfa-challenge');
    this.ttlSeconds = config.security.accessTokenTtlSeconds;
  }

  get accessTtlSeconds(): number {
    return this.ttlSeconds;
  }

  signAccess(p: Principal): Promise<string> {
    // iatMs: emisión en milisegundos. `iat` del estándar es en segundos y no alcanza para distinguir
    // un token emitido justo antes de una revocación de uno emitido justo después.
    return new SignJWT({ kind: p.kind, role: p.role, agencyId: p.agencyId ?? undefined, iatMs: Date.now() })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(p.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }

  /**
   * Comprobante de "contraseña correcta, falta el segundo factor" (5 min). Clave distinta de la del
   * acceso: no sirve como token de sesión.
   */
  signMfaChallenge(operatorId: string): Promise<string> {
    return new SignJWT({ purpose: 'mfa' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(operatorId)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.mfaKey);
  }

  async verifyMfaChallenge(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.mfaKey, { issuer: ISSUER, algorithms: ['HS256'] });
      if (payload['purpose'] !== 'mfa' || !payload.sub) throw new Error('purpose');
      return payload.sub;
    } catch {
      throw new DomainError('UNAUTHORIZED', 'El paso de verificación venció. Ingresá de nuevo.');
    }
  }

  async verifyAccess(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, algorithms: ['HS256'] });
      const kind = payload['kind'] as PrincipalKind;
      if (!payload.sub || !KINDS.includes(kind)) throw new Error('claims');
      if (kind === 'OPERATOR' && !payload['role']) throw new Error('role');
      return {
        kind,
        id: payload.sub,
        role: payload['role'] as OperatorRole | undefined,
        agencyId: (payload['agencyId'] as string | undefined) ?? null,
        ...(typeof payload['iatMs'] === 'number' ? { issuedAtMs: payload['iatMs'] } : payload.iat !== undefined ? { issuedAtMs: payload.iat * 1000 } : {}),
      };
    } catch {
      throw new DomainError('UNAUTHORIZED', 'Sesión inválida o vencida');
    }
  }
}
