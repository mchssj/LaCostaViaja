import { Body, Controller, Get, Param, Post, UseGuards, Req } from '@nestjs/common';
import { PanicService } from './panic.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
export class PanicController {
  constructor(private readonly panic: PanicService) {}

  @Post('panic')
  create(@Req() req: any, @Body() body: any) {
    return this.panic.create({
      clientEventId: body.clientEventId,
      tripId: body.tripId,
      raisedBy: body.raisedBy ?? 'PASSENGER',
      passengerId: body.passengerId ?? req.user?.id,
      driverId: body.driverId,
      vehicleId: body.vehicleId,
      location: body.location,
      accuracyM: body.accuracyM,
      channel: body.channel ?? 'APP',
      snapshot: body.snapshot ?? {},
      occurredAt: body.occurredAt ?? new Date().toISOString(),
    });
  }

  @Get('com/alerts')
  @UseGuards(JwtAuthGuard)
  list() {
    return this.panic.listOpen();
  }

  @Post('com/alerts/:id/ack')
  @UseGuards(JwtAuthGuard)
  ack(@Req() req: any, @Param('id') id: string) {
    return this.panic.ack(id, req.user?.id ?? 'operator');
  }

  @Post('com/alerts/:id/units-dispatched')
  @UseGuards(JwtAuthGuard)
  units(@Param('id') id: string) {
    return this.panic.unitsDispatched(id);
  }

  @Post('com/alerts/:id/resolve')
  @UseGuards(JwtAuthGuard)
  resolve(@Param('id') id: string, @Body() body: any) {
    return this.panic.resolve(id, body?.notes);
  }
}