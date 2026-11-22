import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import { OPERATOR_ROLES, type OperatorRole, type Permission } from '@lacosta/domain';

export type { OperatorRole, Permission };
export type PrincipalKind = 'PASSENGER' | 'GUEST' | 'DRIVER' | 'OPERATOR';

/**
 * Sesión de operador con configuración pendiente (contraseña temporal o segundo factor obligatorio
 * sin activar): solo puede usar los endpoints marcados con @AllowDuringSetup.
 */
export type SessionScope = 'full' | 'setup';

/** Quién hace el pedido (sale del JWT y, para operadores, de la base; nunca del cuerpo del pedido). */
export interface Principal {
  readonly kind: PrincipalKind;
  readonly id: string;
  readonly role?: OperatorRole;
  /** Solo AGENCY_OPERATOR: la agencia a la que pertenece. */
  readonly agencyId?: string | null;
  readonly scope?: SessionScope;
  /** epoch ms de emisión del token (para revocar sesiones anteriores a un cambio). */
  readonly issuedAtMs?: number;
}

/** Los cuatro tipos de usuario del sistema; los operadores se distinguen por rol. */
export type Audience = 'PASSENGER' | 'GUEST' | 'DRIVER' | OperatorRole;

export const PUBLIC_KEY = 'lc:public';
export const ALLOW_KEY = 'lc:allow';
export const PERMISSION_KEY = 'lc:permission';
export const SETUP_KEY = 'lc:setup';

/** Endpoint sin sesión (cotizar, login, webhook, health). Todo lo demás exige JWT por defecto. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

/** Restringe el endpoint a estos tipos de usuario / roles. */
export const Allow = (...audiences: Audience[]): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_KEY, audiences);

/**
 * Permisos que un OPERADOR necesita (todos). No afecta a pasajeros ni choferes: para ellos rige
 * @Allow y las verificaciones de pertenencia del servicio.
 */
export const RequirePermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator => SetMetadata(PERMISSION_KEY, permissions);

/** Usable con la sesión en modo "configuración pendiente" (cambiar contraseña, activar 2FA, /auth/me). */
export const AllowDuringSetup = (): MethodDecorator & ClassDecorator => SetMetadata(SETUP_KEY, true);

export const PASSENGERS: Audience[] = ['PASSENGER', 'GUEST'];
export const OPERATORS: Audience[] = [...OPERATOR_ROLES];

export function matchesAudience(p: Principal, audiences: readonly Audience[]): boolean {
  return audiences.some((a) => (p.kind === 'OPERATOR' ? a === p.role : a === p.kind));
}

/** Rol del actor en trip_events / idempotencia (enum actor_role de la base). */
export function actorRole(p: Principal): 'PASSENGER' | 'DRIVER' | 'OPERATOR' {
  return p.kind === 'GUEST' ? 'PASSENGER' : p.kind;
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal => {
  const req = ctx.switchToHttp().getRequest<{ user?: Principal }>();
  if (!req.user) throw new Error('CurrentPrincipal usado en un endpoint público');
  return req.user;
});

/** IP y user agent del pedido, para la auditoría. */
export interface RequestMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export const ReqMeta = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest<{ ip?: string; headers: Record<string, unknown> }>();
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null };
});
