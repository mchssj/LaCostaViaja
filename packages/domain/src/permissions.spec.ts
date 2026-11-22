import { ALL_PERMISSIONS, hasPermission, maskDigits, OPERATOR_ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from './permissions';

describe('permisos', () => {
  it('todos los roles tienen etiqueta y solo permisos conocidos', () => {
    for (const role of OPERATOR_ROLES) {
      expect(ROLE_LABELS[role].name).toBeTruthy();
      for (const p of ROLE_PERMISSIONS[role]) expect(ALL_PERMISSIONS).toContain(p);
    }
  });

  it('solo el administrador gestiona usuarios, configuración y tarifas', () => {
    for (const p of ['users.manage', 'settings.edit', 'tariffs.edit', 'tariffs.approve'] as const) {
      expect(OPERATOR_ROLES.filter((r) => hasPermission(r, p))).toEqual(['MUNICIPAL_ADMIN']);
    }
  });

  it('el auditor no modifica nada ni ve datos personales', () => {
    const writes = ALL_PERMISSIONS.filter((p) => !p.endsWith('.view'));
    expect(ROLE_PERMISSIONS.AUDITOR.filter((p) => writes.includes(p))).toEqual([]);
    expect(hasPermission('AUDITOR', 'personal_data.view')).toBe(false);
  });

  it('solo el COM atiende alertas; el administrador no', () => {
    expect(OPERATOR_ROLES.filter((r) => hasPermission(r, 'com.alerts.act'))).toEqual(['COM_OPERATOR']);
  });

  it('verificación de documentos: administrador y habilitaciones, nunca la agencia', () => {
    expect(OPERATOR_ROLES.filter((r) => hasPermission(r, 'documents.review')).sort()).toEqual(['LICENSING_OFFICER', 'MUNICIPAL_ADMIN']);
  });

  it('enmascara DNI, CUIL y teléfono', () => {
    expect(maskDigits('28456789')).toBe('28.***.789');
    expect(maskDigits('20-28456789-3')).toBe('********893');
    expect(maskDigits('+5492257410106')).toBe('**********106');
    expect(maskDigits(null)).toBeNull();
  });
});
