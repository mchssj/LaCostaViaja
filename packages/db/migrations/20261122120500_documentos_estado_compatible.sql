-- =============================================================================
-- Compatibilidad del estado de revisión de documentos (complementa 20261122120000).
-- Quien marque verified_by/verified_at sin indicar status (código previo a la Fase 5) deja el
-- documento como VERIFIED; si además trae rejected_reason, como REJECTED. Así no se rompe la
-- restricción habilitation_documents_review_shape.
-- =============================================================================
CREATE OR REPLACE FUNCTION habilitation_documents_infer_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'PENDING' AND NEW.verified_at IS NOT NULL THEN
    NEW.status := CASE WHEN NEW.rejected_reason IS NOT NULL THEN 'REJECTED' ELSE 'VERIFIED' END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER habilitation_documents_infer_status
  BEFORE INSERT OR UPDATE ON habilitation_documents
  FOR EACH ROW EXECUTE FUNCTION habilitation_documents_infer_status();
