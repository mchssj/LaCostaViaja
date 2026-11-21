-- =============================================================================
-- SEED · Flota DEMO (datos ficticios) con casos de habilitación vigente y bloqueada
-- =============================================================================
-- Fechas relativas a ar_today() para que la demo no "venza" con el tiempo.
-- Casos:
--   Martín Sosa      · taxi independiente San Bernardo    → HABILITADO
--   Carla Benítez    · Remis Chiozza (San Bernardo)       → HABILITADA
--   Diego Romero     · Remises del Tuyú (Santa Teresita)  → HABILITADO
--   Lucía Fernández  · taxi Mar de Ajó                    → BLOQUEADA (licencia profesional y VTV vencidas)
--   Raúl Medina      · taxi Santa Teresita                → BLOQUEADO (suspendido)
--   Sofía Acosta     · Remises Mar de Ajó                 → BLOQUEADA (habilitación de la agencia vencida)

INSERT INTO agencies (cuit, legal_name, trade_name, locality_id, address, base_location, phone,
                      municipal_permit_number, permit_expires_on, status)
SELECT v.cuit, v.legal_name, v.trade_name, l.id, v.address,
       ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326), v.phone, v.permit,
       ar_today() + v.permit_days, 'ACTIVE'
FROM (VALUES
  ('30712345671', 'Remises del Tuyú S.R.L.',  'Remises del Tuyú',  'SANTA_TERESITA', 'Calle 2 (demo), Santa Teresita',      -36.5370, -56.6930, '+5492246400100', 'AG-ST-0012',  400),
  ('30709876542', 'Chiozza Movilidad S.A.',   'Remis Chiozza',     'SAN_BERNARDO',   'Av. Chiozza (demo), San Bernardo',    -36.6880, -56.6850, '+5492257400200', 'AG-SB-0007',  300),
  ('30715558889', 'Ajó Traslados S.R.L.',     'Remises Mar de Ajó','MAR_DE_AJO',     'Av. Libertador (demo), Mar de Ajó',   -36.7170, -56.6820, '+5492257400300', 'AG-MDA-0003', -20)
) AS v(cuit, legal_name, trade_name, locality_code, address, lat, lng, phone, permit, permit_days)
JOIN localities l ON l.code = v.locality_code;

INSERT INTO drivers (agency_id, base_locality_id, dni, cuil, first_name, last_name, phone,
                     professional_license_number, professional_license_class, professional_license_expires_on,
                     municipal_driver_permit_number, municipal_driver_permit_expires_on, criminal_record_expires_on,
                     status, suspension_reason, suspended_until)
SELECT a.id, l.id, v.dni, v.cuil, v.first_name, v.last_name, v.phone,
       'LP-' || v.dni, 'D1', ar_today() + v.license_days,
       v.permit, ar_today() + v.permit_days, ar_today() + 180,
       v.status::permit_status, v.suspension_reason,
       CASE WHEN v.status = 'SUSPENDED' THEN ar_today() + 30 END
FROM (VALUES
  (NULL,          'SAN_BERNARDO',   '28456789', '20284567898', 'Martín', 'Sosa',      '+5492257410101', 400, 'CH-LC-0101', 300, 'ACTIVE',    NULL),
  ('30709876542', 'SAN_BERNARDO',   '25987321', '27259873210', 'Carla',  'Benítez',   '+5492257410102', 500, 'CH-LC-0102', 250, 'ACTIVE',    NULL),
  ('30712345671', 'SANTA_TERESITA', '31222333', '20312223334', 'Diego',  'Romero',    '+5492246410103', 350, 'CH-LC-0103', 200, 'ACTIVE',    NULL),
  (NULL,          'MAR_DE_AJO',     '35666777', '27356667773', 'Lucía',  'Fernández', '+5492257410104', -10, 'CH-LC-0104', 150, 'ACTIVE',    NULL),
  (NULL,          'SANTA_TERESITA', '30111222', '20301112220', 'Raúl',   'Medina',    '+5492246410105', 300, 'CH-LC-0105', 300, 'SUSPENDED', 'Sanción de Tránsito (demo): exceso de velocidad en RP11'),
  ('30715558889', 'MAR_DE_AJO',     '33444555', '27334445556', 'Sofía',  'Acosta',    '+5492257410106', 365, 'CH-LC-0106', 365, 'ACTIVE',    NULL)
) AS v(agency_cuit, locality_code, dni, cuil, first_name, last_name, phone, license_days, permit, permit_days, status, suspension_reason)
JOIN localities l ON l.code = v.locality_code
LEFT JOIN agencies a ON a.cuit = v.agency_cuit;

INSERT INTO vehicles (agency_id, service_type, plate, make, model, model_year, color, passenger_seats,
                      wheelchair_accessible, owner_name, owner_cuit,
                      municipal_vehicle_permit_number, municipal_vehicle_permit_expires_on,
                      vtv_expires_on, insurer_name, insurance_policy_number, passenger_insurance_expires_on, status)
SELECT a.id, v.service_type::service_type, v.plate, v.make, v.model, v.model_year, v.color, 4,
       v.accessible, v.owner_name, v.owner_cuit,
       v.permit, ar_today() + 365,
       ar_today() + v.vtv_days, 'Aseguradora Demo S.A.', 'POL-' || v.plate, ar_today() + 200, 'ACTIVE'
FROM (VALUES
  (NULL,          'TAXI',  'AE123BC', 'Toyota',    'Etios',   2021, 'Blanco', false, 'Martín Sosa',              '20284567898', 'TX-SB-045',   200),
  ('30709876542', 'REMIS', 'AF456DE', 'Fiat',      'Cronos',  2022, 'Gris',   false, 'Chiozza Movilidad S.A.',   '30709876542', 'RM-SB-112',   250),
  ('30712345671', 'REMIS', 'AD789FG', 'Chevrolet', 'Onix',    2020, 'Negro',  true,  'Remises del Tuyú S.R.L.',  '30712345671', 'RM-ST-031',   150),
  (NULL,          'TAXI',  'AC321HJ', 'Renault',   'Logan',   2019, 'Blanco', false, 'Lucía Fernández',          '27356667773', 'TX-MDA-019',  -45),
  (NULL,          'TAXI',  'AB654KL', 'Volkswagen','Voyage',  2018, 'Blanco', false, 'Raúl Medina',              '20301112220', 'TX-ST-027',   120),
  ('30715558889', 'REMIS', 'AG987MN', 'Peugeot',   '208',     2023, 'Azul',   false, 'Ajó Traslados S.R.L.',     '30715558889', 'RM-MDA-008',  300)
) AS v(agency_cuit, service_type, plate, make, model, model_year, color, accessible, owner_name, owner_cuit, permit, vtv_days)
LEFT JOIN agencies a ON a.cuit = v.agency_cuit;

INSERT INTO driver_vehicle_compliance (driver_id, vehicle_id, role, authorization_number, validity,
                                       status, verified_by, verified_at)
SELECT d.id, ve.id, v.role::driver_vehicle_role, v.authorization_number,
       daterange(ar_today() - 120, ar_today() + 400, '[)'),
       'ACTIVE', 'seed', now()
FROM (VALUES
  ('28456789', 'AE123BC', 'OWNER_DRIVER',   'DISP-2026-0451'),
  ('25987321', 'AF456DE', 'PRIMARY_DRIVER', 'DISP-2026-0452'),
  ('31222333', 'AD789FG', 'PRIMARY_DRIVER', 'DISP-2026-0453'),
  ('35666777', 'AC321HJ', 'OWNER_DRIVER',   'DISP-2026-0454'),
  ('30111222', 'AB654KL', 'OWNER_DRIVER',   'DISP-2026-0455'),
  ('33444555', 'AG987MN', 'PRIMARY_DRIVER', 'DISP-2026-0456')
) AS v(dni, plate, role, authorization_number)
JOIN drivers  d  ON d.dni = v.dni
JOIN vehicles ve ON ve.plate = v.plate;

-- Pasajero invitado de demo (Modo QR).
INSERT INTO passengers (kind, guest_session_hash)
VALUES ('GUEST', encode(digest('demo-guest-session', 'sha256'), 'hex'));
