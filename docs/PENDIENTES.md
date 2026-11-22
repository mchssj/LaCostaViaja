# Pendientes

Todo lo que se planteó o se empezó y todavía no está terminado o desplegado. Actualizado el **2026-11-22**.

## Fase 5 (base de datos): documentos de habilitación y auditoría (2026-11-21): implementada y probada
- Tablas `habilitation_documents` y `audit_log`, más `verified_by`/`verified_at` en drivers/vehicles/agencies.
- Smoke test `20261121130001_smoke_fase_5.sql` pasa.
- Pendiente: integración con APIs externas (RENAPER, VTV, aseguradoras) para verificación de veracidad.

## Fase 1: monorepo, esquema PostGIS y motor tarifario (2026-11-20): probada en local, sin commit ni despliegue

- **Estado:** todas las pruebas pasan contra PostGIS 3.4 en Docker (dominio, API, SQL e integración). Detalle: [`2026-11-20-fase-1-monorepo-postgis-tarifas`](bitacora/2026-11-20-fase-1-monorepo-postgis-tarifas/).
- **Falta:**
  - **Datos oficiales del municipio**, para reemplazar lo aproximado:
    - Polígonos de las 14 localidades y eje de la RP11 (Catastro municipal / ARBA / IGN).
    - Lista de localidades confirmada (se corrigieron General Lavalle, San Francisco Solano y Villa Robles).
    - Cuadro tarifario vigente: bandera, ficha, metros y segundos por ficha, mínima, coeficiente de retorno y acto administrativo.
    - Umbral interurbano: en el seed son 800 m.
    - Calendario de temporada alta: feriados trasladables y receso invernal de PBA.
  - Confirmar con la ordenanza si un remis puede operar sin agencia (hoy lo impide `vehicles_remis_requires_agency`).
  - Revisar los datos personales del esquema (DNI, CUIL, teléfono, ubicación GPS) en el marco de la Ley 25.326 antes de producción.

## Fase 2: Redis GPS, colas de despacho y lock atómico (2026-11-20): probada en local, sin commit ni despliegue

- **Estado:** implementada según el plan. Pasan 14 tests de integración contra Redis y PostGIS reales (incluida la concurrencia) y la simulación de temporada: 200/200 viajes asignados, p95 de 2,46 s y 0 dobles asignaciones. Detalle: [`2026-11-20-fase-2-redis-gps-despacho`](bitacora/2026-11-20-fase-2-redis-gps-despacho/).
- **Falta:**
  - Definir con el municipio:
    - Plazo de conservación del recorrido GPS (`trip_track_points`).
    - Los pesos del ranking (Viaje de Vuelta, cola, penalización por rechazo).
    - El tiempo de oferta (15 s).
    - El tope de búsqueda (3 min).

    Hoy son variables de entorno; en la Fase 5 pasan al panel.
  - **Fase 6:**
    - Redis con réplica y persistencia AOF en producción.
    - Las claves usan el prefijo `lc:` y declaran todas sus KEYS en Lua, pero para Redis Cluster falta agruparlas con hashtags.
    - Prueba de carga real.
  - No correr `pnpm build` con la preview de la API abierta: borra `dist/` y la preview se cae (hay que reiniciarla).

## Fase 3: API REST, WebSockets, pagos/vouchers y alerta COM (2026-11-22): rehecha y probada en local, sin commit ni despliegue

- **Estado:** base de datos de kyan (2026-11-21) y capa de API rehecha el 2026-11-22 después de la revisión (permisos, pagos, vouchers, pánico, chofer trabado). Pasan 15 E2E con dos réplicas, Socket.IO, Redis y PostGIS reales, más todas las suites anteriores. Detalle: [`2026-11-20-fase-3-api-websockets-pagos-com`](bitacora/2026-11-20-fase-3-api-websockets-pagos-com/).
- **Falta:**
  - **Commit:** hacerlo en una rama propia cuando se pida. En el árbol de trabajo también hay trabajo sin commit de kyan (`passenger-mobile/app`, `lib`, `mockup/`, `localities.controller.ts`), que no se tocó salvo `@Public()` en `localities.controller.ts`.
  - **Mercado Pago:**
    - Probar contra el sandbox real: credenciales de prueba en el `.env` (`PAYMENTS_PROVIDER=mercadopago`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`), que carga el responsable de la cuenta.
    - **Split marketplace** a agencias y choferes: no implementado. Requiere la autorización OAuth de cada vendedor y una cuenta habilitada.
  - **Proveedores reales** (hoy solo el de log, de desarrollo): SMS para el código de pasajeros y canal de escalamiento de alertas (SMS o llamada a guardia).
  - **Definir con el municipio:**
    - Cargo por cancelación (hoy 0).
    - Espera por "no se presentó" (5 min).
    - Plazo de escalamiento (60 s).
    - Plazos de conservación de alertas, snapshots, eventos y recorrido.
  - ~~**Entorno local:** Windows bloqueaba el puerto 56379 del Redis.~~ Resuelto el 2026-11-22: Redis pasó al **56390** (`docker-compose.yml`, `.env.example`, `.env`).
  - **Prototipos:** `driver-web` y la PWA usan `test-qr` / `demo-qr` para entrar como invitado, así que solo funcionan con `ALLOW_UNSIGNED_QR=true` (desarrollo). Para producción hay que imprimir QR firmados (`POST /auth/guest-qr-codes`).
  - **`passenger-mobile`:** no pasa el typecheck. Es trabajo sin commit de kyan (falta `@react-native-async-storage/async-storage` y la config de módulos).
  - **Decidir con el usuario:**
    - Si `driver-web` (Next.js) reemplaza a `driver-mobile` (Expo) o es solo un prototipo.
    - Si el Modo Invitado (`guest-pwa`) queda como app aparte o como la versión web de `passenger-mobile`.

## Fases 4 y 5: prototipos de kyan sin plan (2026-11-21/22)

- **Estado:** hay prototipos funcionales de `admin-web` (Leaflet, consola COM), `guest-pwa` (QR con cámara), `driver-web` y apps Expo, pero no tienen `PLAN.md` en la bitácora. Antes de seguir con esas fases, escribir sus planes según la convención y usar los prototipos como base.
- **Panel, tablas legibles (2026-11-22):** hecho en Tarifas, Flota y Vouchers ([`2026-11-22-panel-tablas-legibles`](bitacora/2026-11-22-panel-tablas-legibles/)). Falta:
  - Ver las tablas de Vouchers con datos y probar el alta de programas y vouchers (los formularios ya piden pesos desde el 2026-11-22) con un usuario administrador municipal.
  - Que el panel renueve el token: el acceso vence a los 15 minutos y hoy obliga a volver a ingresar.
