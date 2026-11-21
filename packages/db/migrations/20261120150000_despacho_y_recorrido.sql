-- =============================================================================
-- Despacho (Fase 2): ofertas auditables, recorrido GPS y preferencias del chofer
-- =============================================================================

CREATE TYPE offer_outcome AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'CLAIM_FAILED');

-- Preferencia del chofer: puede no tomar viajes interurbanos por RP11.
ALTER TABLE drivers ADD COLUMN accepts_interurban boolean NOT NULL DEFAULT true;

-- Progreso de la búsqueda (ronda de ampliación e inicio, para el tope de 3 minutos).
ALTER TABLE trips
  ADD COLUMN dispatch_round      smallint NOT NULL DEFAULT 0 CHECK (dispatch_round BETWEEN 0 AND 10),
  ADD COLUMN dispatch_started_at timestamptz;

-- Cada oferta a un chofer queda registrada: el municipio puede auditar por qué se le ofreció
-- un viaje a uno y no a otro (rango, puntaje y su desglose, ETA, resultado).
CREATE TABLE trip_offers (
  id                  uuid PRIMARY KEY,                  -- lo genera la API (también vive en Redis)
  trip_id             uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  driver_id           uuid NOT NULL REFERENCES drivers (id),
  vehicle_id          uuid NOT NULL REFERENCES vehicles (id),
  round               smallint NOT NULL CHECK (round BETWEEN 1 AND 10),
  rank                smallint NOT NULL CHECK (rank >= 1),
  score_seconds       numeric(10, 1) NOT NULL,
  eta_seconds         integer NOT NULL CHECK (eta_seconds >= 0),
  backhaul_match      text CHECK (backhaul_match IN ('HOME', 'DIRECTION')),
  score_breakdown     jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome             offer_outcome NOT NULL DEFAULT 'PENDING',
  offered_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  responded_at        timestamptz,
  dispatcher_instance text NOT NULL,
  CONSTRAINT trip_offers_responded CHECK (outcome = 'PENDING' OR responded_at IS NOT NULL),
  CONSTRAINT trip_offers_expiry    CHECK (expires_at > offered_at)
);
-- Nunca dos ofertas abiertas para el mismo viaje (además de la garantía de Redis).
CREATE UNIQUE INDEX trip_offers_one_pending_per_trip ON trip_offers (trip_id) WHERE outcome = 'PENDING';
CREATE INDEX trip_offers_trip_idx   ON trip_offers (trip_id, offered_at);
CREATE INDEX trip_offers_driver_idx ON trip_offers (driver_id, offered_at DESC);

-- Recorrido GPS de los viajes (desde la asignación). Idempotente por (trip_id, recorded_at):
-- los reintentos y los lotes que la app guardó sin señal no duplican puntos.
CREATE TABLE trip_track_points (
  trip_id     uuid NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  driver_id   uuid NOT NULL REFERENCES drivers (id),
  recorded_at timestamptz NOT NULL,
  geom        geometry(Point, 4326) NOT NULL,
  speed_kmh   numeric(6, 1) CHECK (speed_kmh IS NULL OR speed_kmh >= 0),
  heading_deg smallint CHECK (heading_deg IS NULL OR heading_deg BETWEEN 0 AND 359),
  accuracy_m  numeric(7, 1) CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, recorded_at)
);
CREATE INDEX trip_track_points_geom_gix     ON trip_track_points USING gist (geom);
CREATE INDEX trip_track_points_recorded_brin ON trip_track_points USING brin (recorded_at);
