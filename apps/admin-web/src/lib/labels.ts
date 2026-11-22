// Traducción de los códigos (enums) de la API a texto en español para el panel.
// Un código que no esté acá se muestra tal cual.

export type Tono = 'ok' | 'aviso' | 'error' | 'neutro' | 'info';

const TEXTOS: Record<string, Record<string, string>> = {
  service: { TAXI: 'Taxi', REMIS: 'Remis' },
  scope: { URBAN: 'Urbano', INTERURBAN: 'Interurbano' },
  season: { LOW: 'Baja', HIGH: 'Alta' },
  timeBand: { DAY: 'Diurna', NIGHT: 'Nocturna' },
  scheduleStatus: { DRAFT: 'Borrador', APPROVED: 'Aprobado', RETIRED: 'Retirado' },
  permitStatus: { PENDING: 'Pendiente', ACTIVE: 'Habilitado', SUSPENDED: 'Suspendido', REVOKED: 'Revocado' },
  programType: { HEALTH: 'Salud', DISABILITY: 'Discapacidad', EMPLOYEE: 'Empleado municipal', OTHER: 'Otro' },
};

const TONOS: Record<string, Record<string, Tono>> = {
  scheduleStatus: { DRAFT: 'aviso', APPROVED: 'ok', RETIRED: 'neutro' },
  permitStatus: { PENDING: 'aviso', ACTIVE: 'ok', SUSPENDED: 'error', REVOKED: 'error' },
  service: { TAXI: 'aviso', REMIS: 'info' },
};

export type Grupo = keyof typeof TEXTOS;

export function texto(grupo: Grupo, code: string | null | undefined): string {
  if (!code) return '—';
  return TEXTOS[grupo]?.[code] ?? code;
}

export function tono(grupo: Grupo, code: string | null | undefined): Tono {
  if (!code) return 'neutro';
  return TONOS[grupo]?.[code] ?? 'neutro';
}
