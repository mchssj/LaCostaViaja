import { Body, Controller, Get, Param, Post, UseGuards, Req } from '@nestjs/common';
import { TripsService } from './trips.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('trips')
@UseGuards(JwtAuthGuard)
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Post()
  create(@Req() req: any, @Body() body: any) {
    return this.trips.createTrip({
      passengerId: req.user.id,
      channel: body.channel ?? 'PASSENGER_APP',
      serviceType: body.serviceType ?? 'TAXI',
      origin: body.origin,
      destination: body.destination,
      originAddress: body.originAddress,
      destinationAddress: body.destinationAddress,
      paymentMethod: body.paymentMethod ?? 'CASH',
      voucherCode: body.voucherCode,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.trips.getTrip(id);
  }

  @Post(':id/cancel')
  cancel(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.trips.cancelTrip(id, req.user.id, body?.reason);
  }

  @Post(':id/destination')
  changeDestination(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.trips.changeDestination(id, req.user.id, body.destination);
  }

  @Post(':id/rate')
  rate(@Req() req: any, @Param('id') id: string, @Body() body: any) {
    return this.trips.rateTrip(id, req.user.id, body.rating);
  }

  // ---- Chofer: ciclo del viaje ----
  @Post(':id/arrived')
  arrived(@Param('id') id: string) {
    return this.trips.driverArrived(id);
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.trips.startTrip(id);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() body: any) {
    return this.trips.completeTrip(id, body?.meteredFareCents);
  }
}