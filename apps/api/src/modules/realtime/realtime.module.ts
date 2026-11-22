import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { PresenceModule } from '../presence/presence.module';
import { ComGateway } from './com.gateway';
import { DriverGateway } from './driver.gateway';
import { PassengerGateway } from './passenger.gateway';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [DispatchModule, PresenceModule],
  providers: [RealtimeService, DriverGateway, PassengerGateway, ComGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
