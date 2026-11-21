# La Costa Viaja

Sistema Digital Oficial de Despacho y Movilidad Municipal de Transporte de Pasajeros (taxis y remises habilitados)
del **Partido de La Costa, Provincia de Buenos Aires**.

## Estructura del monorepo

```
LaCostaViaja/
├─ apps/
│  ├─ api/                 NestJS · tarifas, despacho, tracking, COM            (Fase 1 ✔ tarifas)
│  ├─ driver-mobile/       Expo · app del chofer (Android)                      (Fase 4)
│  ├─ passenger-mobile/    Expo · app del pasajero                              (Fase 4)
│  ├─ guest-pwa/           Next.js PWA · "Modo Invitado" por QR                 (Fase 4)
│  └─ admin-web/           Next.js + Tailwind · panel municipal, agencias, COM  (Fase 5)
├─ packages/
│  ├─ domain/              Tipos + motor tarifario PURO (compartido backend/apps)
│  └─ db/                  Migraciones PostGIS, seeds de La Costa, smoke tests SQL, runner
├─ infra/osrm/             Ruteo vial OSRM (opcional)
├─ docs/
│  ├─ bitacora/            Un requerimiento por carpeta: AAAA-MM-DD-slug/ (PLAN, DOCUMENTACION, GUIA)
│  ├─ PENDIENTES.md        Lo que falta terminar o validar
│  └─ MODELO_DATOS.md      Tablas, vistas y funciones PostGIS
├─ CLAUDE.md               Convenciones del proyecto
└─ docker-compose.yml      PostGIS 16-3.4 · Redis 7.4 · OSRM (perfil "routing")
```

## Puesta en marcha

Requisitos: Node ≥ 22.12 (probado con 24), pnpm, Docker Desktop.

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up          # PostGIS en :55432, Redis en :56379
pnpm db:migrate        # esquema
pnpm db:seed           # 14 localidades, corredor RP11, cuadro tarifario 2026/27, flota demo
pnpm db:test           # smoke tests SQL (en transacción revertida)
pnpm test              # tests unitarios + HTTP (sin base)
pnpm test:int          # integración contra PostGIS y Redis (TEST_DATABASE_URL, TEST_REDIS_URL)
pnpm --filter @lacosta/api test:sim   # simulación de temporada alta (≈1 min)
pnpm dev:api           # http://localhost:3000/api
```

Cotizar un viaje (San Bernardo · Av. Chiozza → Mar de Ajó centro):

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/v1/fares/quote -ContentType 'application/json' -Body '{"origin":{"lat":-36.6875,"lng":-56.68},"destination":{"lat":-36.716,"lng":-56.68},"serviceType":"TAXI"}'
```

## Hoja de ruta

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Monorepo, esquema PostGIS + seeds, `FareCalculatorService` | ✔ |
| 2 | Redis GPS en vivo, colas de despacho por corredor/parada, lock atómico, prioridad de Viaje de Vuelta | ✔ |
| 3 | API REST + WebSockets del ciclo de vida del viaje, pagos (efectivo / Mercado Pago / vouchers), alertas COM | — |
| 4 | App del chofer (Android) y PWA Modo Invitado por QR | — |
| 5 | Panel municipal: habilitaciones, editor tarifario, mapa de calor, consola COM | — |
| 6 | Pruebas de carga invierno/verano, resiliencia, despliegue y auto-escalado | — |

El detalle de cada fase (plan, documentación, guía de implementación y pruebas) está en la
[bitácora](docs/bitacora/README.md).

⚠ Las geometrías de localidades y los valores tarifarios del seed son **aproximados/ilustrativos**
para desarrollo. Ver [docs/PENDIENTES.md](docs/PENDIENTES.md).
