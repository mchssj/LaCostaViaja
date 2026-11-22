import { Controller, Get, UseGuards } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get('agencies')
  agencies() { return this.fleet.listAgencies(); }

  @Get('drivers')
  drivers() { return this.fleet.listDrivers(); }

  @Get('vehicles')
  vehicles() { return this.fleet.listVehicles(); }

  @Get('driver-vehicle-eligibility')
  eligibility() { return this.fleet.listEligibility(); }
}