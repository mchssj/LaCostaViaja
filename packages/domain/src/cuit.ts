const WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;
const VALID_PREFIXES = new Set(['20', '23', '24', '27', '30', '33', '34']);

export function normalizeCuit(value: string): string {
  return value.replace(/[\s.-]/g, '');
}

/** Valida CUIT/CUIL argentino (módulo 11). Misma regla que la función SQL is_valid_cuit(). */
export function isValidCuit(value: string): boolean {
  const digits = normalizeCuit(value);
  if (!/^\d{11}$/.test(digits) || !VALID_PREFIXES.has(digits.slice(0, 2))) return false;
  let sum = 0;
  for (let i = 0; i < WEIGHTS.length; i++) sum += Number(digits[i]) * WEIGHTS[i]!;
  let dv = 11 - (sum % 11);
  if (dv === 11) dv = 0;
  return dv !== 10 && dv === Number(digits[10]);
}
