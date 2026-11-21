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
| 2026-11-20 | [Fase 3: API REST, WebSockets, pagos/vouchers y alerta COM](2026-11-20-fase-3-api-websockets-pagos-com/) | Aprobado 2026-11-21, implementación iniciada (base de datos) |
