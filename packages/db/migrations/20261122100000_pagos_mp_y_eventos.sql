-- =============================================================================
-- Fase 3 (rehecha 2026-11-22): garantías de pagos y búsqueda de eventos por seq
-- =============================================================================

-- Preferencia de Checkout Pro (link / QR). provider_reference queda para el id del PAGO
-- que informa el webhook (puede haber varios intentos sobre una misma preferencia).
ALTER TABLE payments ADD COLUMN provider_preference_id text;
CREATE UNIQUE INDEX payments_preference_uq
  ON payments (provider_preference_id) WHERE provider_preference_id IS NOT NULL;

-- Un viaje no puede quedar cobrado dos veces en efectivo / voucher.
CREATE UNIQUE INDEX payments_one_settled_offline_per_trip
  ON payments (trip_id) WHERE method IN ('CASH', 'VOUCHER', 'MUNICIPAL_ACCOUNT') AND status = 'PAID';

-- Un solo cobro de Mercado Pago abierto por viaje (reintentos devuelven el mismo link).
CREATE UNIQUE INDEX payments_one_pending_mp_per_trip
  ON payments (trip_id) WHERE method IN ('MERCADO_PAGO_QR', 'MERCADO_PAGO_LINK') AND status = 'PENDING';

-- Reenvío de eventos perdidos al reconectar: trip_events por viaje en orden de seq (id).
CREATE INDEX trip_events_trip_seq_idx ON trip_events (trip_id, id);

-- Saldo reservado (pendiente) de un voucher para un viaje: reservas − liberaciones − consumos.
CREATE OR REPLACE FUNCTION voucher_trip_hold_cents(p_trip_id uuid)
RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(SUM(CASE movement_type WHEN 'RESERVE' THEN amount_cents ELSE -amount_cents END), 0)::integer
  FROM voucher_movements WHERE trip_id = p_trip_id
$$;

-- Saldo comprometido (reservado y todavía no consumido ni liberado) de un programa.
CREATE OR REPLACE FUNCTION municipal_program_held_cents(p_program_id uuid)
RETURNS integer
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(SUM(CASE m.movement_type WHEN 'RESERVE' THEN m.amount_cents ELSE -m.amount_cents END), 0)::integer
  FROM voucher_movements m JOIN vouchers v ON v.id = m.voucher_id
  WHERE v.program_id = p_program_id
$$;
