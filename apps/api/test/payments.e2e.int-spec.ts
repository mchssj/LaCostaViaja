import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PG_POOL } from '../src/database/database.module';
import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';

const DB_URL = process.env['TEST_DATABASE_URL'];
const describeIf = DB_URL ? describe : describe.skip;

describeIf('E2E · Pagos Mercado Pago (webhook)', () => {
  let app: INestApplication;
  let pool: Pool;

  beforeAll(async () => {
    Object.assign(process.env, { DATABASE_URL: DB_URL, ROUTING_PROVIDER: 'straight-line', DISPATCH_WORKERS_ENABLED: 'false', JWT_SECRET: 'dev-secret' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    pool = app.get(PG_POOL);
  });

  afterAll(async () => { await app?.close(); });

  it('webhook con firma válida marca el pago como PAID', async () => {
    const { rows: p } = await pool.query("SELECT id FROM passengers ORDER BY created_at LIMIT 1");
    const { rows: t } = await pool.query(`INSERT INTO trips (passenger_id, channel, service_type, status, origin, destination, origin_locality_id, destination_locality_id, scope, tariff_rule_id, pricing_instant, quoted_fare_cents, fare_breakdown, payment_method) SELECT $1, 'PASSENGER_APP', 'TAXI', 'REQUESTED', ST_SetSRID(ST_MakePoint(-56.68,-36.6875),4326), ST_SetSRID(ST_MakePoint(-56.68,-36.716),4326), origin_locality_id, destination_locality_id, 'URBAN', tariff_rule_id, now(), 100000, '{}'::jsonb, 'MERCADO_PAGO_QR' FROM trips LIMIT 1 RETURNING id`, [p[0].id]);
    const tripId = t[0].id;
    const ref = `MP-TEST-${Date.now()}`;
    await pool.query(`INSERT INTO payments (trip_id, method, amount_cents, status, provider_reference) VALUES ($1, 'MERCADO_PAGO_QR', 100000, 'PENDING', $2)`, [tripId, ref]);

    const secret = 'test-secret';
    process.env['MP_WEBHOOK_SECRET'] = secret;
    const payload = { data: { id: ref }, type: 'payment' };
    const sig = (await (async () => { const { createHmac } = await import('node:crypto'); return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex'); })());

    await request(app.getHttpServer()).post('/api/payments/mercadopago/webhook').set('x-signature', sig).send(payload).expect(201);

    const { rows } = await pool.query('SELECT status FROM payments WHERE provider_reference = $1', [ref]);
    expect(rows[0].status).toBe('PAID');
  });

  it('webhook con firma inválida es rechazado', async () => {
    const payload = { data: { id: 'MP-nonexistent' }, type: 'payment' };
    process.env['MP_WEBHOOK_SECRET'] = 'test-secret';
    const res = await request(app.getHttpServer()).post('/api/payments/mercadopago/webhook').set('x-signature', 'deadbeef').send(payload);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('webhook es idempotente (segunda llamada no duplica)', async () => {
    const { rows: p } = await pool.query("SELECT id FROM passengers ORDER BY created_at LIMIT 1");
    const { rows: t } = await pool.query(`INSERT INTO trips (passenger_id, channel, service_type, status, origin, destination, origin_locality_id, destination_locality_id, scope, tariff_rule_id, pricing_instant, quoted_fare_cents, fare_breakdown, payment_method) SELECT $1, 'PASSENGER_APP', 'TAXI', 'REQUESTED', ST_SetSRID(ST_MakePoint(-56.68,-36.6875),4326), ST_SetSRID(ST_MakePoint(-56.68,-36.716),4326), origin_locality_id, destination_locality_id, 'URBAN', tariff_rule_id, now(), 100000, '{}'::jsonb, 'MERCADO_PAGO_QR' FROM trips LIMIT 1 RETURNING id`, [p[0].id]);
    const tripId = t[0].id;
    const ref = `MP-IDEM-${Date.now()}`;
    await pool.query(`INSERT INTO payments (trip_id, method, amount_cents, status, provider_reference) VALUES ($1, 'MERCADO_PAGO_QR', 100000, 'PENDING', $2)`, [tripId, ref]);

    const secret = 'test-secret';
    process.env['MP_WEBHOOK_SECRET'] = secret;
    const payload = { data: { id: ref }, type: 'payment' };
    const sig = (await (async () => { const { createHmac } = await import('node:crypto'); return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex'); })());

    await request(app.getHttpServer()).post('/api/payments/mercadopago/webhook').set('x-signature', sig).send(payload).expect(201);
    const res2 = await request(app.getHttpServer()).post('/api/payments/mercadopago/webhook').set('x-signature', sig).send(payload);
    expect(res2.status).toBeLessThan(300);
    const { rows } = await pool.query('SELECT count(*)::int AS c FROM payments WHERE provider_reference = $1', [ref]);
    expect(rows[0].c).toBe(1);
  });
});
