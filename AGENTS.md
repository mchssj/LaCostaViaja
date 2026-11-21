# AGENTS.md — La Costa Viaja

Sistema Digital Oficial de Despacho y Movilidad Municipal de Transporte de Pasajeros
(taxis y remises habilitados) del Partido de La Costa (PBA). Monorepo pnpm + Turborepo.

Este documento delimita **qué hace cada agente/rol**, qué partes del repositorio le
corresponden y cómo se coordinan para no pisarse. Es la fuente de verdad sobre
responsabilidades; complementa a `CLAUDE.md` (convenciones) y a
`docs/PENDIENTES.md` (lo que falta).

## Mapa del monorepo

```
LaCostaViaja/
├─ apps/
│  ├─ api/             NestJS · tarifas, despacho, tracking, COM            (Fase 1 ✔, 2 ✔)
│  ├─ driver-mobile/   Expo · app del chofer (Android)                      (Fase 4)
│  ├─ passenger-mobile/ Expo · app del pasajero                            (Fase 4)
│  ├─ guest-pwa/       Next.js PWA · "Modo Invitado" por QR                 (Fase 4)
│  └─ admin-web/       Next.js + Tailwind · panel municipal, agencias, COM  (Fase 5)
├─ packages/
│  ├─ domain/          Tipos + motor tarifario PURO (compartido backend/apps)
│  └─ db/              Migraciones PostGIS, seeds, smoke tests SQL, runner
├─ infra/osrm/         Ruteo vial OSRM (opcional)
└─ docs/               Bitácora, MODELO_DATOS, PENDIENTES
```

## Roles y responsabilidades

### 1. API / Backend (`apps/api`)

**Owner:** agente backend.

**Hace:**
- Endpoints REST y gateways WebSocket del ciclo de vida del viaje.
- Módulos NestJS: `fares`, `tariffs`, `dispatch`, `presence`, `tracking`, `geo`, `routing`, `health`.
- Integración con PostGIS (vía `pg`) y Redis (vía `ioredis`).
- Autenticación/autorización de choferes y pasajeros.
- Eventos de dominio (`DispatchEvents`) y Redis Pub/Sub entre réplicas.
- Cierre del viaje en base (`COMPLETED`) + `releaseAfterTrip`.
- Pagos (efectivo / Mercado Pago / vouchers) y alertas COM.
- Configuración (`config/`), bootstrap, filtros de excepción, reloj (`common/clock`).

**No toca:** código de apps móviles/web, migraciones SQL (solo consume `packages/db`),
ni lógica pura del motor tarifario (eso es `packages/domain`).

**Archivos clave:**
- `apps/api/src/app.module.ts`, `main.ts`, `bootstrap.ts`
- `apps/api/src/modules/**`
- `apps/api/src/redis/**`, `database/**`, `config/**`, `common/**`

### 2. Dominio puro (`packages/domain`)

**Owner:** agente de dominio.

**Hace:**
- Tipos compartidos entre backend y apps (enums, errores, dinero, geo, tiempo).
- Motor tarifario PURO (`fare-engine.ts`, `tariff.ts`, `quote.ts`) — sin I/O, sin framework.
- Algoritmos de despacho y ranking (`dispatch-ranking.ts`).
- Presencia y geometría (`presence.ts`, `geo.ts`, `geo-index.ts`).
- Tests unitarios del dominio (`*.spec.ts`).

**Regla de oro:** cero dependencias de NestJS, Express, pg, redis. Solo TS puro.
Todo importe monetario en **centavos enteros**; porcentajes en **puntos básicos**.

**No toca:** migraciones, endpoints, UI.

### 3. Base de datos (`packages/db`)

**Owner:** agente de datos — **asignado a este agente (Beam).**

**Hace:**
- Migraciones SQL (`migrations/AAAAMMDDHHMMSS_slug.sql`) en español.
- Seeds (`seeds/`) y smoke tests SQL (`tests/`).
- Runner `scripts/db.mjs` (migrate/seed/test/reset).
- Actualizar `docs/MODELO_DATOS.md` cuando cambia el esquema.

**Reglas:**
- Una migración aplicada no se edita: el runner compara checksum y aborta.
  Los cambios van en un archivo nuevo.
- Índices `GIST` en toda columna geométrica.
- Geometrías SRID 4326; cálculos en UTM 21S (`lc_metric_srid()` = 32721).
- Hora evaluada en `America/Argentina/Buenos_Aires` (`ar_today()`).
- Money en centavos enteros.

**No toca:** lógica TS, endpoints, UI.

### 4. App del chofer (`apps/driver-mobile`)

**Owner:** agente mobile-chofer.

**Hace:** Expo (Android). Turno, posiciones GPS, aceptar/rechazar viajes, tracking,
panic button, cobro, voucher. Consume `@lacosta/domain` y la API.

**Estado:** Fase 4 (pendiente).

### 5. App del pasajero (`apps/passenger-mobile`)

**Owner:** agente mobile-pasajero.

**Hace:** Expo. Solicitar viaje, cotización, seguimiento, pago, calificación.

**Estado:** Fase 4 (pendiente).

### 6. PWA Invitado (`apps/guest-pwa`)

**Owner:** agente web-invitado.

**Hace:** Next.js PWA. Flujo "Modo Invitado" por QR (sin registro), cotización y viaje.

**Estado:** Fase 4 (pendiente).

### 7. Panel municipal (`apps/admin-web`)

**Owner:** agente web-admin.

**Hace:** Next.js + Tailwind. Habilitaciones, editor tarifario, mapa de calor,
consola COM, configuración de pesos del ranking y tiempos de oferta.

**Estado:** Fase 5 (pendiente).

### 8. Infraestructura (`infra/osrm`, `docker-compose.yml`)

**Owner:** agente infra.

**Hace:** Ruteo vial OSRM (perfil `routing`), PostGIS/Redis en Docker, configuración
de despliegue y auto-escalado (Fase 6).

### 9. Documentación (`docs/`)

**Owner:** compartido, pero coordinado.

**Hace:**
- `docs/bitacora/AAAA-MM-DD-slug/`: `PLAN.md` (antes de implementar, no se edita),
  `DOCUMENTACION.md` y `GUIA_IMPLEMENTACION.md` (al terminar), `pruebas/` opcional,
  fila nueva en `docs/bitacora/README.md`.
- `docs/PENDIENTES.md`: actualizar al cerrar cada requerimiento (fecha en "Actualizado el").
- `docs/MODELO_DATOS.md`: actualizar cuando cambia el esquema.

Todo en español, con diagramas Mermaid. Fechas AAAA-MM-DD.

## Reglas de coordinación

1. **Bitácora obligatoria:** cada requerimiento (fase o cambio) va en su carpeta con
   fecha. Plan antes de implementar; documentación al terminar.
2. **No pisar migraciones:** una migración aplicada no se edita (checksum). Cambios en
   archivo nuevo.
3. **Dominio es la fuente de verdad de tipos:** las apps y la API importan de
   `@lacosta/domain`, no duplican tipos.
4. **Dinero y tiempo:** centavos enteros / puntos básicos; reglas de franja/temporada/
   vencimiento en `America/Argentina/Buenos_Aires`.
5. **Paquetes:** solo pnpm (`pnpm install --frozen-lockfile`), nunca npm.
6. **Git:** no se inicializa ni se commitea salvo que el usuario lo pida.
7. **Datos sensibles:** credenciales en `.env` de la raíz (no versionado). No mostrarlas.
8. **No correr `pnpm build` con la preview de la API abierta:** borra `dist/`.
9. **Fase 3 aprobada el 2026-11-21:** implementación iniciada por el agente de base de datos
   (migración `20261121090000_api_pagos_com.sql`). El resto de los roles (API, etc.) arrancan cuando la migración y el `MODELO_DATOS.md` estén cerrados.

## Flujos de trabajo típicos

- **Nueva regla tarifaria / motor:** agente de dominio (`packages/domain`) +
  agente de datos (si cambia esquema) + agente backend (si se expone).
- **Nuevo endpoint de despacho:** agente backend, consumiendo `packages/domain`.
- **Cambio de esquema:** agente de datos crea migración + actualiza
  `docs/MODELO_DATOS.md`; backend adapta repositorios.
- **App nueva (Fase 4/5):** agente mobile/web correspondiente, consumiendo
  `@lacosta/domain` y la API.

## Asignaciones actuales

| Rol | Responsable |
|---|---|
| Base de datos (`packages/db`) | Este agente (Beam) |
| Dominio puro, API, apps, infra, docs | Sin asignar |

## Estado actual (2026-11-20)

- Fase 1 ✔ y Fase 2 ✔ probadas en local, sin commit ni despliegue.
- Fase 3 aprobada 2026-11-21, implementación iniciada (base de datos).
- Fases 4, 5, 6 pendientes.
- Datos del municipio (polígonos, cuadro tarifario, calendario) son aproximados/ilustrativos.