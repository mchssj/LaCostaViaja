import { Module } from '@nestjs/common';
import { ClockModule } from './common/clock';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { AuthModule } from './modules/auth/auth.module';
import { FaresModule } from './modules/fares/fares.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { HealthController } from './modules/health/health.controller';
import { PresenceModule } from './modules/presence/presence.module';
import { PanicModule } from './modules/panic/panic.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { VouchersModule } from './modules/vouchers/vouchers.module';
import { TripsModule } from './modules/trips/trips.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [AppConfigModule, ClockModule, DatabaseModule, RedisModule, AuthModule, FaresModule, FleetModule, PresenceModule, TrackingModule, DispatchModule, TripsModule, DriversModule, PanicModule, VouchersModule, PaymentsModule],
  controllers: [HealthController],
})
export class AppModule {}
