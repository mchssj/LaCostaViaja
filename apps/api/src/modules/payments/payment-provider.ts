import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@lacosta/domain';
import { createHmac, randomUUID } from 'node:crypto';
import { safeEqual } from '../../security/crypto';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CheckoutRequest {
  /** Nuestro id de pago: vuelve como external_reference (lo único que se usa para conciliar). */
  readonly paymentId: string;
  readonly tripId: string;
  readonly amountCents: number;
  readonly description: string;
  readonly notificationUrl: string;
}

export interface CheckoutResult {
  readonly preferenceId: string;
  /** Link de pago; el QR se dibuja con este mismo link. */
  readonly link: string;
}

export type ProviderPaymentStatus = 'approved' | 'pending' | 'in_process' | 'authorized' | 'rejected' | 'cancelled' | 'refunded' | 'charged_back';

export interface ProviderPayment {
  readonly providerPaymentId: string;
  readonly status: ProviderPaymentStatus | string;
  readonly externalReference: string | null;
  readonly amountCents: number;
}

/** Proveedor de cobros online (Mercado Pago; reemplazable). */
export interface IPaymentProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Estado real del pago consultado al proveedor (nunca se confía en el cuerpo del webhook). */
  getPayment(providerPaymentId: string): Promise<ProviderPayment>;
}

/**
 * Firma de webhooks de Mercado Pago: header x-signature "ts=…,v1=…" y x-request-id.
 * Manifiesto: "id:<data.id>;request-id:<x-request-id>;ts:<ts>;" con HMAC-SHA256 y la clave secreta.
 */
export function verifyMercadoPagoSignature(p: {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string | undefined;
  secret: string;
}): boolean {
  if (!p.xSignature) return false;
  const parts = Object.fromEntries(
    p.xSignature.split(',').map((kv) => {
      const [k, ...v] = kv.split('=');
      return [k?.trim() ?? '', v.join('=').trim()];
    }),
  );
  const ts = parts['ts'];
  const v1 = parts['v1'];
  if (!ts || !v1) return false;
  const id = p.dataId && /^[a-z0-9]+$/i.test(p.dataId) ? p.dataId.toLowerCase() : p.dataId;
  let manifest = '';
  if (id) manifest += `id:${id};`;
  if (p.xRequestId) manifest += `request-id:${p.xRequestId};`;
  manifest += `ts:${ts};`;
  const expected = createHmac('sha256', p.secret).update(manifest).digest('hex');
  return safeEqual(expected, v1);
}

/** Genera una firma válida (para tests y para el simulador de desarrollo). */
export function signMercadoPagoWebhook(p: { dataId: string; xRequestId: string; ts: number; secret: string }): string {
  const id = /^[a-z0-9]+$/i.test(p.dataId) ? p.dataId.toLowerCase() : p.dataId;
  const v1 = createHmac('sha256', p.secret).update(`id:${id};request-id:${p.xRequestId};ts:${p.ts};`).digest('hex');
  return `ts=${p.ts},v1=${v1}`;
}

const MP_API = 'https://api.mercadopago.com';

@Injectable()
export class MercadoPagoProvider implements IPaymentProvider {
  readonly name = 'mercadopago';

  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const res = await this.call('/checkout/preferences', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': req.paymentId },
      body: JSON.stringify({
        items: [{ id: req.tripId, title: req.description, quantity: 1, unit_price: req.amountCents / 100, currency_id: 'ARS' }],
        external_reference: req.paymentId,
        notification_url: req.notificationUrl,
        binary_mode: true,
      }),
    });
    const body = (await res.json()) as { id?: string; init_point?: string };
    if (!body.id || !body.init_point) throw new DomainError('PAYMENT_ERROR', 'Mercado Pago no devolvió el link de pago');
    return { preferenceId: body.id, link: body.init_point };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const res = await this.call(`/v1/payments/${encodeURIComponent(providerPaymentId)}`, { method: 'GET' });
    const body = (await res.json()) as { id?: number | string; status?: string; external_reference?: string | null; transaction_amount?: number };
    return {
      providerPaymentId: String(body.id ?? providerPaymentId),
      status: body.status ?? 'unknown',
      externalReference: body.external_reference ?? null,
      amountCents: Math.round((body.transaction_amount ?? 0) * 100),
    };
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${MP_API}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      throw new DomainError('PAYMENT_ERROR', `Mercado Pago no respondió: ${(err as Error).message}`);
    }
    if (!res.ok) throw new DomainError('PAYMENT_ERROR', `Mercado Pago respondió HTTP ${res.status}`, { path });
    return res;
  }
}

/**
 * Proveedor simulado (desarrollo y tests). Mismo contrato que Mercado Pago: el pago se "aprueba"
 * con simulateApproval() y el webhook se firma con signMercadoPagoWebhook().
 */
@Injectable()
export class FakePaymentProvider implements IPaymentProvider {
  readonly name = 'fake';
  private readonly logger = new Logger(FakePaymentProvider.name);
  private readonly payments = new Map<string, ProviderPayment>();

  constructor() {
    this.logger.warn('PAYMENTS_PROVIDER=fake: los cobros online son simulados');
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const preferenceId = `fake-pref-${randomUUID()}`;
    return { preferenceId, link: `https://pagos.invalid/checkout/${preferenceId}` };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const p = this.payments.get(providerPaymentId);
    if (!p) throw new DomainError('PAYMENT_ERROR', 'Pago inexistente en el proveedor simulado');
    return p;
  }

  /** Simula que el pasajero pagó: devuelve el id de pago que va a informar el webhook. */
  simulatePayment(externalReference: string, amountCents: number, status: ProviderPaymentStatus = 'approved'): string {
    const providerPaymentId = String(Date.now()) + String(Math.floor(Math.random() * 1000));
    this.payments.set(providerPaymentId, { providerPaymentId, status, externalReference, amountCents });
    return providerPaymentId;
  }
}
