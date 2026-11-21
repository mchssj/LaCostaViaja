import { Body, Controller, Param, Post, UseGuards, Req } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('trips/:id/payment/mercadopago')
  @UseGuards(JwtAuthGuard)
  createMp(@Param('id') id: string, @Body() body: any) {
    // tripId viene del path; amount del body o del viaje.
    return this.payments.createMercadoPago(id, body?.amountCents ?? 0);
  }

  // Webhook: sin guard (Mercado Pago llama directamente).
  @Post('payments/mercadopago/webhook')
  webhook(@Body() body: any, @Req() req: any) {
    const sig = req.headers?.['x-signature'] as string | undefined;
    return this.payments.webhook(body, sig);
  }
}