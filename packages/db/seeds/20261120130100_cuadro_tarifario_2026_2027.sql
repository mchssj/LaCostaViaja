-- =============================================================================
-- SEED · Cuadro tarifario 2026/2027 y calendario de temporada
-- =============================================================================
-- ⚠ VALORES ILUSTRATIVOS (ARS, 2026-11). Reemplazar por los del acto administrativo vigente.
--
-- Base LOW/DAY por servicio y alcance; el resto se deriva con coeficientes y queda guardado
-- explícito (como se publica en el boletín oficial):
--   NIGHT x1.20 · HIGH x1.10 · HIGH+NIGHT x1.32
-- Bandera y mínima redondeadas a $10; ficha a $1.
-- Interurbano RP11: ficha cada 170 m (vs 150 m urbano) + Retorno Interurbano = 40% de las
-- fichas recorridas fuera de la localidad de origen, bonificable si el chofer termina en su base.

WITH schedule AS (
  INSERT INTO tariff_schedules (
    code, legal_instrument, status, validity, timezone,
    night_starts_at, night_ends_at, interurban_min_outside_m, rounding_step_cents, quote_ttl_seconds,
    approved_by, approved_at
  ) VALUES (
    'CT-2026-2027',
    'EJEMPLO DE DESARROLLO · reemplazar por Ordenanza/Decreto vigente del Partido de La Costa',
    'APPROVED',
    tstzrange('2026-11-01 00:00:00-03', '2027-11-01 00:00:00-03', '[)'),
    'America/Argentina/Buenos_Aires',
    '22:00', '06:00', 800, 1000, 600,
    'seed', now()
  )
  RETURNING id
),
base (service_type, scope, flag_fall, unit_value, distance_unit_m, time_unit_s, ref_speed, minimum_fare, return_coef, waives) AS (
  VALUES
    ('TAXI'::service_type,  'URBAN'::trip_scope,      220000, 22000, 150, 60, 20.0, 350000, 0.0000, false),
    ('TAXI'::service_type,  'INTERURBAN'::trip_scope, 220000, 22000, 170, 60, 30.0, 350000, 0.4000, true),
    ('REMIS'::service_type, 'URBAN'::trip_scope,      250000, 24000, 150, 60, 20.0, 400000, 0.0000, false),
    ('REMIS'::service_type, 'INTERURBAN'::trip_scope, 250000, 24000, 170, 60, 30.0, 400000, 0.4000, true)
),
factors (season, time_band, factor) AS (
  VALUES
    ('LOW'::season_kind,  'DAY'::time_band,   1.00),
    ('LOW'::season_kind,  'NIGHT'::time_band, 1.20),
    ('HIGH'::season_kind, 'DAY'::time_band,   1.10),
    ('HIGH'::season_kind, 'NIGHT'::time_band, 1.32)
)
INSERT INTO tariff_rules (
  schedule_id, service_type, scope, season, time_band,
  flag_fall_cents, unit_value_cents, distance_unit_m, time_unit_s, reference_speed_kmh,
  minimum_fare_cents, return_coefficient, backhaul_waives_return
)
SELECT s.id, b.service_type, b.scope, f.season, f.time_band,
       (round(b.flag_fall * f.factor / 1000) * 1000)::int,
       (round(b.unit_value * f.factor / 100) * 100)::int,
       b.distance_unit_m, b.time_unit_s, b.ref_speed,
       (round(b.minimum_fare * f.factor / 1000) * 1000)::int,
       b.return_coef, b.waives
FROM schedule s CROSS JOIN base b CROSS JOIN factors f;

-- Calendario de temporada alta (fechas locales, rango [desde, hasta)).
-- ⚠ Verificar contra el calendario oficial (feriados trasladables y receso invernal PBA).
INSERT INTO season_periods (name, season, period) VALUES
  ('Temporada de verano 2026/2027',         'HIGH', daterange('2026-12-15', '2027-03-15', '[)')),
  ('Semana Santa 2027',                     'HIGH', daterange('2027-03-25', '2027-03-29', '[)')),
  ('Vacaciones de invierno PBA 2027 (est.)', 'HIGH', daterange('2027-07-19', '2027-08-01', '[)'));
