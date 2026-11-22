import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../../database/database.module';
import type { Pool } from 'pg';

@Injectable()
export class FleetService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async listAgencies() {
    const { rows } = await this.pool.query('SELECT * FROM agencies ORDER BY trade_name');
    return rows;
  }

  async listDrivers() {
    const { rows } = await this.pool.query(`
      SELECT d.*, a.trade_name AS agency_name, l.name AS base_locality_name
      FROM drivers d
      LEFT JOIN agencies a ON a.id = d.agency_id
      LEFT JOIN localities l ON l.id = d.base_locality_id
      ORDER BY d.last_name, d.first_name
    `);
    return rows;
  }

  async listVehicles() {
    const { rows } = await this.pool.query(`
      SELECT v.*, a.trade_name AS agency_name
      FROM vehicles v
      LEFT JOIN agencies a ON a.id = v.agency_id
      ORDER BY v.plate
    `);
    return rows;
  }

  async listEligibility() {
    const { rows } = await this.pool.query('SELECT * FROM v_driver_vehicle_eligibility ORDER BY driver_id, vehicle_id');
    return rows;
  }
}
