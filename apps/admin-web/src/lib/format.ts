// Formateo para mostrar datos de la API en el panel. Los importes se guardan en centavos enteros;
// acá solo se convierten para leerlos. Las fechas se evalúan en la zona horaria del Partido.

const TZ = 'America/Argentina/Buenos_Aires';

const pesosFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('es-AR');
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

const DASH = '—';

/** 220000 → "$ 2.200,00" */
export function pesos(cents: number | string | null | undefined): string {
  if (cents === null || cents === undefined || cents === '') return DASH;
  const n = Number(cents);
  return Number.isFinite(n) ? pesosFmt.format(n / 100) : DASH;
}

/**
 * Texto en pesos escrito por una persona → centavos enteros, sin pasar por floats.
 * Acepta "1500", "1.500", "1500,5", "1.500,50" y "$ 1.500,50". Devuelve null si no es válido.
 * Si hay una sola coma, es el separador decimal; los puntos se toman como separador de miles.
 */
export function pesosACentavos(input: string): number | null {
  const s = input.replace(/[$\s]/g, '');
  const m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const enteros = Number(m[1]!.replace(/\./g, ''));
  const dec = (m[2] ?? '').padEnd(2, '0');
  const cents = enteros * 100 + Number(dec);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function entero(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return DASH;
  const v = Number(n);
  return Number.isFinite(v) ? intFmt.format(v) : DASH;
}

function toDate(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  // "AAAA-MM-DD" a secas es una fecha civil: se interpreta al mediodía para que la zona no la corra de día.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00-03:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Fecha en AAAA-MM-DD (hora de Buenos Aires). */
export function fecha(value: string | Date | null | undefined): string {
  if (!value) return DASH;
  const d = toDate(value);
  return d ? dateFmt.format(d) : DASH;
}

/** Fecha y hora: "AAAA-MM-DD HH:MM". */
export function fechaHora(value: string | Date | null | undefined): string {
  if (!value) return DASH;
  const d = toDate(value);
  return d ? `${dateFmt.format(d)} ${timeFmt.format(d)}` : DASH;
}

/** Hoy en AAAA-MM-DD, hora de Buenos Aires. */
export function hoy(): string {
  return dateFmt.format(new Date());
}

export type Vencimiento = 'vencido' | 'por-vencer' | 'vigente' | 'sin-dato';

/** Vencido si ya pasó; "por vencer" si faltan 30 días o menos. */
export function vencimiento(value: string | Date | null | undefined, avisoDias = 30): Vencimiento {
  if (!value) return 'sin-dato';
  const f = fecha(value);
  if (f === DASH) return 'sin-dato';
  const today = hoy();
  if (f < today) return 'vencido';
  const limite = dateFmt.format(new Date(Date.now() + avisoDias * 86_400_000));
  return f <= limite ? 'por-vencer' : 'vigente';
}

/** 30712345678 → "30-71234567-8" */
export function cuit(value: string | null | undefined): string {
  if (!value) return DASH;
  const d = value.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : value;
}

/** 28123456 → "28.123.456" */
export function dni(value: string | null | undefined): string {
  if (!value) return DASH;
  const d = value.replace(/\D/g, '');
  return d ? intFmt.format(Number(d)) : value;
}

/** +5492255123456 → "+54 9 2255 12-3456" (aproximado: el código de área varía). */
export function telefono(value: string | null | undefined): string {
  if (!value) return DASH;
  const m = /^\+54(9?)(\d{4})(\d{2})(\d{4})$/.exec(value);
  return m ? `+54 ${m[1] ? '9 ' : ''}${m[2]} ${m[3]}-${m[4]}` : value;
}

/** 0.5 → "50 %" */
export function porcentaje(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return DASH;
  const n = Number(value);
  return Number.isFinite(n) ? `${intFmt.format(Math.round(n * 1000) / 10)} %` : DASH;
}
