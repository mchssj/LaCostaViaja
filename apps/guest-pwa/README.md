# PWA "Modo Invitado" por QR (Next.js) — Fase 4

Flujo ultrarrápido para turistas sin instalar app: QR en paradas, hoteles y accesos de playa → PWA liviana →
tarifa cerrada (`POST /api/v1/fares/quote`) antes de confirmar → seguimiento del viaje y botón de pánico.

Requisitos de resiliencia: shell cacheado por Service Worker, reintentos con backoff y eventos idempotentes
para zonas saturadas (Av. Chiozza en San Bernardo, Calle 2 en Santa Teresita).
