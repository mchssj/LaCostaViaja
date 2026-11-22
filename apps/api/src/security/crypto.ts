import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

/** Hash de PIN / contraseña / código OTP con scrypt. Formato "salt:hash" (hex), compatible con los seeds. */
export async function hashSecret(value: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(value, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifySecret(value: string, stored: string | null | undefined): Promise<boolean> {
  const [salt, hash] = (stored ?? '').split(':');
  if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash)) {
    // Igual se calcula un hash: no revelar por tiempo de respuesta si el usuario existe.
    await scrypt(value, 'x'.repeat(32), 64);
    return false;
  }
  const actual = await scrypt(value, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

/** Clave derivada por propósito: un mismo secreto maestro no se reutiliza tal cual para dos firmas distintas. */
export const deriveKey = (master: string, purpose: string): Buffer => createHmac('sha256', master).update(`lacosta:${purpose}`).digest();

export const b64url = (buf: Buffer | string): string => Buffer.from(buf).toString('base64url');

export function hmacB64url(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const randomToken = (bytes = 48): string => randomBytes(bytes).toString('base64url');
