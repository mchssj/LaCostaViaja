# Guía de implementación: Fase 5, panel administrativo

## Archivos

| Dónde | Cambio |
|---|---|
| `packages/db/migrations/20261122120000_panel_administracion.sql` | Roles `LICENSING_OFFICER` y `AUDITOR`; acciones de auditoría; columnas de cuenta en `operator_users`; `system_settings`; doble control y triggers de tarifas; estado de documentos. |
| `packages/db/migrations/20261122120500_documentos_estado_compatible.sql` | Trigger que completa `status` cuando un código viejo marca `verified_at`. Lo exigió el smoke test de la Fase 5. |
| `packages/db/migrations/20261122121000_tarifas_reemplazo_de_cuadro.sql` | Permite **acortar** a futuro la vigencia de un cuadro aprobado, al aprobar su reemplazo. |
| `packages/db/migrations/20261122121500_tarifas_borrado_en_cascada.sql` | El trigger de reglas deja pasar el borrado en cascada del cuadro. |
| `packages/db/seeds/20261122120100_configuracion_inicial.sql` | 13 parámetros con los valores por defecto actuales. |
| `packages/db/seeds/20261122130000_usuarios_demo_fase_5.sql` | Usuarios **demo** `habilitaciones`, `auditoria` y `muni_admin2`, con la misma contraseña demo que el resto. |
| `packages/db/tests/20261122120001_smoke_panel_administracion.sql` | Smoke test: doble control, inmutabilidad, rangos y rechazo con motivo. |
| `packages/domain/src/permissions.ts` (+ spec) | Roles, permisos, matriz, roles con 2FA obligatorio y `maskDigits`. 6 tests. |
| `apps/api/src/security/` | Archivos nuevos `operator-state.service.ts`, `audit.service.ts` y `password-policy.ts`. Cambian `auth.guard.ts` (estado de la base, revocación, modo configuración y permisos), `principal.ts` (`RequirePermission`, `AllowDuringSetup`, `ReqMeta`), `jwt.service.ts` (`iatMs` y comprobante de 2FA) y `crypto.ts` (AES-GCM y TOTP). |
| `apps/api/src/modules/auth/` | Login en dos pasos, `mfa.service.ts`, `account.service.ts` y `/auth/me` con permisos. |
| `apps/api/src/modules/admin/` | Módulo nuevo: usuarios, auditoría, tarifas (servicio y controlador), habilitaciones (servicio y controlador) y `file-storage.ts`. |
| `apps/api/src/modules/settings/` | `SettingsService` (aplicación en caliente) y controlador. |
| Controladores existentes | `fleet`, `tariffs`, `vouchers`, `panic`, `trips`, `auth` (QR) y el gateway `/com` pasan a permisos; la flota enmascara los datos personales. |
| `apps/api/src/modules/tariffs/*`, `fares/fare-calculator.service.ts` | `findScheduleById` e `invalidate` en el repositorio, y la opción interna `scheduleId` para el simulador. |
| `apps/api/test/fase5.e2e.int-spec.ts` | 9 tests de integración. `fase3.e2e` ahora activa el 2FA del administrador de prueba. |
| `apps/admin-web/` | `lib/api.ts` y `lib/session.tsx` nuevos; `Shell` con menú por permisos y logo; login con 2FA; páginas nuevas; `components/ui.tsx`; las páginas existentes con `requires`; `@lacosta/driver-core` como dependencia (ya estaba en el monorepo, sin descargas). |
| `.env.example` | `DOCUMENT_STORAGE_DIR`. |

## Cómo probarlo

```powershell
pnpm db:migrate
pnpm db:seed
pnpm db:test
pnpm --filter @lacosta/domain build
pnpm dev:api
pnpm --filter @lacosta/admin-web dev    # http://localhost:3001
```

Usuarios demo, todos con la contraseña demo del seed:

| Usuario | Rol | 2FA |
|---|---|---|
| `muni_admin`, `muni_admin2` | Administrador | Lo pide configurar al primer ingreso |
| `habilitaciones` | Habilitaciones | Lo pide configurar al primer ingreso |
| `com_operador` | Operador COM | — |
| `auditoria` | Auditor | — |
| `agencia_chiozza` | Operador de agencia | — |

Para el doble control de tarifas: `muni_admin` arma el borrador y `muni_admin2` lo aprueba.

Tests:

```powershell
pnpm --filter @lacosta/domain test
pnpm --filter @lacosta/api exec jest --config jest.int.config.js --runInBand   # con TEST_DATABASE_URL y TEST_REDIS_URL
```

## Pruebas hechas (2026-11-22)

- **SQL:** smoke tests OK, incluido el nuevo con 9 verificaciones.
- **Dominio:** 70 tests OK.
- **API:** 28 unitarios y **50 de integración** OK. Fase 5 son 9:
  - 2FA en dos pasos, sin reuso de códigos y con códigos de recuperación de un solo uso.
  - Alta de usuario con contraseña temporal y política de contraseñas.
  - Permisos por rol y enmascarado de datos personales.
  - Revocación inmediata al cambiar el rol o desactivar.
  - Último administrador.
  - Configuración en caliente.
  - Tarifas con doble control, inmutabilidad, superposición y retiro.
  - Habilitación completa: agencia → documentos (con rechazo de un archivo falso) → verificación → habilitación → suspensión → PIN.
  - Bloqueo y desbloqueo.
- **Typecheck:** OK en `admin-web` y en la API.
- **Navegador:**
  - Operador COM: el menú sin Usuarios, Vouchers ni Auditoría; `/usuarios` muestra "No tenés acceso"; Configuración en solo lectura.
  - Administrador: lo llevó a Mi cuenta a activar el 2FA; con el código lo activó, mostró los códigos de recuperación y habilitó el menú completo.
  - Usuarios, Tarifas, Habilitaciones y Auditoría cargan.
  - Al terminar, el 2FA de `muni_admin` se **reseteó** (y quedó registrado en la auditoría), porque se había configurado con una clave que solo vio el navegador de prueba.
- **No probado en el navegador:**
  - El flujo completo de aprobar una tarifa con dos administradores.
  - La subida de documentos desde el panel (la API sí está probada).
  - Las pantallas como Habilitaciones y como agencia.

## Cómo revertirlo

Las migraciones son aditivas. Para volver atrás en una base de desarrollo: `pnpm db:reset --yes` y aplicar hasta `20261122100000`. En código, revertir los commits de esta fase. Los documentos subidos quedan en `DOCUMENT_STORAGE_DIR` y se borran a mano.

## Diferencias con el plan

- **Configuración y entorno:** si un parámetro nunca se editó desde el panel, manda el entorno. No estaba en el plan; evita que los tests y los despliegues cambien solos.
- **Cuadros aprobados:** se permite **acortar** la vigencia de un aprobado para reemplazarlo. El plan decía solo "retirar"; sin esto no se puede pasar de un cuadro al siguiente.
- **Agencias:** el alta y la edición de agencias **no** se hicieron; solo el cambio de estado. Queda pendiente.
- **QR:** el panel genera la dirección firmada pero no dibuja el QR; hace falta una librería nueva, que se instala solo con aviso.
- **Correcciones por las pruebas:**
  - `iatMs` en el token: con `iat` en segundos, un token emitido en el mismo segundo que la revocación seguía valiendo.
  - Casts explícitos en los UPDATE de estado: PostgreSQL deducía tipos inconsistentes para el mismo parámetro.
  - Rutas sin expresiones regulares, porque Express 5 ya no las admite.
- **Fase 3:** el test E2E ahora configura el 2FA del administrador de prueba.
