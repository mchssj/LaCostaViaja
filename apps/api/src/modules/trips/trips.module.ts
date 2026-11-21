import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller';
import { PassengerGateway } from './passenger.gateway';
import { TripsService } from './trips.service';
import { DispatchModule } from '../dispatch/dispatch.module';
import { FaresModule } from '../fares/fares.module';

@Module({
  imports: [DispatchModule, FaresModule],
  controllers: [TripsController],
  providers: [TripsService, PassengerGateway],
  exports: [TripsService, PassengerGateway],
})
export class TripsModule {}