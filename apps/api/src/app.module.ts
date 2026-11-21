import { Module } from '@nestjs/common';
import { ClockModule } from './common/clock';
import { AppConfigModule } from './config/app-config.module';
import { DatabaseModule } from './database/database.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { FaresModule } from './modules/fares/fares.module';
import { HealthController } from './modules/health/health.controller';
import { PresenceModule } from './modules/presence/presence.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [AppConfigModule, ClockModule, DatabaseModule, RedisModule, FaresModule, PresenceModule, TrackingModule, DispatchModule],
  controllers: [HealthController],
})
export class AppModule {}
