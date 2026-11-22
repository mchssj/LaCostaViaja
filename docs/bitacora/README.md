# Bitácora de requerimientos

Cada requerimiento tiene su propia carpeta `AAAA-MM-DD-nombre-corto/`, con la fecha en que se planeó.

| Archivo | Contenido |
|---|---|
| `PLAN.md` | La planeación original, tal como se aprobó. No se edita después. |
| `DOCUMENTACION.md` | Cómo funciona lo que se construyó: reglas, datos, funciones y pantallas. |
| `GUIA_IMPLEMENTACION.md` | Qué archivos cambiaron, cómo desplegarlo, cómo probarlo, cómo revertirlo y en qué se apartó del plan. |
| `pruebas/` | Opcional: scripts de prueba que se usaron. |

El formato detallado de cada archivo está en [PLANTILLA.md](PLANTILLA.md), que también sirve como enunciado para generar los `.md` con otra IA.

## Requerimientos

Lo que quedó sin terminar o sin desplegar está resumido en [`../PENDIENTES.md`](../PENDIENTES.md).

| Fecha | Requerimiento | Estado |
|---|---|---|
| 2026-11-20 | [Fase 1: monorepo, esquema PostGIS y motor tarifario](2026-11-20-fase-1-monorepo-postgis-tarifas/) | Probado en local (2026-11-20) contra PostGIS 3.4 en Docker; sin commit ni despliegue |
| 2026-11-20 | [Fase 2: Redis GPS, colas de despacho y lock atómico](2026-11-20-fase-2-redis-gps-despacho/) | Probado en local (2026-11-20): integración, concurrencia y simulación de temporada; sin commit ni despliegue |
| 2026-11-20 | [Fase 3: API REST, WebSockets, pagos/vouchers y alerta COM](2026-11-20-fase-3-api-websockets-pagos-com/) | Base de datos de kyan (2026-11-21); capa de API rehecha y probada en local (2026-11-22): 15 E2E con permisos, réplicas, pagos, vouchers y pánico; sin commit ni despliegue |
| 2026-11-22 | [Panel: tablas legibles (pesos, fechas, estados en español)](2026-11-22-panel-tablas-legibles/) | Probado en el navegador (2026-11-22) en Tarifas y Flota; Vouchers sin datos de prueba; commit en `feat/fase-3-4-api-panel-chofer` |
| 2026-11-22 | [Fase 4: app del chofer (web y Expo) y Modo Invitado](2026-11-22-fase-4-chofer-e-invitado/) | Probado de punta a punta en el navegador (2026-11-22): invitado pide, chofer acepta y completa, invitado califica; Expo solo con typecheck |
| 2026-11-22 | [Fase 5: panel administrativo (usuarios, roles, 2FA, tarifas, configuración, habilitaciones, auditoría)](2026-11-22-fase-5-panel-administracion/) | Probado en local (2026-11-22): 50 tests de integración de la API, smoke SQL y navegador por rol; commit en `feat/fase-3-4-api-panel-chofer` (PR #1) |
