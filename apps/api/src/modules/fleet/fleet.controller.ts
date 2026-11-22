import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Allow, CurrentPrincipal, OPERATORS, type Principal } from '../../security/principal';
import { FleetService } from './fleet.service';

/** Flota habilitada: solo operadores (COM, municipio, agencia con su propio alcance). */
@ApiTags('flota')
@ApiBearerAuth()
@Allow(...OPERATORS)
@Controller({ version: ['1', VERSION_NEUTRAL] })
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get('agencies')
  agencies(@CurrentPrincipal() p: Principal) {
    return this.fleet.listAgencies(p);
  }

  @Get('drivers')
  drivers(@CurrentPrincipal() p: Principal) {
    return this.fleet.listDrivers(p);
  }

  @Get('vehicles')
  vehicles(@CurrentPrincipal() p: Principal) {
    return this.fleet.listVehicles(p);
  }

  @Get('driver-vehicle-eligibility')
  eligibility(@CurrentPrincipal() p: Principal) {
    return this.fleet.listEligibility(p);
  }
}
