import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PG_POOL } from '../src/database/database.module';
import { QrCodeService } from '../src/modules/auth/qr-code.service';
import { REDIS } from '../src/redis/redis.tokens';
import { hashSecret } from '../src/security/crypto';
import { cleanupTestData, createTestFleet, randomTag } from './support/dispatch-fixtures';
import type Redis from 'ioredis';

const DB_URL = process.env['TEST_DATABASE_URL'];
const REDIS_URL = process.env['TEST_REDIS_URL'];
const describeIf = DB_URL && REDIS_URL ? describe : describe.skip;

jest.setTimeout(60_000);

const PIN = '482915';

describeIf('Fase 4 · endpoints de la app del chofer (E2E)', () => {
  let app: INestApplication;
  let pool: Pool;
  const tag = randomTag();
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function driverToken(): Promise<{ id: string; vehicleId: string; token: string }> {
    const [d] = await createTestFleet(pool, { tag, count: 1, baseLocalityCode: 'SAN_BERNARDO' });
    await pool.query(`UPDATE drivers SET pin_hash = $2 WHERE id = $1`, [d!.id, await hashSecret(PIN)]);
    const res = await http().post('/api/auth/driver/login').send({ dni: d!.dni, pin: PIN }).expect(200);
    return { id: d!.id, vehicleId: d!.vehicleId, token: res.body.accessToken };
  }

  beforeAll(async () => {
    Object.assign(process.env, { DATABASE_URL: DB_URL, REDIS_URL, ROUTING_PROVIDER: 'straight-line', DISPATCH_WORKERS_ENABLED: 'false' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    pool = app.get(PG_POOL);
  });

  afterAll(async () => {
    try {
      if (pool) await cleanupTestData(pool, tag);
    } finally {
      await (app?.get(REDIS) as Redis | undefined)?.flushdb().catch(() => undefined);
      await app?.close();
    }
  });

  it('GET /drivers/me devuelve el perfil propio, sin PIN', async () => {
    const d = await driverToken();
    const res = await http().get('/api/drivers/me').set(auth(d.token)).expect(200);
    expect(res.body.id).toBe(d.id);
    expect(res.body.base_locality_name).toBe('San Bernardo del Tuyú');
    expect(res.body.municipal_driver_permit_expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(res.body).some((k) => k.includes('pin'))).toBe(false);
  });

  it('GET /drivers/me/vehicles lista los vehículos autorizados y marca los bloqueados con el motivo', async () => {
    const d = await driverToken();
    let res = await http().get('/api/drivers/me/vehicles').set(auth(d.token)).expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ vehicle_id: d.vehicleId, is_eligible: true, blocking_reasons: [] });
    expect(res.body[0].plate).toBeTruthy();

    await pool.query(`UPDATE vehicles SET vtv_expires_on = ar_today() - 1 WHERE id = $1`, [d.vehicleId]);
    res = await http().get('/api/drivers/me/vehicles').set(auth(d.token)).expect(200);
    expect(res.body[0]).toMatchObject({ is_eligible: false });
    expect(res.body[0].blocking_reasons).toContain('VTV_VENCIDA');
  });

  it('los endpoints del chofer no son accesibles para un invitado', async () => {
    const qrCode = app.get(QrCodeService).issue('Parada test', null);
    const guest = await http().post('/api/auth/guest').send({ qrCode }).expect(200);
    await http().get('/api/drivers/me').set(auth(guest.body.accessToken)).expect(403);
    await http().get('/api/drivers/me/vehicles').set(auth(guest.body.accessToken)).expect(403);
    await http().get('/api/drivers/me').expect(401);
  });
});
