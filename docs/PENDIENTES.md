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

## Fase 3: API REST, WebSockets, pagos/vouchers y alerta COM (2026-11-22): rehecha y probada en local, con commit en `feat/fase-3-4-api-panel-chofer`, sin despliegue

- **Estado:** base de datos de kyan (2026-11-21) y capa de API rehecha el 2026-11-22 después de la revisión (permisos, pagos, vouchers, pánico, chofer trabado). Pasan 15 E2E con dos réplicas, Socket.IO, Redis y PostGIS reales, más todas las suites anteriores. Detalle: [`2026-11-20-fase-3-api-websockets-pagos-com`](bitacora/2026-11-20-fase-3-api-websockets-pagos-com/).
- **Falta:**
  - ~~**Commit**~~: hecho el 2026-11-22 y mergeado a `main` (PR #1). `localities.controller.ts` de kyan entró en ese commit porque la API lo necesita. El trabajo en curso de kyan (`passenger-mobile/app`, `passenger-mobile/lib` y `mockup/`) se commiteó tal cual en `main` el 2026-11-22, a pedido del usuario.
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
  - **QR firmados:** los atajos de prueba (`test-qr`) solo funcionan con `ALLOW_UNSIGNED_QR=true` (desarrollo). Para producción hay que imprimir QR firmados (`POST /auth/guest-qr-codes`) que apunten a `https://<pwa>/?qr=<código>`.
  - **`passenger-mobile`:** está en `main` pero **no compila** (no pasa el typecheck): falta la dependencia `@react-native-async-storage/async-storage` y la configuración de módulos. Es trabajo en curso de kyan, commiteado tal cual el 2026-11-22.

## Fase 4: app del chofer (web y Expo) y Modo Invitado (2026-11-22): probada en el navegador, con commit en `feat/fase-3-4-api-panel-chofer`, sin despliegue

- **Estado:** `driver-core` compartido, `driver-web` y `guest-pwa` rehechas, y `driver-mobile` (Expo) portada. Funcionó de punta a punta en el navegador. Las decisiones del 2026-11-22: hay app del chofer en web y en Expo, y el invitado marca origen y destino en un mapa con su ubicación. Detalle: [`2026-11-22-fase-4-chofer-e-invitado`](bitacora/2026-11-22-fase-4-chofer-e-invitado/).
- **Falta:**
  - **PR** de la rama `feat/fase-3-4-api-panel-chofer` hacia `main` (no abierto).
  - **Probar `driver-mobile` en un teléfono** con Expo Go. Solo pasó el typecheck. Para la exportación web de Expo faltan `react-dom` y `@expo/metro-runtime`; hay que avisar antes de instalarlos.
  - Probar con el GPS real de un teléfono y con HTTPS: el navegador lo exige fuera de `localhost`.
  - **Fase 6:**
    - GPS en segundo plano y notificaciones push del chofer.
    - Geocodificación de direcciones para el invitado.
    - QR firmados impresos.
  - **Decidir con el municipio** si el chofer usará la PWA, la app Expo o las dos en producción.

## Fase 5: panel administrativo (2026-11-22): implementado y probado en local, con commit en `feat/fase-3-4-api-panel-chofer` (PR #1), sin despliegue

- **Estado:**
  - Usuarios con 5 roles y permisos, y segundo factor obligatorio para Administrador y Habilitaciones.
  - Tarifas configurables con doble control y simulador.
  - Configuración editable en caliente.
  - Habilitaciones con documentos, verificación, estados y vencimientos.
  - Auditoría, y renovación automática de la sesión del panel.
  - Detalle: [`2026-11-22-fase-5-panel-administracion`](bitacora/2026-11-22-fase-5-panel-administracion/). Antes, tablas legibles: [`2026-11-22-panel-tablas-legibles`](bitacora/2026-11-22-panel-tablas-legibles/).
- **Falta:**
  - **Definir con el municipio:**
    - Documentos obligatorios por tipo (hoy, una lista provisoria en `habilitations.service.ts`).
    - Plazos de conservación de datos: guardados en Configuración, sin efecto todavía.
    - Cargo por cancelación: guardado, sin efecto todavía.
    - Si el Operador COM puede cancelar viajes (hoy sí).
    - Quiénes serán los administradores iniciales.
  - **Alta y edición de agencias** desde el panel. Hoy solo se cambia su estado.
  - **Dibujar el QR** para imprimir desde el panel: necesita una librería nueva, que se instala con aviso. Hoy se genera la dirección firmada.
  - **Almacenamiento de documentos en producción:** S3 o el del municipio, con la misma interfaz `IFileStorage` (Fase 6).
  - **Probar en el navegador** la aprobación de una tarifa con dos administradores, la subida de documentos desde el panel y las pantallas como Habilitaciones y como agencia (la API ya está probada).
  - **Clave de cifrado del 2FA:** hoy se deriva de `JWT_SECRET`, así que rotar ese secreto obliga a reconfigurar el 2FA. Evaluar una clave propia antes de producción.
  - **Vouchers:** probar el alta de programas y vouchers con un administrador (los formularios ya piden pesos).
