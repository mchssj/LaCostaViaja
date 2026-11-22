import type { Socket } from 'socket.io';
import { bearerToken } from '../../security/auth.guard';
import type { JwtService } from '../../security/jwt.service';
import { matchesAudience, type Audience, type Principal } from '../../security/principal';

/** Autentica el handshake (auth.token o header Authorization). Si no corresponde, desconecta. */
export async function authenticateSocket(client: Socket, jwt: JwtService, audiences: readonly Audience[]): Promise<Principal | null> {
  const token =
    (typeof client.handshake.auth?.['token'] === 'string' ? (client.handshake.auth['token'] as string) : null) ??
    bearerToken(client.handshake.headers.authorization);
  try {
    if (!token) throw new Error('sin token');
    const principal = await jwt.verifyAccess(token);
    if (!matchesAudience(principal, audiences)) throw new Error('rol');
    client.data['principal'] = principal;
    return principal;
  } catch {
    client.emit('error', { error: 'UNAUTHORIZED', message: 'Sesión inválida para este canal' });
    client.disconnect(true);
    return null;
  }
}

export const socketPrincipal = (client: Socket): Principal | null => (client.data['principal'] as Principal | undefined) ?? null;

export const afterSeqOf = (value: unknown): number => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};
