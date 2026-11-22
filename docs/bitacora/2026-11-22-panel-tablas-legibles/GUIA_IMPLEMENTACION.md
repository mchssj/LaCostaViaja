# Guía de implementación: tablas legibles en el panel municipal

## Archivos

| Archivo | Cambio |
|---|---|
| `apps/admin-web/src/lib/format.ts` | Nuevo: formateadores de pesos, fechas, CUIT, DNI, teléfono, porcentaje y vencimientos. |
| `apps/admin-web/src/lib/labels.ts` | Nuevo: traducción y color de los enums de la API. |
| `apps/admin-web/src/components/TableParts.tsx` | Nuevo: `Badge`, `CodeBadge`, `Vence`, `Two`, `EmptyRow`, `CardTitle`. |
| `apps/admin-web/src/app/globals.css` | Clases `.tbl-wrap`, `.tbl`, `.num`, `.grp`, `.sub`. |
| `apps/admin-web/src/app/tarifas/page.tsx` | Reescrita. Corrige la columna Vigencia, que leía `validity` en vez de `valid_from`/`valid_to` y salía vacía. |
| `apps/admin-web/src/app/flota/page.tsx` | Reescrita con más columnas (vencimientos, licencia, VTV, seguro). |
| `apps/admin-web/src/app/vouchers/page.tsx` | Tablas de programas y vouchers. Los formularios no cambiaron. |
| `apps/admin-web/src/lib/api.ts` | Mensajes de error legibles (401, 403 con el rol requerido, resto con el `message` de la API). |

Sin dependencias nuevas, sin cambios en la API ni en la base.

## Cómo probarlo

```powershell
pnpm --filter @lacosta/admin-web typecheck
pnpm --filter @lacosta/admin-web dev    # http://localhost:3001 (con la API en :3000)
```

Entrar con un operador y recorrer `/tarifas`, `/flota` y `/vouchers`.

## Pruebas hechas (2026-11-22)

- `typecheck`: pasa.
- En el navegador, con la base de desarrollo:
  - `/tarifas`: estado "Aprobado", vigencia 2026-11-01 a 2027-11-01, horario nocturno de 22:00 a 06:00, la etiqueta "Ejemplo, no oficial" y las reglas agrupadas con importes en pesos.
  - `/flota`: 3 agencias y 6 choferes con los vencimientos marcados. Por ejemplo, la habilitación de "Remises Mar de Ajó" aparece vencida el 2026-10-31.
  - `/vouchers`: con un usuario que no es administrador municipal, se ve el mensaje de permiso en castellano y las tablas vacías. **No se probó con datos**: las tablas de programas y vouchers no se vieron con filas reales.

## Cómo revertirlo

Restaurar los archivos de la tabla anterior y borrar los tres archivos nuevos. No hay migraciones.

## Diferencias con el plan

- Se agregó el cambio de mensajes de error en `lib/api.ts`. Al verificar `/vouchers` apareció el JSON crudo del 403.
- **Ampliación pedida el 2026-11-22: formularios de Vouchers en pesos.**
  - `pesosACentavos()` en `lib/format.ts` convierte el texto a centavos enteros sin floats. Acepta `1500`, `1.500`, `1500,5`, `1.500,50` y `$ 1.500.000`, y rechaza `1,234`, `1.50` y `1.5000`.
  - Los dos formularios tienen etiquetas y ayudas. Debajo del importe se ve el valor interpretado (`= $ 1.250.000,50`) o "Importe no válido".
  - Antes de enviar se validan los topes de la API (presupuesto hasta $ 20.000.000; voucher hasta $ 1.000.000) y el orden de las fechas.
  - Las fechas de vigencia se mandan con `-03:00` (hora de Buenos Aires): `datetime-local` no trae zona horaria.
  - El código del voucher es opcional (si queda vacío, lo genera la API) y se pasa a mayúsculas. Se agregó el DNI del beneficiario, también opcional (vacío = voucher al portador).
  - Se muestra un mensaje de éxito o de error en cada formulario y se deshabilita el botón mientras se envía.
  - Se definió la clase `.in` en `globals.css`: la usaban los inputs, pero no existía.
  - **Pruebas:** 13 casos de `pesosACentavos` (script en el scratchpad de la sesión, no versionado) y `typecheck`, todos OK. En el navegador se vieron las etiquetas y la conversión en vivo. **No se probó crear un programa ni un voucher**: el usuario de la sesión no es administrador municipal (403).
