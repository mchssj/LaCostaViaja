-- =============================================================================
-- SEED · Corredor RP11, 14 localidades del Partido de La Costa y zonas de despacho
-- =============================================================================
-- ⚠ GEOMETRÍAS APROXIMADAS PARA DESARROLLO. Son envolventes simplificadas (costa → oeste de RP11)
--   construidas a partir de coordenadas públicas aproximadas. Antes de producción deben
--   reemplazarse por las capas oficiales (Catastro municipal / ARBA / IGN).
--   Entre San Clemente y Las Toninas, y al sur de Nueva Atlántida, hay tramos rurales sin
--   polígono: se resuelven con NEAREST_FALLBACK.

INSERT INTO corridor_axes (code, name, geom) VALUES (
  'RP11',
  'Ruta Provincial 11 (Interbalnearia) · eje aproximado, dibujado norte → sur',
  ST_GeomFromText(
    'LINESTRING(-56.740 -36.310, -56.735 -36.360, -56.722 -36.420, -56.712 -36.470, -56.705 -36.520,'
    ' -56.700 -36.560, -56.697 -36.600, -56.695 -36.640, -56.694 -36.680, -56.694 -36.720,'
    ' -56.696 -36.770, -56.700 -36.830, -56.710 -36.880, -56.740 -36.940, -56.775 -37.000, -56.790 -37.035)',
    4326)
);

-- corridor_order: 1 = extremo norte. Envolvente: (lon_min, lat_min, lon_max, lat_max).
INSERT INTO localities (code, name, corridor_order, geom)
SELECT v.code, v.name, v.ord, ST_Multi(ST_MakeEnvelope(v.xmin, v.ymin, v.xmax, v.ymax, 4326))
FROM (VALUES
  ('SAN_CLEMENTE',      'San Clemente del Tuyú',  1, -56.790, -36.405, -56.680, -36.300),
  ('LAS_TONINAS',       'Las Toninas',            2, -56.735, -36.505, -56.665, -36.465),
  ('COSTA_CHICA',       'Costa Chica',            3, -56.735, -36.515, -56.665, -36.505),
  ('SANTA_TERESITA',    'Santa Teresita',         4, -56.735, -36.560, -56.665, -36.515),
  ('MAR_DEL_TUYU',      'Mar del Tuyú',           5, -56.730, -36.590, -56.662, -36.560),
  ('COSTA_DEL_ESTE',    'Costa del Este',         6, -56.730, -36.618, -56.662, -36.590),
  ('AGUAS_VERDES',      'Aguas Verdes',           7, -56.728, -36.645, -56.660, -36.618),
  ('LA_LUCILA_DEL_MAR', 'La Lucila del Mar',      8, -56.728, -36.668, -56.658, -36.645),
  ('COSTA_AZUL',        'Costa Azul',             9, -56.728, -36.677, -56.658, -36.668),
  ('SAN_BERNARDO',      'San Bernardo del Tuyú', 10, -56.728, -36.703, -56.655, -36.677),
  ('MAR_DE_AJO',        'Mar de Ajó',            11, -56.728, -36.745, -56.655, -36.703),
  ('NUEVA_ATLANTIS',    'Nueva Atlantis',        12, -56.728, -36.790, -56.655, -36.745),
  ('PINAR_DEL_SOL',     'Pinar del Sol',         13, -56.735, -36.880, -56.650, -36.840),
  ('COSTA_ESMERALDA',   'Costa Esmeralda',       14, -56.820, -37.030, -56.740, -36.975)
) AS v(code, name, ord, xmin, ymin, xmax, ymax);

-- Zonas de despacho de alta demanda (ubicaciones aproximadas).
INSERT INTO dispatch_zones (locality_id, code, name, kind, geom, pickup_point, stand_capacity, dispatch_priority, is_high_demand)
SELECT l.id, v.code, v.name, v.kind::zone_kind,
       ST_MakeEnvelope(v.xmin, v.ymin, v.xmax, v.ymax, 4326),
       ST_SetSRID(ST_MakePoint(v.px, v.py), 4326),
       v.capacity, v.priority, v.high_demand
FROM (VALUES
  ('SAN_BERNARDO',   'SB_CENTRO_CHIOZZA',   'San Bernardo · Centro comercial (Av. Chiozza)',   'DOWNTOWN',   -56.690, -36.692, -56.668, -36.683, -56.6790, -36.6875, 12::smallint, 5::smallint, true),
  ('SAN_BERNARDO',   'SB_PARADA_COSTANERA', 'San Bernardo · Parada Chiozza y Costanera',       'TAXI_STAND', -56.6720, -36.6895, -56.6690, -36.6870, -56.6705, -36.6882, 6::smallint, 3::smallint, true),
  ('SANTA_TERESITA', 'ST_CENTRO_CALLE_2',   'Santa Teresita · Centro (Calle 2)',               'DOWNTOWN',   -56.700, -36.545, -56.684, -36.528, -56.6920, -36.5360, 10::smallint, 5::smallint, true),
  ('MAR_DE_AJO',     'MDA_CENTRO',          'Mar de Ajó · Centro',                             'DOWNTOWN',   -56.690, -36.722, -56.670, -36.710, -56.6800, -36.7160, 8::smallint, 4::smallint, true),
  ('SAN_CLEMENTE',   'SC_CENTRO',           'San Clemente del Tuyú · Centro',                  'DOWNTOWN',   -56.735, -36.365, -56.712, -36.350, -56.7240, -36.3570, 8::smallint, 4::smallint, true)
) AS v(locality_code, code, name, kind, xmin, ymin, xmax, ymax, px, py, capacity, priority, high_demand)
JOIN localities l ON l.code = v.locality_code;
