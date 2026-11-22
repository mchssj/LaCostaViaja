import { Body, Controller, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Allow, CurrentPrincipal, PASSENGERS, Public, type Principal } from '../../security/principal';
import { Idempotent } from '../../security/idempotency.interceptor';
import { PaymentsService } from './payments.service';

@ApiTags('pagos')
@Controller({ version: ['1', VERSION_NEUTRAL] })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** El chofer confirma el cobro en efectivo. El monto es el final del viaje (no se acepta del cliente). */
  @ApiBearerAuth()
  @Allow('DRIVER')
  @Post('trips/:id/payment/cash')
  @HttpCode(HttpStatus.OK)
  cash(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() _ignored: Record<string, unknown>) {
    return this.payments.confirmCash(principal, id);
  }

  @ApiBearerAuth()
  @Allow(...PASSENGERS, 'DRIVER')
  @Idempotent()
  @Post('trips/:id/payment/mercadopago')
  @HttpCode(HttpStatus.OK)
  mercadoPago(@CurrentPrincipal() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.createMercadoPago(principal, id);
  }

  /** Mercado Pago llama acá (sin sesión): la seguridad es la firma x-signature. */
  @Public()
  @Post('payments/mercadopago/webhook')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Query('data.id') queryDataId: string | undefined,
    @Query('type') queryType: string | undefined,
    @Headers('x-signature') xSignature: string | undefined,
    @Headers('x-request-id') xRequestId: string | undefined,
    @Body() body: { type?: string; data?: { id?: string | number } } | undefined,
  ) {
    return this.payments.handleMercadoPagoWebhook({
      dataId: queryDataId ?? (body?.data?.id !== undefined ? String(body.data.id) : undefined),
      type: queryType ?? body?.type,
      xSignature,
      xRequestId,
      rawBody: body,
    });
  }
}
