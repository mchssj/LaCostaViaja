import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module';
import { RoutingModule } from '../routing/routing.module';
import { TariffsModule } from '../tariffs/tariffs.module';
import { FareCalculatorService } from './fare-calculator.service';
import { FaresController } from './fares.controller';

@Module({
  imports: [GeoModule, RoutingModule, TariffsModule],
  controllers: [FaresController],
  providers: [FareCalculatorService],
  exports: [FareCalculatorService],
})
export class FaresModule {}
