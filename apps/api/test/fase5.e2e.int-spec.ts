import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PG_POOL } from '../src/database/database.module';
import { REDIS } from '../src/redis/redis.tokens';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config';
import { SettingsService } from '../src/modules/settings/settings.service';
import { base32Decode, hashSecret, hotp } from '../src/security/crypto';
import { randomTag } from './support/dispatch-fixtures';
import type Redis from 'ioredis';

const DB_URL = process.env['TEST_DATABASE_URL'];
const REDIS_URL = process.env['TEST_REDIS_URL'];
const describeIf = DB_URL && REDIS_URL ? describe : describe.skip;

jest.setTimeout(60_000);

const PASSWORD = 'clave-de-prueba-2026';
const step = () => Math.floor(Date.now() / 30_000);

describeIf('Fase 5 · usuarios, roles, permisos y segundo factor (E2E)', () => {
  let app: INestApplication;
  let pool: Pool;
  const tag = randomTag().toLowerCase();
  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  let seq = 0;

  /** Inserta un operador con contraseña conocida (sin pasar por la API). */
  async function insertOperator(role: string, extra: { agencyId?: string; mustChange?: boolean } = {}): Promise<{ id: string; username: string }> {
    const username = `test-${tag}-${role.toLowerCase()}-${++seq}`;
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO operator_users (username, password_hash, role, agency_id, must_change_password) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, await hashSecret(PASSWORD), role, extra.agencyId ?? null, extra.mustChange ?? false],
    );
    return { id: rows[0]!.id, username };
  }

  function login(username: string, password = PASSWORD) {
    return http().post('/api/auth/operator/login').send({ username, password });
  }

  /** Login + alta de 2FA si el rol lo exige: devuelve un token de sesión completa y el secreto. */
  async function fullSession(role: string): Promise<{ id: string; username: string; token: string; secret: string | null }> {
    const op = await insertOperator(role);
    const res = await login(op.username).expect(200);
    let token = res.body.accessToken as string;
    let secret: string | null = null;
    if (res.body.user.setupRequired.includes('MFA')) {
      const setup = await http().post('/api/auth/me/mfa/setup').set(auth(token)).expect(200);
      secret = setup.body.secret as string;
      await http().post('/api/auth/me/mfa/enable').set(auth(token)).send({ code: hotp(base32Decode(secret), step()) }).expect(200);
      token = res.body.accessToken; // el mismo token ahora tiene alcance completo (el guard relee el estado)
    }
    return { ...op, token, secret };
  }

  beforeAll(async () => {
    Object.assign(process.env, { DATABASE_URL: DB_URL, REDIS_URL, ROUTING_PROVIDER: 'straight-line', DISPATCH_WORKERS_ENABLED: 'false' });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    pool = app.get(PG_POOL);
  });

  // El login tiene límite de 10 por minuto por IP: entre tests se vacía Redis (base de test).
  afterEach(async () => {
    await (app.get(REDIS) as Redis).flushdb();
  });

  afterAll(async () => {
    try {
      if (pool) {
        await pool.query(`UPDATE operator_users SET created_by = NULL WHERE username LIKE $1`, [`test-${tag}-%`]);
        const ids = `SELECT id FROM operator_users WHERE username LIKE $1`;
        await pool.query(`UPDATE system_settings SET updated_by = NULL WHERE updated_by IN (${ids})`, [`test-${tag}-%`]);
        await pool.query(`DELETE FROM tariff_schedules WHERE code LIKE $1`, [`TEST-${tag.toUpperCase()}-%`]);
        const drivers = `SELECT id FROM drivers WHERE municipal_driver_permit_number LIKE $1`;
        await pool.query(`DELETE FROM habilitation_documents WHERE entity_id IN (${drivers})`, [`TEST-${tag.toUpperCase()}-%`]);
        await pool.query(`DELETE FROM drivers WHERE municipal_driver_permit_number LIKE $1`, [`TEST-${tag.toUpperCase()}-%`]);
        await pool.query(`DELETE FROM operator_users WHERE username LIKE $1`, [`test-${tag}-%`]);
      }
    } finally {
      await (app?.get(REDIS) as Redis | undefined)?.flushdb().catch(() => undefined);
      await app?.close();
    }
  });

  it('el administrador debe activar el segundo factor antes de usar el panel', async () => {
    const op = await insertOperator('MUNICIPAL_ADMIN');
    const res = await login(op.username).expect(200);
    expect(res.body.user.setupRequired).toEqual(['MFA']);
    const blocked = await http().get('/api/admin/users').set(auth(res.body.accessToken)).expect(403);
    expect(blocked.body.details.setupRequired).toEqual(['MFA']);
    await http().get('/api/auth/me').set(auth(res.body.accessToken)).expect(200); // permitido durante la configuración
  });

  it('2FA: login en dos pasos, el mismo código no sirve dos veces y los códigos de recuperación son de un solo uso', async () => {
    const op = await insertOperator('LICENSING_OFFICER');
    const first = await login(op.username).expect(200);
    const setup = await http().post('/api/auth/me/mfa/setup').set(auth(first.body.accessToken)).expect(200);
    // Volver a tocar "Configurar" (o recargar) devuelve la MISMA clave: la cargada en el teléfono sigue sirviendo.
    const again = await http().post('/api/auth/me/mfa/setup').set(auth(first.body.accessToken)).expect(200);
    expect(again.body.secret).toBe(setup.body.secret);
    const secret = base32Decode(setup.body.secret);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const s = step();
    const enabled = await http().post('/api/auth/me/mfa/enable').set(auth(first.body.accessToken)).send({ code: hotp(secret, s) }).expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);

    const challenge = await login(op.username).expect(200);
    expect(challenge.body).toMatchObject({ mfaRequired: true });
    expect(challenge.body.accessToken).toBeUndefined();
    await http().post('/api/auth/operator/mfa').send({ mfaToken: challenge.body.mfaToken, code: hotp(secret, s) }).expect(401); // reuso
    const ok = await http().post('/api/auth/operator/mfa').send({ mfaToken: challenge.body.mfaToken, code: hotp(secret, s + 1) }).expect(200);
    expect(ok.body.user.setupRequired).toEqual([]);

    const recovery = enabled.body.recoveryCodes[0] as string;
    const c2 = await login(op.username).expect(200);
    await http().post('/api/auth/operator/mfa').send({ mfaToken: c2.body.mfaToken, code: recovery }).expect(200);
    const c3 = await login(op.username).expect(200);
    await http().post('/api/auth/operator/mfa').send({ mfaToken: c3.body.mfaToken, code: recovery }).expect(401);
  });

  it('usuarios: alta con contraseña temporal que obliga a cambiarla, y política de contraseñas', async () => {
    const admin = await fullSession('MUNICIPAL_ADMIN');
    const created = await http()
      .post('/api/admin/users')
      .set(auth(admin.token))
      .send({ username: `test-${tag}-nuevo-${++seq}`, fullName: 'Operadora Nueva', role: 'COM_OPERATOR' })
      .expect(201);
    const temp = created.body.temporaryPassword as string;
    expect(temp).toHaveLength(14);
    expect(JSON.stringify(created.body.user)).not.toMatch(/hash|secret/i);

    const res = await login(created.body.user.username, temp).expect(200);
    expect(res.body.user.setupRequired).toEqual(['PASSWORD']);
    await http().get('/api/com/alerts').set(auth(res.body.accessToken)).expect(403);
    await http().post('/api/auth/me/password').set(auth(res.body.accessToken)).send({ currentPassword: temp, newPassword: 'corta1' }).expect(400);
    const changed = await http()
      .post('/api/auth/me/password')
      .set(auth(res.body.accessToken))
      .send({ currentPassword: temp, newPassword: 'Faro de San Clemente 1923' })
      .expect(200);
    await http().get('/api/com/alerts').set(auth(changed.body.accessToken)).expect(200);
    await http().get('/api/com/alerts').set(auth(res.body.accessToken)).expect(401); // la sesión vieja quedó cerrada
  });

  it('permisos por rol: cada uno ve solo lo suyo', async () => {
    const com = await fullSession('COM_OPERATOR');
    const auditor = await fullSession('AUDITOR');
    const admin = await fullSession('MUNICIPAL_ADMIN');

    await http().get('/api/admin/users').set(auth(com.token)).expect(403);
    await http().get('/api/admin/users').set(auth(auditor.token)).expect(403);
    await http().get('/api/admin/users').set(auth(admin.token)).expect(200);
    await http().get('/api/admin/audit').set(auth(auditor.token)).expect(200);
    await http().get('/api/admin/audit').set(auth(com.token)).expect(403);
    await http().post('/api/municipal-programs').set(auth(auditor.token)).send({}).expect(403);
    await http().get('/api/municipal-programs').set(auth(auditor.token)).expect(200);
    await http().get('/api/vouchers').set(auth(com.token)).expect(403);

    // Datos personales: el auditor y el COM los ven enmascarados; el administrador, completos.
    const masked = await http().get('/api/drivers').set(auth(auditor.token)).expect(200);
    const full = await http().get('/api/drivers').set(auth(admin.token)).expect(200);
    expect(masked.body[0].dni).toMatch(/\*/);
    expect(full.body[0].dni).toMatch(/^\d+$/);

    const roles = await http().get('/api/admin/roles').set(auth(com.token)).expect(200);
    expect(roles.body.roles.map((r: { role: string }) => r.role)).toEqual(['MUNICIPAL_ADMIN', 'LICENSING_OFFICER', 'COM_OPERATOR', 'AUDITOR', 'AGENCY_OPERATOR']);
  });

  it('cambiar el rol o desactivar cierra las sesiones al instante; no se puede quedar sin administradores', async () => {
    const admin = await fullSession('MUNICIPAL_ADMIN');
    const target = await fullSession('COM_OPERATOR');
    await http().get('/api/com/alerts').set(auth(target.token)).expect(200);

    await http().patch(`/api/admin/users/${target.id}`).set(auth(admin.token)).send({ role: 'AUDITOR' }).expect(200);
    await http().get('/api/com/alerts').set(auth(target.token)).expect(401);

    await http().patch(`/api/admin/users/${admin.id}`).set(auth(admin.token)).send({ role: 'AUDITOR' }).expect(403);
    await http().post(`/api/admin/users/${admin.id}/deactivate`).set(auth(admin.token)).send({}).expect(403);

    const relogin = await login(target.username).expect(200);
    await http().post(`/api/admin/users/${target.id}/deactivate`).set(auth(admin.token)).send({ reason: 'Baja de prueba' }).expect(200);
    await http().get('/api/auth/me').set(auth(relogin.body.accessToken)).expect(401);
    await login(target.username).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: relogin.body.refreshToken }).expect(401);

    const audit = await http().get(`/api/admin/audit?entityId=${target.id}`).set(auth(admin.token)).expect(200);
    const actions = audit.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['UPDATE', 'SUSPEND']));
    expect(JSON.stringify(audit.body.items)).not.toMatch(/password_hash|totp_secret/);
  });

  it('configuración: el COM la ve pero no la edita; el administrador la cambia y se aplica en caliente', async () => {
    const com = await fullSession('COM_OPERATOR');
    const admin = await fullSession('MUNICIPAL_ADMIN');
    const config = app.get(APP_CONFIG) as AppConfig;
    const before = config.dispatch.offerTimeoutMs;
    try {
      const list = await http().get('/api/admin/settings').set(auth(com.token)).expect(200);
      const offer = list.body.find((s: { key: string }) => s.key === 'dispatch.offer_timeout_ms');
      expect(offer).toMatchObject({ effect: 'LIVE', unit: 'ms' });
      await http().patch('/api/admin/settings/dispatch.offer_timeout_ms').set(auth(com.token)).send({ value: 20000 }).expect(403);
      await http().patch('/api/admin/settings/dispatch.offer_timeout_ms').set(auth(admin.token)).send({ value: 1 }).expect(400);
      await http().patch('/api/admin/settings/dispatch.offer_timeout_ms').set(auth(admin.token)).send({ value: 21000 }).expect(200);
      expect(config.dispatch.offerTimeoutMs).toBe(21000);
      const audit = await http().get('/api/admin/audit?entityType=system_setting').set(auth(admin.token)).expect(200);
      expect(audit.body.items[0].changes).toMatchObject({ key: 'dispatch.offer_timeout_ms', after: 21000 });
    } finally {
      // Base compartida con desarrollo: se deja el parámetro como "no editado" (vuelve a mandar el entorno).
      await pool.query(`UPDATE system_settings SET value = default_value, updated_by = NULL WHERE key = 'dispatch.offer_timeout_ms'`);
      await app.get(SettingsService).refresh();
    }
    expect(config.dispatch.offerTimeoutMs).toBe(before);
  });

  it('tarifas: borrador, simulador y doble control; lo aprobado no se edita', async () => {
    const a = await fullSession('MUNICIPAL_ADMIN');
    const b = await fullSession('MUNICIPAL_ADMIN');
    const com = await fullSession('COM_OPERATOR');
    const code = `TEST-${tag.toUpperCase()}-${++seq}`;
    // Vigencia muy en el futuro: no se superpone con el cuadro del seed.
    await http().post('/api/admin/tariff-schedules').set(auth(com.token)).send({ code, validFrom: '2098-01-01' }).expect(403);
    const draft = await http().post('/api/admin/tariff-schedules').set(auth(a.token)).send({ code, validFrom: '2098-01-01', validTo: '2099-01-01' }).expect(201);
    expect(draft.body).toMatchObject({ status: 'DRAFT', rule_count: 16, valid_from: '2098-01-01' });

    const rules = draft.body.rules.map((r: Record<string, number | string | boolean>) => ({
      serviceType: r['service_type'],
      scope: r['scope'],
      season: r['season'],
      timeBand: r['time_band'],
      flagFallCents: Math.round((r['flag_fall_cents'] as number) * 1.1),
      unitValueCents: r['unit_value_cents'],
      distanceUnitM: r['distance_unit_m'],
      timeUnitS: r['time_unit_s'],
      referenceSpeedKmh: r['reference_speed_kmh'],
      minimumFareCents: Math.max(r['minimum_fare_cents'] as number, Math.round((r['flag_fall_cents'] as number) * 1.1)),
      returnCoefficientPct: r['return_coefficient_pct'],
      backhaulWaivesReturn: r['backhaul_waives_return'],
    }));
    await http().put(`/api/admin/tariff-schedules/${draft.body.id}/rules`).set(auth(a.token)).send({ rules: rules.slice(0, 15) }).expect(400);
    await http().put(`/api/admin/tariff-schedules/${draft.body.id}/rules`).set(auth(a.token)).send({ rules }).expect(200);

    const sim = await http()
      .post('/api/admin/tariffs/simulate')
      .set(auth(com.token))
      .send({ scheduleId: draft.body.id, origin: { lat: -36.6875, lng: -56.68 }, destination: { lat: -36.716, lng: -56.68 }, serviceType: 'TAXI' })
      .expect(200);
    expect(sim.body.draft.scheduleCode).toBe(code);
    expect(sim.body.draft.totalCents).toBeGreaterThanOrEqual(sim.body.current.totalCents);

    // Doble control: el autor no aprueba; otro administrador sí.
    const approveBody = { legalInstrument: 'Ordenanza de prueba 1/2098', validFrom: '2098-01-01', validTo: '2099-01-01' };
    const self = await http().post(`/api/admin/tariff-schedules/${draft.body.id}/approve`).set(auth(a.token)).send(approveBody).expect(403);
    expect(self.body.message).toMatch(/Doble control/);
    const approved = await http().post(`/api/admin/tariff-schedules/${draft.body.id}/approve`).set(auth(b.token)).send(approveBody).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', approved_by_username: b.username, created_by_username: a.username });

    await http().put(`/api/admin/tariff-schedules/${draft.body.id}/rules`).set(auth(a.token)).send({ rules }).expect(409);
    await http().patch(`/api/admin/tariff-schedules/${draft.body.id}`).set(auth(a.token)).send({ roundingStepCents: 500 }).expect(409);

    // Otro borrador en el mismo período no se puede aprobar (superposición).
    const other = await http().post('/api/admin/tariff-schedules').set(auth(a.token)).send({ code: `${code}-B`, validFrom: '2098-06-01' }).expect(201);
    const overlap = await http().post(`/api/admin/tariff-schedules/${other.body.id}/approve`).set(auth(b.token)).send({ legalInstrument: 'Ordenanza 2/2098', validFrom: '2098-06-01' }).expect(409);
    expect(overlap.body.message).toMatch(/superpone/);

    await http().post(`/api/admin/tariff-schedules/${draft.body.id}/retire`).set(auth(b.token)).expect(200);
    await http().delete(`/api/admin/tariff-schedules/${other.body.id}`).set(auth(a.token)).expect(200);
    const audit = await http().get(`/api/admin/audit?entityId=${draft.body.id}`).set(auth(a.token)).expect(200);
    expect(audit.body.items.map((i: { action: string }) => i.action)).toEqual(expect.arrayContaining(['CREATE', 'UPDATE', 'APPROVE', 'REVOKE']));
  });

  it('habilitaciones: la agencia carga, Habilitaciones verifica y recién ahí se habilita; suspender exige motivo', async () => {
    const officer = await fullSession('LICENSING_OFFICER');
    const com = await fullSession('COM_OPERATOR');
    const { rows: ag } = await pool.query<{ id: string }>(`SELECT id FROM agencies ORDER BY trade_name LIMIT 1`);
    const agencyOp = await insertOperator('AGENCY_OPERATOR', { agencyId: ag[0]!.id });
    const agencyToken = (await login(agencyOp.username).expect(200)).body.accessToken as string;

    // DNI único por corrida; el CUIL debe corresponder al DNI (prefijo 20 + DNI + dígito verificador).
    const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let dni = '';
    let cuil = '';
    // Con dígito verificador 10 AFIP usa otro prefijo: se busca un DNI que no caiga en ese caso.
    while (!cuil) {
      dni = String(90_000_000 + Math.floor(Math.random() * 9_000_000));
      const base = `20${dni.padStart(8, '0')}`;
      const mod = 11 - (base.split('').reduce((s, d, i) => s + Number(d) * weights[i]!, 0) % 11);
      if (mod !== 10) cuil = `${base}${mod === 11 ? 0 : mod}`;
    }
    const driverBody = {
      baseLocalityCode: 'SAN_BERNARDO', dni, cuil, firstName: 'Prueba', lastName: `Habilitación ${tag}`, phone: '+5492257000000',
      professionalLicenseNumber: `LIC-${dni}`, professionalLicenseClass: 'D1', professionalLicenseExpiresOn: '2030-01-01',
      municipalDriverPermitNumber: `TEST-${tag.toUpperCase()}-${dni}`, municipalDriverPermitExpiresOn: '2030-01-01',
    };
    await http().post('/api/admin/drivers').set(auth(com.token)).send(driverBody).expect(403);
    const created = await http().post('/api/admin/drivers').set(auth(agencyToken)).send({ ...driverBody, agencyId: null }).expect(201);
    const driverId = created.body.id as string;
    const { rows: dr } = await pool.query(`SELECT agency_id, status FROM drivers WHERE id = $1`, [driverId]);
    expect(dr[0]).toMatchObject({ agency_id: ag[0]!.id, status: 'PENDING' }); // la agencia no puede elegir otra

    // Sin documentos no se habilita; la agencia tampoco puede cambiar el estado.
    await http().post(`/api/admin/drivers/${driverId}/status`).set(auth(agencyToken)).send({ status: 'ACTIVE' }).expect(403);
    const blocked = await http().post(`/api/admin/drivers/${driverId}/status`).set(auth(officer.token)).send({ status: 'ACTIVE' }).expect(409);
    expect(blocked.body.details.missingDocuments).toEqual(['DNI', 'LICENCIA_PROFESIONAL', 'HABILITACION_MUNICIPAL', 'ANTECEDENTES_PENALES']);

    // Un archivo que no es PDF/JPG/PNG se rechaza aunque diga .pdf.
    await http().post('/api/admin/documents').set(auth(agencyToken))
      .field('entityType', 'DRIVER').field('entityId', driverId).field('documentType', 'DNI')
      .attach('file', Buffer.from('MZ ejecutable'), 'dni.pdf').expect(400);

    const pdf = Buffer.from('%PDF-1.4\n% documento de prueba\n');
    const docIds: string[] = [];
    for (const documentType of ['DNI', 'LICENCIA_PROFESIONAL', 'HABILITACION_MUNICIPAL', 'ANTECEDENTES_PENALES']) {
      const up = await http().post('/api/admin/documents').set(auth(agencyToken))
        .field('entityType', 'DRIVER').field('entityId', driverId).field('documentType', documentType).field('expiresOn', '2030-01-01')
        .attach('file', pdf, `${documentType}.pdf`).expect(201);
      docIds.push(up.body.id);
    }
    // La agencia no verifica; Habilitaciones sí. Un rechazo exige motivo.
    await http().post(`/api/admin/documents/${docIds[0]}/review`).set(auth(agencyToken)).send({ verified: true }).expect(403);
    await http().post(`/api/admin/documents/${docIds[0]}/review`).set(auth(officer.token)).send({ verified: false }).expect(400);
    await http().post(`/api/admin/documents/${docIds[0]}/review`).set(auth(officer.token)).send({ verified: false, reason: 'Ilegible' }).expect(200);
    const replaced = await http().post('/api/admin/documents').set(auth(agencyToken))
      .field('entityType', 'DRIVER').field('entityId', driverId).field('documentType', 'DNI').attach('file', pdf, 'dni-nuevo.pdf').expect(201);
    for (const id of [replaced.body.id, ...docIds.slice(1)]) await http().post(`/api/admin/documents/${id}/review`).set(auth(officer.token)).send({ verified: true }).expect(200);

    const file = await http().get(`/api/admin/documents/${replaced.body.id}/file`).set(auth(officer.token)).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');

    await http().post(`/api/admin/drivers/${driverId}/status`).set(auth(officer.token)).send({ status: 'ACTIVE' }).expect(200);
    // Ya habilitado: la agencia no lo edita más.
    await http().patch(`/api/admin/drivers/${driverId}`).set(auth(agencyToken)).send({ firstName: 'Otro' }).expect(403);
    await http().post(`/api/admin/drivers/${driverId}/status`).set(auth(officer.token)).send({ status: 'SUSPENDED' }).expect(400);
    await http().post(`/api/admin/drivers/${driverId}/status`).set(auth(officer.token)).send({ status: 'SUSPENDED', reason: 'Sanción de prueba', until: '2030-01-01' }).expect(200);

    const pin = await http().post(`/api/admin/drivers/${driverId}/reset-pin`).set(auth(officer.token)).expect(200);
    expect(pin.body.temporaryPin).toMatch(/^\d{6}$/);
    // Vencimientos de la agencia: incluye a su chofer y nada de otras agencias.
    const exp = await http().get('/api/admin/expirations?days=3650').set(auth(agencyToken)).expect(200);
    expect(exp.body.some((e: { entity_id: string }) => e.entity_id === driverId)).toBe(true);
    const { rows: foreign } = await pool.query<{ id: string }>(`SELECT id FROM drivers WHERE agency_id IS DISTINCT FROM $1`, [ag[0]!.id]);
    expect(exp.body.some((e: { entity_id: string }) => foreign.some((f) => f.id === e.entity_id))).toBe(false);
  });

  it('bloqueo por intentos fallidos y desbloqueo por un administrador', async () => {
    const admin = await fullSession('MUNICIPAL_ADMIN');
    const op = await insertOperator('AUDITOR');
    for (let i = 0; i < 5; i++) await login(op.username, 'incorrecta-123456').expect(401);
    const locked = await login(op.username).expect(401);
    expect(locked.body.message).toMatch(/bloqueada/);
    await http().post(`/api/admin/users/${op.id}/unlock`).set(auth(admin.token)).expect(200);
    await login(op.username).expect(200);
  });
});
