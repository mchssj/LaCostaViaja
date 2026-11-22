-- =============================================================================
-- Smoke tests del panel administrativo (20261122120000): doble control de tarifas, reglas
-- inmutables fuera de borrador, rangos de configuración y estado de documentos.
-- Corre dentro de una transacción revertida.
-- =============================================================================
DO $$
DECLARE
  v_admin_a uuid;
  v_admin_b uuid;
  v_sched uuid;
  v_src uuid := (SELECT id FROM tariff_schedules WHERE status = 'APPROVED' ORDER BY lower(validity) DESC LIMIT 1);
  v_rule uuid;
  v_doc uuid;
BEGIN
  INSERT INTO operator_users (username, password_hash, role) VALUES ('smoke-admin-a', 'x:y', 'MUNICIPAL_ADMIN') RETURNING id INTO v_admin_a;
  INSERT INTO operator_users (username, password_hash, role) VALUES ('smoke-admin-b', 'x:y', 'MUNICIPAL_ADMIN') RETURNING id INTO v_admin_b;

  -- Borrador con reglas copiadas, en un período que no se superpone con ningún aprobado.
  INSERT INTO tariff_schedules (code, legal_instrument, status, validity, created_by)
  VALUES ('SMOKE-2099', 'Borrador de prueba', 'DRAFT', tstzrange('2099-01-01', '2100-01-01', '[)'), v_admin_a)
  RETURNING id INTO v_sched;
  INSERT INTO tariff_rules (schedule_id, service_type, scope, season, time_band, flag_fall_cents, unit_value_cents,
                            distance_unit_m, time_unit_s, reference_speed_kmh, minimum_fare_cents, return_coefficient, backhaul_waives_return)
  SELECT v_sched, service_type, scope, season, time_band, flag_fall_cents, unit_value_cents,
         distance_unit_m, time_unit_s, reference_speed_kmh, minimum_fare_cents, return_coefficient, backhaul_waives_return
  FROM tariff_rules WHERE schedule_id = v_src;
  ASSERT (SELECT count(*) FROM tariff_rules WHERE schedule_id = v_sched) > 0;
  UPDATE tariff_rules SET flag_fall_cents = flag_fall_cents + 1000 WHERE schedule_id = v_sched;
  RAISE NOTICE 'OK · un borrador se edita';

  -- Doble control: el autor no puede aprobar.
  BEGIN
    UPDATE tariff_schedules SET status = 'APPROVED', approved_by = 'smoke-admin-a', approved_by_user = v_admin_a, approved_at = now() WHERE id = v_sched;
    RAISE EXCEPTION 'TEST FAILED: el autor aprobó su propio cuadro';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · el autor no aprueba su propio cuadro';
  END;
  UPDATE tariff_schedules SET status = 'APPROVED', approved_by = 'smoke-admin-b', approved_by_user = v_admin_b, approved_at = now() WHERE id = v_sched;
  RAISE NOTICE 'OK · otro administrador aprueba';

  -- Aprobado: reglas y parámetros inmutables.
  SELECT id INTO v_rule FROM tariff_rules WHERE schedule_id = v_sched LIMIT 1;
  BEGIN
    UPDATE tariff_rules SET flag_fall_cents = flag_fall_cents + 1 WHERE id = v_rule;
    RAISE EXCEPTION 'TEST FAILED: se modificó una regla de un cuadro aprobado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · reglas de un cuadro aprobado inmutables';
  END;
  BEGIN
    UPDATE tariff_schedules SET rounding_step_cents = 500 WHERE id = v_sched;
    RAISE EXCEPTION 'TEST FAILED: se modificó un cuadro aprobado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · cuadro aprobado inmutable';
  END;
  UPDATE tariff_schedules SET status = 'RETIRED', retired_at = now() WHERE id = v_sched;
  BEGIN
    UPDATE tariff_schedules SET status = 'APPROVED' WHERE id = v_sched;
    RAISE EXCEPTION 'TEST FAILED: se reactivó un cuadro retirado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · un cuadro retirado no se reactiva';
  END;

  -- Configuración: rango validado por la base.
  BEGIN
    UPDATE system_settings SET value = '1' WHERE key = 'dispatch.offer_timeout_ms';
    RAISE EXCEPTION 'TEST FAILED: valor fuera de rango aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · configuración fuera de rango rechazada';
  END;
  UPDATE system_settings SET value = '20000', updated_by = v_admin_a WHERE key = 'dispatch.offer_timeout_ms';

  -- Documentos: rechazo con motivo; verificado sin motivo.
  INSERT INTO habilitation_documents (entity_type, entity_id, document_type, file_name, file_hash)
  VALUES ('DRIVER', (SELECT id FROM drivers LIMIT 1), 'VTV', 'vtv.pdf', repeat('a', 64)) RETURNING id INTO v_doc;
  BEGIN
    UPDATE habilitation_documents SET status = 'REJECTED', verified_by = v_admin_a, verified_at = now() WHERE id = v_doc;
    RAISE EXCEPTION 'TEST FAILED: rechazo sin motivo';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · un rechazo exige motivo';
  END;
  UPDATE habilitation_documents SET status = 'REJECTED', verified_by = v_admin_a, verified_at = now(), rejected_reason = 'Ilegible' WHERE id = v_doc;

  RAISE NOTICE 'OK · panel administrativo';
END $$;
