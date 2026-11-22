import { NotFoundError } from '@lacosta/domain';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsNumber, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { Allow, CurrentPrincipal, type Principal } from '../../security/principal';
import { DispatchService } from '../dispatch/dispatch.service';
import { DriverPresenceService, MAX_PINGS_PER_BATCH } from '../presence/driver-presence.service';
import { RealtimeService } from '../realtime/realtime.service';
import { OfferResponseDto } from '../trips/trips.dto';

class StartShiftDto {
  @ApiProperty() @IsUUID() vehicleId!: string;
}

class PingDto {
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) lat!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) lng!: number;
  @ApiProperty({ description: 'epoch ms del dispositivo' }) @IsNumber() recordedAt!: number;
  @IsOptional() @IsNumber() @Min(0) speedKmh?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(360) headingDeg?: number;
  @IsOptional() @IsNumber() @Min(0) accuracyM?: number;
}

class PositionsDto {
  @ApiProperty({ type: [PingDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PINGS_PER_BATCH)
  @ValidateNested({ each: true })
  @Type(() => PingDto)
  pings!: PingDto[];
}

/** Turno, posiciones y ofertas del chofer (sobre los servicios de la Fase 2). */
@ApiTags('chofer')
@ApiBearerAuth()
@Allow('DRIVER')
@Controller({ version: ['1', VERSION_NEUTRAL] })
export class DriversController {
  constructor(
    private readonly presence: DriverPresenceService,
    private readonly dispatch: DispatchService,
    private readonly realtime: RealtimeService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  /** Datos del chofer para el encabezado de la app (sin PIN ni datos de terceros). */
  @Get('drivers/me')
  async me(@CurrentPrincipal() p: Principal) {
    const { rows } = await this.pool.query(
      `SELECT d.id, d.first_name, d.last_name, d.phone, d.status, d.suspension_reason, d.suspended_until,
              d.accepts_interurban, a.trade_name AS agency_name, l.name AS base_locality_name,
              d.municipal_driver_permit_number,
              to_char(d.municipal_driver_permit_expires_on, 'YYYY-MM-DD') AS municipal_driver_permit_expires_on,
              d.professional_license_class,
              to_char(d.professional_license_expires_on, 'YYYY-MM-DD') AS professional_license_expires_on,
              to_char(d.criminal_record_expires_on, 'YYYY-MM-DD') AS criminal_record_expires_on
       FROM drivers d
       LEFT JOIN agencies a ON a.id = d.agency_id
       LEFT JOIN localities l ON l.id = d.base_locality_id
       WHERE d.id = $1`,
      [p.id],
    );
    if (!rows[0]) throw new NotFoundError('Chofer inexistente', { id: p.id });
    return rows[0];
  }

  /**
   * Vehículos con los que el chofer tiene autorización, elegibles o no. Los bloqueados vienen con el
   * motivo (habilitación vencida, VTV, seguro…) para que la app lo explique en vez de fallar al iniciar turno.
   */
  @Get('drivers/me/vehicles')
  async myVehicles(@CurrentPrincipal() p: Principal) {
    const { rows } = await this.pool.query(
      `SELECT e.vehicle_id, v.plate, v.make, v.model, v.model_year, v.color, v.passenger_seats, v.wheelchair_accessible,
              e.service_type, e.role, e.is_eligible, e.blocking_reasons,
              to_char(e.next_expiry_on, 'YYYY-MM-DD') AS next_expiry_on, a.trade_name AS agency_name
       FROM v_driver_vehicle_eligibility e
       JOIN vehicles v ON v.id = e.vehicle_id
       LEFT JOIN agencies a ON a.id = v.agency_id
       WHERE e.driver_id = $1
       ORDER BY e.is_eligible DESC, v.plate`,
      [p.id],
    );
    return rows;
  }

  @Post('drivers/me/shift')
  async startShift(@CurrentPrincipal() p: Principal, @Body() body: StartShiftDto) {
    const state = await this.presence.startShift(p.id, body.vehicleId);
    return { status: state.status, vehicleId: state.vehicleId, serviceType: state.serviceType };
  }

  @Delete('drivers/me/shift')
  async endShift(@CurrentPrincipal() p: Principal) {
    await this.presence.endShift(p.id);
    return { ok: true };
  }

  @Get('drivers/me/state')
  async state(@CurrentPrincipal() p: Principal) {
    const s = await this.presence.getState(p.id);
    return s
      ? { status: s.status, vehicleId: s.vehicleId, tripId: s.tripId, position: s.position, returnToLocalityId: s.returnToLocalityId }
      : { status: 'OFFLINE' };
  }

  @Post('drivers/me/positions')
  @HttpCode(HttpStatus.OK)
  async positions(@CurrentPrincipal() p: Principal, @Body() body: PositionsDto) {
    const summary = await this.presence.ingest(p.id, body.pings);
    await this.realtime.driverPositionUpdated(p.id).catch(() => undefined);
    return summary;
  }

  /** Oferta vigente (para la app al reconectar o si no usa WebSocket). */
  @Get('drivers/me/offer')
  async currentOffer(@CurrentPrincipal() p: Principal) {
    const { rows } = await this.pool.query(
      `SELECT o.id AS offer_id, o.trip_id, o.round, o.rank, o.eta_seconds, o.expires_at, o.backhaul_match,
              t.public_code, t.service_type, t.scope, t.quoted_fare_cents,
              ST_Y(t.origin) AS origin_lat, ST_X(t.origin) AS origin_lng, t.origin_address,
              ST_Y(t.destination) AS destination_lat, ST_X(t.destination) AS destination_lng, t.destination_address
       FROM trip_offers o JOIN trips t ON t.id = o.trip_id
       WHERE o.driver_id = $1 AND o.outcome = 'PENDING' AND o.expires_at > now()
       ORDER BY o.offered_at DESC LIMIT 1`,
      [p.id],
    );
    return rows[0] ?? null;
  }

  @Post('offers/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) offerId: string, @Body() body: OfferResponseDto) {
    return this.dispatch.accept(body.tripId, p.id, offerId);
  }

  @Post('offers/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) offerId: string, @Body() body: OfferResponseDto) {
    return this.dispatch.reject(body.tripId, p.id, offerId);
  }
}
