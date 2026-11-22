-- =============================================================================
-- Reemplazo de un cuadro tarifario (complementa 20261122120000).
-- Al aprobar un cuadro nuevo que empieza el día X, el vigente tiene que terminar en X. Un cuadro
-- aprobado sigue sin poder editarse, con UNA excepción: ACORTAR su vigencia (fijar o adelantar el
-- fin) a un instante futuro. Nunca alargarla, moverle el inicio ni cerrarla hacia atrás.
-- =============================================================================
CREATE OR REPLACE FUNCTION tariff_schedules_immutable_when_approved() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  shortening boolean;
BEGIN
  IF OLD.status = 'APPROVED' THEN
    shortening := NEW.status = 'APPROVED'
      AND lower(NEW.validity) = lower(OLD.validity)
      AND upper(NEW.validity) IS NOT NULL
      AND (upper(OLD.validity) IS NULL OR upper(NEW.validity) < upper(OLD.validity))
      AND upper(NEW.validity) >= now();
    IF NEW.status = 'DRAFT'
       OR (NEW.validity IS DISTINCT FROM OLD.validity AND NEW.status = 'APPROVED' AND NOT shortening)
       OR NEW.night_starts_at IS DISTINCT FROM OLD.night_starts_at
       OR NEW.night_ends_at IS DISTINCT FROM OLD.night_ends_at
       OR NEW.interurban_min_outside_m IS DISTINCT FROM OLD.interurban_min_outside_m
       OR NEW.rounding_step_cents IS DISTINCT FROM OLD.rounding_step_cents
       OR NEW.quote_ttl_seconds IS DISTINCT FROM OLD.quote_ttl_seconds
       OR NEW.legal_instrument IS DISTINCT FROM OLD.legal_instrument THEN
      RAISE EXCEPTION 'Un cuadro tarifario aprobado no se modifica: solo se puede retirar o acortar su vigencia'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.status = 'RETIRED' AND NEW.status <> 'RETIRED' THEN
    RAISE EXCEPTION 'Un cuadro retirado no se reactiva' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
