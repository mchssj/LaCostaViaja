import { Inject, Injectable } from '@nestjs/common';
import type { GeoPoint, LocalityResolutionMethod, ResolvedLocality } from '@lacosta/domain';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import type { CorridorStretch, CorridorStretchRequest, ILocalityResolver } from './locality-resolver';

export const CORRIDOR_CODE = 'RP11';

interface ResolveRow {
  locality_id: string;
  locality_code: string;
  locality_name: string;
  corridor_order: number;
  method: LocalityResolutionMethod;
  distance_m: number;
}

interface StretchRow {
  origin_pos_m: number;
  destination_pos_m: number;
  locality_from_m: number;
  locality_to_m: number;
  corridor_outside_m: number;
  route_outside_m: number | null;
}

/** Resolución espacial delegada a las funciones SQL resolve_locality() y corridor_stretch(). */
@Injectable()
export class PostgisLocalityResolver implements ILocalityResolver {
  private readonly fallbackMaxMeters: number;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.fallbackMaxMeters = config.geo.localityFallbackMaxMeters;
  }

  async resolve(point: GeoPoint): Promise<ResolvedLocality | null> {
    const { rows } = await this.pool.query<ResolveRow>('SELECT * FROM resolve_locality($1, $2, $3)', [
      point.lng,
      point.lat,
      this.fallbackMaxMeters,
    ]);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.locality_id,
      code: row.locality_code,
      name: row.locality_name,
      corridorOrder: row.corridor_order,
      method: row.method,
      distanceMeters: Math.round(row.distance_m),
    };
  }

  async measureCorridorStretch(request: CorridorStretchRequest): Promise<CorridorStretch> {
    const { origin, destination, originLocalityId, routeGeometry } = request;
    const { rows } = await this.pool.query<StretchRow>(
      `SELECT * FROM corridor_stretch(
         ST_SetSRID(ST_MakePoint($1, $2), 4326),
         ST_SetSRID(ST_MakePoint($3, $4), 4326),
         $5::uuid,
         CASE WHEN $6::text IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON($6::text), 4326) END,
         $7::text
       )`,
      [
        origin.lng,
        origin.lat,
        destination.lng,
        destination.lat,
        originLocalityId,
        routeGeometry && routeGeometry.coordinates.length >= 2 ? JSON.stringify(routeGeometry) : null,
        CORRIDOR_CODE,
      ],
    );
    const row = rows[0];
    if (!row) throw new Error(`corridor_stretch no devolvió filas para la localidad ${originLocalityId}`);
    return {
      corridorCode: CORRIDOR_CODE,
      originPositionMeters: row.origin_pos_m,
      destinationPositionMeters: row.destination_pos_m,
      originLocalityFromMeters: row.locality_from_m,
      originLocalityToMeters: row.locality_to_m,
      corridorOutsideOriginMeters: row.corridor_outside_m,
      routeOutsideOriginMeters: row.route_outside_m,
    };
  }
}
