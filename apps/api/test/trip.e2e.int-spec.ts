import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PG_POOL } from '../src/database/database.module';
import type { Pool } from 'pg';
import { DriverPresenceService } from '../src/modules/presence/driver-presence.service';
import { FareCalculatorService } from '../src/modules/fares/fare-calculator.service';
import { GeoPoint } from '@lacosta/domain';
import { createTestFleet, createTestTrip, closeOpenTestTrips, cleanupTestData, randomTag, sleep, offset } from './support/dispatch-fixtures';

const DB_URL = process.env['TEST_DATABASE_URL'];
const REDIS_URL = process.env['TEST_REDIS_URL'];
const describeIf = DB_URL && REDIS_URL ? describe : describe.skip;

const CHIOZZA: GeoPoint = { lat: -36.6875, lng: -56.68 };
const MDA_CENTRO: GeoPoint = { lat: -36.716, lng: -56.68 };
const OFFER_TIMEOUT_MS = 2_000;
const PIN_HASH = 'ebba6a9ee40647fe15e9a3c57bc36836:ca0024a898998aa4c721a2fecf3d209903bd106dbc7cfdb477b6224ecc0e1bb6e46f26fd27f3075050fa4b83f784666f4c1f7f25332f227fa5f83b816e9069fe';

describeIf('E2E · Viaje completo (HTTP)', () => {
  let app: INestApplication;
  let pool: Pool;
  let presence: DriverPresenceService;
  let fares: FareCalculatorService;
  const tag = randomTag();

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB_URL,
      REDIS_URL,
      ROUTING_PROVIDER: 'straight-line',
      DISPATCH_WORKERS_ENABLED: 'false',
      DISPATCH_OFFER_TIMEOUT_MS: String(OFFER_TIMEOUT_MS),
      DISPATCH_INSTANCE_ID: 'test-e2e',
      JWT_SECRET: 'dev-secret',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    pool = app.get(PG_POOL);
    presence = app.get(DriverPresenceService);
    fares = app.get(FareCalculatorService);

    // Crear flota de 1 chofer habilitado.
    const fleet = await createTestFleet(pool, { tag, count: 1, baseLocalityCode: 'SAN_BERNARDO' });
    const driver = fleet[0]!;
    // Setear PIN para auth.
    await pool.query('UPDATE drivers SET pin_hash = $1 WHERE id = $2', [PIN_HASH, driver.id]);
    // Guardar en closure.
    (global as any).__e2eDriver = driver;
  });

  afterAll(async () => {
    // Borrar los viajes creados por el test (el endpoint no setea origin_address = TEST-tag).
    await pool.query(`DELETE FROM trips WHERE origin_address IS NULL AND passenger_id IN (SELECT id FROM passengers WHERE kind = 'GUEST') AND requested_at > now() - interval '1 hour'`).catch(() => {});
    await closeOpenTestTrips(pool, tag);
    await cleanupTestData(pool, tag).catch(() => {});
    await app?.close();
  });

  it('flujo completo: pasajero pide → chofer acepta → arrived → start → complete → pago efectivo', async () => {
    const driver = (global as any).__e2eDriver;
    // 1. Chofer abre turno.
    await presence.startShift(driver.id, driver.vehicleId);
    await presence.ingest(driver.id, [{ lat: -36.6875, lng: -56.68, recordedAt: Date.now(), accuracyM: 8 }]);

    // 2. Login chofer.
    const driverLogin = await request(app.getHttpServer())
      .post('/api/auth/driver/login')
      .send({ dni: (await pool.query('SELECT dni FROM drivers WHERE id = $1', [driver.id])).rows[0].dni, pin: '123456' })
      .expect(201);
    const driverToken = driverLogin.body.accessToken;

    // 3. Login pasajero (invitado).
    const guestLogin = await request(app.getHttpServer())
      .post('/api/auth/guest')
      .send({ qrCode: 'test-qr' })
      .expect(201);
    const passengerToken = guestLogin.body.accessToken;

    // 4. Crear viaje.
    const tripRes = await request(app.getHttpServer())
      .post('/api/trips')
      .set('Authorization', `Bearer ${passengerToken}`)
      .send({
        origin: { lat: -36.6875, lng: -56.68 },
        destination: { lat: -36.716, lng: -56.68 },
        serviceType: 'TAXI',
        paymentMethod: 'CASH',
        channel: 'PASSENGER_APP',
      })
      .expect(201);
    const tripId = tripRes.body.id;
    expect(tripId).toBeTruthy();

    // 5. Esperar a que se ofrezca al chofer.
    let offer: any = null;
    for (let i = 0; i < 20; i++) {
      const r = await request(app.getHttpServer())
        .get('/api/drivers/me/offer')
        .set('Authorization', `Bearer ${driverToken}`);
      if (r.body) { offer = r.body; break; }
      await sleep(300);
    }
    expect(offer).toBeTruthy();
    const offerId = offer.offer_id;

    // 6. Aceptar oferta.
    const acceptRes = await request(app.getHttpServer())
      .post(`/api/offers/${offerId}/accept`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ tripId })
      .expect(201);
    expect(acceptRes.body.idempotent).toBe(false);

    // 7. Verificar viaje ASSIGNED.
    const tripAfterAssign = await request(app.getHttpServer())
      .get(`/api/trips/${tripId}`)
      .set('Authorization', `Bearer ${passengerToken}`)
      .expect(200);
    expect(tripAfterAssign.body.status).toBe('ASSIGNED');

    // 8. Chofer: arrived → start → complete.
    await request(app.getHttpServer()).post(`/api/trips/${tripId}/arrived`).set('Authorization', `Bearer ${driverToken}`).expect(201);
    await request(app.getHttpServer()).post(`/api/trips/${tripId}/start`).set('Authorization', `Bearer ${driverToken}`).expect(201);
    await request(app.getHttpServer()).post(`/api/trips/${tripId}/complete`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);

    // 9. Pago en efectivo.
    const tripCompleted = await request(app.getHttpServer()).get(`/api/trips/${tripId}`).set('Authorization', `Bearer ${passengerToken}`).expect(200);
    const fare = tripCompleted.body.quoted_fare_cents;
    await request(app.getHttpServer()).post(`/api/trips/${tripId}/payment/cash`).set('Authorization', `Bearer ${driverToken}`).send({ amountCents: fare }).expect(201);

    // 10. Verificar COMPLETED + PAID.
    const final = await request(app.getHttpServer()).get(`/api/trips/${tripId}`).set('Authorization', `Bearer ${passengerToken}`).expect(200);
    expect(final.body.status).toBe('COMPLETED');
    expect(final.body.payment_status).toBe('PAID');
  }, 60_000);
});
