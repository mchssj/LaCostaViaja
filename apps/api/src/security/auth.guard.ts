import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@lacosta/domain';
import { JwtService } from './jwt.service';
import { ALLOW_KEY, matchesAudience, PUBLIC_KEY, type Audience, type Principal } from './principal';

export function bearerToken(header: unknown): string | null {
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/**
 * Guard GLOBAL: todo endpoint exige sesión salvo @Public(). Si el endpoint declara @Allow(...),
 * además verifica el tipo de usuario / rol. Lo que no se declara queda cerrado por defecto.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true; // los gateways WebSocket autentican en el handshake
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown>; user?: Principal }>();
    const token = bearerToken(req.headers['authorization']);
    if (!token) throw new DomainError('UNAUTHORIZED', 'Falta el token de acceso');
    const principal = await this.jwt.verifyAccess(token);
    req.user = principal;

    const allowed = this.reflector.getAllAndOverride<Audience[] | undefined>(ALLOW_KEY, targets);
    if (allowed && !matchesAudience(principal, allowed)) {
      throw new DomainError('FORBIDDEN', 'No tenés permiso para esta operación', { required: allowed });
    }
    return true;
  }
}
