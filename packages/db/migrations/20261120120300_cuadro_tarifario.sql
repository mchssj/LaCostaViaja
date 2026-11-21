-- =============================================================================
-- Cuadro tarifario regulado
-- =============================================================================
-- tariff_schedules: el cuadro aprobado por acto administrativo, con vigencia (sin solapamientos
--                   entre cuadros APPROVED), franja nocturna, umbral interurbano y redondeo.
-- tariff_rules:     valores por (servicio, alcance urbano/interurbano, temporada, franja).
--                   Valores explícitos por combinación, como se publican en las ordenanzas.
-- season_periods:   calendario de temporada alta (verano, Semana Santa, fines de semana largos...).

CREATE TABLE tariff_schedules (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                     text NOT NULL UNIQUE,
  legal_instrument         text NOT NULL,        -- ordenanza / decreto que lo aprueba
  status                   tariff_schedule_status NOT NULL DEFAULT 'DRAFT',
  validity                 tstzrange NOT NULL,
  timezone                 text NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
  night_starts_at          time NOT NULL DEFAULT '22:00',
  night_ends_at            time NOT NULL DEFAULT '06:00',
  -- Metros mínimos recorridos fuera de la localidad de origen para considerar el viaje INTERURBANO
  -- (evita cobrar retorno por cruzar el límite por dos cuadras).
  interurban_min_outside_m integer NOT NULL DEFAULT 800,
  rounding_step_cents      integer NOT NULL DEFAULT 1000,  -- $10
  quote_ttl_seconds        integer NOT NULL DEFAULT 600,
  approved_by              text,
  approved_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tariff_schedules_validity_shape CHECK (
    NOT isempty(validity) AND NOT lower_inf(validity) AND lower_inc(validity) AND NOT upper_inc(validity)
  ),
  CONSTRAINT tariff_schedules_night_window CHECK (night_starts_at <> night_ends_at),
  CONSTRAINT tariff_schedules_threshold CHECK (interurban_min_outside_m BETWEEN 0 AND 20000),
  CONSTRAINT tariff_schedules_rounding CHECK (rounding_step_cents BETWEEN 1 AND 100000),
  CONSTRAINT tariff_schedules_ttl CHECK (quote_ttl_seconds BETWEEN 60 AND 3600),
  CONSTRAINT tariff_schedules_timezone CHECK (timezone ~ '^[A-Za-z_]+(/[A-Za-z_]+)*$'),
  CONSTRAINT tariff_schedules_approval CHECK (status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT tariff_schedules_no_overlap EXCLUDE USING gist (validity WITH &&) WHERE (status = 'APPROVED')
);
CREATE TRIGGER tariff_schedules_updated_at BEFORE UPDATE ON tariff_schedules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tariff_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id            uuid NOT NULL REFERENCES tariff_schedules (id) ON DELETE CASCADE,
  service_type           service_type NOT NULL,
  scope                  trip_scope NOT NULL,
  season                 season_kind NOT NULL,
  time_band              time_band NOT NULL,
  flag_fall_cents        integer NOT NULL CHECK (flag_fall_cents > 0),       -- bajada de bandera
  unit_value_cents       integer NOT NULL CHECK (unit_value_cents > 0),      -- valor de la ficha
  distance_unit_m        integer NOT NULL CHECK (distance_unit_m > 0),       -- metros por ficha
  time_unit_s            integer NOT NULL CHECK (time_unit_s > 0),           -- segundos de espera por ficha
  reference_speed_kmh    numeric(5, 2) NOT NULL CHECK (reference_speed_kmh > 0), -- debajo de esta velocidad corre tiempo
  minimum_fare_cents     integer NOT NULL,
  return_coefficient     numeric(5, 4) NOT NULL DEFAULT 0 CHECK (return_coefficient BETWEEN 0 AND 1),
  backhaul_waives_return boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tariff_rules_unique_key UNIQUE (schedule_id, service_type, scope, season, time_band),
  CONSTRAINT tariff_rules_minimum CHECK (minimum_fare_cents >= flag_fall_cents),
  CONSTRAINT tariff_rules_return_only_interurban CHECK (scope = 'INTERURBAN' OR (return_coefficient = 0 AND NOT backhaul_waives_return))
);
CREATE INDEX tariff_rules_schedule_idx ON tariff_rules (schedule_id);

CREATE TABLE season_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  season     season_kind NOT NULL DEFAULT 'HIGH',
  period     daterange NOT NULL,     -- [desde, hasta) en fecha local argentina
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT season_periods_shape CHECK (NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period))
);
CREATE INDEX season_periods_period_gix ON season_periods USING gist (period);

-- Temporada vigente para una fecha local: HIGH prevalece sobre LOW; sin período ⇒ LOW.
CREATE OR REPLACE FUNCTION season_for(p_local_date date) RETURNS season_kind
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT sp.season FROM season_periods sp WHERE sp.period @> p_local_date ORDER BY sp.season DESC LIMIT 1),
    'LOW'::season_kind
  )
$$;
