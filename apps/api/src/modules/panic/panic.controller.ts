import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsDefined, IsIn, IsNumber, IsObject, IsOptional, IsString, IsUUID, Length, Min, ValidateNested } from 'class-validator';
import { Allow, CurrentPrincipal, PASSENGERS, type Principal } from '../../security/principal';
import { RateLimit } from '../../security/rate-limit';
import { PointDto } from '../trips/trips.dto';
import { PanicService } from './panic.service';

class CreatePanicDto {
  @ApiProperty({ description: 'UUID generado en el dispositivo: los reintentos no duplican la alerta' }) @IsUUID() clientEventId!: string;
  @ApiProperty({ type: PointDto }) @IsDefined() @ValidateNested() @Type(() => PointDto) location!: PointDto;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) accuracyM?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tripId?: string;
  @ApiPropertyOptional({ enum: ['APP', 'PWA', 'SMS_FALLBACK', 'HARDWARE_BUTTON'] })
  @IsOptional()
  @IsIn(['APP', 'PWA', 'SMS_FALLBACK', 'HARDWARE_BUTTON'])
  channel?: 'APP' | 'PWA' | 'SMS_FALLBACK' | 'HARDWARE_BUTTON';
  @ApiPropertyOptional() @IsOptional() @IsDateString() occurredAt?: string;
  // Compatibilidad con los prototipos: se aceptan pero se IGNORAN (salen de la sesión y de la base).
  @IsOptional() @IsIn(['PASSENGER', 'DRIVER']) raisedBy?: string;
  @IsOptional() @IsObject() snapshot?: Record<string, unknown>;
  @IsOptional() @IsUUID() passengerId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsUUID() vehicleId?: string;
}

class ResolveDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) notes?: string;
  @ApiPropertyOptional({ description: 'Cierra como falsa alarma' }) @IsOptional() @IsBoolean() falseAlarm?: boolean;
}

@ApiTags('pánico y COM')
@ApiBearerAuth()
@Controller({ version: ['1', VERSION_NEUTRAL] })
export class PanicController {
  constructor(private readonly panic: PanicService) {}

  /** Cualquier sesión de pasajero (incluida la invitada) o de chofer. */
  @Allow(...PASSENGERS, 'DRIVER')
  @RateLimit({ name: 'panic', limit: 10, windowSeconds: 60, by: 'principal' })
  @Post('panic')
  @HttpCode(HttpStatus.OK)
  create(@CurrentPrincipal() p: Principal, @Body() body: CreatePanicDto) {
    return this.panic.create(p, {
      clientEventId: body.clientEventId,
      location: body.location,
      ...(body.accuracyM !== undefined ? { accuracyM: body.accuracyM } : {}),
      ...(body.tripId ? { tripId: body.tripId } : {}),
      ...(body.channel ? { channel: body.channel } : {}),
      ...(body.occurredAt ? { occurredAt: body.occurredAt } : {}),
    });
  }

  @Allow(...PASSENGERS, 'DRIVER')
  @RateLimit({ name: 'panic-location', limit: 60, windowSeconds: 60, by: 'principal' })
  @Post('panic/:id/location')
  @HttpCode(HttpStatus.OK)
  location(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: PointDto) {
    return this.panic.updateLocation(p, id, body);
  }

  @Allow('COM_OPERATOR', 'MUNICIPAL_ADMIN')
  @Get('com/alerts')
  list() {
    return this.panic.listOpen();
  }

  @Allow('COM_OPERATOR', 'MUNICIPAL_ADMIN')
  @Get('com/alerts/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.panic.get(id);
  }

  @Allow('COM_OPERATOR')
  @Post('com/alerts/:id/ack')
  @HttpCode(HttpStatus.OK)
  ack(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.panic.acknowledge(p, id);
  }

  @Allow('COM_OPERATOR')
  @Post('com/alerts/:id/units-dispatched')
  @HttpCode(HttpStatus.OK)
  units(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.panic.unitsDispatched(p, id);
  }

  @Allow('COM_OPERATOR')
  @Post('com/alerts/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ResolveDto) {
    return this.panic.resolve(p, id, body.notes, body.falseAlarm === true);
  }
}
