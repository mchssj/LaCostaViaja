import { InvalidInputError } from './errors';
import { applyBasisPoints, formatArs, roundHalfUpToStep, type Cents } from './money';
import { validateTariffRule, type TariffRule } from './tariff';

/**
 * Motor tarifario PURO: sin I/O, sin reloj, determinístico.
 * Lo usa el backend para cotizar y, en Fase 4, la app del chofer como taxímetro digital
 * offline con el cuadro tarifario cacheado (si se corta la red el viaje se sigue midiendo igual).
 */

export type FareLineCode =
  | 'FLAG_FALL'
  | 'DISTANCE'
  | 'WAIT_TIME'
  | 'INTERURBAN_RETURN'
  | 'INTERURBAN_RETURN_WAIVER'
  | 'MINIMUM_FARE_ADJUSTMENT'
  | 'ROUNDING';

export interface FareLineItem {
  readonly code: FareLineCode;
  readonly label: string;
  readonly amountCents: Cents;
  readonly quantity?: number;
  readonly unitAmountCents?: Cents;
  readonly basisPoints?: number;
  readonly baseAmountCents?: Cents;
  /** Texto explicativo para mostrar al pasajero (transparencia tarifaria). */
  readonly detail?: string;
}

export interface FareComputationInput {
  readonly rule: TariffRule;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  /** Espera solicitada por el pasajero (paradas intermedias). */
  readonly extraWaitSeconds?: number;
  /** Metros del recorrido fuera de la localidad de origen (solo interurbano). */
  readonly interurbanOutsideMeters?: number;
  /** El chofer asignado finaliza en su localidad base ⇒ no corresponde retorno (si la regla lo permite). */
  readonly returnWaived?: boolean;
  readonly roundingStepCents: number;
}

export interface FareComputationMetrics {
  readonly distanceUnits: number;
  readonly waitSeconds: number;
  readonly waitUnits: number;
  readonly returnUnits: number;
  readonly returnSurchargeCents: Cents;
  readonly returnWaived: boolean;
}

export interface FareComputation {
  readonly totalCents: Cents;
  readonly lines: readonly FareLineItem[];
  readonly metrics: FareComputationMetrics;
}

function finiteNonNegative(value: number | undefined, label: string): number {
  const v = value ?? 0;
  if (!Number.isFinite(v) || v < 0) {
    throw new InvalidInputError(`${label} debe ser un número finito >= 0`, { [label]: value });
  }
  return v;
}

const sumLines = (lines: readonly FareLineItem[]): Cents => lines.reduce((acc, l) => acc + l.amountCents, 0);

/**
 * Tarifa = bandera
 *        + fichas por distancia            ceil(distancia / metros_por_ficha)
 *        + fichas por espera               floor(espera / segundos_por_ficha)
 *              espera = max(0, duración − distancia / velocidad_referencia) + espera_solicitada
 *              (aproxima un reloj dual: corre tiempo solo cuando se va más lento que la referencia)
 *        + Retorno Interurbano             coef × fichas recorridas fuera de la localidad de origen
 *        − bonificación Viaje de Vuelta    (si el chofer termina en su base y la regla lo habilita)
 *        → mínimo → redondeo half-up al paso del cuadro.
 */
export function computeFare(input: FareComputationInput): FareComputation {
  const { rule } = input;
  validateTariffRule(rule);
  const distanceMeters = finiteNonNegative(input.distanceMeters, 'distanceMeters');
  const durationSeconds = finiteNonNegative(input.durationSeconds, 'durationSeconds');
  const extraWaitSeconds = finiteNonNegative(input.extraWaitSeconds, 'extraWaitSeconds');
  const outsideMeters = Math.min(finiteNonNegative(input.interurbanOutsideMeters, 'interurbanOutsideMeters'), distanceMeters);
  if (!Number.isSafeInteger(input.roundingStepCents) || input.roundingStepCents <= 0) {
    throw new InvalidInputError('roundingStepCents debe ser un entero > 0', { roundingStepCents: input.roundingStepCents });
  }

  const lines: FareLineItem[] = [
    {
      code: 'FLAG_FALL',
      label: 'Bajada de bandera',
      quantity: 1,
      unitAmountCents: rule.flagFallCents,
      amountCents: rule.flagFallCents,
    },
  ];

  const distanceUnits = Math.ceil(distanceMeters / rule.distanceUnitMeters);
  if (distanceUnits > 0) {
    lines.push({
      code: 'DISTANCE',
      label: 'Recorrido',
      quantity: distanceUnits,
      unitAmountCents: rule.unitValueCents,
      amountCents: distanceUnits * rule.unitValueCents,
      detail: `${distanceUnits} fichas × ${formatArs(rule.unitValueCents)} · 1 ficha cada ${rule.distanceUnitMeters} m`,
    });
  }

  const cruiseSeconds = distanceMeters / (rule.referenceSpeedKmh / 3.6);
  const waitSeconds = Math.max(0, durationSeconds - cruiseSeconds) + extraWaitSeconds;
  const waitUnits = Math.floor(waitSeconds / rule.timeUnitSeconds);
  if (waitUnits > 0) {
    lines.push({
      code: 'WAIT_TIME',
      label: 'Espera / tránsito lento',
      quantity: waitUnits,
      unitAmountCents: rule.unitValueCents,
      amountCents: waitUnits * rule.unitValueCents,
      detail: `${waitUnits} fichas × ${formatArs(rule.unitValueCents)} · 1 ficha cada ${rule.timeUnitSeconds} s`,
    });
  }

  let returnUnits = 0;
  let returnSurchargeCents = 0;
  let returnWaived = false;
  if (rule.scope === 'INTERURBAN' && rule.returnCoefficientBps > 0 && outsideMeters > 0) {
    returnUnits = Math.min(Math.ceil(outsideMeters / rule.distanceUnitMeters), distanceUnits);
    const base = returnUnits * rule.unitValueCents;
    returnSurchargeCents = applyBasisPoints(base, rule.returnCoefficientBps);
    if (returnSurchargeCents > 0) {
      const pct = (rule.returnCoefficientBps / 100).toLocaleString('es-AR');
      lines.push({
        code: 'INTERURBAN_RETURN',
        label: 'Tarifa de Retorno Interurbano',
        quantity: returnUnits,
        basisPoints: rule.returnCoefficientBps,
        baseAmountCents: base,
        amountCents: returnSurchargeCents,
        detail: `${pct}% de ${returnUnits} fichas recorridas fuera de la localidad de origen`,
      });
      if (input.returnWaived === true && rule.backhaulWaivesReturn) {
        returnWaived = true;
        lines.push({
          code: 'INTERURBAN_RETURN_WAIVER',
          label: 'Bonificación Viaje de Vuelta',
          amountCents: -returnSurchargeCents,
          detail: 'El chofer asignado finaliza el viaje en su localidad base: no corresponde retorno',
        });
      }
    }
  }

  const subtotal = sumLines(lines);
  if (subtotal < rule.minimumFareCents) {
    lines.push({
      code: 'MINIMUM_FARE_ADJUSTMENT',
      label: 'Ajuste a tarifa mínima',
      amountCents: rule.minimumFareCents - subtotal,
      detail: `Tarifa mínima ${formatArs(rule.minimumFareCents)}`,
    });
  }

  const preRounding = sumLines(lines);
  let total = roundHalfUpToStep(preRounding, input.roundingStepCents);
  if (total < rule.minimumFareCents) total += input.roundingStepCents; // nunca redondear por debajo de la mínima
  if (total !== preRounding) {
    lines.push({
      code: 'ROUNDING',
      label: 'Redondeo',
      amountCents: total - preRounding,
      detail: `Al múltiplo de ${formatArs(input.roundingStepCents)}`,
    });
  }

  if (sumLines(lines) !== total) {
    throw new Error('Invariante del motor tarifario violado: la suma de líneas no coincide con el total');
  }

  return {
    totalCents: total,
    lines,
    metrics: { distanceUnits, waitSeconds, waitUnits, returnUnits, returnSurchargeCents, returnWaived },
  };
}
