import { Inject, Injectable } from '@nestjs/common';
import {
  tariffRuleKey,
  type Season,
  type SeasonPeriod,
  type ServiceType,
  type TariffRule,
  type TariffRuleKey,
  type TariffSchedule,
  type TimeBand,
  type TripScope,
} from '@lacosta/domain';
import type { Pool } from 'pg';
import { TtlCache } from '../../common/ttl-cache';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import type { ITariffRepository } from './tariff-repository';

interface ScheduleRow {
  id: string;
  code: string;
  legal_instrument: string;
  timezone: string;
  night_starts_at: string;
  night_ends_at: string;
  interurban_min_outside_m: number;
  rounding_step_cents: number;
  quote_ttl_seconds: number;
  valid_from: Date;
  valid_to: Date | null;
}

interface SeasonRow {
  name: string;
  season: Season;
  starts_on: string;
  ends_on_exclusive: string;
}

interface RuleRow {
  id: string;
  schedule_id: string;
  service_type: ServiceType;
  scope: TripScope;
  season: Season;
  time_band: TimeBand;
  flag_fall_cents: number;
  unit_value_cents: number;
  distance_unit_m: number;
  time_unit_s: number;
  reference_speed_kmh: string; // numeric → string en node-postgres
  minimum_fare_cents: number;
  return_coefficient: string;
  backhaul_waives_return: boolean;
}

interface ScheduleWindow {
  readonly schedule: TariffSchedule;
  readonly validFrom: number;
  readonly validTo: number | null;
}

/**
 * El cuadro tarifario cambia pocas veces al año y se consulta en cada cotización:
 * se cachea completo en memoria (TTL corto) para no castigar a PostgreSQL en el pico de verano.
 */
@Injectable()
export class PostgresTariffRepository implements ITariffRepository {
  private readonly schedules: TtlCache<readonly ScheduleWindow[]>;
  private readonly seasons: TtlCache<readonly SeasonPeriod[]>;
  private readonly rules: TtlCache<ReadonlyMap<string, TariffRule>>;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    const ttl = config.tariffs.cacheTtlMs;
    this.schedules = new TtlCache(ttl);
    this.seasons = new TtlCache(ttl);
    this.rules = new TtlCache(ttl);
  }

  async findScheduleAt(instant: Date): Promise<TariffSchedule | null> {
    const windows = await this.schedules.getOrLoad('approved', () => this.loadSchedules());
    const t = instant.getTime();
    return windows.find((w) => w.validFrom <= t && (w.validTo === null || t < w.validTo))?.schedule ?? null;
  }

  async findSeasonPeriodsOn(localIsoDate: string): Promise<readonly SeasonPeriod[]> {
    const all = await this.seasons.getOrLoad('all', () => this.loadSeasons());
    return all.filter((p) => p.startsOn <= localIsoDate && localIsoDate < p.endsOnExclusive);
  }

  async findRule(key: TariffRuleKey): Promise<TariffRule | null> {
    const byKey = await this.rules.getOrLoad(key.scheduleId, () => this.loadRules(key.scheduleId));
    return byKey.get(tariffRuleKey(key)) ?? null;
  }

  async findRuleById(ruleId: string): Promise<TariffRule | null> {
    const { rows } = await this.pool.query<{ schedule_id: string }>(`SELECT schedule_id FROM tariff_rules WHERE id = $1`, [ruleId]);
    if (!rows[0]) return null;
    const byKey = await this.rules.getOrLoad(rows[0].schedule_id, () => this.loadRules(rows[0]!.schedule_id));
    return [...byKey.values()].find((r) => r.id === ruleId) ?? null;
  }

  private async loadSchedules(): Promise<readonly ScheduleWindow[]> {
    const { rows } = await this.pool.query<ScheduleRow>(
      `SELECT id, code, legal_instrument, timezone,
              to_char(night_starts_at, 'HH24:MI') AS night_starts_at,
              to_char(night_ends_at, 'HH24:MI')   AS night_ends_at,
              interurban_min_outside_m, rounding_step_cents, quote_ttl_seconds,
              lower(validity) AS valid_from, upper(validity) AS valid_to
       FROM tariff_schedules
       WHERE status = 'APPROVED'
       ORDER BY lower(validity)`,
    );
    return rows.map((r) => ({
      validFrom: r.valid_from.getTime(),
      validTo: r.valid_to ? r.valid_to.getTime() : null,
      schedule: {
        id: r.id,
        code: r.code,
        legalInstrument: r.legal_instrument,
        timeZone: r.timezone,
        nightStartsAt: r.night_starts_at,
        nightEndsAt: r.night_ends_at,
        interurbanMinOutsideMeters: r.interurban_min_outside_m,
        roundingStepCents: r.rounding_step_cents,
        quoteTtlSeconds: r.quote_ttl_seconds,
      },
    }));
  }

  private async loadSeasons(): Promise<readonly SeasonPeriod[]> {
    const { rows } = await this.pool.query<SeasonRow>(
      `SELECT name, season,
              to_char(lower(period), 'YYYY-MM-DD') AS starts_on,
              to_char(upper(period), 'YYYY-MM-DD') AS ends_on_exclusive
       FROM season_periods`,
    );
    return rows.map((r) => ({ name: r.name, season: r.season, startsOn: r.starts_on, endsOnExclusive: r.ends_on_exclusive }));
  }

  private async loadRules(scheduleId: string): Promise<ReadonlyMap<string, TariffRule>> {
    const { rows } = await this.pool.query<RuleRow>('SELECT * FROM tariff_rules WHERE schedule_id = $1', [scheduleId]);
    const map = new Map<string, TariffRule>();
    for (const r of rows) {
      const rule: TariffRule = {
        id: r.id,
        scheduleId: r.schedule_id,
        serviceType: r.service_type,
        scope: r.scope,
        season: r.season,
        timeBand: r.time_band,
        flagFallCents: r.flag_fall_cents,
        unitValueCents: r.unit_value_cents,
        distanceUnitMeters: r.distance_unit_m,
        timeUnitSeconds: r.time_unit_s,
        referenceSpeedKmh: Number(r.reference_speed_kmh),
        minimumFareCents: r.minimum_fare_cents,
        returnCoefficientBps: Math.round(Number(r.return_coefficient) * 10_000),
        backhaulWaivesReturn: r.backhaul_waives_return,
      };
      map.set(tariffRuleKey(rule), rule);
    }
    return map;
  }
}
