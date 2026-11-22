import { Controller, Get, Inject, ParseUUIDPipe, Query, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { Allow, OPERATORS, RequirePermission } from '../../security/principal';

/** Lectura del cuadro tarifario para el panel (la edición está en el módulo admin). */
@ApiTags('tarifas')
@ApiBearerAuth()
@Allow(...OPERATORS)
@RequirePermission('tariffs.view')
@Controller({ version: ['1', VERSION_NEUTRAL] })
export class TariffsController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('tariff-schedules')
  async schedules() {
    const { rows } = await this.pool.query(
      `SELECT id, code, legal_instrument, status, lower(validity) AS valid_from, upper(validity) AS valid_to, timezone,
              to_char(night_starts_at, 'HH24:MI') AS night_starts_at, to_char(night_ends_at, 'HH24:MI') AS night_ends_at,
              interurban_min_outside_m, rounding_step_cents, quote_ttl_seconds, approved_by, approved_at
       FROM tariff_schedules ORDER BY lower(validity) DESC`,
    );
    return rows;
  }

  @Get('tariff-rules')
  async rules(@Query('scheduleId', new ParseUUIDPipe({ optional: true })) scheduleId?: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM tariff_rules WHERE ($1::uuid IS NULL OR schedule_id = $1) ORDER BY service_type, scope, season, time_band`,
      [scheduleId ?? null],
    );
    return rows;
  }

  @Get('season-periods')
  async seasons() {
    const { rows } = await this.pool.query(
      `SELECT id, name, season, to_char(lower(period), 'YYYY-MM-DD') AS starts_on, to_char(upper(period), 'YYYY-MM-DD') AS ends_on_exclusive
       FROM season_periods ORDER BY lower(period)`,
    );
    return rows;
  }
}
