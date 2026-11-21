import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

export type JwtSubject = { kind: 'PASSENGER' | 'DRIVER' | 'OPERATOR' | 'GUEST'; id: string; role?: string };

@Injectable()
export class JwtService {
  private readonly secret: Uint8Array;
  private readonly issuer = 'la-costa-viaja';
  private readonly accessTtl = '15m';

  constructor() {
    const raw = process.env['JWT_SECRET'] ?? 'dev-secret-change-me';
    this.secret = new TextEncoder().encode(raw);
  }

  async signAccess(subject: JwtSubject): Promise<string> {
    return new SignJWT({ kind: subject.kind, role: subject.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(subject.id)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(this.accessTtl)
      .sign(this.secret);
  }

  async verifyAccess(token: string): Promise<JwtSubject> {
    const { payload } = await jwtVerify(token, this.secret, { issuer: this.issuer });
    return { kind: payload.kind as JwtSubject['kind'], id: payload.sub as string, role: payload.role as string | undefined };
  }
}