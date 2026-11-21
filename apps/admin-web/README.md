# Panel Municipal, Agencias y COM (Next.js + Tailwind) — Fase 5

Estructura inicial creada (2026-11-21): layout con sidebar de 5 vistas + Consola COM,
y la vista 1 (Monitoreo y COM) portada del mockup. El resto son placeholders.

- Alta/baja/suspensión de habilitaciones (choferes, vehículos, agencias) con trazabilidad.
- Editor de cuadros tarifarios (`tariff_schedules` / `tariff_rules` / `season_periods`): diurno/nocturno, temporada, coeficiente de Retorno Interurbano RP11.
- Mapa de calor de demanda por localidad/zona de despacho.
- Consola de alertas COM (suscripción en tiempo real; `pg_notify('com_panic_alerts')` como canal de respaldo).

## Puesta en marcha

```powershell
pnpm install --frozen-lockfile   # instala next, react, tailwind (requiere aprobación de deps nuevas)
pnpm --filter @lacosta/admin-web dev   # http://localhost:3001
```
