import { Global, Module } from '@nestjs/common';
import { TripEventsRepository } from './trip-events.repository';

/** Bitácora de eventos del viaje (trip_events): la usan el despacho, el ciclo de vida y los WebSockets. */
@Global()
@Module({
  providers: [TripEventsRepository],
  exports: [TripEventsRepository],
})
export class TripEventsModule {}
