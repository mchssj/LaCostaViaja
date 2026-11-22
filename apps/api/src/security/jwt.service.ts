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
  private readonly ttlSeconds: number;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = deriveKey(config.security.jwtSecret, 'jwt-access');
    this.ttlSeconds = config.security.accessTokenTtlSeconds;
  }

  get accessTtlSeconds(): number {
    return this.ttlSeconds;
  }

  signAccess(p: Principal): Promise<string> {
    return new SignJWT({ kind: p.kind, role: p.role, agencyId: p.agencyId ?? undefined })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(p.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
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
      };
    } catch {
      throw new DomainError('UNAUTHORIZED', 'Sesión inválida o vencida');
    }
  }
}
