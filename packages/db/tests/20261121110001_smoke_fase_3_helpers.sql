-- =============================================================================
-- Smoke tests Fase 3 helpers: vistas, funciones y limpieza.
-- =============================================================================
DO $$
DECLARE
  v_voucher uuid := (SELECT id FROM vouchers LIMIT 1);
  v_trip    uuid := (SELECT id FROM trips LIMIT 1);
  v_pay     integer;
  v_avail   integer;
  v_cover   boolean;
  v_cleaned integer;
BEGIN
  -- Vista v_payment_summary existe y es consultable.
  PERFORM 1 FROM v_payment_summary LIMIT 1;
  RAISE NOTICE 'OK · v_payment_summary consultable';

  -- Vista v_com_open_alerts existe y es consultable.
  PERFORM 1 FROM v_com_open_alerts LIMIT 1;
  RAISE NOTICE 'OK · v_com_open_alerts consultable';

  -- voucher_available_balance retorna el balance.
  IF v_voucher IS NOT NULL THEN
    v_avail := voucher_available_balance(v_voucher);
    ASSERT v_avail >= 0, 'saldo disponible negativo';
    RAISE NOTICE 'OK · voucher_available_balance = %', v_avail;
  END IF;

  -- voucher_can_cover.
  IF v_voucher IS NOT NULL THEN
    v_cover := voucher_can_cover(v_voucher, 1);
    RAISE NOTICE 'OK · voucher_can_cover(1) = %', v_cover;
  END IF;

  -- trip_paid_cents retorna >= 0.
  IF v_trip IS NOT NULL THEN
    v_pay := trip_paid_cents(v_trip);
    ASSERT v_pay >= 0, 'total pagado negativo';
    RAISE NOTICE 'OK · trip_paid_cents = %', v_pay;
  END IF;

  -- Funciones de limpieza retornan integer >= 0.
  v_cleaned := cleanup_expired_idempotency_keys();
  ASSERT v_cleaned >= 0;
  v_cleaned := cleanup_expired_otp_challenges();
  ASSERT v_cleaned >= 0;
  v_cleaned := cleanup_expired_refresh_tokens();
  ASSERT v_cleaned >= 0;
  RAISE NOTICE 'OK · funciones de limpieza ejecutables';

  RAISE NOTICE 'OK · helpers Fase 3';
END $$;