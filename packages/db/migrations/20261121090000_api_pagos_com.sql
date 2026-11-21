-- =============================================================================
-- Fase 3: autenticación, pagos, vouchers y alerta COM
-- =============================================================================
-- Migración aprobada el 2026-11-21. Agrega las tablas necesarias para la API
-- REST y los WebSockets de la Fase 3 (auth, idempotencia, pagos, vouchers y
-- operadores COM) y extiende las tablas existentes (drivers, trips, panic_alerts,
-- agencies) con los campos que el ciclo de vida del viaje requiere.
--
-- Convenciones:
--   * Dinero en centavos enteros (integer). Nada de floats en importes.
--   * Timestamps en timestamptz. Vencimientos evaluados contra ar_today() cuando aplique.
--   * Índices GIST en toda columna geométrica (no aplica a tablas nuevas: sin geometría).
--   * Una migración aplicada no se edita: los cambios van en un archivo nuevo.

-- -----------------------------------------------------------------------------
-- Enums nuevos
-- -----------------------------------------------------------------------------
CREATE TYPE operator_role AS ENUM ('COM_OPERATOR', 'AGENCY_OPERATOR', 'MUNICIPAL_ADMIN');
CREATE TYPE municipal_program_type AS ENUM ('HEALTH', 'DISABILITY', 'EMPLOYEE', 'OTHER');
CREATE TYPE voucher_movement_type AS ENUM ('RESERVE', 'CONSUME', 'RELEASE');

-- -----------------------------------------------------------------------------
-- Operadores (COM, agencia, municipio): usuario + contraseña
-- -----------------------------------------------------------------------------
CREATE TABLE operator_users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username         text NOT NULL UNIQUE,
  password_hash    text NOT NULL,                 -- scrypt (calculado en la app)
  role             operator_role NOT NULL,
  agency_id        uuid REFERENCES agencies (id),
  full_name        text,
  failed_attempts  smallint NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until     timestamptz,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_users_agency_role CHECK (
    (role = 'AGENCY_OPERATOR' AND agency_id IS NOT NULL)
    OR (role <> 'AGENCY_OPERATOR' AND agency_id IS NULL)
  )
);
CREATE INDEX operator_users_role_idx ON operator_users (role) WHERE is_active;
CREATE TRIGGER operator_users_updated_at
  BEFORE UPDATE ON operator_users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Refresh tokens rotativos (hash, nunca el token en claro)
-- -----------------------------------------------------------------------------
CREATE TABLE auth_refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,
  subject_kind actor_role NOT NULL,              -- reusa actor_role: PASSENGER/DRIVER/OPERATOR/SYSTEM
  subject_id   uuid NOT NULL,
  family       uuid NOT NULL,                    -- para detectar reutilización al rotar
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  replaced_by  uuid REFERENCES auth_refresh_tokens (id),
  ip           text,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_refresh_tokens_subject_idx ON auth_refresh_tokens (subject_kind, subject_id);
CREATE INDEX auth_refresh_tokens_family_idx  ON auth_refresh_tokens (family);
CREATE INDEX auth_refresh_tokens_expires_idx ON auth_refresh_tokens (expires_at) WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- Desafíos OTP para pasajeros registrados (teléfono + código por SMS)
-- -----------------------------------------------------------------------------
CREATE TABLE otp_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       text NOT NULL CHECK (phone ~ '^\+[0-9]{8,15}$'),
  code_hash   text NOT NULL,                    -- scrypt/argon del código
  attempts    smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_challenges_phone_idx ON otp_challenges (phone, created_at DESC);

-- -----------------------------------------------------------------------------
-- Idempotencia HTTP (crear viaje, pánico, pagos)
-- -----------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_kind      actor_role NOT NULL,
  actor_id        uuid NOT NULL,
  key             text NOT NULL,
  request_hash    text NOT NULL,                -- hash del cuerpo para detectar reuso con otro payload
  response_status smallint,
  response_body   jsonb,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_unique UNIQUE (actor_kind, actor_id, key)
);
CREATE INDEX idempotency_keys_expires_idx ON idempotency_keys (expires_at);

-- -----------------------------------------------------------------------------
-- Pagos (detalle). trips.payment_status queda como estado agregado.
-- -----------------------------------------------------------------------------
CREATE TABLE payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           uuid NOT NULL REFERENCES trips (id) ON DELETE RESTRICT,
  method            payment_method NOT NULL,
  amount_cents      integer NOT NULL CHECK (amount_cents > 0),
  status            payment_status NOT NULL DEFAULT 'PENDING',
  provider_reference text,                     -- id del pago en Mercado Pago
  provider_status   text,
  qr_data           text,
  payment_link      text,
  webhook_payload   jsonb,
  idempotency_key   text,
  paid_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_provider_reference_uq
  ON payments (provider_reference) WHERE provider_reference IS NOT NULL;
CREATE INDEX payments_trip_idx ON payments (trip_id, created_at DESC);
CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Programas municipales de vouchers (presupuesto por período)
-- -----------------------------------------------------------------------------
CREATE TABLE municipal_programs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  program_type  municipal_program_type NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  budget_cents  integer NOT NULL CHECK (budget_cents >= 0),
  spent_cents   integer NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT municipal_programs_period CHECK (period_end >= period_start),
  CONSTRAINT municipal_programs_spent  CHECK (spent_cents <= budget_cents)
);
CREATE INDEX municipal_programs_active_idx ON municipal_programs (is_active, period_start);
CREATE TRIGGER municipal_programs_updated_at
  BEFORE UPDATE ON municipal_programs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Vouchers con saldo y vigencia
-- -----------------------------------------------------------------------------
CREATE TABLE vouchers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                    text NOT NULL UNIQUE,
  program_id              uuid NOT NULL REFERENCES municipal_programs (id) ON DELETE RESTRICT,
  initial_balance_cents   integer NOT NULL CHECK (initial_balance_cents > 0),
  balance_cents           integer NOT NULL CHECK (balance_cents >= 0),
  valid_from              timestamptz NOT NULL,
  valid_until             timestamptz NOT NULL,
  beneficiary_dni_hash    text,                -- hash del DNI (Ley 25.326), nunca el DNI en claro
  beneficiary_passenger_id uuid REFERENCES passengers (id),
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vouchers_validity CHECK (valid_until > valid_from),
  CONSTRAINT vouchers_balance  CHECK (balance_cents <= initial_balance_cents)
);
CREATE INDEX vouchers_program_idx   ON vouchers (program_id);
CREATE INDEX vouchers_passenger_idx ON vouchers (beneficiary_passenger_id) WHERE beneficiary_passenger_id IS NOT NULL;
CREATE INDEX vouchers_validity_idx  ON vouchers (valid_from, valid_until);
CREATE TRIGGER vouchers_updated_at
  BEFORE UPDATE ON vouchers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------------
-- Movimientos de voucher: reserva, consumo, liberación
-- -----------------------------------------------------------------------------
CREATE TABLE voucher_movements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id          uuid NOT NULL REFERENCES vouchers (id) ON DELETE RESTRICT,
  trip_id             uuid REFERENCES trips (id) ON DELETE RESTRICT,
  movement_type       voucher_movement_type NOT NULL,
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),
  balance_after_cents integer NOT NULL CHECK (balance_after_cents >= 0),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX voucher_movements_voucher_idx ON voucher_movements (voucher_id, created_at DESC);
CREATE INDEX voucher_movements_trip_idx    ON voucher_movements (trip_id) WHERE trip_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Extensiones a tablas existentes
-- -----------------------------------------------------------------------------

-- drivers: PIN de 6 dígitos (hash scrypt en la app), bloqueo por intentos fallidos
ALTER TABLE drivers
  ADD COLUMN pin_hash            text,
  ADD COLUMN pin_failed_attempts smallint NOT NULL DEFAULT 0 CHECK (pin_failed_attempts >= 0),
  ADD COLUMN pin_locked_until    timestamptz;

-- agencies.mp_collector_id ya existe desde 20261120120200_flota_y_habilitaciones.sql (Fase 3 prevista).

-- trips: taxímetro de referencia, desglose final, calificación, cargo por cancelación
ALTER TABLE trips
  ADD COLUMN metered_fare_cents     integer CHECK (metered_fare_cents IS NULL OR metered_fare_cents >= 0),
  ADD COLUMN final_breakdown        jsonb,
  ADD COLUMN passenger_rating       smallint CHECK (passenger_rating IS NULL OR passenger_rating BETWEEN 1 AND 5),
  ADD COLUMN cancellation_fee_cents integer NOT NULL DEFAULT 0 CHECK (cancellation_fee_cents >= 0);

-- panic_alerts: escalamiento
ALTER TABLE panic_alerts
  ADD COLUMN escalated_at      timestamptz,
  ADD COLUMN escalation_count  smallint NOT NULL DEFAULT 0 CHECK (escalation_count >= 0);