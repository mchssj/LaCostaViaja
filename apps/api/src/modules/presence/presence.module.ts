import { Module } from '@nestjs/common';
import { DriverPresenceService } from './driver-presence.service';
import { GeoIndexService } from './geo-index.service';
import { PresenceRepository } from './presence.repository';

@Module({
  providers: [GeoIndexService, PresenceRepository, DriverPresenceService],
  exports: [GeoIndexService, DriverPresenceService],
})
export class PresenceModule {}
