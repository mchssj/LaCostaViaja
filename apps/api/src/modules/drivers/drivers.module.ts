import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PresenceModule } from '../presence/presence.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { DriversController } from './drivers.controller';

@Module({
  imports: [PresenceModule, DispatchModule, RealtimeModule],
  controllers: [DriversController],
})
export class DriversModule {}
