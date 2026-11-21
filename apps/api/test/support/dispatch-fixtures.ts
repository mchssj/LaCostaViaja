import type { GeoPoint, ServiceType } from '@lacosta/domain';
import type { Pool } from 'pg';
import type { FareCalculatorService } from '../../src/modules/fares/fare-calculator.service';

/**
 * Flota y viajes TEMPORALES para tests de integración y simulación, en la base real.
 * Todo lleva la marca TEST-<tag>- y se borra con cleanupTestData().
 */

export interface TestDriver {
  readonly id: string;
  readonly vehicleId: string;
  readonly dni: string;
  readonly index: number;
}

const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** CUIL "20" + DNI con su dígito verificador; null si el DNI no admite prefijo 20 (dv = 10). */
export function cuil20(dni: string): string | null {
  const base = `20${dni.padStart(8, '0')}`;
  const sum = [...base].reduce((acc, d, i) => acc + Number(d) * WEIGHTS[i]!, 0);
  let dv = 11 - (sum % 11);
  if (dv === 11) dv = 0;
  return dv === 10 ? null : `${base}${dv}`;
}

export function randomTag(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 2 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
}

let dniCursor = 40_000_000 + Math.floor(Math.random() * 5_000_000);

/** Crea N choferes de taxi independientes habilitados, cada uno con su vehículo y autorización. */
export async function createTestFleet(
  pool: Pool,
  opts: { tag: string; count: number; baseLocalityCode: string; acceptsInterurban?: boolean; serviceType?: ServiceType },
): Promise<TestDriver[]> {
  const { rows: loc } = await pool.query<{ id: string }>('SELECT id FROM localities WHERE code = $1', [opts.baseLocalityCode]);
  if (!loc[0]) throw new Error(`Localidad ${opts.baseLocalityCode} inexistente`);
  const items: Array<{ dni: string; cuil: string; i: number; seq: number }> = [];
  while (items.length < opts.count) {
    const dni = String(dniCursor++);
    const cuil = cuil20(dni);
    if (cuil) items.push({ dni, cuil, i: items.length, seq: dniCursor });
  }
  const tag = opts.tag;
  const key = (kind: string, it: { seq: number }): string => `TEST-${tag}-${kind}-${it.seq}`;
  const plate = (it: { seq: number }): string => {
    const n = it.seq % 1_000_000;
    const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    return `${tag}${String(n % 1000).padStart(3, '0')}${letters[Math.floor(n / 1000) % letters.length]}${letters[Math.floor(n / 23_000) % letters.length]}`;
  };

  await pool.query(
    `INSERT INTO drivers (agency_id, base_locality_id, dni, cuil, first_name, last_name, phone,
                          professional_license_number, professional_license_class, professional_license_expires_on,
                          municipal_driver_permit_number, municipal_driver_permit_expires_on, criminal_record_expires_on,
                          status, accepts_interurban)
     SELECT NULL, $1, u.dni, u.cuil, 'Test', 'Chofer ' || u.n, u.phone,
            'LP-' || u.dni, 'D1', ar_today() + 365, u.permit, ar_today() + 365, ar_today() + 180, 'ACTIVE', $7
     FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS u(dni, cuil, n, phone, permit)`,
    [
      loc[0].id,
      items.map((it) => it.dni),
      items.map((it) => it.cuil),
      items.map((it) => String(it.i)),
      items.map((it) => `+5492257${String(it.seq % 1_000_000).padStart(6, '0')}`),
      items.map((it) => key('CH', it)),
      opts.acceptsInterurban ?? true,
    ],
  );

  await pool.query(
    `INSERT INTO vehicles (agency_id, service_type, plate, make, model, model_year, color, passenger_seats,
                           owner_name, owner_cuit, municipal_vehicle_permit_number, municipal_vehicle_permit_expires_on,
                           vtv_expires_on, insurer_name, insurance_policy_number, passenger_insurance_expires_on, status)
     SELECT NULL, $1::service_type, u.plate, 'Test', 'Sedán', 2022, 'Blanco', 4, 'Test', u.cuil, u.permit, ar_today() + 365,
            ar_today() + 365, 'Aseguradora Test', 'POL-' || u.plate, ar_today() + 365, 'ACTIVE'
     FROM unnest($2::text[], $3::text[], $4::text[]) AS u(plate, cuil, permit)`,
    [opts.serviceType ?? 'TAXI', items.map(plate), items.map((it) => it.cuil), items.map((it) => key('TX', it))],
  );

  const { rows } = await pool.query<{ driver_id: string; vehicle_id: string; dni: string }>(
    `WITH pairs AS (
       SELECT d.id AS driver_id, v.id AS vehicle_id, d.dni, u.auth
       FROM unnest($1::text[], $2::text[], $3::text[]) AS u(dni, plate, auth)
       JOIN drivers d ON d.dni = u.dni
       JOIN vehicles v ON v.plate = u.plate
     ), ins AS (
       INSERT INTO driver_vehicle_compliance (driver_id, vehicle_id, role, authorization_number, validity, status, verified_by, verified_at)
       SELECT driver_id, vehicle_id, 'OWNER_DRIVER', auth, daterange(ar_today() - 1, ar_today() + 365, '[)'), 'ACTIVE', 'test', now()
       FROM pairs
     )
     SELECT driver_id, vehicle_id, dni FROM pairs`,
    [items.map((it) => it.dni), items.map(plate), items.map((it) => key('DISP', it))],
  );
  const byDni = new Map(rows.map((r) => [r.dni, r]));
  return items.map((it) => {
    const r = byDni.get(it.dni);
    if (!r) throw new Error(`No se creó el chofer ${it.dni}`);
    return { id: r.driver_id, vehicleId: r.vehicle_id, dni: it.dni, index: it.i };
  });
}

/** Crea un viaje REQUESTED con su cotización real (motor tarifario + PostGIS). */
export async function createTestTrip(
  pool: Pool,
  fares: FareCalculatorService,
  opts: { tag: string; origin: GeoPoint; destination: GeoPoint; serviceType?: ServiceType },
): Promise<{ tripId: string; quotedFareCents: number; scope: string }> {
  const serviceType = opts.serviceType ?? 'TAXI';
  const q = await fares.quote({ origin: opts.origin, destination: opts.destination, serviceType });
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO trips (passenger_id, channel, service_type, status, origin, origin_address, destination,
                        origin_locality_id, destination_locality_id, scope, crossed_boundaries, backhaul_eligible,
                        tariff_rule_id, pricing_instant, quoted_fare_cents, fare_breakdown, payment_method)
     VALUES ((SELECT id FROM passengers ORDER BY created_at LIMIT 1), 'PASSENGER_APP', $1::service_type, 'REQUESTED',
             ST_SetSRID(ST_MakePoint($2, $3), 4326), $4, ST_SetSRID(ST_MakePoint($5, $6), 4326),
             $7, $8, $9::trip_scope, $10, $11, $12, $13, $14, $15::jsonb, 'CASH')
     RETURNING id`,
    [
      serviceType,
      opts.origin.lng,
      opts.origin.lat,
      `TEST-${opts.tag}`,
      opts.destination.lng,
      opts.destination.lat,
      q.origin.locality.id,
      q.destination.locality.id,
      q.scope,
      q.corridor.crossedBoundaries,
      q.backhaul.eligible,
      q.tariff.ruleId,
      q.pricingInstant,
      q.totalCents,
      JSON.stringify(q),
    ],
  );
  return { tripId: rows[0]!.id, quotedFareCents: q.totalCents, scope: q.scope };
}

/** Cierra lo que haya quedado abierto de un tag (para no dejar viajes "activos" entre tests). */
export async function closeOpenTestTrips(pool: Pool, tag: string): Promise<void> {
  await pool.query(
    `UPDATE trips SET status = 'CANCELLED_BY_OPERATOR', cancelled_at = now(), cancellation_reason = 'fin de test'
     WHERE origin_address = $1 AND status IN ('REQUESTED', 'SEARCHING')`,
    [`TEST-${tag}`],
  );
  await pool.query(
    `UPDATE trips SET status = 'COMPLETED', started_at = COALESCE(started_at, now()), completed_at = now(),
                      final_fare_cents = quoted_fare_cents
     WHERE origin_address = $1 AND status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')`,
    [`TEST-${tag}`],
  );
}

export async function cleanupTestData(pool: Pool, tag: string): Promise<void> {
  const like = `TEST-${tag}-%`;
  await pool.query(`DELETE FROM trips WHERE origin_address = $1`, [`TEST-${tag}`]); // cascada: trip_offers, trip_track_points
  await pool.query(`DELETE FROM driver_vehicle_compliance WHERE authorization_number LIKE $1`, [like]);
  await pool.query(`DELETE FROM vehicles WHERE municipal_vehicle_permit_number LIKE $1`, [like]);
  await pool.query(`DELETE FROM drivers WHERE municipal_driver_permit_number LIKE $1`, [like]);
}

/** Desplaza un punto N metros al norte/este (aprox. local). */
export function offset(p: GeoPoint, northMeters: number, eastMeters: number): GeoPoint {
  return {
    lat: p.lat + northMeters / 110_974,
    lng: p.lng + eastMeters / (111_320 * Math.cos((p.lat * Math.PI) / 180)),
  };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
