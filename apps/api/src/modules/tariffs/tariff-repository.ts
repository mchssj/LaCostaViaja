import type { SeasonPeriod, TariffRule, TariffRuleKey, TariffSchedule } from '@lacosta/domain';

export const TARIFF_REPOSITORY = Symbol('TARIFF_REPOSITORY');

export interface ITariffRepository {
  /** Cuadro APROBADO vigente en ese instante, o null. */
  findScheduleAt(instant: Date): Promise<TariffSchedule | null>;
  /** Períodos de temporada que cubren la fecha local 'YYYY-MM-DD'. */
  findSeasonPeriodsOn(localIsoDate: string): Promise<readonly SeasonPeriod[]>;
  findRule(key: TariffRuleKey): Promise<TariffRule | null>;
  /** Regla aplicada a un viaje (para el taxímetro de referencia al terminar). */
  findRuleById(ruleId: string): Promise<TariffRule | null>;
  /** Cualquier cuadro (también borradores): para el simulador del panel. */
  findScheduleById?(scheduleId: string): Promise<TariffSchedule | null>;
  /** Vacía la caché (tras aprobar/retirar un cuadro, editar un borrador o cambiar temporadas). */
  invalidate?(): void;
}
