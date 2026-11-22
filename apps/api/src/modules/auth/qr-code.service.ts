import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@lacosta/domain';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { b64url, deriveKey, hmacB64url, safeEqual } from '../../security/crypto';

const PREFIX = 'LCQR1';

export interface QrPayload {
  /** Dónde está pegado el QR (parada, hotel, acceso de playa). */
  readonly label: string;
  readonly zoneCode: string | null;
  readonly issuedAt: string;
}

/**
 * Códigos QR del Modo Invitado. Se imprimen y pegan en paradas y hoteles, así que van firmados con
 * QR_SECRET: un código inventado no abre sesión. ALLOW_UNSIGNED_QR solo para desarrollo.
 */
@Injectable()
export class QrCodeService {
  private readonly logger = new Logger(QrCodeService.name);
  private readonly key: Buffer;
  private readonly allowUnsigned: boolean;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = deriveKey(config.security.qrSecret, 'guest-qr');
    this.allowUnsigned = config.security.allowUnsignedQr;
    if (this.allowUnsigned) this.logger.warn('ALLOW_UNSIGNED_QR=true: se aceptan QR sin firma (solo desarrollo)');
  }

  issue(label: string, zoneCode: string | null): string {
    const payload = b64url(JSON.stringify({ label, zoneCode, issuedAt: new Date().toISOString() } satisfies QrPayload));
    return `${PREFIX}.${payload}.${hmacB64url(this.key, payload)}`;
  }

  verify(code: string): QrPayload {
    const [prefix, payload, signature] = code.split('.');
    if (prefix === PREFIX && payload && signature && safeEqual(signature, hmacB64url(this.key, payload))) {
      try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as QrPayload;
      } catch {
        // cae al rechazo de abajo
      }
    }
    if (this.allowUnsigned && code.trim().length > 0) {
      return { label: `sin-firma:${code.slice(0, 40)}`, zoneCode: null, issuedAt: new Date().toISOString() };
    }
    throw new DomainError('UNAUTHORIZED', 'Código QR inválido');
  }
}
