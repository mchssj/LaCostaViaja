# Guía de implementación: Fase 4, app del chofer y Modo Invitado

## Archivos

| Dónde | Cambio |
|---|---|
| `apps/api/src/modules/drivers/drivers.controller.ts` | `GET /drivers/me` y `GET /drivers/me/vehicles`. |
| `apps/api/test/fase4.e2e.int-spec.ts` | 3 tests de integración: perfil sin PIN, vehículos con motivo de bloqueo y acceso denegado a invitados. |
| `packages/driver-core/` | Paquete nuevo (`api`, `endpoints`, `trip`, `pings`, `realtime`, `format`, `types`) con 17 tests en Jest. |
| `apps/driver-web/` | Reescrita. Borrados `app/turno`, `app/oferta`, `app/viaje` y `lib/api.ts`. Nuevos `components/` (`DriverApp`, `Login`, `VehiclePicker`, `OfferSheet`, `TripPanel`, `TripMap`, `PanicButton`, `DevTools`, `MapBoundary`), `lib/client.ts`, `lib/useLocation.ts`, `public/manifest.json` e `icon.svg`. |
| `apps/guest-pwa/` | Reescrita. Borrados `app/cotizar`, `app/seguimiento` y `lib/api.ts`. Nuevos `components/` (`GuestApp`, `PickMap`, `Tracking`, `PanicButton`, `MapBoundary`; se conserva `QrScanner`), `lib/client.ts` y `public/sw.js`. |
| `apps/driver-mobile/` | `App.tsx` reescrita sobre `driver-core`, `lib/client.ts` (reemplaza `lib/api.ts`) y `app.json` con el permiso de ubicación. |
| `package.json` de las tres apps | `@lacosta/driver-core`, `socket.io-client`; en las web también `leaflet`, `react-leaflet` y `@types/leaflet`. Son versiones que ya estaban en el lockfile por `admin-web`. Instalado con `pnpm install --offline`, sin descargas. |

Sin migraciones.

## Cómo probarlo en local

```powershell
pnpm infra:up
pnpm dev:api                                   # :3000 (necesita ALLOW_UNSIGNED_QR=true para los atajos de prueba)
pnpm --filter @lacosta/driver-web dev          # :3003
pnpm --filter @lacosta/guest-pwa dev           # :3002
```

1. Chofer (`:3003`): ingresar con un chofer demo del seed, tocar el vehículo y esperar "Esperando viajes". El GPS simulado arranca en San Bernardo.
2. Invitado (`:3002`): "Entrar con código de prueba", tocar el mapa para A y para B, "Ver precio" y "Confirmar y pedir".
3. Chofer: aceptar la oferta, "Llegué", "Iniciar" y "Finalizar"; después "Cobré en efectivo".
4. Invitado: ver los pasos y el auto en vivo, y calificar.

Expo: `pnpm --filter @lacosta/driver-mobile start` y abrir con Expo Go, con `EXPO_PUBLIC_API_URL=http://<IP de la PC>:3000/api`. Fuera de `localhost`, el GPS del navegador exige HTTPS; en Expo no hace falta.

Tests:

```powershell
pnpm --filter @lacosta/driver-core test
pnpm --filter @lacosta/api exec jest --config jest.int.config.js --runInBand fase4   # con TEST_DATABASE_URL y TEST_REDIS_URL
```

## Pruebas hechas (2026-11-22)

- `driver-core`: 17 tests OK. API `fase4`: 3 tests OK. Typecheck OK en `driver-web`, `guest-pwa` y `driver-mobile`.
- **Navegador, a 375 px de ancho, de punta a punta:**
  1. El invitado entró con el código de prueba, marcó A y B en el mapa y cotizó $ 3.500 (tarifa mínima, urbano, temporada baja, diurna).
  2. Confirmó, la oferta llegó por socket al chofer con cuenta regresiva y el chofer la aceptó.
  3. El invitado pasó en vivo a "Tu chofer está en camino", con nombre, patente y el auto en el mapa.
  4. El chofer marcó la llegada, inició y finalizó el viaje.
  5. El invitado, después de recargar la página, vio "¡Llegaste!" y calificó con 5 ★.
- **Chofer, además:**
  - Al recargar en medio de un viaje se recuperó el estado desde la API.
  - "Cobré en efectivo" dejó el pago en "Pagado".
  - La oferta de un viaje de prueba creado desde las herramientas llegó por socket.
- **No probado:**
  - `driver-mobile` en un teléfono o emulador: solo pasó el typecheck. La exportación web de Expo prevista en el plan no se hizo, porque faltan `react-dom` y `@expo/metro-runtime` en ese paquete y habría que instalarlos.
  - El GPS real del dispositivo: se usó el simulado.
  - El pago con Mercado Pago real.
  - El service worker: solo se registra en producción.
  - Escanear un QR con la cámara.

## Cómo revertirlo

Volver a la versión anterior de `apps/driver-web`, `apps/guest-pwa` y `apps/driver-mobile`, borrar `packages/driver-core` y los dos endpoints, y correr `pnpm install`. No hay cambios en la base.

## Diferencias con el plan

- `driver-core` también lo usa `guest-pwa` (cliente de la API, formato, pasos del pasajero y socket), no solo las apps del chofer. El nombre se mantuvo.
- La exportación web de Expo no se hizo (ver "No probado").
- Se agregó `MapBoundary` en las dos web. En desarrollo, tras un Fast Refresh, Leaflet tira "Map container is being reused" y rompía toda la pantalla; ahora el mapa se vuelve a montar.
- Los `window.confirm` se reemplazaron por confirmaciones dentro de la pantalla, más usables en el teléfono.
- `ApiClient` envuelve `fetch`: llamarlo como método de otro objeto da "Illegal invocation" en el navegador. Ese error apareció en la primera prueba.
