-- =============================================================================
-- Fase 3: vistas, funciones helper y limpieza para el backend
-- =============================================================================
-- Vistas de consulta, funciones de soporte y tareas de mantenimiento que el
-- backend (API) y el panel COM van a usar. No cambia el esquema de tablas.

-- -----------------------------------------------------------------------------
-- Vista: resumen de pagos por viaje
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_payment_summary AS
SELECT
  t.id                                    AS trip_id,
  t.payment_method                        AS trip_payment_method,
  t.payment_status                        AS trip_payment_status,
  t.quoted_fare_cents                     AS quoted_fare_cents,
  t.final_fare_cents                      AS final_fare_cents,
  COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status = 'PAID'), 0) AS paid_cents,
  COUNT(p.id)                             AS payments_count,
  MAX(p.paid_at)                          AS last_paid_at,
  (SELECT p2.status FROM payments p2 WHERE p2.trip_id = t.id ORDER BY p2.created_at DESC LIMIT 1) AS last_payment_status
FROM trips t
LEFT JOIN payments p ON p.trip_id = t.id
GROUP BY t.id;

-- -----------------------------------------------------------------------------
-- Vista: alertas de pánico abiertas para el COM (con datos del viaje/chofer)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_com_open_alerts AS
SELECT
  pa.id,
  pa.client_event_id,
  pa.trip_id,
  pa.raised_by,
  pa.passenger_id,
  pa.driver_id,
  pa.vehicle_id,
  pa.location,
  pa.accuracy_m,
  pa.locality_id,
  pa.channel,
  pa.status,
  pa.snapshot,
  pa.occurred_at,
  pa.received_at,
  pa.acknowledged_at,
  pa.acknowledged_by,
  pa.escalated_at,
  pa.escalation_count,
  t.public_code       AS trip_public_code,
  t.status            AS trip_status,
  d.first_name        AS driver_first_name,
  d.last_name         AS driver_last_name,
  v.plate             AS vehicle_plate
FROM panic_alerts pa
LEFT JOIN trips t    ON t.id = pa.trip_id
LEFT JOIN drivers d  ON d.id = pa.driver_id
LEFT JOIN vehicles v ON v.id = pa.vehicle_id
WHERE pa.status IN ('OPEN', 'ACKNOWLEDGED', 'UNITS_DISPATCHED');

-- -----------------------------------------------------------------------------
-- Función: saldo disponible de un voucher (fuente de verdad: balance_cents)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION voucher_available_balance(p_voucher_id uuid)
RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(balance_cents, 0) FROM vouchers WHERE id = p_voucher_id
$$;

-- -----------------------------------------------------------------------------
-- Función: ¿puede el voucher cubrir un monto?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION voucher_can_cover(p_voucher_id uuid, p_amount_cents integer)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE((SELECT balance_cents >= p_amount_cents AND is_active
                   AND now() BETWEEN valid_from AND valid_until
                   FROM vouchers WHERE id = p_voucher_id), false)
$$;

-- -----------------------------------------------------------------------------
-- Función: total pagado (PAID) de un viaje
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trip_paid_cents(p_trip_id uuid)
RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(SUM(amount_cents), 0)::integer
  FROM payments
  WHERE trip_id = p_trip_id AND status = 'PAID'
$$;

-- -----------------------------------------------------------------------------
-- Funciones de mantenimiento: limpieza de registros vencidos
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM idempotency_keys WHERE expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION cleanup_expired_otp_challenges()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM otp_challenges WHERE expires_at < now() - interval '1 day';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION cleanup_expired_refresh_tokens()
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM auth_refresh_tokens WHERE expires_at < now() - interval '7 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- -----------------------------------------------------------------------------
-- Índices adicionales para consultas del backend / panel
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS payments_status_created_idx ON payments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS vouchers_active_valid_until_idx ON vouchers (is_active, valid_until) WHERE is_active;
CREATE INDEX IF NOT EXISTS panic_alerts_status_received_idx ON panic_alerts (status, received_at DESC);