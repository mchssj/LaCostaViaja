-- =============================================================================
-- Configuración editable (system_settings): valores por defecto, iguales a los que hoy toma la API
-- de las variables de entorno. Son valores de DESARROLLO, a confirmar por el municipio.
-- Idempotente: no pisa un valor ya cambiado desde el panel.
-- =============================================================================
INSERT INTO system_settings (key, group_name, label, description, value_type, value, default_value, min_value, max_value, unit, sort_order)
VALUES
  ('dispatch.offer_timeout_ms', 'Despacho', 'Tiempo para aceptar una oferta',
   'Cuánto tiene el chofer para aceptar antes de que la oferta pase al siguiente.', 'DURATION_MS', '15000', '15000', 5000, 60000, 'ms', 10),
  ('dispatch.max_offers_per_round', 'Despacho', 'Ofertas simultáneas por ronda',
   'A cuántos choferes se ofrece el viaje a la vez en cada ronda.', 'INTEGER', '5', '5', 1, 20, 'choferes', 20),
  ('dispatch.max_search_ms', 'Despacho', 'Tope de búsqueda',
   'Tiempo máximo buscando chofer antes de informar "no hay choferes disponibles".', 'DURATION_MS', '180000', '180000', 30000, 900000, 'ms', 30),
  ('dispatch.rejection_window_ms', 'Despacho', 'Ventana de penalización por rechazo',
   'Durante cuánto tiempo un rechazo baja al chofer en el ranking.', 'DURATION_MS', '1800000', '1800000', 60000, 86400000, 'ms', 40),
  ('trips.no_show_wait_ms', 'Viajes', 'Espera por "no se presentó"',
   'Tiempo mínimo que el chofer espera en la puerta antes de poder cerrar el viaje por ausencia.', 'DURATION_MS', '300000', '300000', 60000, 1800000, 'ms', 10),
  ('trips.cancellation_fee_cents', 'Viajes', 'Cargo por cancelación',
   'Importe que se cobra si el pasajero cancela con el chofer ya en camino. 0 = sin cargo.', 'CENTS', '0', '0', 0, 10000000, '$', 20),
  ('trips.driver_location_throttle_ms', 'Viajes', 'Frecuencia de ubicación al pasajero',
   'Cada cuánto se reenvía la posición del chofer al pasajero durante el viaje.', 'DURATION_MS', '5000', '5000', 1000, 60000, 'ms', 30),
  ('panic.escalate_after_ms', 'Seguridad', 'Escalamiento de alertas de pánico',
   'Si nadie atiende la alerta en este tiempo, se escala al canal de guardia.', 'DURATION_MS', '60000', '60000', 10000, 600000, 'ms', 10),
  ('security.max_failed_logins', 'Seguridad', 'Intentos fallidos antes del bloqueo',
   'Intentos de contraseña (operadores) o PIN (choferes) antes de bloquear la cuenta.', 'INTEGER', '5', '5', 3, 10, 'intentos', 20),
  ('security.lock_minutes', 'Seguridad', 'Duración del bloqueo',
   'Minutos que la cuenta queda bloqueada después de superar los intentos fallidos.', 'INTEGER', '15', '15', 5, 1440, 'min', 30),
  ('retention.track_points_days', 'Conservación de datos', 'Recorrido GPS de los viajes',
   'Días que se conserva el recorrido GPS. Definición pendiente del municipio (Ley 25.326).', 'INTEGER', '180', '180', 30, 3650, 'días', 10),
  ('retention.panic_alerts_days', 'Conservación de datos', 'Alertas de pánico',
   'Días que se conservan las alertas resueltas y su ubicación. Definición pendiente del municipio.', 'INTEGER', '730', '730', 90, 3650, 'días', 20),
  ('retention.rejected_documents_days', 'Conservación de datos', 'Documentos rechazados',
   'Días que se conserva un documento de habilitación rechazado antes de borrarlo.', 'INTEGER', '90', '90', 7, 3650, 'días', 30)
ON CONFLICT (key) DO NOTHING;
