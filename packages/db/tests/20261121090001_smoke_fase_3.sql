-- =============================================================================
-- Smoke tests Fase 3: autenticación, pagos, vouchers y COM.
-- El runner ejecuta este archivo dentro de una transacción y la REVIERTE.
-- =============================================================================

-- 1 · operator_users: rol AGENCY_OPERATOR exige agencia; otros roles la prohíben -------
DO $$
DECLARE
  v_agency uuid := (SELECT id FROM agencies LIMIT 1);
BEGIN
  BEGIN
    INSERT INTO operator_users (username, password_hash, role, agency_id)
    VALUES ('op_sin_agencia', 'hash', 'AGENCY_OPERATOR', NULL);
    RAISE EXCEPTION 'TEST FAILED: AGENCY_OPERATOR sin agencia aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · AGENCY_OPERATOR requiere agencia';
  END;

  BEGIN
    INSERT INTO operator_users (username, password_hash, role, agency_id)
    VALUES ('op_con_agencia', 'hash', 'COM_OPERATOR', v_agency);
    RAISE EXCEPTION 'TEST FAILED: COM_OPERATOR con agencia aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · COM_OPERATOR no admite agencia';
  END;

  INSERT INTO operator_users (username, password_hash, role, agency_id)
  VALUES ('op_com_ok', 'hash', 'COM_OPERATOR', NULL);
  ASSERT (SELECT count(*) FROM operator_users WHERE username = 'op_com_ok') = 1;
  RAISE NOTICE 'OK · operator_users válido insertado';
END $$;

-- 2 · auth_refresh_tokens: unicidad del hash ---------------------------------------
DO $$
BEGIN
  INSERT INTO auth_refresh_tokens (token_hash, subject_kind, subject_id, family, expires_at)
  VALUES ('hash_unico_1', 'DRIVER', gen_random_uuid(), gen_random_uuid(), now() + interval '30 days');
  BEGIN
    INSERT INTO auth_refresh_tokens (token_hash, subject_kind, subject_id, family, expires_at)
    VALUES ('hash_unico_1', 'DRIVER', gen_random_uuid(), gen_random_uuid(), now() + interval '30 days');
    RAISE EXCEPTION 'TEST FAILED: token_hash duplicado aceptado';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK · refresh token duplicado rechazado';
  END;
END $$;

-- 3 · otp_challenges: intentos no negativos -----------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO otp_challenges (phone, code_hash, attempts, expires_at)
    VALUES ('+541112345678', 'hash', -1, now() + interval '5 minutes');
    RAISE EXCEPTION 'TEST FAILED: attempts negativo aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · otp attempts >= 0';
  END;
END $$;

-- 4 · idempotency_keys: unicidad por (actor, clave) ---------------------------------
DO $$
DECLARE v_actor uuid := gen_random_uuid();
BEGIN
  INSERT INTO idempotency_keys (actor_kind, actor_id, key, request_hash, expires_at)
  VALUES ('PASSENGER', v_actor, 'key-1', 'bodyhash', now() + interval '1 day');
  BEGIN
    INSERT INTO idempotency_keys (actor_kind, actor_id, key, request_hash, expires_at)
    VALUES ('PASSENGER', v_actor, 'key-1', 'otrohash', now() + interval '1 day');
    RAISE EXCEPTION 'TEST FAILED: idempotency duplicada aceptada';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK · idempotency key única por actor';
  END;
END $$;

-- 5 · vouchers: reserva / consumo / liberación de saldo ------------------------------
DO $$
DECLARE
  v_program  uuid;
  v_voucher  uuid;
  v_passenger uuid := (SELECT id FROM passengers LIMIT 1);
  v_trip     uuid := (SELECT id FROM trips LIMIT 1);
BEGIN
  INSERT INTO municipal_programs (name, program_type, period_start, period_end, budget_cents)
  VALUES ('Programa test', 'HEALTH', current_date, current_date + 365, 100000)
  RETURNING id INTO v_program;

  INSERT INTO vouchers (code, program_id, initial_balance_cents, balance_cents, valid_from, valid_until, beneficiary_passenger_id)
  VALUES ('VCH-TEST-001', v_program, 50000, 50000, now(), now() + interval '90 days', v_passenger)
  RETURNING id INTO v_voucher;

  -- Reserva: saldo disponible baja.
  UPDATE vouchers SET balance_cents = balance_cents - 12000 WHERE id = v_voucher;
  INSERT INTO voucher_movements (voucher_id, trip_id, movement_type, amount_cents, balance_after_cents)
  VALUES (v_voucher, v_trip, 'RESERVE', 12000, (SELECT balance_cents FROM vouchers WHERE id = v_voucher));
  ASSERT (SELECT balance_cents FROM vouchers WHERE id = v_voucher) = 38000, 'Saldo tras reserva incorrecto';

  -- Liberación: saldo vuelve.
  UPDATE vouchers SET balance_cents = balance_cents + 12000 WHERE id = v_voucher;
  INSERT INTO voucher_movements (voucher_id, trip_id, movement_type, amount_cents, balance_after_cents)
  VALUES (v_voucher, v_trip, 'RELEASE', 12000, (SELECT balance_cents FROM vouchers WHERE id = v_voucher));
  ASSERT (SELECT balance_cents FROM vouchers WHERE id = v_voucher) = 50000, 'Saldo tras liberación incorrecto';

  -- Consumo total: saldo a 0 (reserva previa asumida).
  UPDATE vouchers SET balance_cents = balance_cents - 50000 WHERE id = v_voucher;
  INSERT INTO voucher_movements (voucher_id, trip_id, movement_type, amount_cents, balance_after_cents)
  VALUES (v_voucher, v_trip, 'CONSUME', 50000, (SELECT balance_cents FROM vouchers WHERE id = v_voucher));
  ASSERT (SELECT balance_cents FROM vouchers WHERE id = v_voucher) = 0, 'Saldo tras consumo incorrecto';

  -- Saldo negativo rechazado.
  BEGIN
    UPDATE vouchers SET balance_cents = -1 WHERE id = v_voucher;
    RAISE EXCEPTION 'TEST FAILED: saldo negativo aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · voucher balance >= 0';
  END;

  -- Presupuesto gastado no puede superar el presupuestado.
  BEGIN
    UPDATE municipal_programs SET spent_cents = budget_cents + 1 WHERE id = v_program;
    RAISE EXCEPTION 'TEST FAILED: spent > budget aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · spent_cents <= budget_cents';
  END;

  RAISE NOTICE 'OK · flujo de voucher completo';
END $$;

-- 6 · payments: provider_reference único --------------------------------------------
DO $$
DECLARE v_trip uuid := (SELECT id FROM trips LIMIT 1);
BEGIN
  INSERT INTO payments (trip_id, method, amount_cents, provider_reference, status)
  VALUES (v_trip, 'MERCADO_PAGO_QR', 484000, 'MP-REF-001', 'PENDING');
  BEGIN
    INSERT INTO payments (trip_id, method, amount_cents, provider_reference, status)
    VALUES (v_trip, 'MERCADO_PAGO_QR', 100000, 'MP-REF-001', 'PENDING');
    RAISE EXCEPTION 'TEST FAILED: provider_reference duplicado aceptado';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK · provider_reference único';
  END;
END $$;

-- 7 · panic_alerts: escalamiento ----------------------------------------------------
DO $$
DECLARE
  v_pa uuid;
BEGIN
  INSERT INTO panic_alerts (client_event_id, raised_by, passenger_id, location, channel, snapshot, occurred_at)
  SELECT '7f0c1e9a-0000-4000-8000-000000000099'::uuid, 'PASSENGER', id,
         ST_SetSRID(ST_MakePoint(-56.680, -36.6875), 4326), 'APP', '{}'::jsonb, now()
  FROM passengers LIMIT 1
  RETURNING id INTO v_pa;

  UPDATE panic_alerts SET escalated_at = now(), escalation_count = 1 WHERE id = v_pa;
  ASSERT (SELECT escalation_count FROM panic_alerts WHERE id = v_pa) = 1, 'escalation_count incorrecto';

  BEGIN
    UPDATE panic_alerts SET escalation_count = -1 WHERE id = v_pa;
    RAISE EXCEPTION 'TEST FAILED: escalation_count negativo aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · panic escalation_count >= 0';
  END;
END $$;

-- 8 · trips: nuevas columnas y constraints ------------------------------------------
DO $$
DECLARE v_trip uuid := (SELECT id FROM trips LIMIT 1);
BEGIN
  UPDATE trips SET metered_fare_cents = 500000, final_breakdown = '{"total":500000}'::jsonb,
                   passenger_rating = 5, cancellation_fee_cents = 0
  WHERE id = v_trip;
  ASSERT (SELECT passenger_rating FROM trips WHERE id = v_trip) = 5;

  BEGIN
    UPDATE trips SET passenger_rating = 6 WHERE id = v_trip;
    RAISE EXCEPTION 'TEST FAILED: rating > 5 aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · passenger_rating 1..5';
  END;

  BEGIN
    UPDATE trips SET metered_fare_cents = -1 WHERE id = v_trip;
    RAISE EXCEPTION 'TEST FAILED: metered_fare negativo aceptado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · metered_fare_cents >= 0';
  END;
END $$;