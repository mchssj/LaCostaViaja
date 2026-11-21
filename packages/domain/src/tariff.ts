import type { Season, ServiceType, TimeBand, TripScope } from './enums';
import { InvalidInputError } from './errors';
import { isMinuteInWindow, parseTimeOfDay } from './time';

/** Una fila del cuadro tarifario (valores explícitos por servicio/alcance/temporada/franja). */
export interface TariffRule {
  readonly id: string;
  readonly scheduleId: string;
  readonly serviceType: ServiceType;
  readonly scope: TripScope;
  readonly season: Season;
  readonly timeBand: TimeBand;
  /** Bajada de bandera. */
  readonly flagFallCents: number;
  /** Valor de una ficha. */
  readonly unitValueCents: number;
  /** Metros recorridos por ficha. */
  readonly distanceUnitMeters: number;
  /** Segundos de espera / tránsito lento por ficha. */
  readonly timeUnitSeconds: number;
  /** Debajo de esta velocidad el reloj cuenta tiempo en lugar de distancia. */
  readonly referenceSpeedKmh: number;
  readonly minimumFareCents: number;
  /** Coeficiente de Retorno Interurbano en puntos básicos (4000 = 40 %). 0 en reglas urbanas. */
  readonly returnCoefficientBps: number;
  /** Si es true, el retorno se bonifica cuando el chofer asignado termina en su localidad base. */
  readonly backhaulWaivesReturn: boolean;
}

/** Cuadro tarifario aprobado (acto administrativo) con sus parámetros generales. */
export interface TariffSchedule {
  readonly id: string;
  readonly code: string;
  readonly legalInstrument: string;
  readonly timeZone: string;
  /** 'HH:MM' local. */
  readonly nightStartsAt: string;
  readonly nightEndsAt: string;
  readonly interurbanMinOutsideMeters: number;
  readonly roundingStepCents: number;
  readonly quoteTtlSeconds: number;
}

export interface SeasonPeriod {
  readonly name: string;
  readonly season: Season;
  /** 'YYYY-MM-DD' inclusive. */
  readonly startsOn: string;
  /** 'YYYY-MM-DD' exclusive. */
  readonly endsOnExclusive: string;
}

export interface TariffRuleKey {
  readonly scheduleId: string;
  readonly serviceType: ServiceType;
  readonly scope: TripScope;
  readonly season: Season;
  readonly timeBand: TimeBand;
}

export function tariffRuleKey(k: TariffRuleKey): string {
  return `${k.scheduleId}|${k.serviceType}|${k.scope}|${k.season}|${k.timeBand}`;
}

export function resolveTimeBand(
  minuteOfDay: number,
  schedule: Pick<TariffSchedule, 'nightStartsAt' | 'nightEndsAt'>,
): TimeBand {
  const start = parseTimeOfDay(schedule.nightStartsAt);
  const end = parseTimeOfDay(schedule.nightEndsAt);
  return isMinuteInWindow(minuteOfDay, start, end) ? 'NIGHT' : 'DAY';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** HIGH prevalece sobre LOW; sin período que cubra la fecha ⇒ LOW. */
export function resolveSeason(
  isoDate: string,
  periods: readonly SeasonPeriod[],
): { season: Season; periodName: string | null } {
  if (!ISO_DATE.test(isoDate)) throw new InvalidInputError('Fecha local inválida', { isoDate });
  const covering = periods.filter((p) => p.startsOn <= isoDate && isoDate < p.endsOnExclusive);
  const high = covering.find((p) => p.season === 'HIGH');
  if (high) return { season: 'HIGH', periodName: high.name };
  const low = covering.find((p) => p.season === 'LOW');
  return { season: 'LOW', periodName: low?.name ?? null };
}

export function validateTariffRule(rule: TariffRule): void {
  const problems: string[] = [];
  const positiveInt = (value: number, name: string): void => {
    if (!Number.isSafeInteger(value) || value <= 0) problems.push(`${name} debe ser un entero > 0`);
  };
  positiveInt(rule.flagFallCents, 'flagFallCents');
  positiveInt(rule.unitValueCents, 'unitValueCents');
  positiveInt(rule.distanceUnitMeters, 'distanceUnitMeters');
  positiveInt(rule.timeUnitSeconds, 'timeUnitSeconds');
  positiveInt(rule.minimumFareCents, 'minimumFareCents');
  if (!(Number.isFinite(rule.referenceSpeedKmh) && rule.referenceSpeedKmh > 0)) {
    problems.push('referenceSpeedKmh debe ser > 0');
  }
  if (!Number.isSafeInteger(rule.returnCoefficientBps) || rule.returnCoefficientBps < 0 || rule.returnCoefficientBps > 10_000) {
    problems.push('returnCoefficientBps debe estar entre 0 y 10000');
  }
  if (rule.scope === 'URBAN' && (rule.returnCoefficientBps !== 0 || rule.backhaulWaivesReturn)) {
    problems.push('una regla URBANA no puede tener Retorno Interurbano');
  }
  if (problems.length > 0) {
    throw new InvalidInputError(`Regla tarifaria ${rule.id} inválida: ${problems.join('; ')}`, { ruleId: rule.id, problems });
  }
}
