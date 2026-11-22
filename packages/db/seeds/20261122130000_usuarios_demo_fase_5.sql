-- =============================================================================
-- DEMO (solo desarrollo): un usuario por cada rol nuevo de la Fase 5, con la misma contraseña demo
-- que el resto de los operadores del seed (20261121120000_fase_3_demo_hashes.sql).
-- En producción los usuarios se crean desde el panel con contraseña temporal.
-- =============================================================================
INSERT INTO operator_users (username, password_hash, role, full_name)
SELECT v.username, o.password_hash, v.role::operator_role, v.full_name
FROM (VALUES
  ('habilitaciones', 'LICENSING_OFFICER', 'Oficina de Habilitaciones Demo'),
  ('auditoria',      'AUDITOR',           'Auditoría Demo'),
  ('muni_admin2',    'MUNICIPAL_ADMIN',   'Segundo Administrador Demo (doble control de tarifas)')
) AS v(username, role, full_name)
CROSS JOIN (SELECT password_hash FROM operator_users WHERE username = 'com_operador') o
ON CONFLICT (username) DO NOTHING;
