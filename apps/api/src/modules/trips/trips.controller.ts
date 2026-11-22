import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Idempotent } from '../../security/idempotency.interceptor';
import { Allow, CurrentPrincipal, OPERATORS, PASSENGERS, RequirePermission, type Principal } from '../../security/principal';
import { RateLimit } from '../../security/rate-limit';
import { CancelTripDto, ChangeDestinationDto, CreateTripDto, RateTripDto, TripActionDto } from './trips.dto';
import { TripsService } from './trips.service';

@ApiTags('viajes')
@ApiBearerAuth()
@Controller({ path: 'trips', version: ['1', VERSION_NEUTRAL] })
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Allow(...PASSENGERS)
  @Idempotent()
  @RateLimit({ name: 'trip-create', limit: 10, windowSeconds: 600, by: 'principal' })
  @Post()
  create(@CurrentPrincipal() p: Principal, @Body() body: CreateTripDto) {
    return this.trips.create(p, {
      origin: body.origin,
      destination: body.destination,
      serviceType: body.serviceType ?? 'TAXI',
      paymentMethod: body.paymentMethod ?? 'CASH',
      ...(body.voucherCode ? { voucherCode: body.voucherCode } : {}),
      ...(body.quoteToken ? { quoteToken: body.quoteToken } : {}),
      ...(body.originAddress ? { originAddress: body.originAddress } : {}),
      ...(body.destinationAddress ? { destinationAddress: body.destinationAddress } : {}),
    });
  }

  @Allow(...PASSENGERS, 'DRIVER')
  @Get('mine')
  mine(@CurrentPrincipal() p: Principal) {
    return this.trips.listMine(p);
  }

  @Allow(...PASSENGERS, 'DRIVER', ...OPERATORS)
  @RequirePermission('trips.view')
  @Get(':id')
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.get(p, id);
  }

  /** Eventos posteriores a afterSeq: alternativa REST al WebSocket (mala señal, polling). */
  @Allow(...PASSENGERS, 'DRIVER', ...OPERATORS)
  @RequirePermission('trips.view')
  @Get(':id/events')
  events(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Query('afterSeq') afterSeq?: string) {
    const n = Number(afterSeq ?? 0);
    return this.trips.events(p, id, Number.isSafeInteger(n) && n >= 0 ? n : 0);
  }

  @Allow('DRIVER')
  @Post(':id/arrived')
  @HttpCode(HttpStatus.OK)
  arrived(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: TripActionDto) {
    return this.trips.arrived(p, id, this.options(body));
  }

  @Allow('DRIVER')
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: TripActionDto) {
    return this.trips.start(p, id, this.options(body));
  }

  @Allow('DRIVER')
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: TripActionDto) {
    return this.trips.complete(p, id, this.options(body));
  }

  /** Pasajero: cancela. Chofer: devuelve el viaje (antes de llegar) o cierra por "no se presentó". Operador: cancela. */
  @Allow(...PASSENGERS, 'DRIVER', ...OPERATORS)
  @RequirePermission('trips.cancel')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: CancelTripDto) {
    return this.trips.cancel(p, id, { ...this.options(body), ...(body.reason ? { reason: body.reason } : {}), noShow: body.noShow === true });
  }

  @Allow(...PASSENGERS)
  @Post(':id/destination')
  @HttpCode(HttpStatus.OK)
  changeDestination(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ChangeDestinationDto) {
    return this.trips.changeDestination(p, id, {
      destination: body.destination,
      ...(body.destinationAddress ? { destinationAddress: body.destinationAddress } : {}),
      ...(body.quoteToken ? { quoteToken: body.quoteToken } : {}),
    });
  }

  @Allow(...PASSENGERS)
  @Post(':id/rate')
  @HttpCode(HttpStatus.OK)
  rate(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: RateTripDto) {
    return this.trips.rate(p, id, body.rating);
  }

  private options(body: TripActionDto) {
    return {
      ...(body.clientEventId ? { clientEventId: body.clientEventId } : {}),
      ...(body.location ? { location: body.location } : {}),
    };
  }
}
