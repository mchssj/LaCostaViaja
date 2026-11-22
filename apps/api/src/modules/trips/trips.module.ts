import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { FaresModule } from '../fares/fares.module';
import { PaymentsModule } from '../payments/payments.module';
import { PresenceModule } from '../presence/presence.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TariffsModule } from '../tariffs/tariffs.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripsWorkers } from './trips.workers';

@Module({
  imports: [DispatchModule, FaresModule, TariffsModule, PresenceModule, RealtimeModule, PaymentsModule, VouchersModule],
  controllers: [TripsController],
  providers: [TripsService, TripsWorkers],
  exports: [TripsService],
})
export class TripsModule {}
