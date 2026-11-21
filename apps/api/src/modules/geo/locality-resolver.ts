import type { GeoJsonLineString, GeoPoint, ResolvedLocality } from '@lacosta/domain';

export const LOCALITY_RESOLVER = Symbol('LOCALITY_RESOLVER');

export interface CorridorStretchRequest {
  readonly origin: GeoPoint;
  readonly destination: GeoPoint;
  readonly originLocalityId: string;
  /** Geometría real de la ruta, si el proveedor de ruteo la entregó. */
  readonly routeGeometry: GeoJsonLineString | null;
}

export interface CorridorStretch {
  readonly corridorCode: string;
  /** Progresivas (m) sobre RP11; crecen de norte a sur. */
  readonly originPositionMeters: number;
  readonly destinationPositionMeters: number;
  readonly originLocalityFromMeters: number;
  readonly originLocalityToMeters: number;
  /** Metros fuera de la localidad de origen medidos sobre el eje del corredor (fallback). */
  readonly corridorOutsideOriginMeters: number;
  /** Metros de la ruta real fuera de la localidad de origen; null si no hubo geometría. */
  readonly routeOutsideOriginMeters: number | null;
}

/** Puerto de resolución geoespacial (implementación productiva: PostGIS). */
export interface ILocalityResolver {
  /** null ⇒ el punto no pertenece ni está cerca de ninguna localidad (fuera del área de servicio). */
  resolve(point: GeoPoint): Promise<ResolvedLocality | null>;
  measureCorridorStretch(request: CorridorStretchRequest): Promise<CorridorStretch>;
}
