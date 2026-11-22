import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import type { Principal } from '../../security/principal';

/**
 * Consultas de flota para el panel. Columnas explícitas (nunca pin_hash) y alcance por rol:
 * un operador de agencia solo ve su agencia.
 */
@Injectable()
export class FleetService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** null = sin filtro (COM y municipio); id = solo esa agencia. */
  private agencyScope(p: Principal): string | null {
    return p.role === 'AGENCY_OPERATOR' ? (p.agencyId ?? '00000000-0000-0000-0000-000000000000') : null;
  }

  async listAgencies(p: Principal) {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.cuit, a.legal_name, a.trade_name, a.locality_id, l.name AS locality_name, a.address, a.phone,
              a.municipal_permit_number, a.permit_expires_on, a.status
       FROM agencies a JOIN localities l ON l.id = a.locality_id
       WHERE ($1::uuid IS NULL OR a.id = $1) ORDER BY a.trade_name`,
      [this.agencyScope(p)],
    );
    return rows;
  }

  async listDrivers(p: Principal) {
    const { rows } = await this.pool.query(
      `SELECT d.id, d.agency_id, a.trade_name AS agency_name, d.base_locality_id, l.name AS base_locality_name,
              d.dni, d.first_name, d.last_name, d.phone, d.professional_license_class, d.professional_license_expires_on,
              d.municipal_driver_permit_number, d.municipal_driver_permit_expires_on, d.criminal_record_expires_on,
              d.status, d.suspension_reason, d.suspended_until, d.accepts_interurban,
              (d.pin_hash IS NOT NULL) AS has_pin, (d.pin_locked_until > now()) AS pin_locked
       FROM drivers d
       LEFT JOIN agencies a ON a.id = d.agency_id
       LEFT JOIN localities l ON l.id = d.base_locality_id
       WHERE ($1::uuid IS NULL OR d.agency_id = $1)
       ORDER BY d.last_name, d.first_name`,
      [this.agencyScope(p)],
    );
    return rows;
  }

  async listVehicles(p: Principal) {
    const { rows } = await this.pool.query(
      `SELECT v.id, v.agency_id, a.trade_name AS agency_name, v.service_type, v.plate, v.make, v.model, v.model_year, v.color,
              v.passenger_seats, v.wheelchair_accessible, v.municipal_vehicle_permit_number, v.municipal_vehicle_permit_expires_on,
              v.vtv_expires_on, v.insurer_name, v.passenger_insurance_expires_on, v.status
       FROM vehicles v LEFT JOIN agencies a ON a.id = v.agency_id
       WHERE ($1::uuid IS NULL OR v.agency_id = $1)
       ORDER BY v.plate`,
      [this.agencyScope(p)],
    );
    return rows;
  }

  async listEligibility(p: Principal) {
    const { rows } = await this.pool.query(
      `SELECT compliance_id, driver_id, vehicle_id, role, service_type, vehicle_agency_id, is_eligible, blocking_reasons, next_expiry_on
       FROM v_driver_vehicle_eligibility
       WHERE ($1::uuid IS NULL OR vehicle_agency_id = $1)
       ORDER BY is_eligible, next_expiry_on`,
      [this.agencyScope(p)],
    );
    return rows;
  }
}
