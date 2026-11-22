import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { GeoPoint } from '@lacosta/domain';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp, configureRealtime } from '../src/bootstrap';
import { PG_POOL } from '../src/database/database.module';
import { QrCodeService } from '../src/modules/auth/qr-code.service';
import { PanicService } from '../src/modules/panic/panic.service';
import { FakePaymentProvider, PAYMENT_PROVIDER, signMercadoPagoWebhook } from '../src/modules/payments/payment-provider';
import { DriverPresenceService } from '../src/modules/presence/driver-presence.service';
import { TrackingService } from '../src/modules/tracking/tracking.service';
import { TripsService } from '../src/modules/trips/trips.service';
import { RedisStateStore } from '../src/redis/redis-state.store';
import { REDIS } from '../src/redis/redis.tokens';
import { hashSecret } from '../src/security/crypto';
import { cleanupTestData, closeOpenTestTrips, createTestFleet, offset, randomTag, sleep, type TestDriver } from './support/dispatch-fixtures';
import type Redis from 'ioredis';

const DB_URL = process.env['TEST_DATABASE_URL'];
const REDIS_URL = process.env['TEST_REDIS_URL'];
const describeIf = DB_URL && REDIS_URL ? describe : describe.skip;

jest.setTimeout(60_000);

const CHIOZZA: GeoPoint = { lat: -36.6875, lng: -56.68 };
const SB_SOUTH: GeoPoint = { lat: -36.695, lng: -56.69 };
const MDA_CENTRO: GeoPoint = { lat: -36.716, lng: -56.68 };
const PIN = '482915';

/** Junta los eventos que recibe un socket para poder esperarlos en orden. */
class Inbox {
  readonly items: Array<{ name: string; payload: any }> = [];
  constructor(socket: Socket) {
    socket.onAny((name: string, payload: unknown) => this.items.push({ name, payload }));
  }
  async waitFor(name: string, pred: (p: any) => boolean = () => true, timeoutMs = 8_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.items.find((i) => i.name === name && pred(i.payload));
      if (hit) return hit.payload;
      await sleep(50);
    }
    throw new Error(`No llegó ${name}. Recibidos: ${this.items.map((i) => i.name).join(', ')}`);
  }
}

describeIf('Fase 3 · API, permisos, WebSockets, pagos, vouchers y pánico (E2E)', () => {
  let app: INestApplication;
  let replica: INestApplication;
  let port: number;
  let replicaPort: number;
  let pool: Pool;
  let redis: Redis;
  const tag = randomTag();
  const sockets: Socket[] = [];
  let voucherSeq = 0;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function startApp(instanceId: string): Promise<[INestApplication, number]> {
    process.env['DISPATCH_INSTANCE_ID'] = instanceId;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const a = configureApp(moduleRef.createNestApplication({ logger: process.env['E2E_LOG'] ? ['error'] : false }));
    await configureRealtime(a);
    await a.listen(0, '127.0.0.1');
    return [a, (a.getHttpServer().address() as AddressInfo).port];
  }

  function connect(path: string, token: string, onPort = port): Promise<[Socket, Inbox]> {
    const socket = io(`http://127.0.0.1:${onPort}${path}`, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    const inbox = new Inbox(socket);
    return new Promise((resolve, reject) => {
      socket.on('connect', () => setTimeout(() => (socket.connected ? resolve([socket, inbox]) : reject(new Error('desconectado'))), 150));
      socket.on('connect_error', reject);
    });
  }

  async function guest(): Promise<{ token: string; id: string }> {
    const qrCode = app.get(QrCodeService).issue('Parada test', 'SB_PARADA_COSTANERA');
    const res = await http().post('/api/auth/guest').send({ qrCode }).expect(200);
    return { token: res.body.accessToken, id: res.body.user.id };
  }

  async function operator(role: 'COM_OPERATOR' | 'MUNICIPAL_ADMIN'): Promise<string> {
    const username = `test-${tag.toLowerCase()}-${role.toLowerCase()}-${randomUUID().slice(0, 6)}`;
    await pool.query(`INSERT INTO operator_users (username, password_hash, role) VALUES ($1, $2, $3)`, [username, await hashSecret('clave-de-prueba'), role]);
    const res = await http().post('/api/auth/operator/login').send({ username, password: 'clave-de-prueba' }).expect(200);
    return res.body.accessToken;
  }

  async function driverOnShift(at: GeoPoint, base = 'SAN_BERNARDO'): Promise<TestDriver & { token: string }> {
    const [d] = await createTestFleet(pool, { tag, count: 1, baseLocalityCode: base });
    await pool.query(`UPDATE drivers SET pin_hash = $2 WHERE id = $1`, [d!.id, await hashSecret(PIN)]);
    const login = await http().post('/api/auth/driver/login').send({ dni: d!.dni, pin: PIN }).expect(200);
    const token = login.body.accessToken as string;
    await http().post('/api/drivers/me/shift').set(auth(token)).send({ vehicleId: d!.vehicleId }).expect(201);
    await http()
      .post('/api/drivers/me/positions')
      .set(auth(token))
      .send({ pings: [{ ...at, recordedAt: Date.now(), accuracyM: 6 }] })
      .expect(200);
    return { ...d!, token };
  }

  function requestTrip(token: string, extra: Record<string, unknown> = {}, origin = CHIOZZA, destination = SB_SOUTH) {
    return http()
      .post('/api/trips')
      .set(auth(token))
      .send({ origin, destination, serviceType: 'TAXI', originAddress: `TEST-${tag}`, ...extra });
  }

  async function acceptOfferFor(inbox: Inbox, driver: { token: string }, tripId: string) {
    const offer = await inbox.waitFor('offer.created', (p) => p.tripId === tripId);
    await http().post(`/api/offers/${offer.data.offerId}/accept`).set(auth(driver.token)).send({ tripId }).expect(200);
  }

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: DB_URL,
      REDIS_URL,
      ROUTING_PROVIDER: 'straight-line',
      DISPATCH_WORKERS_ENABLED: 'false',
      DISPATCH_OFFER_TIMEOUT_MS: '5000',
      PANIC_ESCALATE_AFTER_MS: '1000',
      TRIP_DRIVER_LOCATION_THROTTLE_MS: '0',
      TRIP_NO_SHOW_WAIT_MS: '0',
    });
    [app, port] = await startApp('e2e-A');
    [replica, replicaPort] = await startApp('e2e-B');
    pool = app.get(PG_POOL);
    redis = app.get(REDIS);
    await redis.flushdb();
  });

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.disconnect();
    await closeOpenTestTrips(pool, tag);
    await redis.flushdb();
  });

  afterAll(async () => {
    try {
      if (pool) {
        const trips = `SELECT id FROM trips WHERE origin_address = 'TEST-${tag}'`;
        await pool.query(`DELETE FROM voucher_movements WHERE trip_id IN (${trips})`);
        await pool.query(`DELETE FROM payments WHERE trip_id IN (${trips})`);
        await pool.query(`DELETE FROM panic_alerts WHERE trip_id IN (${trips})`);
        await cleanupTestData(pool, tag);
        await pool.query(`DELETE FROM vouchers WHERE code LIKE $1`, [`T${tag}-%`]);
        await pool.query(`DELETE FROM municipal_programs WHERE name LIKE $1`, [`TEST-${tag}%`]);
        await pool.query(`DELETE FROM operator_users WHERE username LIKE $1`, [`test-${tag.toLowerCase()}-%`]);
      }
    } finally {
      for (const s of sockets.splice(0)) s.disconnect();
      await sleep(1_000); // dejar terminar el trabajo en curso (re-despachos, emits) antes de cerrar Redis
      await replica?.close();
      await app?.close();
    }
  });

  // ------------------------------------------------------------------ autenticación y permisos
  it('guard global y roles: sin sesión 401, invitado no ve la flota, el COM sí (sin hashes de PIN)', async () => {
    await http().get('/api/drivers').expect(401);
    const g = await guest();
    const forbidden = await http().get('/api/drivers').set(auth(g.token)).expect(403);
    expect(forbidden.body.error).toBe('FORBIDDEN');
    await http().post('/api/municipal-programs').set(auth(g.token)).send({}).expect(403);
    const com = await operator('COM_OPERATOR');
    const drivers = await http().get('/api/drivers').set(auth(com)).expect(200);
    expect(drivers.body.length).toBeGreaterThan(0);
    expect(Object.keys(drivers.body[0])).not.toContain('pin_hash');
  });

  it('QR del Modo Invitado: un código inventado no abre sesión', async () => {
    await http().post('/api/auth/guest').send({ qrCode: 'test-qr' }).expect(401);
    await http().post('/api/auth/guest').send({ qrCode: 'LCQR1.e30.firma-falsa' }).expect(401);
  });

  it('refresh rotativo: funciona una vez y la reutilización revoca toda la sesión', async () => {
    const qrCode = app.get(QrCodeService).issue('Hotel test', null);
    const first = await http().post('/api/auth/guest').send({ qrCode }).expect(200);
    const second = await http().post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(200);
    expect(second.body.accessToken).toBeTruthy();
    await http().get('/api/trips/mine').set(auth(second.body.accessToken)).expect(200);
    await http().post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401); // robado
    await http().post('/api/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401); // familia revocada
  });

  it('PIN del chofer: se bloquea tras 5 intentos fallidos aunque después use el correcto', async () => {
    const [d] = await createTestFleet(pool, { tag, count: 1, baseLocalityCode: 'SAN_BERNARDO' });
    await pool.query(`UPDATE drivers SET pin_hash = $2 WHERE id = $1`, [d!.id, await hashSecret(PIN)]);
    for (let i = 0; i < 5; i++) await http().post('/api/auth/driver/login').send({ dni: d!.dni, pin: '000000' }).expect(401);
    const locked = await http().post('/api/auth/driver/login').send({ dni: d!.dni, pin: PIN }).expect(401);
    expect(locked.body.message).toMatch(/bloqueado/i);
  });

  // ------------------------------------------------------------------ ciclo completo
  it('viaje completo por HTTP + WebSocket: precio garantizado, idempotencia, permisos, reenvío por seq, chofer liberado', async () => {
    const driver = await driverOnShift(offset(CHIOZZA, 0, 40));
    const [, driverInbox] = await connect('/driver', driver.token);
    const passenger = await guest();

    const quote = await http().post('/api/v1/fares/quote').send({ origin: CHIOZZA, destination: SB_SOUTH, serviceType: 'TAXI' }).expect(200);
    const key = randomUUID();
    const body = { origin: CHIOZZA, destination: SB_SOUTH, serviceType: 'TAXI', quoteToken: quote.body.quoteToken, originAddress: `TEST-${tag}` };
    const created = await http().post('/api/trips').set(auth(passenger.token)).set('Idempotency-Key', key).send(body).expect(201);
    const tripId: string = created.body.id;
    expect(created.body.quoted_fare_cents).toBe(quote.body.totalCents);

    // Mismo pedido reintentado → misma respuesta, sin segundo viaje. Misma clave con otro cuerpo → 409.
    const replay = await http().post('/api/trips').set(auth(passenger.token)).set('Idempotency-Key', key).send(body).expect(201);
    expect(replay.body.id).toBe(tripId);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    await http().post('/api/trips').set(auth(passenger.token)).set('Idempotency-Key', key).send({ ...body, serviceType: 'REMIS' }).expect(409);
    // Sin clave, un segundo viaje abierto se rechaza igual.
    const second = await requestTrip(passenger.token).expect(409);
    expect(second.body.details.reason).toBe('PASSENGER_HAS_OPEN_TRIP');

    // Cotización adulterada → rechazada.
    const other = await guest();
    const [, sig] = (quote.body.quoteToken as string).split('.').slice(1);
    await requestTrip(other.token, { quoteToken: `q1.${Buffer.from('{"totalCents":1}').toString('base64url')}.${sig}` }).expect(400);

    await acceptOfferFor(driverInbox, driver, tripId);

    // Otro pasajero no ve el viaje ni puede seguirlo por WebSocket.
    await http().get(`/api/trips/${tripId}`).set(auth(other.token)).expect(404);
    const [otherSocket] = await connect('/passenger', other.token);
    expect(await otherSocket.emitWithAck('subscribe', { tripId, afterSeq: 0 })).toMatchObject({ ok: false, error: 'FORBIDDEN' });

    // El pasajero se suscribe tarde y recibe todo lo que pasó, en orden.
    const [passengerSocket, passengerInbox] = await connect('/passenger', passenger.token);
    const sub = await passengerSocket.emitWithAck('subscribe', { tripId, afterSeq: 0 });
    expect(sub.ok).toBe(true);
    const types = passengerInbox.items.filter((i) => i.name === 'trip.status').map((i) => i.payload.type);
    expect(types).toEqual(['TRIP_REQUESTED', 'SEARCH_STARTED', 'DRIVER_ASSIGNED']);
    const seqs = passengerInbox.items.filter((i) => i.name === 'trip.status').map((i) => i.payload.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    const assignedSeq = seqs.at(-1);

    // Solo el chofer asignado mueve el viaje.
    await http().post(`/api/trips/${tripId}/arrived`).set(auth(passenger.token)).expect(403);
    const intruder = await driverOnShift(offset(MDA_CENTRO, 0, 40), 'MAR_DE_AJO');
    await http().post(`/api/trips/${tripId}/arrived`).set(auth(intruder.token)).expect(404);

    await http().post(`/api/trips/${tripId}/arrived`).set(auth(driver.token)).send({}).expect(200);
    await passengerInbox.waitFor('trip.status', (p) => p.type === 'DRIVER_ARRIVED');
    const startEvent = randomUUID();
    await http().post(`/api/trips/${tripId}/start`).set(auth(driver.token)).send({ clientEventId: startEvent }).expect(200);
    const retried = await http().post(`/api/trips/${tripId}/start`).set(auth(driver.token)).send({ clientEventId: startEvent }).expect(200);
    expect(retried.body.idempotent).toBe(true);
    expect((await app.get(RedisStateStore).getDriver(driver.id))?.status).toBe('ON_TRIP');

    // Recorrido durante el viaje → ubicación al pasajero y taxímetro de referencia.
    const t0 = Date.now();
    const route = [0.25, 0.5, 0.75, 1].map((f, i) => ({
      lat: CHIOZZA.lat + (SB_SOUTH.lat - CHIOZZA.lat) * f,
      lng: CHIOZZA.lng + (SB_SOUTH.lng - CHIOZZA.lng) * f,
      recordedAt: t0 + (i + 1) * 30_000,
      accuracyM: 5,
    }));
    await http().post('/api/drivers/me/positions').set(auth(driver.token)).send({ pings: route }).expect(200);
    await passengerInbox.waitFor('trip.driver_location');
    while ((await app.get(TrackingService).flushOnce()) > 0);

    const done = await http().post(`/api/trips/${tripId}/complete`).set(auth(driver.token)).send({ meteredFareCents: 1 }).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', final_fare_cents: quote.body.totalCents });
    expect(done.body.metered_fare_cents).toBeGreaterThan(0); // calculado por el servidor, no el 1 enviado
    expect((await app.get(RedisStateStore).getDriver(driver.id))?.status).toBe('AVAILABLE'); // liberado

    // Cobro en efectivo: solo el chofer, con el monto del viaje, una sola vez.
    await http().post(`/api/trips/${tripId}/payment/cash`).set(auth(passenger.token)).send({}).expect(403);
    const paid = await http().post(`/api/trips/${tripId}/payment/cash`).set(auth(driver.token)).send({ amountCents: 1 }).expect(200);
    expect(paid.body).toMatchObject({ status: 'PAID', amount_cents: quote.body.totalCents, idempotent: false });
    expect((await http().post(`/api/trips/${tripId}/payment/cash`).set(auth(driver.token)).send({}).expect(200)).body.idempotent).toBe(true);

    // Reconexión: con el último seq visto, recibe solo lo posterior.
    const [lateSocket, lateInbox] = await connect('/passenger', passenger.token);
    const resumed = await lateSocket.emitWithAck('resume', { tripId, afterSeq: assignedSeq });
    expect(resumed.ok).toBe(true);
    expect(lateInbox.items.map((i) => i.payload.type)).toEqual(['DRIVER_ARRIVED', 'TRIP_STARTED', 'TRIP_COMPLETED', 'PAYMENT_PAID']);

    // El chofer quedó disponible: recibe la próxima oferta.
    const next = await guest();
    const nextTrip = await requestTrip(next.token).expect(201);
    await driverInbox.waitFor('offer.created', (p) => p.tripId === nextTrip.body.id);
  });

  it('el chofer que devuelve un viaje antes de llegar: el viaje se re-despacha a otro y él queda libre', async () => {
    const a = await driverOnShift(offset(CHIOZZA, 0, 30));
    const b = await driverOnShift(offset(CHIOZZA, 0, 600));
    const [, inboxA] = await connect('/driver', a.token);
    const [, inboxB] = await connect('/driver', b.token);
    const passenger = await guest();
    const trip = await requestTrip(passenger.token).expect(201);
    await acceptOfferFor(inboxA, a, trip.body.id);

    const back = await http().post(`/api/trips/${trip.body.id}/cancel`).set(auth(a.token)).send({ reason: 'Se rompió el auto' }).expect(200);
    expect(back.body).toMatchObject({ status: 'SEARCHING', driver_id: null });
    expect((await app.get(RedisStateStore).getDriver(a.id))?.status).toBe('AVAILABLE');
    expect(await app.get(RedisStateStore).tripLockOwner(trip.body.id)).toBeNull();
    await acceptOfferFor(inboxB, b, trip.body.id);
    expect((await http().get(`/api/trips/${trip.body.id}`).set(auth(passenger.token)).expect(200)).body.driver_id).toBe(b.id);
  });

  it('cancelación del pasajero con chofer asignado: el chofer queda libre y se le avisa', async () => {
    const d = await driverOnShift(offset(CHIOZZA, 0, 30));
    const [, inbox] = await connect('/driver', d.token);
    const passenger = await guest();
    const trip = await requestTrip(passenger.token).expect(201);
    await acceptOfferFor(inbox, d, trip.body.id);
    await http().post(`/api/trips/${trip.body.id}/cancel`).set(auth(passenger.token)).send({ reason: 'Me fui en colectivo' }).expect(200);
    await inbox.waitFor('trip.cancelled', (p) => p.tripId === trip.body.id);
    expect((await app.get(RedisStateStore).getDriver(d.id))?.status).toBe('AVAILABLE');
  });

  it('dos réplicas: la oferta generada en una llega al chofer conectado a la otra (adaptador Redis)', async () => {
    const d = await driverOnShift(offset(CHIOZZA, 0, 30));
    const [, inboxOnReplica] = await connect('/driver', d.token, replicaPort);
    const passenger = await guest();
    const trip = await requestTrip(passenger.token).expect(201); // atendido por la réplica A
    await inboxOnReplica.waitFor('offer.created', (p) => p.tripId === trip.body.id);
  });

  it('reconciliación: si Redis quedó con el chofer "en viaje" de un viaje ya cerrado, se lo libera', async () => {
    const d = await driverOnShift(offset(CHIOZZA, 0, 30));
    const [, inbox] = await connect('/driver', d.token);
    const passenger = await guest();
    const trip = await requestTrip(passenger.token).expect(201);
    await acceptOfferFor(inbox, d, trip.body.id);
    await pool.query(`UPDATE trips SET status = 'CANCELLED_BY_OPERATOR', cancelled_at = now() WHERE id = $1`, [trip.body.id]);
    expect((await app.get(RedisStateStore).getDriver(d.id))?.status).toBe('ASSIGNED');
    const r = await app.get(TripsService).reconcile();
    expect(r.released).toBeGreaterThanOrEqual(1);
    // Liberado: ya no está atado a ese viaje (puede haber recibido enseguida otra oferta).
    const after = await app.get(RedisStateStore).getDriver(d.id);
    expect(after?.tripId).toBeNull();
    expect(['AVAILABLE', 'OFFERED']).toContain(after?.status);
  });

  // ------------------------------------------------------------------ vouchers
  it('vouchers: solo el municipio los crea; dos viajes simultáneos no gastan de más; cancelar devuelve; terminar consume', async () => {
    const admin = await operator('MUNICIPAL_ADMIN');
    const program = await http()
      .post('/api/municipal-programs')
      .set(auth(admin))
      .send({ name: `TEST-${tag} salud`, programType: 'HEALTH', periodStart: '2026-01-01', periodEnd: '2027-12-31', budgetCents: 50_000_000 })
      .expect(201);
    const quote = await http().post('/api/v1/fares/quote').send({ origin: CHIOZZA, destination: SB_SOUTH, serviceType: 'TAXI' }).expect(200);
    const initial = quote.body.totalCents + 1_000; // alcanza para UN viaje
    const code = `T${tag}-V${String(++voucherSeq).padStart(4, '0')}`;
    await http()
      .post('/api/vouchers')
      .set(auth(admin))
      .send({ code, programId: program.body.id, initialBalanceCents: initial, validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-12-31T23:59:59Z' })
      .expect(201);

    const [p1, p2] = await Promise.all([guest(), guest()]);
    const results = await Promise.all(
      [p1, p2].map((p) => requestTrip(p.token, { paymentMethod: 'VOUCHER', voucherCode: code, quoteToken: quote.body.quoteToken })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(results.find((r) => r.status === 422)!.body.details.reason).toBe('INSUFFICIENT_BALANCE');
    const balance = async () => (await pool.query(`SELECT balance_cents FROM vouchers WHERE code = $1`, [code])).rows[0].balance_cents;
    expect(await balance()).toBe(initial - quote.body.totalCents);

    // Cancelar devuelve la reserva.
    const winner = results.find((r) => r.status === 201)!;
    const winnerToken = winner === results[0] ? p1.token : p2.token;
    await http().post(`/api/trips/${winner.body.id}/cancel`).set(auth(winnerToken)).send({}).expect(200);
    expect(await balance()).toBe(initial);

    // Viaje completo con voucher: se consume el final y queda pagado.
    const d = await driverOnShift(offset(CHIOZZA, 0, 30));
    const [, inbox] = await connect('/driver', d.token);
    const p3 = await guest();
    const trip = await requestTrip(p3.token, { paymentMethod: 'VOUCHER', voucherCode: code }).expect(201);
    await acceptOfferFor(inbox, d, trip.body.id);
    await http().post(`/api/trips/${trip.body.id}/arrived`).set(auth(d.token)).send({}).expect(200);
    await http().post(`/api/trips/${trip.body.id}/start`).set(auth(d.token)).send({}).expect(200);
    const done = await http().post(`/api/trips/${trip.body.id}/complete`).set(auth(d.token)).send({}).expect(200);
    expect(done.body.payment_status).toBe('PAID');
    expect(await balance()).toBe(initial - done.body.final_fare_cents);
    const spent = await pool.query(`SELECT spent_cents FROM municipal_programs WHERE id = $1`, [program.body.id]);
    expect(spent.rows[0].spent_cents).toBe(done.body.final_fare_cents);
  });

  // ------------------------------------------------------------------ Mercado Pago
  it('Mercado Pago: link idempotente, webhook con firma real de MP, estado consultado al proveedor', async () => {
    const d = await driverOnShift(offset(CHIOZZA, 0, 30));
    const [, inbox] = await connect('/driver', d.token);
    const passenger = await guest();
    const trip = await requestTrip(passenger.token, { paymentMethod: 'MERCADO_PAGO_LINK' }).expect(201);
    const tripId = trip.body.id as string;
    await http().post(`/api/trips/${tripId}/payment/mercadopago`).set(auth(passenger.token)).expect(409); // todavía no empezó
    await acceptOfferFor(inbox, d, tripId);
    await http().post(`/api/trips/${tripId}/arrived`).set(auth(d.token)).send({}).expect(200);
    await http().post(`/api/trips/${tripId}/start`).set(auth(d.token)).send({}).expect(200);

    const checkout = await http().post(`/api/trips/${tripId}/payment/mercadopago`).set(auth(passenger.token)).expect(200);
    expect(checkout.body).toMatchObject({ status: 'PENDING', amount_cents: trip.body.quoted_fare_cents });
    expect(checkout.body.payment_link).toMatch(/^https:\/\//);
    const again = await http().post(`/api/trips/${tripId}/payment/mercadopago`).set(auth(passenger.token)).expect(200);
    expect(again.body).toMatchObject({ id: checkout.body.id, idempotent: true });

    const fake = app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
    const secret = process.env['MP_WEBHOOK_SECRET']!;
    const webhook = (dataId: string, signature: string) =>
      http()
        .post(`/api/payments/mercadopago/webhook?data.id=${dataId}&type=payment`)
        .set('x-signature', signature)
        .set('x-request-id', 'req-1')
        .send({ type: 'payment', data: { id: dataId } });

    // Firma inválida → 401, sin cambios.
    const mpId = fake.simulatePayment(checkout.body.id, trip.body.quoted_fare_cents);
    await webhook(mpId, `ts=1,v1=${'0'.repeat(64)}`).expect(401);
    // Firma válida → se consulta el pago al proveedor → PAID.
    const sig = signMercadoPagoWebhook({ dataId: mpId, xRequestId: 'req-1', ts: Date.now(), secret });
    expect((await webhook(mpId, sig).expect(200)).body.result).toBe('PAID');
    expect((await webhook(mpId, sig).expect(200)).body.result).toBe('unchanged'); // reintento de MP
    const t = await http().get(`/api/trips/${tripId}`).set(auth(passenger.token)).expect(200);
    expect(t.body.payment_status).toBe('PAID');
  });

  it('Mercado Pago: si el proveedor informa otro monto, el pago no se da por bueno', async () => {
    const d = await driverOnShift(offset(CHIOZZA, 0, 30));
    const [, inbox] = await connect('/driver', d.token);
    const passenger = await guest();
    const trip = await requestTrip(passenger.token, { paymentMethod: 'MERCADO_PAGO_QR' }).expect(201);
    await acceptOfferFor(inbox, d, trip.body.id);
    await http().post(`/api/trips/${trip.body.id}/arrived`).set(auth(d.token)).send({}).expect(200);
    await http().post(`/api/trips/${trip.body.id}/start`).set(auth(d.token)).send({}).expect(200);
    const checkout = await http().post(`/api/trips/${trip.body.id}/payment/mercadopago`).set(auth(d.token)).expect(200);
    const fake = app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
    const mpId = fake.simulatePayment(checkout.body.id, 100); // $1 en lugar del total
    const sig = signMercadoPagoWebhook({ dataId: mpId, xRequestId: 'req-2', ts: Date.now(), secret: process.env['MP_WEBHOOK_SECRET']! });
    const res = await http()
      .post(`/api/payments/mercadopago/webhook?data.id=${mpId}&type=payment`)
      .set('x-signature', sig)
      .set('x-request-id', 'req-2')
      .send({})
      .expect(200);
    expect(res.body.result).toBe('FAILED');
  });

  // ------------------------------------------------------------------ pánico y COM
  it('pánico: autenticado, datos del servidor (no del cliente), idempotente, en vivo al COM y con escalamiento', async () => {
    const com = await operator('COM_OPERATOR');
    const [, comInbox] = await connect('/com', com);
    await comInbox.waitFor('panic.snapshot');

    const d = await driverOnShift(offset(CHIOZZA, 0, 30));
    const [, inbox] = await connect('/driver', d.token);
    const passenger = await guest();
    const trip = await requestTrip(passenger.token).expect(201);
    await acceptOfferFor(inbox, d, trip.body.id);

    await http().post('/api/panic').send({ clientEventId: randomUUID(), location: CHIOZZA }).expect(401);
    const clientEventId = randomUUID();
    const spoofed = randomUUID();
    const raised = await http()
      .post('/api/panic')
      .set(auth(passenger.token))
      .send({ clientEventId, location: CHIOZZA, raisedBy: 'DRIVER', driverId: spoofed, snapshot: { falso: true } })
      .expect(200);
    expect(raised.body).toMatchObject({ raised_by: 'PASSENGER', passenger_id: passenger.id, driver_id: d.id, trip_id: trip.body.id });
    expect(raised.body.snapshot.vehicle.plate).toBeTruthy(); // armado por el servidor
    expect(raised.body.snapshot.falso).toBeUndefined();

    const alert = await comInbox.waitFor('panic.alert', (a) => a.id === raised.body.id);
    expect(alert.vehicle_plate).toBeTruthy();
    const retry = await http().post('/api/panic').set(auth(passenger.token)).send({ clientEventId, location: CHIOZZA }).expect(200);
    expect(retry.body).toMatchObject({ id: raised.body.id, idempotent: true });
    await http().post('/api/panic').set(auth(d.token)).send({ clientEventId, location: CHIOZZA }).expect(409);

    // Posición en vivo del chofer mientras la alerta está abierta.
    await http().post('/api/drivers/me/positions').set(auth(d.token)).send({ pings: [{ ...offset(CHIOZZA, 50, 50), recordedAt: Date.now(), accuracyM: 5 }] }).expect(200);
    // (la alerta la levantó el pasajero: su ubicación llega por /panic/:id/location)
    await http().post(`/api/panic/${raised.body.id}/location`).set(auth(passenger.token)).send(offset(CHIOZZA, 80, 0)).expect(200);
    await comInbox.waitFor('panic.location', (p) => p.alertId === raised.body.id);

    await sleep(1_100);
    expect(await app.get(PanicService).escalateOverdue()).toBeGreaterThanOrEqual(1);
    await comInbox.waitFor('panic.escalated', (a) => a.id === raised.body.id);

    await http().post(`/api/com/alerts/${raised.body.id}/ack`).set(auth(passenger.token)).expect(403);
    await http().post(`/api/com/alerts/${raised.body.id}/ack`).set(auth(com)).expect(200);
    await http().post(`/api/com/alerts/${raised.body.id}/ack`).set(auth(com)).expect(409); // ya tomada
    const closed = await http().post(`/api/com/alerts/${raised.body.id}/resolve`).set(auth(com)).send({ notes: 'Patrullero en el lugar' }).expect(200);
    expect(closed.body.status).toBe('RESOLVED');
    await pool.query(`DELETE FROM panic_alerts WHERE id = $1`, [raised.body.id]);
  });

  it('pánico sin viaje (invitado) y resolución directa como falsa alarma', async () => {
    const com = await operator('COM_OPERATOR');
    const g = await guest();
    const raised = await http().post('/api/panic').set(auth(g.token)).send({ clientEventId: randomUUID(), location: CHIOZZA }).expect(200);
    expect(raised.body.trip_id).toBeNull();
    const closed = await http().post(`/api/com/alerts/${raised.body.id}/resolve`).set(auth(com)).send({ falseAlarm: true }).expect(200);
    expect(closed.body).toMatchObject({ status: 'FALSE_ALARM' });
    await pool.query(`DELETE FROM panic_alerts WHERE id = $1`, [raised.body.id]);
  });

  it('presencia: el chofer puede consultar su estado y el pasajero no accede a endpoints de chofer', async () => {
    const d = await driverOnShift(offset(CHIOZZA, 0, 30));
    const state = await http().get('/api/drivers/me/state').set(auth(d.token)).expect(200);
    expect(state.body.status).toBe('AVAILABLE');
    const g = await guest();
    await http().get('/api/drivers/me/state').set(auth(g.token)).expect(403);
    await http().post('/api/drivers/me/positions').set(auth(g.token)).send({ pings: [{ ...CHIOZZA, recordedAt: Date.now() }] }).expect(403);
    expect(await app.get(DriverPresenceService).getState(d.id)).not.toBeNull();
  });
});
