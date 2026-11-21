import { Body, Controller, Delete, Get, Param, Post, UseGuards, Req } from '@nestjs/common';
import { DriverPresenceService } from '../presence/driver-presence.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../../database/database.module';
import type { Pool } from 'pg';

@Controller()
@UseGuards(JwtAuthGuard)
export class DriversController {
  constructor(
    private readonly presence: DriverPresenceService,
    private readonly dispatch: DispatchService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  @Post('drivers/me/shift')
  async startShift(@Req() req: any, @Body() body: { vehicleId: string }) {
    const state = await this.presence.startShift(req.user.id, body.vehicleId);
    return { status: state.status, vehicleId: state.vehicleId };
  }

  @Delete('drivers/me/shift')
  async endShift(@Req() req: any) {
    await this.presence.endShift(req.user.id);
    return { ok: true };
  }

  @Post('drivers/me/positions')
  async positions(@Req() req: any, @Body() body: { pings: any[] }) {
    const summary = await this.presence.ingest(req.user.id, body.pings ?? []);
    return summary;
  }

  @Get('drivers/me/offer')
  async currentOffer(@Req() req: any) {
    const { rows } = await this.pool.query(
      `SELECT o.id AS offer_id, o.trip_id, o.round, o.rank, o.score_seconds, o.eta_seconds, o.expires_at,
              t.public_code, t.origin, t.destination, t.service_type, t.quoted_fare_cents, t.scope
       FROM trip_offers o JOIN trips t ON t.id = o.trip_id
       WHERE o.driver_id = $1 AND o.outcome = 'PENDING' AND o.expires_at > now()
       ORDER BY o.offered_at DESC LIMIT 1`,
      [req.user.id],
    );
    return rows[0] ?? null;
  }

  @Post('offers/:id/accept')
  async accept(@Req() req: any, @Param('id') offerId: string, @Body() body: { tripId: string }) {
    const result = await this.dispatch.accept(body.tripId, req.user.id, offerId);
    return result;
  }

  @Post('offers/:id/reject')
  async reject(@Req() req: any, @Param('id') offerId: string, @Body() body: { tripId: string }) {
    const outcome = await this.dispatch.reject(body.tripId, req.user.id, offerId);
    return outcome;
  }
}
