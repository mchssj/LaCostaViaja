-- =============================================================================
-- Extensiones, utilidades y tipos de dominio
-- Sistema Digital Oficial de Despacho y Movilidad · Partido de La Costa (PBA)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusiones combinando igualdad (uuid) + solapamiento de rangos
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid(), digest()

-- SRID métrico para cálculos lineales sobre el corredor RP11:
-- WGS 84 / UTM zona 21S (meridiano central -57°), distorsión despreciable en -56.6/-56.8.
CREATE OR REPLACE FUNCTION lc_metric_srid() RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 32721 $$;

-- "Hoy" en hora argentina, independiente del TimeZone de la sesión.
-- Los vencimientos (VTV, seguro, licencias) se evalúan contra esta fecha.
CREATE OR REPLACE FUNCTION ar_today() RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Validación de CUIT/CUIL (módulo 11, pesos 5-4-3-2-7-6-5-4-3-2).
CREATE OR REPLACE FUNCTION is_valid_cuit(p_value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  v_weights CONSTANT int[] := ARRAY[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  v_sum int := 0;
  v_dv  int;
BEGIN
  IF p_value !~ '^(20|23|24|27|30|33|34)[0-9]{9}$' THEN
    RETURN false;
  END IF;
  FOR i IN 1..10 LOOP
    v_sum := v_sum + substr(p_value, i, 1)::int * v_weights[i];
  END LOOP;
  v_dv := 11 - (v_sum % 11);
  IF v_dv = 11 THEN v_dv := 0; END IF;
  RETURN v_dv <> 10 AND v_dv = substr(p_value, 11, 1)::int;
END $$;

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
CREATE TYPE service_type AS ENUM ('TAXI', 'REMIS');
CREATE TYPE trip_scope   AS ENUM ('URBAN', 'INTERURBAN');
CREATE TYPE season_kind  AS ENUM ('LOW', 'HIGH');
CREATE TYPE time_band    AS ENUM ('DAY', 'NIGHT');

-- El vencimiento NO se guarda como estado: se deriva de las fechas (ver v_driver_vehicle_eligibility).
-- Así una habilitación vencida bloquea al instante, sin depender de un cron.
CREATE TYPE permit_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');

CREATE TYPE driver_vehicle_role AS ENUM ('OWNER_DRIVER', 'PRIMARY_DRIVER', 'RELIEF_DRIVER');
CREATE TYPE zone_kind AS ENUM ('TAXI_STAND', 'DOWNTOWN', 'BUS_TERMINAL', 'HEALTH_CENTER', 'BEACH_ACCESS', 'EVENT');
CREATE TYPE tariff_schedule_status AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

CREATE TYPE passenger_kind  AS ENUM ('REGISTERED', 'GUEST');
CREATE TYPE request_channel AS ENUM ('PASSENGER_APP', 'GUEST_QR_PWA', 'PHONE_OPERATOR', 'AGENCY_PANEL', 'STREET_HAIL');
CREATE TYPE trip_status AS ENUM (
  'REQUESTED', 'SEARCHING', 'ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED',
  'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_OPERATOR', 'NO_DRIVER_AVAILABLE'
);
CREATE TYPE payment_method AS ENUM ('CASH', 'MERCADO_PAGO_QR', 'MERCADO_PAGO_LINK', 'VOUCHER', 'MUNICIPAL_ACCOUNT');
CREATE TYPE payment_status AS ENUM ('PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED');

CREATE TYPE actor_role    AS ENUM ('PASSENGER', 'DRIVER', 'OPERATOR', 'SYSTEM');
CREATE TYPE panic_status  AS ENUM ('OPEN', 'ACKNOWLEDGED', 'UNITS_DISPATCHED', 'RESOLVED', 'FALSE_ALARM');
CREATE TYPE panic_channel AS ENUM ('APP', 'PWA', 'SMS_FALLBACK', 'HARDWARE_BUTTON');
