-- =============================================================================
-- Smoke tests Fase 5: documentos de habilitación y auditoría.
-- =============================================================================
DO $$
DECLARE
  v_driver uuid := (SELECT id FROM drivers LIMIT 1);
  v_doc uuid;
BEGIN
  -- Documento válido.
  INSERT INTO habilitation_documents (entity_type, entity_id, document_type, file_name, file_hash, uploaded_by)
  VALUES ('DRIVER', v_driver, 'DNI', 'dni.pdf', encode(digest('file', 'sha256'), 'hex'), NULL)
  RETURNING id INTO v_doc;
  ASSERT v_doc IS NOT NULL;

  -- Verificación requiere verified_by y verified_at juntos.
  BEGIN
    UPDATE habilitation_documents SET verified_at = now() WHERE id = v_doc;
    RAISE EXCEPTION 'TEST FAILED: verified_at sin verified_by aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · verificación requiere verified_by y verified_at';
  END;

  -- Verificar correctamente.
  UPDATE habilitation_documents SET verified_by = (SELECT id FROM operator_users LIMIT 1), verified_at = now() WHERE id = v_doc;
  ASSERT (SELECT verified_at IS NOT NULL FROM habilitation_documents WHERE id = v_doc);

  -- Audit log insertable.
  INSERT INTO audit_log (actor_kind, actor_id, action, entity_type, entity_id, changes)
  VALUES ('OPERATOR', (SELECT id FROM operator_users LIMIT 1), 'APPROVE', 'DRIVER', v_driver, '{"status":"ACTIVE"}'::jsonb);
  ASSERT (SELECT count(*) FROM audit_log WHERE entity_id = v_driver) >= 1;

  -- Marca de verificación en driver.
  UPDATE drivers SET verified_by = (SELECT id FROM operator_users LIMIT 1), verified_at = now() WHERE id = v_driver;
  ASSERT (SELECT verified_at IS NOT NULL FROM drivers WHERE id = v_driver);

  RAISE NOTICE 'OK · Fase 5 documentos y auditoría';
END $$;