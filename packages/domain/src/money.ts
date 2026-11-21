import { InvalidInputError } from './errors';

/** Importe en centavos de peso argentino. Siempre entero: nada de floats en dinero. */
export type Cents = number;

export function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidInputError(`${label} debe ser un entero de centavos >= 0`, { [label]: value });
  }
}

/** Redondeo half-up al múltiplo de `stepCents` (p. ej. 1000 = $10), en aritmética entera. */
export function roundHalfUpToStep(amountCents: Cents, stepCents: number): Cents {
  assertCents(amountCents, 'amountCents');
  if (!Number.isSafeInteger(stepCents) || stepCents <= 0) {
    throw new InvalidInputError('stepCents debe ser un entero > 0', { stepCents });
  }
  return Math.floor((amountCents * 2 + stepCents) / (stepCents * 2)) * stepCents;
}

/** amount x (bps / 10000), half-up, en aritmética entera (4000 bps = 40 %). */
export function applyBasisPoints(amountCents: Cents, basisPoints: number): Cents {
  assertCents(amountCents, 'amountCents');
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0) {
    throw new InvalidInputError('basisPoints debe ser un entero >= 0', { basisPoints });
  }
  return Math.floor((amountCents * basisPoints * 2 + 10_000) / 20_000);
}

const ARS = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });

export function formatArs(amountCents: Cents): string {
  return ARS.format(amountCents / 100);
}
