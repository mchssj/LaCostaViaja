-- =============================================================================
-- Smoke tests de esquema, seeds y reglas de integridad.
-- El runner (scripts/db.mjs test) ejecuta este archivo dentro de una transacción y la REVIERTE.
-- =============================================================================

-- 1 · Resolución espacial de localidades -----------------------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM resolve_locality(-56.680, -36.6875);
  ASSERT r.locality_code = 'SAN_BERNARDO' AND r.method = 'CONTAINED',
    format('Av. Chiozza → esperaba SAN_BERNARDO/CONTAINED, obtuve %s/%s', r.locality_code, r.method);

  SELECT * INTO r FROM resolve_locality(-56.692, -36.536);
  ASSERT r.locality_code = 'SANTA_TERESITA', format('Calle 2 → %s', r.locality_code);

  SELECT * INTO r FROM resolve_locality(-56.680, -36.716);
  ASSERT r.locality_code = 'MAR_DE_AJO', format('Centro Mar de Ajó → %s', r.locality_code);

  SELECT * INTO r FROM resolve_locality(-56.724, -36.357);
  ASSERT r.locality_code = 'SAN_CLEMENTE', format('Centro San Clemente → %s', r.locality_code);

  -- Borde compartido SB/MdA: desempate determinístico por corridor_order (la del norte).
  SELECT * INTO r FROM resolve_locality(-56.680, -36.703);
  ASSERT r.locality_code = 'SAN_BERNARDO', format('Borde SB/MdA → %s', r.locality_code);

  -- Tramo rural entre San Clemente y Las Toninas → localidad más cercana.
  SELECT * INTO r FROM resolve_locality(-56.720, -36.440);
  ASSERT r.locality_code = 'LAS_TONINAS' AND r.method = 'NEAREST_FALLBACK' AND r.distance_m BETWEEN 2500 AND 3100,
    format('Tramo rural → %s/%s %s m', r.locality_code, r.method, r.distance_m);

  -- Mar adentro → fuera de servicio.
  PERFORM 1 FROM resolve_locality(-56.400, -36.600);
  ASSERT NOT FOUND, 'Un punto en el mar no debe resolver localidad';

  RAISE NOTICE 'OK · resolución de localidades';
END $$;

-- 2 · Referenciación lineal sobre RP11 -------------------------------------------
DO $$
DECLARE
  v_prev double precision := -1;
  r record;
  s record;
BEGIN
  FOR r IN SELECT * FROM v_locality_corridor_ranges ORDER BY corridor_order LOOP
    ASSERT r.from_m >= v_prev - 1, format('Rango de %s no es monótono norte→sur', r.code);
    ASSERT r.to_m > r.from_m, format('Rango vacío en %s', r.code);
    v_prev := r.from_m;
  END LOOP;

  -- San Bernardo (Chiozza) → Mar de Ajó: ~1,45 km fuera de San Bernardo.
  SELECT * INTO s FROM corridor_stretch(
    ST_SetSRID(ST_MakePoint(-56.680, -36.6875), 4326),
    ST_SetSRID(ST_MakePoint(-56.680, -36.716), 4326),
    (SELECT id FROM localities WHERE code = 'SAN_BERNARDO'),
    ST_GeomFromText('LINESTRING(-56.680 -36.6875, -56.680 -36.716)', 4326));
  ASSERT s.destination_pos_m > s.origin_pos_m, 'Hacia el sur la progresiva debe crecer';
  ASSERT s.corridor_outside_m BETWEEN 1300 AND 1600, format('corridor_outside_m=%s', s.corridor_outside_m);
  ASSERT s.route_outside_m BETWEEN 1400 AND 1500, format('route_outside_m=%s', s.route_outside_m);

  -- Viaje dentro de San Bernardo: nada fuera.
  SELECT * INTO s FROM corridor_stretch(
    ST_SetSRID(ST_MakePoint(-56.680, -36.6875), 4326),
    ST_SetSRID(ST_MakePoint(-56.690, -36.695), 4326),
    (SELECT id FROM localities WHERE code = 'SAN_BERNARDO'));
  ASSERT s.corridor_outside_m = 0 AND s.route_outside_m IS NULL, 'Viaje urbano no debe tener tramo exterior';

  RAISE NOTICE 'OK · corredor RP11';
END $$;

-- 3 · Integridad geográfica --------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO localities (code, name, corridor_order, geom)
    VALUES ('SOLAPADA', 'Solapada', 99, ST_Multi(ST_MakeEnvelope(-56.70, -36.70, -56.66, -36.68, 4326)));
    RAISE EXCEPTION 'TEST FAILED: se aceptó una localidad superpuesta';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'OK · localidad superpuesta rechazada (%)', SQLERRM;
  END;

  BEGIN
    INSERT INTO dispatch_zones (locality_id, code, name, kind, geom)
    VALUES ((SELECT id FROM localities WHERE code = 'SAN_BERNARDO'), 'ZONA_INVALIDA', 'Fuera', 'DOWNTOWN',
            ST_MakeEnvelope(-56.69, -36.72, -56.67, -36.69, 4326));
    RAISE EXCEPTION 'TEST FAILED: se aceptó una zona que excede su localidad';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · zona fuera de localidad rechazada';
  END;
END $$;

-- 4 · CUIT/CUIL y elegibilidad de flota -------------------------------------------
DO $$
DECLARE r record;
BEGIN
  ASSERT is_valid_cuit('20284567898') AND is_valid_cuit('27259873210') AND is_valid_cuit('30712345671'), 'CUIT válidos rechazados';
  ASSERT NOT is_valid_cuit('20284567890'), 'CUIT con dígito verificador incorrecto aceptado';
  ASSERT NOT is_valid_cuit('99284567898'), 'CUIT con prefijo inválido aceptado';

  FOR r IN
    SELECT d.dni, e.is_eligible, e.blocking_reasons
    FROM v_driver_vehicle_eligibility e JOIN drivers d ON d.id = e.driver_id
  LOOP
    CASE r.dni
      WHEN '28456789' THEN ASSERT r.is_eligible, format('Martín debería operar: %s', r.blocking_reasons);
      WHEN '25987321' THEN ASSERT r.is_eligible, format('Carla debería operar: %s', r.blocking_reasons);
      WHEN '31222333' THEN ASSERT r.is_eligible, format('Diego debería operar: %s', r.blocking_reasons);
      WHEN '35666777' THEN ASSERT r.blocking_reasons @> ARRAY['LICENCIA_PROFESIONAL_VENCIDA', 'VTV_VENCIDA'], format('Lucía: %s', r.blocking_reasons);
      WHEN '30111222' THEN ASSERT r.blocking_reasons = ARRAY['CHOFER_SUSPENDED'], format('Raúl: %s', r.blocking_reasons);
      WHEN '33444555' THEN ASSERT r.blocking_reasons = ARRAY['HABILITACION_AGENCIA_VENCIDA'], format('Sofía: %s', r.blocking_reasons);
      ELSE NULL;
    END CASE;
  END LOOP;
  RAISE NOTICE 'OK · elegibilidad de flota';
END $$;

-- 5 · Cuadro tarifario --------------------------------------------------------------
DO $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM tariff_rules r JOIN tariff_schedules s ON s.id = r.schedule_id
  WHERE s.code = 'CT-2026-2027';
  ASSERT v_count = 16, format('Se esperaban 16 reglas (2 servicios x 2 alcances x 2 temporadas x 2 franjas), hay %s', v_count);

  ASSERT season_for('2027-01-15') = 'HIGH' AND season_for('2027-03-15') = 'LOW' AND season_for('2026-11-20') = 'LOW',
    'Calendario de temporada incorrecto';

  BEGIN
    INSERT INTO tariff_schedules (code, legal_instrument, status, validity, approved_by, approved_at)
    VALUES ('SOLAPADO', 'test', 'APPROVED', tstzrange('2027-06-01 00:00-03', '2028-01-01 00:00-03', '[)'), 'test', now());
    RAISE EXCEPTION 'TEST FAILED: dos cuadros aprobados con vigencia superpuesta';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'OK · cuadros tarifarios superpuestos rechazados';
  END;
END $$;

-- 6 · Viajes: habilitación al asignar y anti doble asignación ----------------------
DO $$
DECLARE
  v_passenger uuid := (SELECT id FROM passengers LIMIT 1);
  v_rule      uuid := (SELECT r.id FROM tariff_rules r JOIN tariff_schedules s ON s.id = r.schedule_id
                       WHERE s.code = 'CT-2026-2027' AND r.service_type = 'TAXI' AND r.scope = 'URBAN'
                         AND r.season = 'LOW' AND r.time_band = 'DAY');
  v_sb        uuid := (SELECT id FROM localities WHERE code = 'SAN_BERNARDO');
  v_martin    uuid := (SELECT id FROM drivers WHERE dni = '28456789');
  v_martin_car uuid := (SELECT id FROM vehicles WHERE plate = 'AE123BC');
  v_lucia     uuid := (SELECT id FROM drivers WHERE dni = '35666777');
  v_lucia_car uuid := (SELECT id FROM vehicles WHERE plate = 'AC321HJ');
  v_trip1 uuid;
  v_trip2 uuid;
  v_rows int;
BEGIN
  INSERT INTO trips (passenger_id, channel, service_type, status, origin, destination,
                     origin_locality_id, destination_locality_id, scope, tariff_rule_id,
                     pricing_instant, quoted_fare_cents, fare_breakdown, payment_method)
  VALUES (v_passenger, 'GUEST_QR_PWA', 'TAXI', 'SEARCHING',
          ST_SetSRID(ST_MakePoint(-56.680, -36.6875), 4326), ST_SetSRID(ST_MakePoint(-56.690, -36.695), 4326),
          v_sb, v_sb, 'URBAN', v_rule, now(), 484000, '{}'::jsonb, 'CASH')
  RETURNING id INTO v_trip1;

  INSERT INTO trips (passenger_id, channel, service_type, status, origin, destination,
                     origin_locality_id, destination_locality_id, scope, tariff_rule_id,
                     pricing_instant, quoted_fare_cents, fare_breakdown, payment_method)
  VALUES (v_passenger, 'PHONE_OPERATOR', 'TAXI', 'SEARCHING',
          ST_SetSRID(ST_MakePoint(-56.685, -36.690), 4326), ST_SetSRID(ST_MakePoint(-56.690, -36.695), 4326),
          v_sb, v_sb, 'URBAN', v_rule, now(), 400000, '{}'::jsonb, 'CASH')
  RETURNING id INTO v_trip2;

  BEGIN
    UPDATE trips SET status = 'ASSIGNED', driver_id = v_lucia, vehicle_id = v_lucia_car, assigned_at = now()
    WHERE id = v_trip1;
    RAISE EXCEPTION 'TEST FAILED: se asignó un chofer inhabilitado';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'OK · asignación bloqueada: %', SQLERRM;
  END;

  -- Aceptación atómica: solo gana quien encuentra el viaje todavía en SEARCHING con la versión esperada.
  UPDATE trips SET status = 'ASSIGNED', driver_id = v_martin, vehicle_id = v_martin_car,
                   assigned_at = now(), version = version + 1
  WHERE id = v_trip1 AND status = 'SEARCHING' AND version = 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  ASSERT v_rows = 1, 'La primera aceptación debe ganar';

  UPDATE trips SET status = 'ASSIGNED', driver_id = v_martin, vehicle_id = v_martin_car, version = version + 1
  WHERE id = v_trip1 AND status = 'SEARCHING' AND version = 0;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  ASSERT v_rows = 0, 'Una segunda aceptación concurrente no debe aplicar';

  ASSERT (SELECT agency_id IS NULL FROM trips WHERE id = v_trip1), 'Taxi independiente sin agencia';

  BEGIN
    UPDATE trips SET status = 'ASSIGNED', driver_id = v_martin, vehicle_id = v_martin_car, assigned_at = now()
    WHERE id = v_trip2;
    RAISE EXCEPTION 'TEST FAILED: un chofer quedó con dos viajes activos';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK · un chofer no puede tener dos viajes activos';
  END;

  -- Alertas de pánico: enriquecimiento con localidad + idempotencia por client_event_id.
  INSERT INTO panic_alerts (client_event_id, trip_id, raised_by, passenger_id, driver_id, vehicle_id,
                            location, accuracy_m, channel, snapshot, occurred_at)
  VALUES ('6f0c1e9a-0000-4000-8000-000000000001', v_trip1, 'PASSENGER', v_passenger, v_martin, v_martin_car,
          ST_SetSRID(ST_MakePoint(-56.692, -36.536), 4326), 12.5, 'APP', '{}'::jsonb, now());
  ASSERT (SELECT locality_id FROM panic_alerts WHERE client_event_id = '6f0c1e9a-0000-4000-8000-000000000001')
         = (SELECT id FROM localities WHERE code = 'SANTA_TERESITA'), 'La alerta debe resolver su localidad';

  BEGIN
    INSERT INTO panic_alerts (client_event_id, raised_by, passenger_id, location, channel, snapshot, occurred_at)
    VALUES ('6f0c1e9a-0000-4000-8000-000000000001', 'PASSENGER', v_passenger,
            ST_SetSRID(ST_MakePoint(-56.692, -36.536), 4326), 'APP', '{}'::jsonb, now());
    RAISE EXCEPTION 'TEST FAILED: alerta duplicada aceptada';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK · reintento de alerta idempotente';
  END;
END $$;
