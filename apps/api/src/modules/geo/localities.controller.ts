import { Controller, Get } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../../database/database.module';
import { Public } from '../../security/principal';
import type { Pool } from 'pg';

@Controller()
export class LocalitiesController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Público: la PWA invitada necesita listar localidades sin token.
  @Public()
  @Get('localities')
  async list() {
    const { rows } = await this.pool.query(`
      SELECT code, name, corridor_order,
             ST_Y(ST_Centroid(geom)) AS lat,
             ST_X(ST_Centroid(geom)) AS lng
      FROM localities
      WHERE is_active = true
      ORDER BY corridor_order
    `);
    return rows;
  }
}
