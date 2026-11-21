# Pendientes

Todo lo que se planteó o se empezó y todavía no está terminado o desplegado. Actualizado el **2026-11-21**.

## Fase 1: monorepo, esquema PostGIS y motor tarifario (2026-11-20): probada en local, sin commit ni despliegue

- **Estado:** todas las pruebas pasan contra PostGIS 3.4 en Docker (dominio, API, SQL e integración). Detalle: [`2026-11-20-fase-1-monorepo-postgis-tarifas`](bitacora/2026-11-20-fase-1-monorepo-postgis-tarifas/).
- **Falta:**
  - Inicializar el repositorio git y hacer el primer commit (cuando se pida).
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
  - **Fase 3:** exponer los servicios.
    - Endpoints de turno, posiciones, aceptar y rechazar.
    - Eventos WebSocket a partir de `DispatchEvents`, con Redis Pub/Sub entre réplicas.
    - Autenticación de choferes.
    - Cierre del viaje en la base (`COMPLETED`) junto con `releaseAfterTrip`.
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

## Fase 3: API REST, WebSockets, pagos/vouchers y alerta COM (2026-11-20): aprobada; base de datos implementada y probada (2026-11-21); API implementada (auth, trips, drivers, panic, vouchers, payments, gateways /driver /passenger /com, adaptador Redis, OpenAPI en /api/docs) — faltan tests end-to-end y idempotencia HTTP formal

- **Estado:** plan escrito, sin implementar. Detalle: [`2026-11-20-fase-3-api-websockets-pagos-com`](bitacora/2026-11-20-fase-3-api-websockets-pagos-com/PLAN.md).
- **Falta:**
  - Aprobar el plan, o pedir cambios.
  - Para probar Mercado Pago contra el sandbox: credenciales de prueba en el `.env`, que las carga el usuario.
  - Que el municipio defina:
    - Cargo por cancelación.
    - Espera por "no se presentó".
    - Plazo de escalamiento de alertas.
    - Proveedor de SMS.
