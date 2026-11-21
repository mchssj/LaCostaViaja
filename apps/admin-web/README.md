# Panel Municipal, Agencias y COM (Next.js + Tailwind) — Fase 5

- Alta/baja/suspensión de habilitaciones (choferes, vehículos, agencias) con trazabilidad.
- Editor de cuadros tarifarios (`tariff_schedules` / `tariff_rules` / `season_periods`): diurno/nocturno, temporada, coeficiente de Retorno Interurbano RP11.
- Mapa de calor de demanda por localidad/zona de despacho.
- Consola de alertas COM (suscripción en tiempo real; `pg_notify('com_panic_alerts')` como canal de respaldo).
