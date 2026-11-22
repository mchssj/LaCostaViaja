-- =============================================================================
-- Ajuste del trigger tariff_rules_only_in_draft (20261122120000).
-- Cuando se borra el cuadro completo (ON DELETE CASCADE), el trigger ya no encuentra al padre y
-- antes lo trataba como "no borrador". Si el padre no existe, la regla se va con él.
-- (Borrar un cuadro aprobado sigue sin hacerse desde la API; esto es para mantenimiento y tests.)
-- =============================================================================
CREATE OR REPLACE FUNCTION tariff_rules_only_in_draft() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st tariff_schedule_status;
  found_parent boolean;
BEGIN
  SELECT status, true INTO st, found_parent FROM tariff_schedules WHERE id = COALESCE(NEW.schedule_id, OLD.schedule_id);
  IF TG_OP = 'DELETE' AND found_parent IS NULL THEN
    RETURN OLD;
  END IF;
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Las reglas de un cuadro % no se pueden modificar: creá un cuadro nuevo', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
