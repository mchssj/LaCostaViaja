import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';

export type PrincipalKind = 'PASSENGER' | 'GUEST' | 'DRIVER' | 'OPERATOR';
export type OperatorRole = 'COM_OPERATOR' | 'AGENCY_OPERATOR' | 'MUNICIPAL_ADMIN';

/** Quién hace el pedido (sale del JWT; nunca del cuerpo del pedido). */
export interface Principal {
  readonly kind: PrincipalKind;
  readonly id: string;
  readonly role?: OperatorRole;
  /** Solo AGENCY_OPERATOR: la agencia a la que pertenece. */
  readonly agencyId?: string | null;
}

/** Los cuatro tipos de usuario del sistema; los operadores se distinguen por rol. */
export type Audience = 'PASSENGER' | 'GUEST' | 'DRIVER' | OperatorRole;

export const PUBLIC_KEY = 'lc:public';
export const ALLOW_KEY = 'lc:allow';

/** Endpoint sin sesión (cotizar, login, webhook, health). Todo lo demás exige JWT por defecto. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

/** Restringe el endpoint a estos tipos de usuario / roles. */
export const Allow = (...audiences: Audience[]): MethodDecorator & ClassDecorator => SetMetadata(ALLOW_KEY, audiences);

export const PASSENGERS: Audience[] = ['PASSENGER', 'GUEST'];
export const OPERATORS: Audience[] = ['COM_OPERATOR', 'AGENCY_OPERATOR', 'MUNICIPAL_ADMIN'];

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
