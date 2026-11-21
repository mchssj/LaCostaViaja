import type { SeasonPeriod, TariffRule, TariffRuleKey, TariffSchedule } from '@lacosta/domain';

export const TARIFF_REPOSITORY = Symbol('TARIFF_REPOSITORY');

export interface ITariffRepository {
  /** Cuadro APROBADO vigente en ese instante, o null. */
  findScheduleAt(instant: Date): Promise<TariffSchedule | null>;
  /** Períodos de temporada que cubren la fecha local 'YYYY-MM-DD'. */
  findSeasonPeriodsOn(localIsoDate: string): Promise<readonly SeasonPeriod[]>;
  findRule(key: TariffRuleKey): Promise<TariffRule | null>;
}
