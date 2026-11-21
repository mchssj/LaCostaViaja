import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { GeoIndex, ServiceDegradedError, type IndexedLocality, type IndexedZone, type LngLat, type PolygonRings } from '@lacosta/domain';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';

interface LocalityRow {
  id: string;
  code: string;
  name: string;
  corridor_order: number;
  g: { type: 'MultiPolygon'; coordinates: LngLat[][][] };
}

interface ZoneRow {
  id: string;
  code: string;
  locality_id: string;
  dispatch_priority: number;
  g: { type: 'Polygon'; coordinates: LngLat[][] };
}

/**
 * Copia en memoria de localidades, zonas y eje RP11 (fuente de verdad: PostGIS).
 * Si la carga inicial falla (base caída al arrancar), la API arranca igual y reintenta en cada refresco;
 * mientras tanto la presencia y el despacho responden SERVICE_DEGRADED.
 */
@Injectable()
export class GeoIndexService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GeoIndexService.name);
  private index: GeoIndex | null = null;
  private timer: NodeJS.Timeout | null = null;
  private loadedAt: Date | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh().catch((err: Error) => this.logger.warn(`No se pudo cargar el índice geográfico: ${err.message}`));
    this.timer = setInterval(() => {
      this.refresh().catch((err: Error) => this.logger.warn(`Refresco del índice geográfico falló: ${err.message}`));
    }, this.config.dispatch.geoIndexRefreshMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<GeoIndex> {
    const [localities, zones, axis] = await Promise.all([
      this.pool.query<LocalityRow>(
        `SELECT id, code, name, corridor_order, ST_AsGeoJSON(geom)::json AS g FROM localities WHERE is_active`,
      ),
      this.pool.query<ZoneRow>(
        `SELECT id, code, locality_id, dispatch_priority, ST_AsGeoJSON(geom)::json AS g FROM dispatch_zones WHERE is_active`,
      ),
      this.pool.query<{ g: { coordinates: LngLat[] } }>(`SELECT ST_AsGeoJSON(geom)::json AS g FROM corridor_axes WHERE code = 'RP11'`),
    ]);
    const axisRow = axis.rows[0];
    if (!axisRow) throw new Error('Corredor RP11 no configurado');
    const index = new GeoIndex({
      localities: localities.rows.map(
        (r): IndexedLocality => ({
          id: r.id,
          code: r.code,
          name: r.name,
          corridorOrder: r.corridor_order,
          polygons: r.g.coordinates as ReadonlyArray<PolygonRings>,
        }),
      ),
      zones: zones.rows.map(
        (r): IndexedZone => ({
          id: r.id,
          code: r.code,
          localityId: r.locality_id,
          dispatchPriority: r.dispatch_priority,
          polygon: r.g.coordinates,
        }),
      ),
      corridorAxis: axisRow.g.coordinates,
    });
    this.index = index;
    this.loadedAt = new Date();
    return index;
  }

  require(): GeoIndex {
    if (!this.index) throw new ServiceDegradedError('El índice geográfico todavía no está cargado');
    return this.index;
  }

  status(): { loaded: boolean; loadedAt: string | null; localities: number; zones: number } {
    return {
      loaded: this.index !== null,
      loadedAt: this.loadedAt?.toISOString() ?? null,
      localities: this.index?.localityCount ?? 0,
      zones: this.index?.zoneCount ?? 0,
    };
  }
}
