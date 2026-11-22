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
  docStatus: { PENDING: 'Pendiente de revisión', VERIFIED: 'Verificado', REJECTED: 'Rechazado' },
  docType: {
    DNI: 'DNI',
    LICENCIA_PROFESIONAL: 'Licencia profesional',
    VTV: 'VTV',
    SEGURO_PASAJEROS: 'Seguro de pasajeros',
    HABILITACION_MUNICIPAL: 'Habilitación municipal',
    ANTECEDENTES_PENALES: 'Certificado de antecedentes',
    CUIT: 'Constancia de CUIT',
    OTRO: 'Otro',
  },
  entity: { DRIVER: 'Chofer', VEHICLE: 'Vehículo', AGENCY: 'Agencia' },
  auditAction: {
    CREATE: 'Alta',
    UPDATE: 'Modificación',
    DELETE: 'Baja',
    SUSPEND: 'Suspensión / desactivación',
    REVOKE: 'Revocación / retiro',
    APPROVE: 'Aprobación / habilitación',
    REJECT: 'Rechazo',
    VERIFY: 'Verificación',
    LOGIN: 'Ingreso',
    LOGIN_FAILED: 'Ingreso fallido',
    PASSWORD_RESET: 'Cambio o reseteo de clave',
    MFA_CHANGE: 'Segundo factor',
    SESSION_REVOKE: 'Cierre de sesiones',
  },
  entityType: {
    operator_user: 'Usuario del panel',
    system_setting: 'Configuración',
    tariff_schedule: 'Cuadro tarifario',
    season_period: 'Temporada',
    driver: 'Chofer',
    vehicle: 'Vehículo',
    agency: 'Agencia',
    habilitation_document: 'Documento',
    driver_vehicle_compliance: 'Autorización chofer-vehículo',
  },
};

const TONOS: Record<string, Record<string, Tono>> = {
  scheduleStatus: { DRAFT: 'aviso', APPROVED: 'ok', RETIRED: 'neutro' },
  permitStatus: { PENDING: 'aviso', ACTIVE: 'ok', SUSPENDED: 'error', REVOKED: 'error' },
  service: { TAXI: 'aviso', REMIS: 'info' },
  docStatus: { PENDING: 'aviso', VERIFIED: 'ok', REJECTED: 'error' },
  auditAction: { LOGIN_FAILED: 'error', SUSPEND: 'error', REVOKE: 'error', REJECT: 'error', APPROVE: 'ok', VERIFY: 'ok', CREATE: 'info' },
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
