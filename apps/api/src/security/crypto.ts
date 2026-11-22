import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
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

// ------------------------------------------------------------------ cifrado simétrico (secretos TOTP)
/** AES-256-GCM. Formato "v1.iv.tag.datos" en base64url. */
export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decryptSecret(key: Buffer, payload: string): string {
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Formato de secreto cifrado inválido');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

// ------------------------------------------------------------------ TOTP (RFC 6238 / RFC 4226)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Código de 6 dígitos para el paso de 30 s `counter` (HMAC-SHA1, como Google Authenticator). */
export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 1_000_000).padStart(6, '0');
}

/**
 * Verifica un código TOTP con ±1 paso de tolerancia (reloj del teléfono). Devuelve el paso usado
 * (para impedir reusar el mismo código) o null.
 */
export function verifyTotp(secretB32: string, code: string, nowMs = Date.now(), lastUsedStep: number | null = null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const step = Math.floor(nowMs / 30_000);
  for (const s of [step, step - 1, step + 1]) {
    if (lastUsedStep !== null && s <= lastUsedStep) continue;
    if (safeEqual(hotp(secret, s), code)) return s;
  }
  return null;
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}
