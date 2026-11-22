import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InvalidInputError, NotFoundError } from '@lacosta/domain';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import { AuditService } from '../../security/audit.service';
import type { Principal, RequestMeta } from '../../security/principal';

const REFRESH_MS = 30_000;

/**
 * Claves que la API aplica en caliente, y dónde. El resto se guarda y se muestra, pero todavía no
 * tiene efecto (el panel lo indica): conservación de datos y cargo por cancelación.
 */
type Section = 'dispatch' | 'trips' | 'panic';
const LIVE: Record<string, readonly [Section, string]> = {
  'dispatch.offer_timeout_ms': ['dispatch', 'offerTimeoutMs'],
  'dispatch.max_offers_per_round': ['dispatch', 'maxOffersPerRound'],
  'dispatch.max_search_ms': ['dispatch', 'maxSearchMs'],
  'dispatch.rejection_window_ms': ['dispatch', 'rejectionWindowMs'],
  'trips.no_show_wait_ms': ['trips', 'noShowWaitMs'],
  'trips.driver_location_throttle_ms': ['trips', 'driverLocationThrottleMs'],
  'panic.escalate_after_ms': ['panic', 'escalateAfterMs'],
};
/** Leídas directamente de la base por quien las usa (no pasan por AppConfig). */
const READ_DIRECT = new Set(['security.max_failed_logins', 'security.lock_minutes']);

/** AppConfig es readonly por tipo; acá se escribe a propósito (único lugar). */
function section(c: AppConfig, s: Section): Record<string, number> {
  return c[s] as unknown as Record<string, number>;
}

export interface SettingRow {
  key: string;
  group_name: string;
  label: string;
  description: string;
  value_type: 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'CENTS' | 'DURATION_MS';
  value: number | boolean;
  default_value: number | boolean;
  min_value: string | null;
  max_value: string | null;
  unit: string | null;
  sort_order: number;
  updated_by: string | null;
  updated_by_username: string | null;
  updated_at: string;
}

/**
 * Parámetros de negocio editables desde el panel (tabla system_settings). Se aplican sobre el
 * AppConfig compartido: el código existente sigue leyendo this.config.* y ve el valor nuevo en
 * ≤ 30 s en todas las réplicas (inmediato en la réplica que lo cambió).
 *
 * Precedencia: si el valor nunca se editó desde el panel (updated_by NULL) manda la variable de
 * entorno / el valor de código, así los despliegues y los tests que fijan variables no cambian.
 */
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly baseline: Record<string, number> = {};

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
  ) {
    // Valores de entorno/código para poder volver a ellos si una fila deja de estar editada.
    for (const [key, [s, field]] of Object.entries(LIVE)) this.baseline[key] = section(config, s)[field]!;
  }

  async onModuleInit(): Promise<void> {
    await this.refresh().catch((e: Error) => this.logger.warn(`No se pudo leer la configuración: ${e.message}`));
    this.timer = setInterval(() => this.refresh().catch(() => undefined), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    const { rows } = await this.pool.query<{ key: string; value: number; updated_by: string | null }>(`SELECT key, value, updated_by FROM system_settings`);
    for (const [key, [s, field]] of Object.entries(LIVE)) {
      const row = rows.find((r) => r.key === key);
      section(this.config, s)[field] = row && row.updated_by ? Number(row.value) : this.baseline[key]!;
    }
  }

  async list(): Promise<Array<SettingRow & { effect: 'LIVE' | 'NOT_YET' }>> {
    const { rows } = await this.pool.query<SettingRow>(
      `SELECT s.key, s.group_name, s.label, s.description, s.value_type, s.value, s.default_value, s.min_value, s.max_value,
              s.unit, s.sort_order, s.updated_by, o.username AS updated_by_username, s.updated_at
       FROM system_settings s LEFT JOIN operator_users o ON o.id = s.updated_by
       ORDER BY s.group_name, s.sort_order, s.key`,
    );
    return rows.map((r) => ({ ...r, effect: LIVE[r.key] || READ_DIRECT.has(r.key) ? ('LIVE' as const) : ('NOT_YET' as const) }));
  }

  async update(actor: Principal, key: string, raw: unknown, meta: RequestMeta) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<SettingRow>(`SELECT * FROM system_settings WHERE key = $1 FOR UPDATE`, [key]);
      const row = rows[0];
      if (!row) throw new NotFoundError('Parámetro inexistente', { key });
      const value = this.coerce(row, raw);
      await client.query(`UPDATE system_settings SET value = $2::jsonb, updated_by = $3, updated_at = now() WHERE key = $1`, [key, JSON.stringify(value), actor.id]);
      await this.audit.record(
        { actor, action: 'UPDATE', entityType: 'system_setting', changes: { key, before: row.value, after: value }, meta },
        client,
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.refresh();
    return (await this.list()).find((s) => s.key === key);
  }

  private coerce(row: SettingRow, raw: unknown): number | boolean {
    if (row.value_type === 'BOOLEAN') {
      if (typeof raw !== 'boolean') throw new InvalidInputError(`${row.label}: debe ser verdadero o falso`, { key: row.key });
      return raw;
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) throw new InvalidInputError(`${row.label}: valor numérico inválido`, { key: row.key });
    if (row.value_type !== 'NUMBER' && !Number.isInteger(n)) throw new InvalidInputError(`${row.label}: debe ser un número entero`, { key: row.key });
    const min = row.min_value !== null ? Number(row.min_value) : null;
    const max = row.max_value !== null ? Number(row.max_value) : null;
    if ((min !== null && n < min) || (max !== null && n > max)) {
      throw new InvalidInputError(`${row.label}: tiene que estar entre ${min ?? '−∞'} y ${max ?? '∞'}${row.unit ? ` ${row.unit}` : ''}`, { key: row.key, min, max });
    }
    return n;
  }
}
