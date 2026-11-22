import { Inject, Injectable } from '@nestjs/common';
import { InvalidInputError, type FareQuote, type GeoPoint, type ServiceType } from '@lacosta/domain';
import { CLOCK, type Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { b64url, deriveKey, hmacB64url, safeEqual } from './crypto';

const VERSION = 'q1';
/** Tolerancia al comparar coordenadas (≈ 1 m). */
const COORD_EPSILON = 1e-5;

/**
 * Precio garantizado sin guardar cotizaciones: la cotización completa viaja firmada (HMAC) y
 * vuelve al crear el viaje. Nadie puede inventar un precio ni reusarla para otro recorrido.
 */
@Injectable()
export class QuoteTokenService {
  private readonly key: Buffer;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.key = deriveKey(config.security.jwtSecret, 'quote-token');
  }

  sign(quote: FareQuote): string {
    const payload = b64url(JSON.stringify(quote));
    return `${VERSION}.${payload}.${hmacB64url(this.key, `${VERSION}.${payload}`)}`;
  }

  /** Verifica firma, vigencia y que corresponda al recorrido y servicio pedidos. */
  verify(token: string, expected: { origin: GeoPoint; destination: GeoPoint; serviceType: ServiceType }): FareQuote {
    const [version, payload, signature] = token.split('.');
    if (version !== VERSION || !payload || !signature || !safeEqual(signature, hmacB64url(this.key, `${version}.${payload}`))) {
      throw new InvalidInputError('La cotización no es válida');
    }
    let quote: FareQuote;
    try {
      quote = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as FareQuote;
    } catch {
      throw new InvalidInputError('La cotización no es válida');
    }
    if (new Date(quote.validUntil).getTime() < this.clock.now().getTime()) {
      throw new InvalidInputError('La cotización venció: volvé a cotizar', { validUntil: quote.validUntil });
    }
    const same = (a: GeoPoint, b: GeoPoint): boolean => Math.abs(a.lat - b.lat) < COORD_EPSILON && Math.abs(a.lng - b.lng) < COORD_EPSILON;
    if (!same(quote.origin.point, expected.origin) || !same(quote.destination.point, expected.destination) || quote.serviceType !== expected.serviceType) {
      throw new InvalidInputError('La cotización corresponde a otro recorrido o servicio');
    }
    return quote;
  }
}
