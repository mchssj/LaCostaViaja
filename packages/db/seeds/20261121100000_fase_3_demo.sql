-- =============================================================================
-- SEED · Fase 3 DEMO (datos ficticios) — operadores, programas, vouchers y PINs
-- =============================================================================
-- Valores de hash son PLACEHOLDERS de desarrollo (scrypt real se genera en la app).
-- No usar en producción. Las contraseñas/PINs reales se cargan por el backend.
-- Idempotente a nivel de datos: re-correr el seed duplica filas; usar solo en bases limpias o tras reset.

-- Pasajeros registrados de demo (teléfono + nombre).
INSERT INTO passengers (kind, full_name, phone)
VALUES
  ('REGISTERED', 'Pasajero Demo Uno', '+5491112345678'),
  ('REGISTERED', 'Pasajero Demo Dos', '+5491187654321');

-- PIN de autenticación para choferes demo (hash placeholder).
UPDATE drivers SET pin_hash = 'demo_scrypt_pin_hash_placeholder', pin_failed_attempts = 0
WHERE dni IN ('28456789', '25987321', '31222333');

-- Operadores.
INSERT INTO operator_users (username, password_hash, role, agency_id, full_name)
SELECT v.username, v.password_hash, v.role::operator_role, a.id, v.full_name
FROM (VALUES
  ('com_operador',   'demo_scrypt_password_hash_placeholder', 'COM_OPERATOR',      NULL,          'Operador COM Demo'),
  ('muni_admin',     'demo_scrypt_password_hash_placeholder', 'MUNICIPAL_ADMIN',   NULL,          'Administrador Municipal Demo'),
  ('agencia_chiozza','demo_scrypt_password_hash_placeholder', 'AGENCY_OPERATOR',   '30709876542', 'Operador Agencia Chiozza Demo')
) AS v(username, password_hash, role, agency_cuit, full_name)
LEFT JOIN agencies a ON a.cuit = v.agency_cuit;

-- Programas municipales de vouchers.
INSERT INTO municipal_programs (name, program_type, period_start, period_end, budget_cents, is_active)
VALUES
  ('Programa Salud Municipal', 'HEALTH', ar_today(), ar_today() + 365, 50000000, true),
  ('Programa Discapacidad', 'DISABILITY', ar_today(), ar_today() + 365, 30000000, true);

-- Vouchers demo asociados a pasajeros registrados.
INSERT INTO vouchers (code, program_id, initial_balance_cents, balance_cents, valid_from, valid_until,
                      beneficiary_dni_hash, beneficiary_passenger_id, is_active)
SELECT v.code, p.id, v.amount, v.amount, now(), now() + interval '180 days',
       encode(digest(v.dni, 'sha256'), 'hex'), pas.id, true
FROM (VALUES
  ('VCH-SALUD-001', 'Programa Salud Municipal', 2000000, '20284567898'),
  ('VCH-DISC-001',  'Programa Discapacidad',     1500000, '27259873210')
) AS v(code, program_name, amount, dni)
JOIN municipal_programs p ON p.name = v.program_name
JOIN passengers pas ON pas.phone = CASE v.dni
  WHEN '20284567898' THEN '+5491112345678'
  WHEN '27259873210' THEN '+5491187654321'
END;