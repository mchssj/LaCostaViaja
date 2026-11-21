# Fase 1 · Monorepo, esquema PostGIS y motor tarifario: guía de implementación

## Estado

Probado en local el 2026-11-20 contra PostGIS 3.4 en Docker. Sin commit (la carpeta no es un repositorio git) y sin despliegue.

## Archivos

| Archivo | Cambio |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` | Monorepo pnpm + Turborepo |
| `docker-compose.yml`, `.env.example` | PostGIS 16-3.4 (`:55432`), Redis 7.4 (`:56379`) y OSRM (perfil `routing`) |
| `packages/domain/src/*` | Tipos, errores, geo, dinero, hora argentina, CUIT, cuadro tarifario y `computeFare()` |
| `packages/db/migrations/20261120120000_extensiones_y_tipos.sql` | Extensiones, `ar_today()`, `is_valid_cuit()` y enums |
| `packages/db/migrations/20261120120100_geografia_corredor_rp11.sql` | Corredor, localidades, zonas y funciones espaciales |
| `packages/db/migrations/20261120120200_flota_y_habilitaciones.sql` | Agencias, choferes, vehículos, autorizaciones y vista de elegibilidad |
| `packages/db/migrations/20261120120300_cuadro_tarifario.sql` | Cuadros, reglas y temporadas |
| `packages/db/migrations/20261120120400_viajes_y_alertas_com.sql` | Pasajeros, viajes, eventos y alertas de pánico |
| `packages/db/seeds/20261120130000_*`, `..130100_*`, `..130200_*` | 14 localidades, 5 zonas, cuadro 2026/2027 y flota demo |
| `packages/db/tests/20261120140000_smoke_fase_1.sql` | Smoke tests de integridad |
| `packages/db/scripts/db.mjs` | Runner: `migrate`, `seed`, `test`, `reset --yes` |
| `apps/api/src/**` | NestJS: config, base, geo, ruteo, tarifas, cotización y health |
| `apps/api/scripts/dev.mjs` | Modo desarrollo (`tsc --watch` + `node --watch`) en lugar del Nest CLI |
| `apps/api/test/**` | Dobles en memoria, pruebas HTTP y de integración |
| `apps/{driver-mobile,passenger-mobile,guest-pwa,admin-web}/README.md` | Alcance reservado para las fases 4 y 5 |

## Despliegue (hecho el 2026-11-20, solo en local)

```powershell
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
pnpm db:seed
```

## Pruebas

### Motor tarifario y dominio (`packages/domain`)

`pnpm test`: 44 pruebas. Cubren fórmula, mínima, retorno, bonificación, redondeo, el invariante con 500 casos aleatorios, franja en hora argentina, temporada, CUIT y geo. Resultado: todas pasan.

### API con dobles en memoria (`apps/api`)

`pnpm test`: 26 pruebas.

- Escenarios del `FareCalculatorService`: urbano, San Bernardo → Mar de Ajó, bonificación, cruce bajo el umbral, nocturno en temporada alta, fallback rural, mar adentro y sin cuadro.
- Ruteo: OSRM y circuit breaker.
- HTTP: 200, 400, 422 y el rechazo de parámetros internos.

Resultado: todas pasan.

### Base de datos (PostGIS 3.4 en Docker)

`pnpm db:test`: 6 bloques de aserciones dentro de una transacción revertida. Cubren:

- Resolución de localidades, bordes y fallback.
- Corredor RP11.
- Localidades y zonas inválidas.
- Elegibilidad de los 6 choferes demo.
- Cuadros superpuestos.
- Asignación bloqueada, aceptación atómica, un viaje activo por chofer y pánico idempotente.

Resultado: todos pasan.

### Integración API + PostGIS

`pnpm test:int`: 9 pruebas contra la base sembrada (health, `ST_Covers`, fallback, `ST_Difference` y cotizaciones reales). Resultado: todas pasan.

### Punta a punta

Se levantó `node dist/main.js` y se cotizó con [`pruebas/cotizar.ps1`](pruebas/cotizar.ps1). Av. Chiozza → Mar de Ajó a las 00:45 hora argentina dio $10.190, interurbano nocturno, con $950,40 de retorno por 1.441 m fuera de San Bernardo.

## En qué se apartó del plan

- **Tablas extra** que necesitan las pedidas: `corridor_axes`, `tariff_schedules`, `season_periods`, `passengers` y `trip_events`.
- **Detección de localidad:** se usa `ST_Covers` en lugar de `ST_Contains`, para incluir el borde y desempatar de forma determinística.
- **Umbral de 800 m:** se agregó para no cobrar retorno por cruzar el límite unos metros.
- **Localidades:** la lista del pedido tenía errores. General Lavalle es otro partido, y San Francisco Solano y Villa Robles no son del Partido de La Costa. Se modelaron las 14 localidades del partido de norte a sur: San Clemente del Tuyú, Las Toninas, Costa Chica, Santa Teresita, Mar del Tuyú, Costa del Este, Aguas Verdes, La Lucila del Mar, Costa Azul, San Bernardo, Mar de Ajó, Nueva Atlantis, Pinar del Sol y Costa Esmeralda.
- **Apps de las fases 4 y 5:** solo tienen un README; se generan en su fase para no fijar versiones de Expo y Next que quedarían viejas.
- **Convenciones adoptadas después de implementar:** el mismo 2026-11-20 se tomaron las del repositorio de referencia. Se renombraron migraciones, seeds y tests al formato `AAAAMMDDHHMMSS_slug.sql`, se creó esta bitácora y se sumó la política de pnpm (`minimumReleaseAge`, `trustPolicy`). Por eso este `PLAN.md` está reconstruido.
- **Sin Nest CLI:** con `trustPolicy: no-downgrade`, pnpm rechaza `chokidar@4.0.3`, que llega por `@nestjs/cli`. No se pudo confirmar que fuera un falso positivo, así que en lugar de excluirlo se quitó el CLI. El build ya usaba `tsc` y el modo desarrollo pasó a `apps/api/scripts/dev.mjs`.

## Incidentes durante las pruebas

- **Docker:** el daemon no estaba corriendo; se inició Docker Desktop.
- **pnpm 12:** bloqueó el script de instalación de `@parcel/watcher`, que pide `jest-haste-map`. Se marcó `false` en `allowBuilds` porque trae binarios precompilados.
- **Política de antigüedad:** el lockfile del primer `pnpm install` tenía versiones publicadas hace menos de 7 días. Se rehízo con `pnpm clean --lockfile` + `pnpm install`, y ahora `pnpm install --frozen-lockfile` pasa las políticas.
- **Renombre de migraciones:** cambiar los nombres obligó a recrear la base local con `pnpm db:reset --yes`. Después se repitieron todas las pruebas, con el mismo resultado.
- **Palabra reservada:** el seed de la flota usaba `authorization` como alias de columna, que en PostgreSQL es reservada. Se renombró a `authorization_number`.

## Cómo revertir

No hay nada desplegado. Para limpiar la base local:

```powershell
pnpm db:reset --yes
```

Para borrar los contenedores y sus volúmenes:

```powershell
docker compose down -v
```
