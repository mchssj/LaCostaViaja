import { Module } from '@nestjs/common';
import { FaresModule } from '../fares/fares.module';
import { PresenceModule } from '../presence/presence.module';
import { RoutingModule } from '../routing/routing.module';
import { TrackingModule } from '../tracking/tracking.module';
import { DispatchEvents } from './dispatch.events';
import { DispatchRepository } from './dispatch.repository';
import { DispatchService } from './dispatch.service';
import { DispatchWorkers } from './dispatch.workers';

@Module({
  imports: [PresenceModule, FaresModule, RoutingModule, TrackingModule],
  providers: [DispatchRepository, DispatchEvents, DispatchService, DispatchWorkers],
  exports: [DispatchService, DispatchEvents],
})
export class DispatchModule {}
