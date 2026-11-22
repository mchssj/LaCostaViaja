# Fase 3 · API REST, WebSockets, pagos/vouchers y alerta COM: guía de implementación

## Estado

Rehecha y probada en local el 2026-11-22 contra PostGIS 3.4 y Redis 7.4 en Docker. Sin commit y sin despliegue.

## Historia

1. **2026-11-21/22 · Primera implementación (kyan).** Esquema de base de datos completo y probado (`20261121090000`, `20261121110000` y seeds de demo), API inicial y prototipos de las apps.
2. **2026-11-22 · Revisión.** La revisión encontró problemas graves en la capa de API:
   - Cualquier usuario podía mover cualquier viaje.
   - Cualquiera podía ver cualquier viaje y su ubicación.
   - El webhook aceptaba pagos sin firma.
   - Los montos los mandaba el cliente.
   - Cualquier sesión podía sumarle saldo a un voucher.
   - El chofer quedaba trabado en Redis después de cada viaje.
   - El pánico era público y aceptaba identidades inventadas.
   - La clave de los JWT tenía un valor por defecto conocido.
   - El refresh token nunca funcionaba.
   - La lista de choferes exponía DNI, CUIL, teléfono y el hash del PIN.
3. **2026-11-22 · Rehechura (sin revertir el historial).** Se rehízo la capa de API sobre el mismo esquema, siguiendo este `PLAN.md`. Se conservaron la base de datos, los seeds y los prototipos.

## Archivos

| Archivo | Cambio |
|---|---|
| `packages/domain/src/trip-lifecycle.ts`, `track-summary.ts` (+ tests) | Máquina de estados del viaje y resumen del recorrido GPS |
| `packages/domain/src/errors.ts` | Códigos `UNAUTHORIZED`, `FORBIDDEN`, `INVALID_TRANSITION`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `PAYMENT_ERROR`, `VOUCHER_REJECTED` |
| `packages/db/migrations/20261122100000_pagos_mp_y_eventos.sql` | Nueva: preferencia de MP, unicidad de cobros, índice de `seq`, funciones de saldo reservado |
| `apps/api/src/security/*` | Nuevo: guard global (cerrado por defecto), `@Public`/`@Allow`, JWT con secreto obligatorio, cotización firmada, idempotencia, límites |
| `apps/api/src/config/app-config.ts`, `.env.example` | Secretos obligatorios y parámetros de viaje, pagos y pánico |
| `apps/api/src/modules/auth/*` | Rehecho: cuatro formas de entrar, QR firmados, refresh rotativo arreglado, OTP con límites |
| `apps/api/src/modules/trips/*` | Rehecho: ciclo de vida con permisos por parte, voucher en la misma transacción, efectos en Redis y reconciliador |
| `apps/api/src/modules/realtime/*`, `trip-events/*` | Nuevo: los tres gateways con permisos, reenvío por `seq` y oferta vigente al reconectar (reemplaza a los tres gateways anteriores) |
| `apps/api/src/common/redis-io.adapter.ts` | Toma la configuración de la app y hace un cierre ordenado |
| `apps/api/src/modules/dispatch/*` | El despacho registra sus eventos (`seq`); `withdrawOffer()` |
| `apps/api/src/modules/payments/*` | Rehecho: proveedor de Mercado Pago real y simulado, firma `x-signature`, consulta del pago real |
| `apps/api/src/modules/vouchers/*` | Rehecho: solo administración por endpoints; reserva, ajuste, consumo y liberación internos con bloqueo y control de presupuesto |
| `apps/api/src/modules/panic/*` | Rehecho: autenticado, snapshot del servidor, posición en vivo, escalamiento y atención por rol |
| `apps/api/src/modules/fleet/*`, `tariffs/tariffs.controller.ts` | Solo operadores, con columnas explícitas (sin `pin_hash`) y alcance por agencia |
| `apps/api/src/modules/drivers/drivers.controller.ts` | DTOs validados, `GET /drivers/me/state`, ubicación en vivo al pasajero |
| `apps/api/src/modules/geo/localities.controller.ts` | `@Public()` (archivo sin commit de kyan; único cambio) |
| `apps/api/src/main.ts`, `bootstrap.ts` | Arranque de WebSockets y OpenAPI; la API no se cierra por promesas rechazadas sin manejar |
| `apps/api/test/fase3.e2e.int-spec.ts`, `setup-env.ts`, `fares.http.spec.ts` | 15 E2E nuevos y 2 HTTP; reemplazan `trip.e2e`, `payments.e2e` y `vouchers.e2e`, que probaban el contrato inseguro |
| `docs/MODELO_DATOS.md` | Cambios de la migración nueva |

## Despliegue (hecho el 2026-11-22, solo en local)

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate
```

Variables nuevas del `.env`:

- **Obligatorias:** `JWT_SECRET` y `QR_SECRET`, de 32 caracteres o más.
- **Pagos:** `PAYMENTS_PROVIDER=fake`. Para el sandbox real hacen falta `mercadopago`, `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET`.
- **Solo desarrollo:** `ALLOW_UNSIGNED_QR=true`.
- El `.env` local de desarrollo ya tiene valores generados.

## Pruebas

| Suite | Resultado |
|---|---|
| Dominio (`pnpm test`) | 64 ✓ (8 nuevos: máquina de estados y recorrido) |
| API unitarias / HTTP con dobles | 28 ✓ (2 nuevos: guard global y cotización firmada) |
| Integración PostGIS (Fase 1) | 9 ✓ |
| Despacho Redis + PostGIS (Fase 2) | 14 ✓ |
| **E2E Fase 3** (`test/fase3.e2e.int-spec.ts`) | **15 ✓** |
| SQL (`pnpm db:test`) | ✓ (incluye los smoke de kyan de las fases 3 y 5) |
| Typecheck y build | ✓ (salvo `passenger-mobile`, que es trabajo sin commit de kyan y no se tocó) |

**Qué prueba el E2E** (dos réplicas de la API, Socket.IO real, Redis y PostGIS reales):

- **Permisos:**
  - Sin sesión → 401.
  - Un invitado no ve la flota ni crea programas.
  - El COM ve la flota sin hashes.
  - Un pasajero no puede marcar "llegué".
  - Otro chofer recibe 404 sobre un viaje ajeno.
  - Otro pasajero no ve ni sigue el viaje.
- **Autenticación:**
  - Un QR inventado se rechaza.
  - El refresh funciona una vez y reutilizarlo revoca la sesión.
  - El PIN se bloquea a los 5 intentos.
- **Viaje completo:**
  - Precio garantizado con `quoteToken`; uno adulterado da 400.
  - `Idempotency-Key`: el reintento devuelve lo mismo y otro cuerpo con la misma clave da 409. Un segundo viaje abierto da 409.
  - Reenvío ordenado por `seq` al suscribirse tarde y al reconectar.
  - `clientEventId` repetido es idempotente.
  - Ubicación del chofer en vivo.
  - Taxímetro de referencia calculado por el servidor (el valor enviado se ignora).
  - **El chofer queda libre y recibe la oferta siguiente.**
  - El efectivo lo confirma solo el chofer, por el monto del viaje y una sola vez.
- **Cancelaciones:** el chofer que devuelve el viaje antes de llegar dispara el re-despacho a otro chofer, se libera y su lock se limpia. Cuando cancela el pasajero, el chofer queda libre y recibe aviso.
- **Réplicas:** la oferta creada en la réplica A llega al chofer conectado a la B.
- **Reconciliador:** libera a un chofer de un viaje ya cerrado.
- **Vouchers:**
  - Dos viajes simultáneos con saldo para uno → 201 y 422.
  - Cancelar devuelve el saldo.
  - Completar consume el monto y suma a `spent_cents`.
- **Mercado Pago:**
  - El link es idempotente.
  - Una firma inválida da 401.
  - Una firma válida consulta el pago al proveedor y queda `PAID`; el reintento queda `unchanged`.
  - Un monto distinto deja el pago `FAILED`.
- **Pánico:**
  - Sin sesión → 401.
  - Las identidades y el snapshot enviados por el cliente se ignoran.
  - El reintento es idempotente; el mismo id usado por otro usuario da 409.
  - La alerta y la posición llegan al COM.
  - Escalamiento.
  - Un pasajero no puede atenderla; un segundo `ack` da 409.
  - Cierre como falsa alarma.

**Verificación manual:** la API compilada arranca y responde.

- `GET /api/drivers` sin token → 401.
- OpenAPI en `/api/docs` con 45 rutas.

## En qué se apartó del plan

- **Rutas sin versión:** además de `/api/v1/…`, todas responden sin versión (`/api/trips`), porque los prototipos ya las usan así. La cotización sigue siendo solo `/api/v1/fares/quote`.
- **Formato de las respuestas:** la vista del viaje y los listados usan snake_case, compatible con los prototipos.
- **Login:** responde 200 (antes 201).
- **Cotización firmada opcional:** si no viene, se cotiza al crear, para no romper los prototipos. Con el token, el precio queda garantizado.
- **Tarifa en el cambio de destino:** el plan decía "acepta el precio antes de aplicarse"; quedó como dos pasos con `quoteToken`, sin un endpoint `/confirm`.
- **Split de Mercado Pago (marketplace):** no implementado. Requiere la autorización (OAuth) de cada agencia o chofer vendedor y una cuenta habilitada; por ahora se cobra a una sola cuenta. Queda en `PENDIENTES.md`.
- **QR de Mercado Pago:** se usa el link de Checkout Pro dibujado como QR, no el "QR dinámico" de Mercado Pago presencial, que requiere caja (POS) registrada por vendedor.
- **Taxímetro de referencia:** usa los puntos ya persistidos al completar. Los que todavía estén en el Redis Stream no entran.
- **SMS y notificación de escalamiento:** solo existe el proveedor de log (desarrollo). El proveedor real se elige con el municipio.
- **`PLAN.md`:** kyan editó la línea de estado ("aprobado el 2026-11-21…"). Se dejó como está; no se volvió a tocar.

## Incidentes durante las pruebas

- **Bugs reales encontrados por los E2E y corregidos:**
  - Comparación del enum `payment_method` contra `text[]` sin cast: el link de Mercado Pago no se generaba.
  - Tipos inconsistentes en el `UPDATE` del webhook (`text` vs `payment_status`).
  - El chofer del viaje podía "reclamar" con su sesión la alerta de pánico del pasajero reutilizando su `clientEventId`.
  - **Cierre del adaptador de Socket.IO:** cortaba la conexión a Redis antes de que salieran sus `UNSUBSCRIBE`, y dejaba comandos rechazados ("Connection is closed"). Ahora espera y usa `quit()`.
- **Riesgo en producción:** de ese último incidente salió que una promesa rechazada sin manejar (por ejemplo, Redis cortándose) habría cerrado la API, porque Node 24 termina el proceso por defecto. Ahora se registra y la API sigue atendiendo.
- **Entorno:** Windows tenía bloqueado el puerto 56379 del Redis de `docker-compose`. Las pruebas usaron un Redis temporal en 56390.
- **Proceso ajeno en el puerto 3000:** un servidor de desarrollo iniciado fuera de esta sesión (desde las 01:54) quedó escuchando en el 3000 y recargó el código nuevo solo. No se lo tocó.

## Cómo revertir

Para la base local:

```sql
DROP FUNCTION municipal_program_held_cents(uuid);
DROP FUNCTION voucher_trip_hold_cents(uuid);
DROP INDEX trip_events_trip_seq_idx, payments_one_pending_mp_per_trip, payments_one_settled_offline_per_trip, payments_preference_uq;
ALTER TABLE payments DROP COLUMN provider_preference_id;
DELETE FROM schema_migrations WHERE filename = '20261122100000_pagos_mp_y_eventos.sql';
```

Para el código: como no hay commit, alcanza con descartar los cambios del árbol de trabajo. **No** usar `git checkout .`, porque también borraría el trabajo sin commit de kyan (`passenger-mobile`, `mockup/`, `localities.controller.ts`): revertir archivo por archivo según la tabla de arriba.
