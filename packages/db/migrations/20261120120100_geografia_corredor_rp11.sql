-- =============================================================================
-- Geografía: corredor RP11, localidades, zonas de despacho y funciones espaciales
-- =============================================================================
-- Modelo lineal: el partido es una franja de ~100 km x 2-4 km. Además de los polígonos,
-- cada punto se proyecta sobre el eje de la Ruta Provincial 11 (referenciación lineal) para:
--   * saber el sentido del viaje (NORTHBOUND / SOUTHBOUND),
--   * medir cuánto del recorrido cae fuera de la localidad de origen (Retorno Interurbano)
--     cuando no hay geometría de ruta (ruteo degradado),
--   * en Fase 2, buscar choferes "aguas arriba/abajo" del corredor y backhaul.

-- -----------------------------------------------------------------------------
-- Eje del corredor
-- -----------------------------------------------------------------------------
CREATE TABLE corridor_axes (
  code       text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{2,20}$'),
  name       text NOT NULL,
  -- Dibujado de NORTE a SUR: la progresiva (metros) crece hacia el sur.
  geom       geometry(LineString, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corridor_axes_geom_valid CHECK (ST_IsValid(geom) AND ST_NPoints(geom) >= 2)
);
CREATE INDEX corridor_axes_geom_gix ON corridor_axes USING gist (geom);

-- -----------------------------------------------------------------------------
-- Localidades
-- -----------------------------------------------------------------------------
CREATE TABLE localities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE CHECK (code ~ '^[A-Z_]{3,40}$'),
  name           text NOT NULL,
  -- 1 = extremo norte (San Clemente del Tuyú). Define el orden sobre el corredor.
  corridor_order smallint NOT NULL UNIQUE CHECK (corridor_order > 0),
  geom           geometry(MultiPolygon, 4326) NOT NULL,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT localities_geom_valid CHECK (ST_IsValid(geom) AND NOT ST_IsEmpty(geom))
);
CREATE INDEX localities_geom_gix ON localities USING gist (geom);
CREATE TRIGGER localities_updated_at BEFORE UPDATE ON localities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Los polígonos pueden tocarse (borde compartido) pero NUNCA superponerse en su interior:
-- un punto debe pertenecer a una sola localidad para que la tarifa sea determinística.
CREATE OR REPLACE FUNCTION trg_localities_no_overlap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_conflict text;
BEGIN
  -- Serializa altas/ediciones concurrentes de polígonos (operación administrativa poco frecuente).
  PERFORM pg_advisory_xact_lock(hashtext('localities.geom'));
  SELECT l.code INTO v_conflict
  FROM localities l
  WHERE l.id <> NEW.id
    AND l.geom && NEW.geom
    AND ST_Relate(l.geom, NEW.geom, '2********')  -- intersección de interiores con dimensión 2
  LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'El polígono de % se superpone con %', NEW.code, v_conflict
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER localities_no_overlap
  BEFORE INSERT OR UPDATE OF geom ON localities
  FOR EACH ROW EXECUTE FUNCTION trg_localities_no_overlap();

-- -----------------------------------------------------------------------------
-- Zonas de despacho / paradas
-- -----------------------------------------------------------------------------
CREATE TABLE dispatch_zones (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locality_id       uuid NOT NULL REFERENCES localities (id),
  code              text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]{3,40}$'),
  name              text NOT NULL,
  kind              zone_kind NOT NULL,
  geom              geometry(Polygon, 4326) NOT NULL,
  pickup_point      geometry(Point, 4326),        -- punto de ascenso sugerido (parada física)
  stand_capacity    smallint CHECK (stand_capacity IS NULL OR stand_capacity > 0),
  dispatch_priority smallint NOT NULL DEFAULT 0 CHECK (dispatch_priority BETWEEN -10 AND 10),
  is_high_demand    boolean NOT NULL DEFAULT false, -- p. ej. Av. Chiozza / Calle 2 en temporada
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_zones_geom_valid CHECK (ST_IsValid(geom))
);
CREATE INDEX dispatch_zones_geom_gix ON dispatch_zones USING gist (geom);
CREATE INDEX dispatch_zones_pickup_gix ON dispatch_zones USING gist (pickup_point);
CREATE INDEX dispatch_zones_locality_idx ON dispatch_zones (locality_id);
CREATE TRIGGER dispatch_zones_updated_at BEFORE UPDATE ON dispatch_zones FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION trg_dispatch_zones_within_locality() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_locality geometry;
BEGIN
  SELECT l.geom INTO v_locality FROM localities l WHERE l.id = NEW.locality_id;
  IF v_locality IS NULL THEN
    RAISE EXCEPTION 'Localidad % inexistente', NEW.locality_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT ST_CoveredBy(NEW.geom, v_locality) THEN
    RAISE EXCEPTION 'La zona % excede los límites de su localidad', NEW.code USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.pickup_point IS NOT NULL AND NOT ST_Covers(NEW.geom, NEW.pickup_point) THEN
    RAISE EXCEPTION 'El punto de ascenso de % está fuera de la zona', NEW.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER dispatch_zones_within_locality
  BEFORE INSERT OR UPDATE OF geom, pickup_point, locality_id ON dispatch_zones
  FOR EACH ROW EXECUTE FUNCTION trg_dispatch_zones_within_locality();

-- -----------------------------------------------------------------------------
-- Funciones espaciales
-- -----------------------------------------------------------------------------

-- Progresiva (m) de un punto sobre el eje del corredor, en SRID métrico.
CREATE OR REPLACE FUNCTION corridor_position_m(p_point geometry, p_corridor text DEFAULT 'RP11')
RETURNS double precision
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT ST_LineLocatePoint(m.axis, m.pt) * ST_Length(m.axis)
  FROM (
    SELECT ST_Transform(a.geom, lc_metric_srid())                        AS axis,
           ST_Transform(ST_SetSRID(p_point, 4326), lc_metric_srid())     AS pt
    FROM corridor_axes a
    WHERE a.code = p_corridor
  ) m
$$;

-- "Sombra" de cada localidad sobre el corredor: [from_m, to_m] proyectando sus vértices.
-- Robusto aunque el eje no atraviese el polígono.
CREATE OR REPLACE VIEW v_locality_corridor_ranges AS
SELECT l.id   AS locality_id,
       l.code,
       l.corridor_order,
       min(p.pos_m) AS from_m,
       max(p.pos_m) AS to_m
FROM localities l
CROSS JOIN LATERAL (
  SELECT corridor_position_m(dp.geom) AS pos_m
  FROM ST_DumpPoints(l.geom) AS dp
) p
GROUP BY l.id, l.code, l.corridor_order;

-- Resolución de localidad de un punto:
--   1) CONTAINED: ST_Covers (incluye el borde). Si cae justo sobre un borde compartido,
--      desempata de forma determinística por corridor_order (la más al norte).
--   2) NEAREST_FALLBACK: tramos rurales entre localidades, playa, GPS impreciso.
--      KNN (<->) sobre el índice GIST para candidatos y distancia geodésica real para elegir.
--   3) Sin filas: fuera del área de servicio.
CREATE OR REPLACE FUNCTION resolve_locality(
  p_lon            double precision,
  p_lat            double precision,
  p_max_fallback_m double precision DEFAULT 6000
)
RETURNS TABLE (
  locality_id    uuid,
  locality_code  text,
  locality_name  text,
  corridor_order smallint,
  method         text,
  distance_m     double precision
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_pt geometry;
BEGIN
  IF p_lon IS NULL OR p_lat IS NULL OR p_lon NOT BETWEEN -180 AND 180 OR p_lat NOT BETWEEN -90 AND 90 THEN
    RAISE EXCEPTION 'Coordenadas inválidas (lon=%, lat=%)', p_lon, p_lat USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_pt := ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326);

  RETURN QUERY
    SELECT l.id, l.code, l.name, l.corridor_order, 'CONTAINED'::text, 0::double precision
    FROM localities l
    WHERE l.is_active AND ST_Covers(l.geom, v_pt)
    ORDER BY l.corridor_order
    LIMIT 1;
  IF FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT c.id, c.code, c.name, c.corridor_order, 'NEAREST_FALLBACK'::text, c.d
    FROM (
      SELECT k.id, k.code, k.name, k.corridor_order,
             ST_Distance(k.geom::geography, v_pt::geography) AS d
      FROM (
        SELECT l.id, l.code, l.name, l.corridor_order, l.geom
        FROM localities l
        WHERE l.is_active
        ORDER BY l.geom <-> v_pt
        LIMIT 5
      ) k
    ) c
    WHERE c.d <= p_max_fallback_m
    ORDER BY c.d
    LIMIT 1;
END $$;

-- Metros de una ruta (geometría real del proveedor de ruteo) que quedan fuera de una localidad.
CREATE OR REPLACE FUNCTION route_outside_locality_m(p_route geometry, p_locality_id uuid)
RETURNS double precision
LANGUAGE sql STABLE AS $$
  SELECT ST_Length(
           ST_Difference(
             ST_Transform(ST_SetSRID(p_route, 4326), lc_metric_srid()),
             ST_Transform(l.geom, lc_metric_srid())
           )
         )
  FROM localities l
  WHERE l.id = p_locality_id
$$;

-- Tramo del viaje respecto de la localidad de origen, en una sola llamada:
--   * progresivas de origen y destino sobre RP11,
--   * rango [from,to] de la localidad de origen,
--   * metros fuera de la localidad medidos sobre el eje (fallback) y sobre la ruta real (si se envía).
CREATE OR REPLACE FUNCTION corridor_stretch(
  p_origin             geometry,
  p_destination        geometry,
  p_origin_locality_id uuid,
  p_route              geometry DEFAULT NULL,
  p_corridor           text DEFAULT 'RP11'
)
RETURNS TABLE (
  origin_pos_m       double precision,
  destination_pos_m  double precision,
  locality_from_m    double precision,
  locality_to_m      double precision,
  corridor_outside_m double precision,
  route_outside_m    double precision
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_o    double precision := corridor_position_m(p_origin, p_corridor);
  v_d    double precision := corridor_position_m(p_destination, p_corridor);
  v_from double precision;
  v_to   double precision;
BEGIN
  IF v_o IS NULL OR v_d IS NULL THEN
    RAISE EXCEPTION 'Corredor % no configurado', p_corridor USING ERRCODE = 'no_data_found';
  END IF;
  SELECT r.from_m, r.to_m INTO v_from, v_to
  FROM v_locality_corridor_ranges r
  WHERE r.locality_id = p_origin_locality_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Localidad % inexistente', p_origin_locality_id USING ERRCODE = 'no_data_found';
  END IF;

  origin_pos_m      := v_o;
  destination_pos_m := v_d;
  locality_from_m   := v_from;
  locality_to_m     := v_to;
  corridor_outside_m := GREATEST(0, CASE
      WHEN v_d > v_to   THEN v_d - GREATEST(v_to, v_o)
      WHEN v_d < v_from THEN LEAST(v_from, v_o) - v_d
      ELSE 0
    END);
  route_outside_m := CASE
      WHEN p_route IS NULL THEN NULL
      ELSE route_outside_locality_m(p_route, p_origin_locality_id)
    END;
  RETURN NEXT;
END $$;
