# App del Chofer (React Native · Expo · Android) — Fase 4

Se genera en la Fase 4 con `create-expo-app` (no se scaffoldea antes para no fijar versiones de Expo/RN que quedarían viejas).

Alcance previsto:
- Inicio/cierre de turno con validación de habilitación (consume `v_driver_vehicle_eligibility` vía API).
- Preferencia urbana / interurbana y aviso de **Viaje de Vuelta** (backhaul) al terminar un viaje interurbano.
- Tracking GPS en segundo plano con buffer offline (eventos con `client_event_id` idempotente).
- Taxímetro digital resiliente: reutiliza `computeFare()` de `@lacosta/domain` con el cuadro tarifario cacheado, para seguir midiendo si se corta la red.
- Botón de pánico (envío con reintentos idempotentes + fallback SMS).
