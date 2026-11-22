-- =============================================================================
-- Fase 5 · Panel administrativo: roles nuevos, cuentas de operador (contraseña temporal, segundo
-- factor, revocación de sesiones), configuración editable, doble control de tarifas y estado de
-- los documentos de habilitación.
-- Plan: docs/bitacora/2026-11-22-fase-5-panel-administracion/PLAN.md
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Roles. MUNICIPAL_ADMIN sigue siendo el Administrador.
-- (ADD VALUE dentro de la transacción es válido; los valores nuevos no se usan en este archivo.)
-- -----------------------------------------------------------------------------
ALTER TYPE operator_role ADD VALUE IF NOT EXISTS 'LICENSING_OFFICER';
ALTER TYPE operator_role ADD VALUE IF NOT EXISTS 'AUDITOR';

ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'VERIFY';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'LOGIN';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'LOGIN_FAILED';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'PASSWORD_RESET';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'MFA_CHANGE';
ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'SESSION_REVOKE';

-- -----------------------------------------------------------------------------
-- Cuentas de operador
-- -----------------------------------------------------------------------------
ALTER TABLE operator_users
  ADD COLUMN email                text CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN password_changed_at  timestamptz,
  -- Secreto TOTP cifrado por la API (AES-256-GCM con clave derivada); nunca en claro.
  ADD COLUMN totp_secret_enc      text,
  ADD COLUMN totp_enabled_at      timestamptz,
  ADD COLUMN recovery_codes_hash  text[] NOT NULL DEFAULT '{}',
  ADD COLUMN last_login_at        timestamptz,
  -- Tokens emitidos antes de este instante dejan de valer (cambio de rol, baja, reseteo).
  ADD COLUMN sessions_revoked_at  timestamptz,
  ADD COLUMN created_by           uuid REFERENCES operator_users (id);

CREATE UNIQUE INDEX operator_users_email_key ON operator_users (lower(email)) WHERE email IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Configuración editable desde el panel (los secretos e infraestructura siguen en el entorno)
-- -----------------------------------------------------------------------------
CREATE TYPE setting_type AS ENUM ('INTEGER', 'NUMBER', 'BOOLEAN', 'CENTS', 'DURATION_MS');

CREATE TABLE system_settings (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]*$'),
  group_name   text NOT NULL,
  label        text NOT NULL,
  description  text NOT NULL,
  value_type   setting_type NOT NULL,
  value        jsonb NOT NULL,
  default_value jsonb NOT NULL,
  min_value    numeric,
  max_value    numeric,
  unit         text,
  sort_order   integer NOT NULL DEFAULT 0,
  updated_by   uuid REFERENCES operator_users (id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT system_settings_range CHECK (
    value_type = 'BOOLEAN'
    OR (jsonb_typeof(value) = 'number'
        AND (min_value IS NULL OR (value)::text::numeric >= min_value)
        AND (max_value IS NULL OR (value)::text::numeric <= max_value))
  ),
  CONSTRAINT system_settings_bool CHECK (value_type <> 'BOOLEAN' OR jsonb_typeof(value) = 'boolean')
);

-- -----------------------------------------------------------------------------
-- Tarifas: autor del borrador y aprobación por OTRO usuario (doble control)
-- -----------------------------------------------------------------------------
ALTER TABLE tariff_schedules
  ADD COLUMN created_by       uuid REFERENCES operator_users (id),
  ADD COLUMN approved_by_user uuid REFERENCES operator_users (id),
  ADD COLUMN retired_at       timestamptz,
  ADD CONSTRAINT tariff_schedules_four_eyes CHECK (
    approved_by_user IS NULL OR created_by IS NULL OR approved_by_user <> created_by
  );

-- Las reglas de un cuadro aprobado o retirado no se tocan: los cambios van en un cuadro nuevo.
CREATE OR REPLACE FUNCTION tariff_rules_only_in_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st tariff_schedule_status;
BEGIN
  SELECT status INTO st FROM tariff_schedules WHERE id = COALESCE(NEW.schedule_id, OLD.schedule_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Las reglas de un cuadro % no se pueden modificar: creá un cuadro nuevo', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER tariff_rules_only_in_draft
  BEFORE INSERT OR UPDATE OR DELETE ON tariff_rules
  FOR EACH ROW EXECUTE FUNCTION tariff_rules_only_in_draft();

-- Un cuadro aprobado no vuelve a borrador ni cambia sus parámetros; solo puede retirarse.
CREATE OR REPLACE FUNCTION tariff_schedules_immutable_when_approved() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'APPROVED' AND (
       NEW.status = 'DRAFT'
       OR NEW.validity IS DISTINCT FROM OLD.validity AND NEW.status = 'APPROVED'
       OR NEW.night_starts_at IS DISTINCT FROM OLD.night_starts_at
       OR NEW.night_ends_at IS DISTINCT FROM OLD.night_ends_at
       OR NEW.interurban_min_outside_m IS DISTINCT FROM OLD.interurban_min_outside_m
       OR NEW.rounding_step_cents IS DISTINCT FROM OLD.rounding_step_cents
       OR NEW.legal_instrument IS DISTINCT FROM OLD.legal_instrument) THEN
    RAISE EXCEPTION 'Un cuadro tarifario aprobado no se modifica: solo se puede retirar'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' THEN
    RAISE EXCEPTION 'Un cuadro retirado no se reactiva' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tariff_schedules_immutable_when_approved
  BEFORE UPDATE ON tariff_schedules
  FOR EACH ROW EXECUTE FUNCTION tariff_schedules_immutable_when_approved();

-- -----------------------------------------------------------------------------
-- Documentos de habilitación: estado de la revisión, vencimiento y archivo
-- -----------------------------------------------------------------------------
CREATE TYPE document_review_status AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

ALTER TABLE habilitation_documents
  ADD COLUMN status          document_review_status NOT NULL DEFAULT 'PENDING',
  ADD COLUMN rejected_reason text,
  ADD COLUMN expires_on      date,
  ADD COLUMN storage_key     text,
  ADD COLUMN superseded_by   uuid REFERENCES habilitation_documents (id),
  ADD CONSTRAINT habilitation_documents_review_shape CHECK (
    (status = 'PENDING' AND verified_at IS NULL)
    OR (status = 'VERIFIED' AND verified_at IS NOT NULL AND rejected_reason IS NULL)
    OR (status = 'REJECTED' AND verified_at IS NOT NULL AND rejected_reason IS NOT NULL)
  );

COMMENT ON COLUMN habilitation_documents.verified_by IS 'Quién revisó el documento (verificado o rechazado, según status)';

CREATE INDEX habilitation_documents_current_idx ON habilitation_documents (entity_type, entity_id, document_type) WHERE superseded_by IS NULL;
CREATE INDEX habilitation_documents_pending_idx ON habilitation_documents (uploaded_at) WHERE status = 'PENDING';
CREATE INDEX audit_log_action_idx ON audit_log (action, occurred_at DESC);
