import { Module } from '@nestjs/common';
import { ClockModule } from './common/clock';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { FaresModule } from './modules/fares/fares.module';
import { FleetModule } from './modules/fleet/fleet.module';
import { HealthController } from './modules/health/health.controller';
import { PanicModule } from './modules/panic/panic.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PresenceModule } from './modules/presence/presence.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { TripEventsModule } from './modules/trip-events/trip-events.module';
import { TripsModule } from './modules/trips/trips.module';
import { VouchersModule } from './modules/vouchers/vouchers.module';
import { RedisModule } from './redis/redis.module';
import { SecurityModule } from './security/security.module';

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    DatabaseModule,
    RedisModule,
    SecurityModule,
    TripEventsModule,
    AuthModule,
    FaresModule,
    FleetModule,
    PresenceModule,
    TrackingModule,
    DispatchModule,
    RealtimeModule,
    TripsModule,
    DriversModule,
    PanicModule,
    VouchersModule,
    PaymentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
