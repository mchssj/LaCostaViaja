import { Module } from '@nestjs/common';
import { DriversController } from './drivers.controller';
import { PresenceModule } from '../presence/presence.module';
import { DispatchModule } from '../dispatch/dispatch.module';

@Module({
  imports: [PresenceModule, DispatchModule],
  controllers: [DriversController],
})
export class DriversModule {}