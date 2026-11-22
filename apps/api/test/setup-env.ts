// Secretos SOLO de test (la app exige ≥ 32 caracteres y no tiene valores por defecto).
process.env['JWT_SECRET'] ??= 'test-jwt-secret-solo-para-pruebas-0123456789';
process.env['QR_SECRET'] ??= 'test-qr-secret-solo-para-pruebas-0123456789ab';
process.env['MP_WEBHOOK_SECRET'] ??= 'test-mp-webhook-secret-solo-para-pruebas';
process.env['PAYMENTS_PROVIDER'] ??= 'fake';
