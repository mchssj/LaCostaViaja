import { AR_TIMEZONE } from './enums';
import { InvalidInputError } from './errors';

export interface LocalParts {
  /** Fecha local 'YYYY-MM-DD'. */
  readonly isoDate: string;
  /** Minutos desde la medianoche local (0..1439). */
  readonly minuteOfDay: number;
}

/** UTC-3 fijo: respaldo si el runtime no trae datos de zona horaria (algunos motores JS móviles). */
const AR_FIXED_OFFSET_MINUTES = -180;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

/** Convierte un instante absoluto a fecha/hora local de la zona indicada. */
export function toLocalParts(instant: Date, timeZone: string = AR_TIMEZONE): LocalParts {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new InvalidInputError('Instante inválido', { instant: String(instant) });
  }
  try {
    const parts: Record<string, string> = {};
    for (const p of formatterFor(timeZone).formatToParts(instant)) parts[p.type] = p.value;
    return {
      isoDate: `${parts['year']}-${parts['month']}-${parts['day']}`,
      minuteOfDay: Number(parts['hour']) * 60 + Number(parts['minute']),
    };
  } catch (err) {
    if (timeZone !== AR_TIMEZONE) throw err;
    const shifted = new Date(instant.getTime() + AR_FIXED_OFFSET_MINUTES * 60_000);
    return {
      isoDate: shifted.toISOString().slice(0, 10),
      minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    };
  }
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

/** '22:00' | '22:00:00' → 1320 */
export function parseTimeOfDay(value: string): number {
  const m = TIME_OF_DAY.exec(value);
  if (!m) throw new InvalidInputError(`Hora inválida: "${value}" (formato HH:MM)`, { value });
  return Number(m[1]) * 60 + Number(m[2]);
}

/** ¿minute ∈ [start, end)? Soporta ventanas que cruzan la medianoche (22:00 → 06:00). */
export function isMinuteInWindow(minute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) {
    throw new InvalidInputError('La ventana horaria no puede tener inicio igual al fin', { startMinute, endMinute });
  }
  return startMinute < endMinute
    ? minute >= startMinute && minute < endMinute
    : minute >= startMinute || minute < endMinute;
}
