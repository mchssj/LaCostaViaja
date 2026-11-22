/**
 * Roles y permisos del panel administrativo. Fuente única para la API (que los EXIGE) y el panel
 * (que oculta lo que no corresponde). Los roles son fijos: cambiar un permiso es un cambio de código
 * revisado, no una edición desde la web.
 * Plan: docs/bitacora/2026-11-22-fase-5-panel-administracion/PLAN.md
 */

export const OPERATOR_ROLES = ['MUNICIPAL_ADMIN', 'LICENSING_OFFICER', 'COM_OPERATOR', 'AUDITOR', 'AGENCY_OPERATOR'] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export const PERMISSIONS = {
  'monitor.view': 'Ver monitoreo y estadísticas',
  'com.alerts.view': 'Ver alertas del COM',
  'com.alerts.act': 'Atender y resolver alertas del COM',
  'trips.view': 'Ver viajes',
  'trips.cancel': 'Cancelar viajes',
  'fleet.view': 'Ver flota (agencias, choferes, vehículos)',
  'fleet.edit': 'Dar de alta y editar flota',
  'fleet.status': 'Habilitar, suspender y revocar',
  'documents.upload': 'Subir documentos de habilitación',
  'documents.review': 'Verificar o rechazar documentos',
  'drivers.pin_reset': 'Resetear el PIN de un chofer',
  'tariffs.view': 'Ver cuadros tarifarios',
  'tariffs.edit': 'Crear y editar borradores de tarifa',
  'tariffs.approve': 'Aprobar y retirar cuadros tarifarios',
  'vouchers.view': 'Ver programas y vouchers',
  'vouchers.manage': 'Crear programas y vouchers',
  'settings.view': 'Ver la configuración',
  'settings.edit': 'Editar la configuración',
  'qr.issue': 'Generar QR del Modo Invitado',
  'users.manage': 'Gestionar usuarios del panel',
  'audit.view': 'Ver la auditoría',
  'personal_data.view': 'Ver datos personales completos (DNI, CUIL, teléfono, domicilio)',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

const ADMIN: Permission[] = ALL_PERMISSIONS.filter((p) => p !== 'com.alerts.act');

export const ROLE_PERMISSIONS: Readonly<Record<OperatorRole, readonly Permission[]>> = {
  MUNICIPAL_ADMIN: ADMIN,
  LICENSING_OFFICER: [
    'monitor.view',
    'trips.view',
    'fleet.view',
    'fleet.edit',
    'fleet.status',
    'documents.upload',
    'documents.review',
    'drivers.pin_reset',
    'tariffs.view',
    'settings.view',
    'personal_data.view',
  ],
  COM_OPERATOR: ['monitor.view', 'com.alerts.view', 'com.alerts.act', 'trips.view', 'trips.cancel', 'fleet.view', 'tariffs.view', 'settings.view'],
  AUDITOR: ['monitor.view', 'com.alerts.view', 'trips.view', 'fleet.view', 'tariffs.view', 'vouchers.view', 'settings.view', 'audit.view'],
  // Siempre acotado a su agencia (la API filtra por agency_id del token).
  AGENCY_OPERATOR: ['trips.view', 'fleet.view', 'fleet.edit', 'documents.upload', 'tariffs.view', 'personal_data.view'],
};

export const ROLE_LABELS: Readonly<Record<OperatorRole, { name: string; description: string }>> = {
  MUNICIPAL_ADMIN: { name: 'Administrador', description: 'Gestiona usuarios, configuración, tarifas, vouchers y todo el panel.' },
  LICENSING_OFFICER: { name: 'Habilitaciones', description: 'Alta y verificación de choferes, vehículos y agencias, documentos, suspensiones.' },
  COM_OPERATOR: { name: 'Operador COM', description: 'Monitoreo, alertas de pánico y viajes en curso.' },
  AUDITOR: { name: 'Auditor', description: 'Solo lectura de todo el panel y de la auditoría, con datos personales enmascarados.' },
  AGENCY_OPERATOR: { name: 'Operador de agencia', description: 'Carga choferes, vehículos y documentos de SU agencia (quedan pendientes de verificación).' },
};

/** Roles que deben usar segundo factor (TOTP). */
export const MFA_REQUIRED_ROLES: readonly OperatorRole[] = ['MUNICIPAL_ADMIN', 'LICENSING_OFFICER'];

export function isOperatorRole(value: unknown): value is OperatorRole {
  return typeof value === 'string' && (OPERATOR_ROLES as readonly string[]).includes(value);
}

export function permissionsOf(role: OperatorRole | null | undefined): readonly Permission[] {
  return role ? (ROLE_PERMISSIONS[role] ?? []) : [];
}

export function hasPermission(role: OperatorRole | null | undefined, permission: Permission): boolean {
  return permissionsOf(role).includes(permission);
}

/** 28456789 → "28.***.789"; teléfonos y CUIL: se dejan los últimos 3 dígitos. */
export function maskDigits(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 3) return '***';
  if (digits.length === 8) return `${digits.slice(0, 2)}.***.${digits.slice(5)}`;
  return `${'*'.repeat(Math.max(3, digits.length - 3))}${digits.slice(-3)}`;
}
