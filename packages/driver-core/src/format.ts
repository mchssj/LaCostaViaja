// Formato para mostrar datos. Los importes viajan en centavos enteros; acá solo se convierten para leerlos.

const pesosFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
const pesosRedondoFmt = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });

/** 220000 → "$ 2.200,00". Con `redondo`, "$ 2.200" (para importes grandes en pantalla). */
export function pesos(cents: number | null | undefined, redondo = false): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—';
  const v = cents / 100;
  return redondo && Number.isInteger(v) ? pesosRedondoFmt.format(v) : pesosFmt.format(v);
}

/** 850 → "850 m"; 2340 → "2,3 km" */
export function distancia(metros: number | null | undefined): string {
  if (metros === null || metros === undefined || !Number.isFinite(metros)) return '—';
  return metros < 1000 ? `${Math.round(metros / 10) * 10} m` : `${decFmt.format(metros / 1000)} km`;
}

/** 45 → "menos de 1 min"; 260 → "4 min"; 4000 → "1 h 7 min" */
export function duracion(segundos: number | null | undefined): string {
  if (segundos === null || segundos === undefined || !Number.isFinite(segundos)) return '—';
  if (segundos < 60) return 'menos de 1 min';
  const min = Math.round(segundos / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** Cuenta regresiva "0:45" a partir de milisegundos restantes. */
export function regresiva(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Distancia en metros entre dos puntos (haversine). Para mostrar, no para cobrar. */
export function metrosEntre(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const TEXTOS = {
  service: { TAXI: 'Taxi', REMIS: 'Remis' } as Record<string, string>,
  scope: { URBAN: 'Urbano', INTERURBAN: 'Interurbano' } as Record<string, string>,
  season: { LOW: 'Temporada baja', HIGH: 'Temporada alta' } as Record<string, string>,
  timeBand: { DAY: 'Tarifa diurna', NIGHT: 'Tarifa nocturna' } as Record<string, string>,
  payment: {
    CASH: 'Efectivo',
    MERCADO_PAGO_QR: 'Mercado Pago (QR)',
    MERCADO_PAGO_LINK: 'Mercado Pago',
    VOUCHER: 'Voucher municipal',
    MUNICIPAL_ACCOUNT: 'Cuenta municipal',
  } as Record<string, string>,
  paymentStatus: {
    PENDING: 'Pendiente',
    AUTHORIZED: 'Autorizado',
    PAID: 'Pagado',
    FAILED: 'Rechazado',
    REFUNDED: 'Devuelto',
  } as Record<string, string>,
};

export type Grupo = keyof typeof TEXTOS;

export function texto(grupo: Grupo, code: string | null | undefined): string {
  if (!code) return '—';
  return TEXTOS[grupo][code] ?? code;
}

/** Motivos por los que un vehículo no habilita el turno (v_driver_vehicle_eligibility.blocking_reasons). */
const MOTIVOS: Record<string, string> = {
  AUTORIZACION_FUERA_DE_VIGENCIA: 'La autorización para manejar este vehículo no está vigente',
  LICENCIA_PROFESIONAL_VENCIDA: 'Tu licencia profesional está vencida',
  HABILITACION_CHOFER_VENCIDA: 'Tu habilitación municipal está vencida',
  CERTIFICADO_ANTECEDENTES_VENCIDO: 'Tu certificado de antecedentes está vencido',
  VTV_VENCIDA: 'La VTV del vehículo está vencida',
  SEGURO_PASAJEROS_VENCIDO: 'El seguro de pasajeros está vencido',
  HABILITACION_VEHICULO_VENCIDA: 'La habilitación del vehículo está vencida',
  HABILITACION_AGENCIA_VENCIDA: 'La habilitación de la agencia está vencida',
  CHOFER_NO_PERTENECE_A_LA_AGENCIA_DEL_VEHICULO: 'No pertenecés a la agencia de este vehículo',
};

export function motivoBloqueo(code: string): string {
  if (MOTIVOS[code]) return MOTIVOS[code]!;
  const m = /^(AUTORIZACION|CHOFER|VEHICULO|AGENCIA)_(PENDING|SUSPENDED|REVOKED)$/.exec(code);
  if (m) {
    const quien = { AUTORIZACION: 'La autorización', CHOFER: 'Tu habilitación', VEHICULO: 'El vehículo', AGENCIA: 'La agencia' }[m[1] as 'CHOFER'];
    const estado = { PENDING: 'está pendiente de aprobación', SUSPENDED: 'está suspendida', REVOKED: 'fue revocada' }[m[2] as 'PENDING'];
    return `${quien} ${estado}`;
  }
  return code;
}
