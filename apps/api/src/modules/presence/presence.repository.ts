import { Inject, Injectable } from '@nestjs/common';
import type { ServiceType } from '@lacosta/domain';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

export interface EligibilityRecord {
  readonly driverId: string;
  readonly vehicleId: string;
  readonly isEligible: boolean;
  readonly blockingReasons: readonly string[];
  readonly serviceType: ServiceType;
  readonly baseLocalityId: string;
  readonly acceptsInterurban: boolean;
}

interface EligibilityRow {
  driver_id: string;
  vehicle_id: string;
  is_eligible: boolean;
  blocking_reasons: string[];
  service_type: ServiceType;
  base_locality_id: string;
  accepts_interurban: boolean;
}

/** Consultas de habilitación (v_driver_vehicle_eligibility, calculada en hora argentina). */
@Injectable()
export class PresenceRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async eligibility(driverId: string, vehicleId: string): Promise<EligibilityRecord | null> {
    const { rows } = await this.pool.query<EligibilityRow>(
      `SELECT e.driver_id, e.vehicle_id, e.is_eligible, e.blocking_reasons, e.service_type,
              d.base_locality_id, d.accepts_interurban
       FROM v_driver_vehicle_eligibility e
       JOIN drivers d ON d.id = e.driver_id
       WHERE e.driver_id = $1 AND e.vehicle_id = $2
       ORDER BY e.is_eligible DESC, cardinality(e.blocking_reasons)
       LIMIT 1`,
      [driverId, vehicleId],
    );
    const r = rows[0];
    return r
      ? {
          driverId: r.driver_id,
          vehicleId: r.vehicle_id,
          isEligible: r.is_eligible,
          blockingReasons: r.blocking_reasons,
          serviceType: r.service_type,
          baseLocalityId: r.base_locality_id,
          acceptsInterurban: r.accepts_interurban,
        }
      : null;
  }

  /** Devuelve los driverId cuyo par chofer↔vehículo sigue habilitado hoy. */
  async eligibleDriverIds(pairs: ReadonlyArray<{ driverId: string; vehicleId: string }>): Promise<Set<string>> {
    if (pairs.length === 0) return new Set();
    const { rows } = await this.pool.query<{ driver_id: string }>(
      `SELECT DISTINCT e.driver_id
       FROM v_driver_vehicle_eligibility e
       JOIN unnest($1::uuid[], $2::uuid[]) AS p(driver_id, vehicle_id)
         ON p.driver_id = e.driver_id AND p.vehicle_id = e.vehicle_id
       WHERE e.is_eligible`,
      [pairs.map((p) => p.driverId), pairs.map((p) => p.vehicleId)],
    );
    return new Set(rows.map((r) => r.driver_id));
  }
}
