import { randomInt } from 'node:crypto';
import { InvalidInputError } from '@lacosta/domain';

const COMMON = ['123456789012', 'contraseña123', 'password1234', 'lacostaviaja', 'municipio123', 'qwertyuiop12'];

/** Política de contraseñas de operadores: 12+ caracteres, no contiene el usuario, no trivial. */
export function assertPasswordPolicy(password: string, username: string): void {
  const problems: string[] = [];
  if (password.length < 12) problems.push('tener al menos 12 caracteres');
  if (password.length > 128) problems.push('tener como máximo 128 caracteres');
  if (username && password.toLowerCase().includes(username.toLowerCase())) problems.push('no contener el nombre de usuario');
  if (new Set(password).size < 5) problems.push('no repetir siempre los mismos caracteres');
  if (COMMON.some((c) => password.toLowerCase().includes(c))) problems.push('no ser una contraseña común');
  if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(password) || !/\d/.test(password)) problems.push('combinar letras y números');
  if (problems.length) throw new InvalidInputError(`La contraseña debe ${problems.join(', ')}.`, { field: 'password' });
}

// Sin caracteres ambiguos (0/O, 1/l/I) para que se pueda dictar o copiar a mano.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Contraseña temporal de 14 caracteres con letras y números (se muestra una sola vez). */
export function temporaryPassword(): string {
  let out = '';
  while (!/\d/.test(out) || !/[a-z]/i.test(out)) {
    out = Array.from({ length: 14 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  }
  return out;
}

/** Códigos de recuperación del segundo factor: 10 × "xxxx-xxxx". */
export function recoveryCodes(n = 10): string[] {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join('');
  return Array.from({ length: n }, () => `${part()}-${part()}`);
}

/** PIN temporal de chofer (6 dígitos). */
export function temporaryPin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
