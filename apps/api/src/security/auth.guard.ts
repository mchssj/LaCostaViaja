import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError, hasPermission, type Permission } from '@lacosta/domain';
import { JwtService } from './jwt.service';
import { OperatorStateService, setupPending } from './operator-state.service';
import { ALLOW_KEY, matchesAudience, PERMISSION_KEY, PUBLIC_KEY, SETUP_KEY, type Audience, type Principal } from './principal';

export function bearerToken(header: unknown): string | null {
  return typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() || null : null;
}

/**
 * Guard GLOBAL: todo endpoint exige sesión salvo @Public(). Luego:
 *  1. Operadores: rol y agencia se toman de la base (no del token), y se rechazan los tokens de
 *     usuarios inactivos o emitidos antes de una revocación.
 *  2. Sesión con configuración pendiente (contraseña temporal / 2FA obligatorio): solo endpoints
 *     @AllowDuringSetup.
 *  3. @Allow(...) por tipo de usuario / rol y @RequirePermission(...) para operadores.
 * Lo que no se declara queda cerrado por defecto.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly operators: OperatorStateService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true; // los gateways WebSocket autentican en el handshake
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown>; user?: Principal }>();
    const token = bearerToken(req.headers['authorization']);
    if (!token) throw new DomainError('UNAUTHORIZED', 'Falta el token de acceso');
    let principal = await this.jwt.verifyAccess(token);

    if (principal.kind === 'OPERATOR') {
      const state = await this.operators.get(principal.id);
      if (!state || !state.isActive) throw new DomainError('UNAUTHORIZED', 'Usuario inactivo');
      if (state.sessionsRevokedAt && (principal.issuedAtMs ?? 0) < state.sessionsRevokedAt) {
        throw new DomainError('UNAUTHORIZED', 'La sesión fue cerrada por un cambio en tu cuenta. Volvé a ingresar.');
      }
      const pending = setupPending(state);
      principal = { ...principal, role: state.role, agencyId: state.agencyId, scope: pending.length ? 'setup' : 'full' };
      if (pending.length && !this.reflector.getAllAndOverride<boolean>(SETUP_KEY, targets)) {
        throw new DomainError('FORBIDDEN', 'Completá la configuración de tu cuenta para continuar', { setupRequired: pending });
      }
    }
    req.user = principal;

    const allowed = this.reflector.getAllAndOverride<Audience[] | undefined>(ALLOW_KEY, targets);
    if (allowed && !matchesAudience(principal, allowed)) {
      throw new DomainError('FORBIDDEN', 'No tenés permiso para esta operación', { required: allowed });
    }
    const permissions = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSION_KEY, targets);
    if (permissions?.length && principal.kind === 'OPERATOR') {
      const missing = permissions.filter((p) => !hasPermission(principal.role, p));
      if (missing.length) throw new DomainError('FORBIDDEN', 'Tu rol no tiene permiso para esta operación', { requiredPermissions: missing });
    }
    return true;
  }
}
