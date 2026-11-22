import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { RealtimeModule } from '../realtime/realtime.module';
import { FakePaymentProvider, MercadoPagoProvider, PAYMENT_PROVIDER, type IPaymentProvider } from './payment-provider';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [RealtimeModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: ({ payments }: AppConfig): IPaymentProvider =>
        payments.provider === 'mercadopago' && payments.mpAccessToken ? new MercadoPagoProvider(payments.mpAccessToken) : new FakePaymentProvider(),
    },
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
