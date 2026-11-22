-- =============================================================================
-- SEED · Fase 3 DEMO — hashes reales (scrypt) para desarrollo
-- =============================================================================
-- Contraseña de operadores: demo
-- PIN de choferes demo: 123456
-- Generados con apps/api/gen-hash.cjs.

UPDATE operator_users
SET password_hash = '8191859e20fa743ab42ee366df1defbd:b39b11d18ad6e0164268c5b224871d6dcbfa71315c9394cded2a9f1e878899e1794f04dfa0cc36e359b284366e0f304ecc9e72bb63163d04dbe8bede787fafa9'
WHERE username IN ('com_operador', 'muni_admin', 'agencia_chiozza');

UPDATE drivers
SET pin_hash = 'ebba6a9ee40647fe15e9a3c57bc36836:ca0024a898998aa4c721a2fecf3d209903bd106dbc7cfdb477b6224ecc0e1bb6e46f26fd27f3075050fa4b83f784666f4c1f7f25332f227fa5f83b816e9069fe'
WHERE dni IN ('28456789', '25987321', '31222333');