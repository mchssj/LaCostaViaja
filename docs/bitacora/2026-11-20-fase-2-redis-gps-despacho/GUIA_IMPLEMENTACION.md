# Fase 2 · Redis GPS, colas de despacho y lock atómico: guía de implementación

## Estado

Probado en local el 2026-11-20 contra Redis 7.4 y PostGIS 3.4 en Docker. Sin commit (la carpeta no es un repositorio git) y sin despliegue. Los servicios todavía no tienen endpoints: se exponen en la Fase 3.

## Archivos

| Archivo | Cambio |
|---|---|
| `packages/db/migrations/20261120150000_despacho_y_recorrido.sql` | `trip_offers`, `trip_track_points`, `drivers.accepts_interurban`, `trips.dispatch_round` y `dispatch_started_at` |
| `packages/domain/src/geo-index.ts` | Punto en polígono, proyección sobre RP11, `GeoIndex` |
| `packages/domain/src/presence.ts` | Estados de presencia y `classifyPing()` |
| `packages/domain/src/dispatch-ranking.ts` | `rankCandidates()` y `backhaulMatch()` |
| `packages/domain/src/errors.ts` | Errores de despacho, habilitación, turno y degradación |
| `packages/domain/src/dispatch.spec.ts` | 12 tests nuevos |
| `apps/api/src/redis/*` | Cliente `ioredis`, claves, scripts Lua y `RedisStateStore` |
| `apps/api/src/modules/presence/*` | `GeoIndexService`, `PresenceRepository`, `DriverPresenceService` |
| `apps/api/src/modules/dispatch/*` | `DispatchService`, `DispatchRepository`, `DispatchEvents`, `DispatchWorkers` |
| `apps/api/src/modules/tracking/*` | Consumidor del Stream → `trip_track_points` |
| `apps/api/src/modules/health/health.controller.ts` | Informa Redis, despacho e índice geográfico |
| `apps/api/src/config/app-config.ts`, `.env.example` | Parámetros `REDIS_URL`, `DISPATCH_*`, `PRESENCE_*`, `TRACKING_*` |
| `apps/api/test/dispatch.int-spec.ts` | 14 tests de integración con Redis y PostGIS reales |
| `apps/api/test/support/dispatch-fixtures.ts` | Flota y viajes temporales (marca `TEST-<tag>-`) |
| `apps/api/test/simulacion-temporada.sim-spec.ts`, `jest.sim.config.js` | Simulación de temporada (`pnpm --filter @lacosta/api test:sim`) |
| `.claude/launch.json` | Preview de la API en el navegador de la app |
| `docs/MODELO_DATOS.md` | Tablas nuevas |

## Despliegue (hecho el 2026-11-20, solo en local)

```powershell
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate
```

Redis no necesita preparación: el grupo de consumidores del recorrido se crea solo.

## Pruebas

### Dominio (`packages/domain`)

`pnpm test`: 56 pruebas, de las cuales 12 son nuevas. Cubren geometría (polígono con agujero, progresiva y distancia lateral), `GeoIndex` con desempate, clasificación de pings y ranking (Viaje de Vuelta, cola, espera, rechazos y desempate). Resultado: todas pasan.

### Integración Redis + PostGIS (`apps/api/test/dispatch.int-spec.ts`)

`pnpm test:int` con `TEST_DATABASE_URL` y `TEST_REDIS_URL`, que apunta a una base de Redis aparte (`/15`). Son 14 tests nuevos y todos pasan:

| Prueba | Resultado |
|---|---|
| Paridad del índice en memoria con PostGIS (9 puntos: localidad, parada y progresiva con menos de 100 m de diferencia) | ✔ |
| Turno: Lucía bloqueada por licencia y VTV; el mismo auto con dos choferes → `VEHICLE_IN_USE` | ✔ |
| Ingesta: cola de parada, ping viejo, impreciso, salto imposible y salida de la zona | ✔ |
| Orden de ofertas: primero el de la cola; rechazo → siguiente; aceptación → `ASSIGNED` en base y en Redis | ✔ |
| **Concurrencia:** 20 avances desde 2 réplicas → 1 sola oferta; 60 aceptaciones en paralelo (50 choferes + 10 reintentos del ganador) → 1 solo ganador | ✔ |
| Vencimiento: pasa al siguiente, penaliza y rechaza la aceptación tardía | ✔ |
| Base rechaza la asignación (VTV vencida durante la oferta) → Redis deshecho, sigue buscando | ✔ |
| Cancelación del pasajero durante la oferta | ✔ |
| Barrido: cierra a quien no reporta, no corta a quien está en viaje | ✔ |
| Lease de otra réplica: no interviene hasta que vence | ✔ |
| Viaje de Vuelta: gana sobre un chofer local más cerca, recotiza más barato y guarda el recorrido sin duplicar | ✔ |
| Viaje de Vuelta termina al entrar a la base | ✔ |
| El consumidor de recorrido se recupera si Redis pierde el grupo | ✔ |
| Sin choferes: espera y pasa a `NO_DRIVER_AVAILABLE` al vencer el tope | ✔ |

También siguen pasando las 26 pruebas unitarias y HTTP de la API, las 9 de integración de la Fase 1 y los smoke tests SQL.

### Simulación de temporada

`pnpm --filter @lacosta/api test:sim`, con resultado en [`pruebas/resultado-simulacion.json`](pruebas/resultado-simulacion.json).

**Parámetros:**
- 300 choferes en 10 localidades y 200 pedidos en 40 s (tiempo comprimido), de los que 62 fueron interurbanos.
- Comportamiento de los choferes: 85 % acepta, 10 % rechaza y 5 % ignora la oferta.
- Oferta de 3 s, con los workers reales.

| Métrica | Valor |
|---|---|
| Viajes completados | 200 / 200 |
| Espera hasta la asignación | p50 0,95 s · p95 2,46 s · máx. 5,64 s |
| Ofertas por viaje | 1,16 (29 rechazadas, 3 vencidas) |
| Asignaciones de Viaje de Vuelta | 45 (7 recotizadas más baratas) |
| Sin chofer / pendientes al final | 0 / 0 |
| **Doble asignación** (eventos y solapamiento en la base) | **0 / 0** |
| Puntos de recorrido guardados | 859 |

Es una referencia funcional, no una prueba de carga: corre en una sola máquina, con ruteo straight-line y sin la latencia de la red móvil. La prueba de carga completa es de la Fase 6.

## En qué se apartó del plan

- **Scripts Lua:** quedaron como strings en `lua-scripts.ts` y no en archivos `.lua`. Así `tsc` los incluye en el build sin copiar archivos, y siguen versionados en un solo lugar.
- **Simulación:** está en `apps/api/test/simulacion-temporada.sim-spec.ts` (se corre con Jest) y no en `pruebas/simular-temporada.ts`. Necesita los decoradores de Nest, que solo compila `ts-jest`, sin sumar dependencias. En `pruebas/` queda el resultado.
- **Tiempos de la simulación:** la ráfaga es de 200 pedidos en 40 s, no en 2 minutos, con ofertas de 3 s en lugar de 15 s, para que la prueba dure menos de un minuto.
- **Última ronda:** si no hay candidatos, el viaje queda `SEARCHING` y se reintenta cada 5 s hasta el tope de 3 min. El plan decía pasar a `NO_DRIVER_AVAILABLE` después de la ronda 3; así se aprovechan los choferes que se conectan mientras tanto.
- **Viaje de Vuelta:** `RETURNING` se decide comparando la posición del chofer con **su localidad base**, no por el alcance del viaje. Es equivalente en el caso típico y correcto cuando el chofer no es de la localidad de origen.
- **Parámetro nuevo** `PRESENCE_MAX_SPEED_KMH`, que antes era fijo en 180. Solo lo sube la simulación, donde los autos "viajan" kilómetros en segundos.
- **El cierre del viaje en la base** (`COMPLETED`) no está en esta fase: lo hace el ciclo de vida de la Fase 3. Los tests lo simulan con un `UPDATE`.

## Incidentes durante las pruebas

- **Test de concurrencia mal planteado:** contaba 10 resultados `OFFERED` cuando eran la misma oferta (los avances de una réplica comparten la promesa en curso). Se corrigió el test para contar ofertas distintas: hubo 1.
- **Test de Viaje de Vuelta:** el segundo viaje lo rechazó PostgreSQL (`trips_one_active_per_driver`) porque el primero seguía `ASSIGNED` en la base. Se agregó el cierre simulado; confirma que la defensa de la base funciona.
- **Test con teletransporte:** un test movía al chofer 3 km en un segundo y el filtro lo descartó como salto imposible. Se corrigieron los tiempos del test; el filtro hizo lo correcto.
- **Bug real en el recorrido (corregido):**
  - `xreadgroup` se llamaba sin enlazarlo al cliente, y la simulación guardó 0 puntos.
  - Después de enlazarlo apareció un segundo problema: si Redis pierde el grupo de consumidores, el consumidor quedaba trabado para siempre.
  - Ahora detecta `NOGROUP` y lo recrea. Tiene un test propio y la simulación guardó 859 puntos.
- **Timer de health sin limpiar:** Jest avisaba de un handle abierto. Se agregó `clearTimeout`.
- **Preview caída:** la preview de la app (`dev:api`) se cayó porque `pnpm build` borra `dist/` mientras `node --watch` corre. Se reinició; hay que evitar correr `pnpm build` con la preview abierta.

## Cómo revertir

No hay nada desplegado. En la base local:

```sql
DROP TABLE trip_track_points;
DROP TABLE trip_offers;
ALTER TABLE trips DROP COLUMN dispatch_round, DROP COLUMN dispatch_started_at;
ALTER TABLE drivers DROP COLUMN accepts_interurban;
DROP TYPE offer_outcome;
DELETE FROM schema_migrations WHERE filename = '20261120150000_despacho_y_recorrido.sql';
```

En Redis, borrar las claves con prefijo `lc:`. Para el código, revertir los archivos de la tabla de arriba.
