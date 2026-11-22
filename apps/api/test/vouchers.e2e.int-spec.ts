import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PG_POOL } from '../src/database/database.module';
import { VouchersService } from '../src/modules/vouchers/vouchers.service';
import type { Pool } from 'pg';

const DB_URL = process.env['TEST_DATABASE_URL'];
const describeIf = DB_URL ? describe : describe.skip;

describeIf('E2E · Vouchers (reserva concurrente)', () => {
  let app: INestApplication;
  let pool: Pool;
  let vouchers: VouchersService;

  beforeAll(async () => {
    Object.assign(process.env, { DATABASE_URL: DB_URL, ROUTING_PROVIDER: 'straight-line', DISPATCH_WORKERS_ENABLED: 'false', JWT_SECRET: 'dev-secret' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    pool = app.get(PG_POOL);
    vouchers = app.get(VouchersService);
  });

  afterAll(async () => { await app?.close(); });

  it('dos reservas concurrentes no gastan de más', async () => {
    // Crear programa y voucher con saldo 10000.
    const prog = await vouchers.createProgram({ name: `Prog-${Date.now()}`, programType: 'HEALTH', periodStart: '2026-01-01', periodEnd: '2027-12-31', budgetCents: 100000 });
    const v = await vouchers.createVoucher({ code: `V-${Date.now()}`, programId: prog.id, initialBalanceCents: 10000, validFrom: '2026-01-01T00:00:00Z', validUntil: '2027-12-31T23:59:59Z' });

    const { rows: t } = await pool.query("SELECT id FROM trips LIMIT 1");
    const tripId = t[0].id;

    // Dos reservas concurrentes de 6000 cada una: solo una debe pasar (saldo 10000).
    const results = await Promise.allSettled([
      vouchers.reserve(v.id, tripId, 6000),
      vouchers.reserve(v.id, tripId, 6000),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const fail = results.filter((r) => r.status === 'rejected');
    expect(ok.length).toBe(1);
    expect(fail.length).toBe(1);
    const { rows } = await pool.query('SELECT balance_cents FROM vouchers WHERE id = $1', [v.id]);
    expect(rows[0].balance_cents).toBe(4000);
  });
});
