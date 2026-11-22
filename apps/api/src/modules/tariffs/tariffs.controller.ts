import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../../database/database.module';
import type { Pool } from 'pg';

@Controller()
@UseGuards(JwtAuthGuard)
export class TariffsController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('tariff-schedules')
  async schedules() {
    const { rows } = await this.pool.query('SELECT * FROM tariff_schedules ORDER BY created_at DESC');
    return rows;
  }

  @Get('tariff-rules')
  async rules(@Query('scheduleId') scheduleId?: string) {
    const q = scheduleId
      ? 'SELECT * FROM tariff_rules WHERE schedule_id = $1 ORDER BY service_type, scope, season, time_band'
      : 'SELECT * FROM tariff_rules ORDER BY service_type, scope, season, time_band';
    const { rows } = await this.pool.query(q, scheduleId ? [scheduleId] : []);
    return rows;
  }

  @Get('season-periods')
  async seasons() {
    const { rows } = await this.pool.query('SELECT * FROM season_periods ORDER BY name');
    return rows;
  }
}