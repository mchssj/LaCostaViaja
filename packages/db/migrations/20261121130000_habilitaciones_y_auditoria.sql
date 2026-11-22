-- =============================================================================
-- Fase 5: documentos de habilitación y auditoría de cambios
-- =============================================================================
-- Agrega trazabilidad de los documentos que respaldan una habilitación (DNI,
-- licencia profesional, VTV, seguro, habilitación municipal, antecedentes) y un
-- registro de auditoría de quién cambió qué y cuándo.
--
-- La verificación de veracidad contra fuentes externas (RENAPER, VTV, aseguradoras)
-- se implementa en la Fase 6 con integraciones; acá queda el soporte de datos.

CREATE TYPE habilitation_document_type AS ENUM (
  'DNI', 'LICENCIA_PROFESIONAL', 'VTV', 'SEGURO_PASAJEROS',
  'HABILITACION_MUNICIPAL', 'ANTECEDENTES_PENALES', 'CUIT', 'OTRO'
);

CREATE TYPE audit_action AS ENUM (
  'CREATE', 'UPDATE', 'DELETE', 'SUSPEND', 'REVOKE', 'APPROVE', 'REJECT'
);

CREATE TYPE habilitation_entity_type AS ENUM ('DRIVER', 'VEHICLE', 'AGENCY');

-- -----------------------------------------------------------------------------
-- Documentos que respaldan una habilitación (se guarda el hash del archivo, nunca el archivo)
-- -----------------------------------------------------------------------------
CREATE TABLE habilitation_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   habilitation_entity_type NOT NULL,
  entity_id     uuid NOT NULL,
  document_type habilitation_document_type NOT NULL,
  file_name     text NOT NULL,
  file_hash     text NOT NULL,                  -- sha256 del archivo; el archivo vive en storage externo
  mime_type     text,
  file_size_bytes integer CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  uploaded_by   uuid,                          -- operator_users.id (sin FK estricta para no acoplar)
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  verified_by   uuid,
  verified_at   timestamptz,
  notes         text,
  CONSTRAINT habilitation_documents_verified_shape CHECK (
    (verified_at IS NULL AND verified_by IS NULL) OR (verified_at IS NOT NULL AND verified_by IS NOT NULL)
  )
);
CREATE INDEX habilitation_documents_entity_idx ON habilitation_documents (entity_type, entity_id);
CREATE INDEX habilitation_documents_type_idx   ON habilitation_documents (document_type);
CREATE INDEX habilitation_documents_uploaded_idx ON habilitation_documents (uploaded_at DESC);

-- -----------------------------------------------------------------------------
-- Auditoría de cambios sobre entidades del sistema
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_kind    actor_role NOT NULL,
  actor_id      uuid,
  action        audit_action NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid,
  changes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  ip            text,
  user_agent    text
);
CREATE INDEX audit_log_entity_idx   ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_log_actor_idx    ON audit_log (actor_kind, actor_id, occurred_at DESC);
CREATE INDEX audit_log_occurred_idx ON audit_log (occurred_at DESC);

-- -----------------------------------------------------------------------------
-- Marca de verificación en drivers/vehicles/agencies (quién verificó y cuándo)
-- -----------------------------------------------------------------------------
ALTER TABLE drivers  ADD COLUMN verified_by uuid, ADD COLUMN verified_at timestamptz;
ALTER TABLE vehicles ADD COLUMN verified_by uuid, ADD COLUMN verified_at timestamptz;
ALTER TABLE agencies ADD COLUMN verified_by uuid, ADD COLUMN verified_at timestamptz;