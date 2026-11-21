-- =============================================================================
-- Pasajeros, viajes, eventos y alertas de pánico (COM)
-- =============================================================================

CREATE TABLE passengers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               passenger_kind NOT NULL,
  full_name          text,
  phone              text CHECK (phone IS NULL OR phone ~ '^\+[0-9]{8,15}$'),
  -- Modo Invitado (QR): se guarda solo el hash del token de sesión, nunca el token.
  guest_session_hash text UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz,
  CONSTRAINT passengers_registered_phone CHECK (kind = 'GUEST' OR phone IS NOT NULL),
  CONSTRAINT passengers_guest_session    CHECK (kind = 'REGISTERED' OR guest_session_hash IS NOT NULL)
);

CREATE TABLE trips (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code             text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  passenger_id            uuid NOT NULL REFERENCES passengers (id),
  channel                 request_channel NOT NULL,
  service_type            service_type NOT NULL,
  status                  trip_status NOT NULL DEFAULT 'REQUESTED',
  origin                  geometry(Point, 4326) NOT NULL,
  origin_address          text,
  destination             geometry(Point, 4326) NOT NULL,
  destination_address     text,
  origin_locality_id      uuid NOT NULL REFERENCES localities (id),
  destination_locality_id uuid NOT NULL REFERENCES localities (id),
  origin_zone_id          uuid REFERENCES dispatch_zones (id),
  scope                   trip_scope NOT NULL,
  crossed_boundaries      smallint NOT NULL DEFAULT 0 CHECK (crossed_boundaries >= 0),
  backhaul_eligible       boolean NOT NULL DEFAULT false,  -- al terminar, el chofer queda en "Viaje de Vuelta"
  is_backhaul_assignment  boolean NOT NULL DEFAULT false,  -- se asignó a un chofer que volvía a su base
  planned_route           geometry(LineString, 4326),
  driver_id               uuid REFERENCES drivers (id),
  vehicle_id              uuid REFERENCES vehicles (id),
  agency_id               uuid REFERENCES agencies (id),
  tariff_rule_id          uuid NOT NULL REFERENCES tariff_rules (id),
  pricing_instant         timestamptz NOT NULL,            -- fija franja y temporada (también en re-cotizaciones)
  quoted_fare_cents       integer NOT NULL CHECK (quoted_fare_cents > 0),
  final_fare_cents        integer CHECK (final_fare_cents > 0),
  fare_breakdown          jsonb NOT NULL,                  -- snapshot auditable de la cotización
  payment_method          payment_method NOT NULL,
  payment_status          payment_status NOT NULL DEFAULT 'PENDING',
  voucher_code            text,
  requested_at            timestamptz NOT NULL DEFAULT now(),
  assigned_at             timestamptz,
  driver_arrived_at       timestamptz,
  started_at              timestamptz,
  completed_at            timestamptz,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  version                 integer NOT NULL DEFAULT 0,      -- control optimista (aceptación concurrente)
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trips_driver_vehicle_pair CHECK ((driver_id IS NULL) = (vehicle_id IS NULL)),
  CONSTRAINT trips_assigned_has_driver CHECK (
    status IN ('REQUESTED', 'SEARCHING', 'NO_DRIVER_AVAILABLE', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_OPERATOR')
    OR driver_id IS NOT NULL
  ),
  CONSTRAINT trips_completed_shape CHECK (
    status <> 'COMPLETED' OR (final_fare_cents IS NOT NULL AND started_at IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT trips_cancelled_shape CHECK (status::text NOT LIKE 'CANCELLED%' OR cancelled_at IS NOT NULL),
  CONSTRAINT trips_voucher_required CHECK (payment_method NOT IN ('VOUCHER', 'MUNICIPAL_ACCOUNT') OR voucher_code IS NOT NULL),
  CONSTRAINT trips_interurban_localities CHECK (scope = 'URBAN' OR origin_locality_id <> destination_locality_id),
  CONSTRAINT trips_backhaul_only_interurban CHECK (NOT backhaul_eligible OR scope = 'INTERURBAN'),
  CONSTRAINT trips_timeline CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);
CREATE INDEX trips_origin_gix      ON trips USING gist (origin);
CREATE INDEX trips_destination_gix ON trips USING gist (destination);
CREATE INDEX trips_requested_brin  ON trips USING brin (requested_at);
CREATE INDEX trips_passenger_idx   ON trips (passenger_id, requested_at DESC);
CREATE INDEX trips_open_queue_idx  ON trips (origin_locality_id, requested_at) WHERE status IN ('REQUESTED', 'SEARCHING');
-- Última línea de defensa contra la doble asignación: un chofer / un vehículo, un solo viaje activo.
CREATE UNIQUE INDEX trips_one_active_per_driver ON trips (driver_id)
  WHERE status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS');
CREATE UNIQUE INDEX trips_one_active_per_vehicle ON trips (vehicle_id)
  WHERE status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS');
CREATE TRIGGER trips_updated_at BEFORE UPDATE ON trips FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Defensa en profundidad: aunque el despacho (Redis, Fase 2) ya filtre, la base rechaza asignar
-- un par chofer↔vehículo no habilitado. Se valida SOLO al cambiar la asignación: si la VTV vence
-- a medianoche con un pasajero a bordo, el viaje en curso termina normalmente.
CREATE OR REPLACE FUNCTION trg_trips_assert_driver_eligible() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_reasons text[];
  v_service service_type;
  v_agency  uuid;
BEGIN
  IF NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id
     AND NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id THEN
    RETURN NEW;
  END IF;

  SELECT e.blocking_reasons, e.service_type, e.vehicle_agency_id
    INTO v_reasons, v_service, v_agency
  FROM v_driver_vehicle_eligibility e
  WHERE e.driver_id = NEW.driver_id AND e.vehicle_id = NEW.vehicle_id
  ORDER BY cardinality(e.blocking_reasons), e.validity DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El chofer % no tiene autorización para operar el vehículo %', NEW.driver_id, NEW.vehicle_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(v_reasons) > 0 THEN
    RAISE EXCEPTION 'Asignación bloqueada por habilitación: %', array_to_string(v_reasons, ', ')
      USING ERRCODE = 'check_violation', HINT = 'Consultar v_driver_vehicle_eligibility';
  END IF;
  IF v_service <> NEW.service_type THEN
    RAISE EXCEPTION 'El vehículo es % pero el viaje solicita %', v_service, NEW.service_type
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.agency_id := v_agency;
  RETURN NEW;
END $$;

CREATE TRIGGER trips_assert_driver_eligible
  BEFORE INSERT OR UPDATE OF driver_id, vehicle_id ON trips
  FOR EACH ROW EXECUTE FUNCTION trg_trips_assert_driver_eligible();

-- Bitácora de eventos del viaje. client_event_id permite que los dispositivos reintenten
-- (o suban eventos guardados offline) sin duplicar.
CREATE TABLE trip_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id         uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  client_event_id uuid UNIQUE,
  event_type      text NOT NULL CHECK (event_type ~ '^[A-Z_]{3,48}$'),
  actor_role      actor_role NOT NULL,
  actor_id        uuid,
  location        geometry(Point, 4326),
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL,   -- reloj del dispositivo
  received_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_events_trip_idx ON trip_events (trip_id, occurred_at);
CREATE INDEX trip_events_location_gix ON trip_events USING gist (location);

-- -----------------------------------------------------------------------------
-- Alertas de pánico → Centro de Operaciones Municipal (COM)
-- -----------------------------------------------------------------------------
CREATE TABLE panic_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id  uuid NOT NULL UNIQUE,  -- idempotencia: reintentos con red inestable no duplican la alerta
  trip_id          uuid REFERENCES trips (id),
  raised_by        actor_role NOT NULL CHECK (raised_by IN ('PASSENGER', 'DRIVER')),
  passenger_id     uuid REFERENCES passengers (id),
  driver_id        uuid REFERENCES drivers (id),
  vehicle_id       uuid REFERENCES vehicles (id),
  location         geometry(Point, 4326) NOT NULL,
  accuracy_m       numeric(7, 1) CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  locality_id      uuid REFERENCES localities (id),
  channel          panic_channel NOT NULL,
  status           panic_status NOT NULL DEFAULT 'OPEN',
  -- Foto de chofer, vehículo, pasajero y viaje al momento de la alerta (el COM la ve aunque luego cambien los datos).
  snapshot         jsonb NOT NULL,
  occurred_at      timestamptz NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  acknowledged_by  text,
  resolved_at      timestamptz,
  resolution_notes text,
  CONSTRAINT panic_passenger_identified CHECK (raised_by <> 'PASSENGER' OR passenger_id IS NOT NULL),
  CONSTRAINT panic_driver_identified    CHECK (raised_by <> 'DRIVER' OR driver_id IS NOT NULL),
  CONSTRAINT panic_ack_shape            CHECK (status = 'OPEN' OR (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)),
  CONSTRAINT panic_resolution_shape     CHECK (status NOT IN ('RESOLVED', 'FALSE_ALARM') OR resolved_at IS NOT NULL)
);
CREATE INDEX panic_alerts_location_gix ON panic_alerts USING gist (location);
CREATE INDEX panic_alerts_open_idx ON panic_alerts (received_at) WHERE status IN ('OPEN', 'ACKNOWLEDGED', 'UNITS_DISPATCHED');
CREATE INDEX panic_alerts_trip_idx ON panic_alerts (trip_id);

CREATE OR REPLACE FUNCTION trg_panic_alerts_enrich() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.locality_id IS NULL THEN
    SELECT r.locality_id INTO NEW.locality_id
    FROM resolve_locality(ST_X(NEW.location), ST_Y(NEW.location), 10000) r;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER panic_alerts_enrich
  BEFORE INSERT ON panic_alerts
  FOR EACH ROW EXECUTE FUNCTION trg_panic_alerts_enrich();

-- Canal de respaldo hacia el COM: NOTIFY transaccional (llega al confirmar el INSERT),
-- útil si el bus en tiempo real (Redis/WebSocket) está degradado.
CREATE OR REPLACE FUNCTION trg_panic_alerts_notify() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('com_panic_alerts', json_build_object(
    'id', NEW.id,
    'tripId', NEW.trip_id,
    'raisedBy', NEW.raised_by,
    'lat', ST_Y(NEW.location),
    'lng', ST_X(NEW.location),
    'localityId', NEW.locality_id,
    'occurredAt', NEW.occurred_at
  )::text);
  RETURN NULL;
END $$;

CREATE TRIGGER panic_alerts_notify
  AFTER INSERT ON panic_alerts
  FOR EACH ROW EXECUTE FUNCTION trg_panic_alerts_notify();
