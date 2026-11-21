-- =============================================================================
-- Flota habilitada: agencias, choferes, vehículos y autorizaciones chofer↔vehículo
-- =============================================================================
-- Principio: solo opera quien tiene TODO vigente. Los vencimientos viven en la entidad
-- que corresponde (licencia → chofer, VTV/seguro → vehículo) y la elegibilidad se
-- calcula en v_driver_vehicle_eligibility. El trigger de trips (20261120120400_viajes_y_alertas_com.sql) la exige al asignar.

CREATE TABLE agencies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuit                    char(11) NOT NULL UNIQUE CHECK (is_valid_cuit(cuit)),
  legal_name              text NOT NULL,
  trade_name              text NOT NULL,
  locality_id             uuid NOT NULL REFERENCES localities (id),
  address                 text NOT NULL,
  base_location           geometry(Point, 4326) NOT NULL,
  phone                   text NOT NULL CHECK (phone ~ '^\+54(9)?[0-9]{10}$'),
  municipal_permit_number text NOT NULL UNIQUE,  -- habilitación comercial de la agencia de remises
  permit_expires_on       date NOT NULL,
  status                  permit_status NOT NULL DEFAULT 'PENDING',
  mp_collector_id         text,                  -- cuenta Mercado Pago para split de pagos (Fase 3)
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agencies_base_location_gix ON agencies USING gist (base_location);
CREATE INDEX agencies_locality_idx ON agencies (locality_id);
CREATE TRIGGER agencies_updated_at BEFORE UPDATE ON agencies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE drivers (
  id                                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id                          uuid REFERENCES agencies (id),          -- NULL = chofer independiente (taxi)
  base_locality_id                   uuid NOT NULL REFERENCES localities (id), -- localidad base (destino del Viaje de Vuelta)
  dni                                varchar(9) NOT NULL UNIQUE CHECK (dni ~ '^[0-9]{7,9}$'),
  cuil                               char(11) NOT NULL UNIQUE CHECK (is_valid_cuit(cuil)),
  first_name                         text NOT NULL,
  last_name                          text NOT NULL,
  phone                              text NOT NULL CHECK (phone ~ '^\+54(9)?[0-9]{10}$'),
  professional_license_number        text NOT NULL,
  -- Licencia profesional de transporte de pasajeros (D1 en adelante).
  professional_license_class         text NOT NULL CHECK (professional_license_class IN ('D1', 'D2', 'D3', 'D4')),
  professional_license_expires_on    date NOT NULL,
  municipal_driver_permit_number     text NOT NULL UNIQUE,                  -- registro municipal de conductores
  municipal_driver_permit_expires_on date NOT NULL,
  criminal_record_expires_on         date,                                  -- certificado de antecedentes (opcional)
  status                             permit_status NOT NULL DEFAULT 'PENDING',
  suspension_reason                  text,
  suspended_until                    date,
  created_at                         timestamptz NOT NULL DEFAULT now(),
  updated_at                         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drivers_suspension_reason CHECK (status <> 'SUSPENDED' OR suspension_reason IS NOT NULL),
  CONSTRAINT drivers_cuil_matches_dni  CHECK (substr(cuil, 3, 8) = lpad(dni, 8, '0'))
);
CREATE INDEX drivers_agency_idx ON drivers (agency_id);
CREATE INDEX drivers_base_locality_idx ON drivers (base_locality_id);
CREATE TRIGGER drivers_updated_at BEFORE UPDATE ON drivers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vehicles (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id                           uuid REFERENCES agencies (id),
  service_type                        service_type NOT NULL,
  -- Patente Mercosur (AB123CD) o formato anterior (ABC123).
  plate                               varchar(7) NOT NULL UNIQUE CHECK (plate ~ '^([A-Z]{2}[0-9]{3}[A-Z]{2}|[A-Z]{3}[0-9]{3})$'),
  make                                text NOT NULL,
  model                               text NOT NULL,
  model_year                          smallint NOT NULL CHECK (model_year BETWEEN 1990 AND 2100),
  color                               text NOT NULL,
  passenger_seats                     smallint NOT NULL CHECK (passenger_seats BETWEEN 1 AND 8),
  wheelchair_accessible               boolean NOT NULL DEFAULT false,
  owner_name                          text NOT NULL,
  owner_cuit                          char(11) NOT NULL CHECK (is_valid_cuit(owner_cuit)),
  municipal_vehicle_permit_number     text NOT NULL UNIQUE,  -- licencia de taxi / habilitación de remis
  municipal_vehicle_permit_expires_on date NOT NULL,
  vtv_expires_on                      date NOT NULL,
  insurer_name                        text NOT NULL,
  insurance_policy_number             text NOT NULL,
  passenger_insurance_expires_on      date NOT NULL,         -- seguro de pasajeros transportados
  status                              permit_status NOT NULL DEFAULT 'PENDING',
  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now(),
  -- Supuesto regulatorio: el remis opera a través de una agencia habilitada; el taxi puede ser independiente.
  CONSTRAINT vehicles_remis_requires_agency CHECK (service_type = 'TAXI' OR agency_id IS NOT NULL)
);
CREATE INDEX vehicles_agency_idx ON vehicles (agency_id);
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Autorización municipal para que un chofer opere un vehículo (titular, chofer, suplente).
CREATE TABLE driver_vehicle_compliance (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id            uuid NOT NULL REFERENCES drivers (id),
  vehicle_id           uuid NOT NULL REFERENCES vehicles (id),
  role                 driver_vehicle_role NOT NULL,
  authorization_number text NOT NULL UNIQUE,  -- disposición / acto administrativo
  validity             daterange NOT NULL,
  status               permit_status NOT NULL DEFAULT 'PENDING',
  verified_by          text,
  verified_at          timestamptz,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dvc_validity_shape CHECK (NOT isempty(validity) AND NOT lower_inf(validity)),
  CONSTRAINT dvc_active_is_verified CHECK (status <> 'ACTIVE' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  -- Un mismo par chofer↔vehículo no puede tener autorizaciones vigentes superpuestas.
  CONSTRAINT dvc_no_overlap EXCLUDE USING gist (driver_id WITH =, vehicle_id WITH =, validity WITH &&)
    WHERE (status IN ('PENDING', 'ACTIVE', 'SUSPENDED'))
);
CREATE INDEX dvc_vehicle_idx ON driver_vehicle_compliance (vehicle_id);
CREATE INDEX dvc_driver_idx ON driver_vehicle_compliance (driver_id);
CREATE TRIGGER dvc_updated_at BEFORE UPDATE ON driver_vehicle_compliance FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Elegibilidad calculada en tiempo real (hora argentina). blocking_reasons vacío ⇒ puede operar.
CREATE OR REPLACE VIEW v_driver_vehicle_eligibility AS
WITH base AS (
  SELECT c.id              AS compliance_id,
         c.driver_id,
         c.vehicle_id,
         c.role,
         v.service_type,
         v.agency_id       AS vehicle_agency_id,
         d.agency_id       AS driver_agency_id,
         d.base_locality_id,
         c.status          AS authorization_status,
         c.validity,
         d.status          AS driver_status,
         d.professional_license_expires_on,
         d.municipal_driver_permit_expires_on,
         d.criminal_record_expires_on,
         v.status          AS vehicle_status,
         v.vtv_expires_on,
         v.passenger_insurance_expires_on,
         v.municipal_vehicle_permit_expires_on,
         a.status          AS agency_status,
         a.permit_expires_on AS agency_permit_expires_on,
         ar_today()        AS today
  FROM driver_vehicle_compliance c
  JOIN drivers  d ON d.id = c.driver_id
  JOIN vehicles v ON v.id = c.vehicle_id
  LEFT JOIN agencies a ON a.id = v.agency_id
),
evaluated AS (
  SELECT b.*,
         array_remove(ARRAY[
           CASE WHEN b.authorization_status <> 'ACTIVE' THEN 'AUTORIZACION_' || b.authorization_status::text END,
           CASE WHEN NOT (b.validity @> b.today) THEN 'AUTORIZACION_FUERA_DE_VIGENCIA' END,
           CASE WHEN b.driver_status <> 'ACTIVE' THEN 'CHOFER_' || b.driver_status::text END,
           CASE WHEN b.professional_license_expires_on < b.today THEN 'LICENCIA_PROFESIONAL_VENCIDA' END,
           CASE WHEN b.municipal_driver_permit_expires_on < b.today THEN 'HABILITACION_CHOFER_VENCIDA' END,
           CASE WHEN b.criminal_record_expires_on < b.today THEN 'CERTIFICADO_ANTECEDENTES_VENCIDO' END,
           CASE WHEN b.vehicle_status <> 'ACTIVE' THEN 'VEHICULO_' || b.vehicle_status::text END,
           CASE WHEN b.vtv_expires_on < b.today THEN 'VTV_VENCIDA' END,
           CASE WHEN b.passenger_insurance_expires_on < b.today THEN 'SEGURO_PASAJEROS_VENCIDO' END,
           CASE WHEN b.municipal_vehicle_permit_expires_on < b.today THEN 'HABILITACION_VEHICULO_VENCIDA' END,
           CASE WHEN b.vehicle_agency_id IS NOT NULL AND b.agency_status <> 'ACTIVE' THEN 'AGENCIA_' || b.agency_status::text END,
           CASE WHEN b.vehicle_agency_id IS NOT NULL AND b.agency_permit_expires_on < b.today THEN 'HABILITACION_AGENCIA_VENCIDA' END,
           CASE WHEN b.vehicle_agency_id IS NOT NULL AND b.driver_agency_id IS DISTINCT FROM b.vehicle_agency_id
                THEN 'CHOFER_NO_PERTENECE_A_LA_AGENCIA_DEL_VEHICULO' END
         ]::text[], NULL) AS blocking_reasons,
         LEAST(
           upper(b.validity) - 1,
           b.professional_license_expires_on,
           b.municipal_driver_permit_expires_on,
           b.criminal_record_expires_on,
           b.vtv_expires_on,
           b.passenger_insurance_expires_on,
           b.municipal_vehicle_permit_expires_on,
           b.agency_permit_expires_on
         ) AS next_expiry_on
  FROM base b
)
SELECT e.*,
       cardinality(e.blocking_reasons) = 0 AS is_eligible
FROM evaluated e;
