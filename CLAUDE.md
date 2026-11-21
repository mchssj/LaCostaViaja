# La Costa Viaja

Sistema Digital Oficial de Despacho y Movilidad Municipal de Transporte de Pasajeros (taxis y remises habilitados) del Partido de La Costa (PBA). Monorepo pnpm + Turborepo: API NestJS (`apps/api`), motor tarifario puro compartido (`packages/domain`) y PostgreSQL + PostGIS (`packages/db`). Las apps Expo, la PWA y el panel llegan en las fases 4 y 5.

**Antes de empezar, lee [`docs/PENDIENTES.md`](docs/PENDIENTES.md)**: ahí está lo que quedó sin terminar, los datos que faltan validar con el municipio y la fase siguiente.

## Convenciones

- **Bitácora:** cada requerimiento (cada fase y cada cambio pedido) va en `docs/bitacora/AAAA-MM-DD-slug/`:
  - `PLAN.md`: se escribe antes de implementar y no se edita después.
  - `DOCUMENTACION.md` y `GUIA_IMPLEMENTACION.md`: al terminar.
  - `pruebas/`: opcional.
  - Una fila nueva en `docs/bitacora/README.md`.
  - El formato está en `docs/bitacora/PLANTILLA.md`. Todo en español, con diagramas Mermaid.
- **Pendientes:** `docs/PENDIENTES.md` se actualiza al cerrar cada requerimiento, con la fecha en la línea "Actualizado el".
- **Fechas:** siempre AAAA-MM-DD, en carpetas, documentos y nombres de archivo. Una decisión o un dato que puede cambiar lleva su fecha, por ejemplo "(2026-11-20)".
- **Migraciones SQL:** `packages/db/migrations/AAAAMMDDHHMMSS_slug.sql` en español, con la misma convención para `seeds/` y `tests/`.
  - Una migración aplicada no se edita: el runner compara el checksum y aborta. Los cambios van en un archivo nuevo.
  - Índices `GIST` en toda columna geométrica.
- **Modelo de datos:** si una migración agrega o cambia tablas, se actualiza `docs/MODELO_DATOS.md` en el mismo cambio.
- **Commits:** Conventional Commits en español (`feat(tarifas): …`, `docs(bitacora): …`). Solo cuando se piden.
- **Paquetes de JavaScript:** **pnpm** (12.x), nunca npm.
  - Instalar con `pnpm install --frozen-lockfile` y correr con `pnpm <script>` o `pnpm exec <bin>`.
  - `pnpm-workspace.yaml` tiene antigüedad mínima de 7 días, `trustPolicy: no-downgrade` y la lista `allowBuilds` de paquetes autorizados a correr scripts de instalación.
  - Si hace falta instalar algo nuevo en la máquina, avisar y que lo instale el usuario.
- **Dinero:** siempre centavos enteros y porcentajes en puntos básicos. Nada de floats en importes.
- **Hora:** toda regla de franja, temporada o vencimiento se evalúa en `America/Argentina/Buenos_Aires` (`ar_today()` en SQL, `toLocalParts()` en TS).

## Cuidados

- Las geometrías de localidades, el eje RP11 y los valores del cuadro tarifario del seed son **aproximados o ilustrativos**. No presentarlos como oficiales.
- La base local corre en Docker (`pnpm infra:up`, puerto `55432`). `pnpm db:reset --yes` borra el esquema completo y solo funciona contra `localhost`.
- Las credenciales van en el `.env` de la raíz, que no se versiona. No mostrarlas.
