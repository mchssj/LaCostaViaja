import { Inject, Injectable } from '@nestjs/common';
import { DomainError, InvalidInputError, NotFoundError, type FareQuote, type GeoPoint, type ServiceType } from '@lacosta/domain';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { AuditService, diff } from '../../security/audit.service';
import type { Principal, RequestMeta } from '../../security/principal';
import { FareCalculatorService } from '../fares/fare-calculator.service';
import { TARIFF_REPOSITORY, type ITariffRepository } from '../tariffs/tariff-repository';

const TZ = 'America/Argentina/Buenos_Aires';
const SERVICES = ['TAXI', 'REMIS'] as const;
const SCOPES = ['URBAN', 'INTERURBAN'] as const;
const SEASONS = ['LOW', 'HIGH'] as const;
const BANDS = ['DAY', 'NIGHT'] as const;

export interface RuleInput {
  serviceType: (typeof SERVICES)[number];
  scope: (typeof SCOPES)[number];
  season: (typeof SEASONS)[number];
  timeBand: (typeof BANDS)[number];
  flagFallCents: number;
  unitValueCents: number;
  distanceUnitM: number;
  timeUnitS: number;
  referenceSpeedKmh: number;
  minimumFareCents: number;
  /** Porcentaje 0–100 (se guarda como fracción). Solo interurbano. */
  returnCoefficientPct: number;
  backhaulWaivesReturn: boolean;
}

export interface ScheduleParams {
  code?: string;
  legalInstrument?: string;
  validFrom?: string;
  validTo?: string | null;
  nightStartsAt?: string;
  nightEndsAt?: string;
  interurbanMinOutsideM?: number;
  roundingStepCents?: number;
  quoteTtlSeconds?: number;
}

const SCHEDULE_COLUMNS = `
  s.id, s.code, s.legal_instrument, s.status,
  to_char(lower(s.validity) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS valid_from,
  to_char(upper(s.validity) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS valid_to,
  (s.validity @> now()) AS in_force,
  to_char(s.night_starts_at, 'HH24:MI') AS night_starts_at, to_char(s.night_ends_at, 'HH24:MI') AS night_ends_at,
  s.interurban_min_outside_m, s.rounding_step_cents, s.quote_ttl_seconds,
  s.created_by, c.username AS created_by_username, s.approved_by_user, a.username AS approved_by_username,
  s.approved_at, s.retired_at, s.created_at, s.updated_at,
  (SELECT count(*)::int FROM tariff_rules r WHERE r.schedule_id = s.id) AS rule_count`;

/**
 * Cuadros tarifarios desde el panel. Flujo: borrador (copiado de otro) → edición → aprobación por
 * OTRO administrador con acto administrativo y vigencia → (opcional) retiro. La base refuerza las
 * reglas: doble control, reglas inmutables fuera de borrador y vigencias aprobadas sin superposición.
 */
@Injectable()
export class TariffsAdminService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(TARIFF_REPOSITORY) private readonly repo: ITariffRepository,
    private readonly fares: FareCalculatorService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const { rows } = await this.pool.query(
      `SELECT ${SCHEDULE_COLUMNS}
       FROM tariff_schedules s LEFT JOIN operator_users c ON c.id = s.created_by LEFT JOIN operator_users a ON a.id = s.approved_by_user
       ORDER BY CASE s.status WHEN 'DRAFT' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, lower(s.validity) DESC`,
    );
    return rows;
  }

  async get(id: string) {
    const { rows } = await this.pool.query(
      `SELECT ${SCHEDULE_COLUMNS}
       FROM tariff_schedules s LEFT JOIN operator_users c ON c.id = s.created_by LEFT JOIN operator_users a ON a.id = s.approved_by_user
       WHERE s.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Cuadro tarifario inexistente', { id });
    const { rows: rules } = await this.pool.query(
      `SELECT id, service_type, scope, season, time_band, flag_fall_cents, unit_value_cents, distance_unit_m, time_unit_s,
              reference_speed_kmh::float8 AS reference_speed_kmh, minimum_fare_cents,
              round(return_coefficient * 100, 2)::float8 AS return_coefficient_pct, backhaul_waives_return
       FROM tariff_rules WHERE schedule_id = $1 ORDER BY service_type, scope, season, time_band`,
      [id],
    );
    return { ...rows[0], rules };
  }

  /** Borrador nuevo copiando parámetros y reglas de otro cuadro (por defecto, el vigente). */
  async createDraft(actor: Principal, input: { code: string; copyFromId?: string; validFrom: string; validTo?: string | null }, meta: RequestMeta) {
    this.assertDates(input.validFrom, input.validTo ?? null);
    const id = await this.tx(async (c) => {
      const { rows: src } = await c.query<{ id: string }>(
        input.copyFromId
          ? `SELECT id FROM tariff_schedules WHERE id = $1`
          : `SELECT id FROM tariff_schedules WHERE status = 'APPROVED' AND validity @> now() LIMIT 1`,
        input.copyFromId ? [input.copyFromId] : [],
      );
      if (!src[0]) throw new NotFoundError('No hay un cuadro del cual copiar', {});
      const { rows } = await c
        .query<{ id: string }>(
          `INSERT INTO tariff_schedules (code, legal_instrument, status, validity, timezone, night_starts_at, night_ends_at,
                                         interurban_min_outside_m, rounding_step_cents, quote_ttl_seconds, created_by)
           SELECT $2, 'Borrador: completar el acto administrativo al aprobar', 'DRAFT', ${this.rangeSql('$3', '$4')}, timezone,
                  night_starts_at, night_ends_at, interurban_min_outside_m, rounding_step_cents, quote_ttl_seconds, $5
           FROM tariff_schedules WHERE id = $1 RETURNING id`,
          [src[0].id, input.code.trim(), input.validFrom, input.validTo ?? null, actor.id],
        )
        .catch(this.friendly);
      const newId = rows[0]!.id;
      await c.query(
        `INSERT INTO tariff_rules (schedule_id, service_type, scope, season, time_band, flag_fall_cents, unit_value_cents,
                                   distance_unit_m, time_unit_s, reference_speed_kmh, minimum_fare_cents, return_coefficient, backhaul_waives_return)
         SELECT $2, service_type, scope, season, time_band, flag_fall_cents, unit_value_cents,
                distance_unit_m, time_unit_s, reference_speed_kmh, minimum_fare_cents, return_coefficient, backhaul_waives_return
         FROM tariff_rules WHERE schedule_id = $1`,
        [src[0].id, newId],
      );
      await this.audit.record({ actor, action: 'CREATE', entityType: 'tariff_schedule', entityId: newId, changes: { code: input.code, copiedFrom: src[0].id }, meta }, c);
      return newId;
    });
    return this.get(id);
  }

  async updateDraft(actor: Principal, id: string, p: ScheduleParams, meta: RequestMeta) {
    await this.tx(async (c) => {
      const before = await this.lockDraft(c, id);
      const validFrom = p.validFrom ?? before.valid_from;
      const validTo = p.validTo !== undefined ? p.validTo : before.valid_to;
      this.assertDates(validFrom, validTo);
      await c
        .query(
          `UPDATE tariff_schedules SET
             code = COALESCE($2, code), legal_instrument = COALESCE($3, legal_instrument),
             validity = ${this.rangeSql('$4', '$5')},
             night_starts_at = COALESCE($6::time, night_starts_at), night_ends_at = COALESCE($7::time, night_ends_at),
             interurban_min_outside_m = COALESCE($8, interurban_min_outside_m), rounding_step_cents = COALESCE($9, rounding_step_cents),
             quote_ttl_seconds = COALESCE($10, quote_ttl_seconds)
           WHERE id = $1`,
          [id, p.code?.trim() ?? null, p.legalInstrument?.trim() ?? null, validFrom, validTo, p.nightStartsAt ?? null, p.nightEndsAt ?? null,
           p.interurbanMinOutsideM ?? null, p.roundingStepCents ?? null, p.quoteTtlSeconds ?? null],
        )
        .catch(this.friendly);
      const after = await this.lockDraft(c, id);
      await this.audit.record({ actor, action: 'UPDATE', entityType: 'tariff_schedule', entityId: id, changes: diff(before, after), meta }, c);
    });
    this.repo.invalidate?.();
    return this.get(id);
  }

  /** Reemplaza las 16 reglas del borrador (servicio × alcance × temporada × franja). */
  async replaceRules(actor: Principal, id: string, rules: RuleInput[], meta: RequestMeta) {
    this.assertRules(rules);
    await this.tx(async (c) => {
      await this.lockDraft(c, id);
      const { rows: before } = await c.query(`SELECT service_type, scope, season, time_band, flag_fall_cents, unit_value_cents, minimum_fare_cents FROM tariff_rules WHERE schedule_id = $1`, [id]);
      await c.query(`DELETE FROM tariff_rules WHERE schedule_id = $1`, [id]);
      for (const r of rules) {
        await c
          .query(
            `INSERT INTO tariff_rules (schedule_id, service_type, scope, season, time_band, flag_fall_cents, unit_value_cents,
                                       distance_unit_m, time_unit_s, reference_speed_kmh, minimum_fare_cents, return_coefficient, backhaul_waives_return)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [id, r.serviceType, r.scope, r.season, r.timeBand, r.flagFallCents, r.unitValueCents, r.distanceUnitM, r.timeUnitS,
             r.referenceSpeedKmh, r.minimumFareCents, r.scope === 'URBAN' ? 0 : r.returnCoefficientPct / 100, r.scope === 'URBAN' ? false : r.backhaulWaivesReturn],
          )
          .catch(this.friendly);
      }
      await this.audit.record(
        {
          actor,
          action: 'UPDATE',
          entityType: 'tariff_schedule',
          entityId: id,
          changes: { rules: { before, after: rules.map((r) => ({ key: `${r.serviceType}/${r.scope}/${r.season}/${r.timeBand}`, flagFallCents: r.flagFallCents, unitValueCents: r.unitValueCents, minimumFareCents: r.minimumFareCents })) } },
          meta,
        },
        c,
      );
    });
    this.repo.invalidate?.();
    return this.get(id);
  }

  async discardDraft(actor: Principal, id: string, meta: RequestMeta) {
    await this.tx(async (c) => {
      const before = await this.lockDraft(c, id);
      await c.query(`DELETE FROM tariff_rules WHERE schedule_id = $1`, [id]);
      await c.query(`DELETE FROM tariff_schedules WHERE id = $1`, [id]);
      await this.audit.record({ actor, action: 'DELETE', entityType: 'tariff_schedule', entityId: id, changes: { code: before.code }, meta }, c);
    });
    return { ok: true };
  }

  /**
   * Aprueba un borrador. Lo aprueba un administrador DISTINTO del autor. Si se superpone con el
   * vigente y `closeCurrent`, el vigente termina donde empieza el nuevo (solo si es a futuro).
   */
  async approve(actor: Principal, id: string, input: { legalInstrument: string; validFrom: string; validTo?: string | null; closeCurrent?: boolean }, meta: RequestMeta) {
    this.assertDates(input.validFrom, input.validTo ?? null);
    if (input.legalInstrument.trim().length < 5) throw new InvalidInputError('Indicá el acto administrativo (ordenanza o decreto) que aprueba el cuadro', {});
    await this.tx(async (c) => {
      const draft = await this.lockDraft(c, id);
      if (draft.created_by === actor.id) {
        throw new DomainError('FORBIDDEN', 'Doble control: el cuadro lo tiene que aprobar un administrador distinto del que lo armó');
      }
      const { rows: cnt } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM tariff_rules WHERE schedule_id = $1`, [id]);
      if ((cnt[0]?.n ?? 0) !== 16) throw new InvalidInputError('El cuadro tiene que tener las 16 reglas (servicio × alcance × temporada × franja)', {});

      const { rows: overlap } = await c.query<{ id: string; code: string; starts_before: boolean }>(
        `SELECT id, code, lower(validity) < ${this.fromSql('$1')} AS starts_before FROM tariff_schedules
         WHERE status = 'APPROVED' AND validity && ${this.rangeSql('$1', '$2')} FOR UPDATE`,
        [input.validFrom, input.validTo ?? null],
      );
      if (overlap.length) {
        const closable = input.closeCurrent && overlap.length === 1 && overlap[0]!.starts_before;
        if (!closable) {
          throw new DomainError('INVALID_TRANSITION', `La vigencia se superpone con el cuadro aprobado ${overlap.map((o) => o.code).join(', ')}. Elegí otra fecha o marcá "cerrar el vigente".`, {
            overlaps: overlap.map((o) => o.code),
          });
        }
        await c
          .query(`UPDATE tariff_schedules SET validity = tstzrange(lower(validity), ${this.fromSql('$2')}, '[)') WHERE id = $1`, [overlap[0]!.id, input.validFrom])
          .catch(this.friendly);
        await this.audit.record({ actor, action: 'UPDATE', entityType: 'tariff_schedule', entityId: overlap[0]!.id, changes: { validTo: { after: input.validFrom }, reason: `Reemplazado por ${draft.code}` }, meta }, c);
      }
      const { rows: u } = await c.query<{ username: string }>(`SELECT username FROM operator_users WHERE id = $1`, [actor.id]);
      await c
        .query(
          `UPDATE tariff_schedules SET status = 'APPROVED', legal_instrument = $2, validity = ${this.rangeSql('$3', '$4')},
                  approved_by = $5, approved_by_user = $6, approved_at = now()
           WHERE id = $1`,
          [id, input.legalInstrument.trim(), input.validFrom, input.validTo ?? null, u[0]?.username ?? actor.id, actor.id],
        )
        .catch(this.friendly);
      await this.audit.record({ actor, action: 'APPROVE', entityType: 'tariff_schedule', entityId: id, changes: { code: draft.code, legalInstrument: input.legalInstrument, validFrom: input.validFrom, validTo: input.validTo ?? null }, meta }, c);
    });
    this.repo.invalidate?.();
    return this.get(id);
  }

  /** Retira un cuadro aprobado que no esté en vigencia (para no dejar al sistema sin tarifa). */
  async retire(actor: Principal, id: string, meta: RequestMeta) {
    await this.tx(async (c) => {
      const { rows } = await c.query<{ status: string; in_force: boolean; code: string }>(
        `SELECT status, validity @> now() AS in_force, code FROM tariff_schedules WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const s = rows[0];
      if (!s) throw new NotFoundError('Cuadro tarifario inexistente', { id });
      if (s.status !== 'APPROVED') throw new DomainError('INVALID_TRANSITION', 'Solo se retira un cuadro aprobado');
      if (s.in_force) throw new DomainError('INVALID_TRANSITION', 'Es el cuadro vigente: aprobá primero el que lo reemplaza (con "cerrar el vigente")');
      await c.query(`UPDATE tariff_schedules SET status = 'RETIRED', retired_at = now() WHERE id = $1`, [id]);
      await this.audit.record({ actor, action: 'REVOKE', entityType: 'tariff_schedule', entityId: id, changes: { code: s.code, status: 'RETIRED' }, meta }, c);
    });
    this.repo.invalidate?.();
    return this.get(id);
  }

  /** Cotiza un viaje con el borrador y con el vigente, para comparar antes de aprobar. */
  async simulate(input: { scheduleId: string; origin: GeoPoint; destination: GeoPoint; serviceType: ServiceType; at?: string }) {
    this.repo.invalidate?.();
    const pricingInstant = input.at ? new Date(input.at) : undefined;
    const base = { origin: input.origin, destination: input.destination, serviceType: input.serviceType, ...(pricingInstant ? { pricingInstant } : {}) };
    const [draft, current] = await Promise.all([
      this.fares.quote({ ...base, scheduleId: input.scheduleId }),
      this.fares.quote(base).catch(() => null as FareQuote | null),
    ]);
    const diffCents = current ? draft.totalCents - current.totalCents : null;
    return {
      draft: summary(draft),
      current: current ? summary(current) : null,
      diffCents,
      diffPct: current && current.totalCents > 0 ? Math.round((diffCents! / current.totalCents) * 1000) / 10 : null,
    };
  }

  // ------------------------------------------------------------------ temporadas
  async listSeasons() {
    const { rows } = await this.pool.query(
      `SELECT id, name, season, to_char(lower(period), 'YYYY-MM-DD') AS starts_on, to_char(upper(period) - 1, 'YYYY-MM-DD') AS ends_on
       FROM season_periods ORDER BY lower(period) DESC`,
    );
    return rows;
  }

  async upsertSeason(actor: Principal, id: string | null, input: { name: string; startsOn: string; endsOn: string }, meta: RequestMeta) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endsOn) || input.endsOn < input.startsOn) {
      throw new InvalidInputError('Fechas inválidas: el fin (inclusive) no puede ser anterior al inicio', {});
    }
    const out = await this.tx(async (c) => {
      const { rows: overlap } = await c.query<{ name: string }>(
        `SELECT name FROM season_periods WHERE period && daterange($1::date, $2::date + 1, '[)') AND ($3::uuid IS NULL OR id <> $3)`,
        [input.startsOn, input.endsOn, id],
      );
      if (overlap.length) throw new InvalidInputError(`Se superpone con "${overlap[0]!.name}"`, {});
      const { rows } = id
        ? await c.query<{ id: string }>(`UPDATE season_periods SET name = $2, period = daterange($3::date, $4::date + 1, '[)') WHERE id = $1 RETURNING id`, [id, input.name.trim(), input.startsOn, input.endsOn])
        : await c.query<{ id: string }>(`INSERT INTO season_periods (name, season, period) VALUES ($1, 'HIGH', daterange($2::date, $3::date + 1, '[)')) RETURNING id`, [input.name.trim(), input.startsOn, input.endsOn]);
      if (!rows[0]) throw new NotFoundError('Período inexistente', { id });
      await this.audit.record({ actor, action: id ? 'UPDATE' : 'CREATE', entityType: 'season_period', entityId: rows[0].id, changes: input, meta }, c);
      return rows[0].id;
    });
    this.repo.invalidate?.();
    return { id: out };
  }

  async deleteSeason(actor: Principal, id: string, meta: RequestMeta) {
    await this.tx(async (c) => {
      const { rows } = await c.query<{ name: string }>(`DELETE FROM season_periods WHERE id = $1 RETURNING name`, [id]);
      if (!rows[0]) throw new NotFoundError('Período inexistente', { id });
      await this.audit.record({ actor, action: 'DELETE', entityType: 'season_period', entityId: id, changes: { name: rows[0].name }, meta }, c);
    });
    this.repo.invalidate?.();
    return { ok: true };
  }

  // ------------------------------------------------------------------ apoyo
  private fromSql(param: string) {
    return `((${param})::date::timestamp AT TIME ZONE '${TZ}')`;
  }

  private rangeSql(from: string, to: string) {
    return `tstzrange(${this.fromSql(from)}, CASE WHEN ${to}::date IS NULL THEN NULL ELSE ((${to})::date::timestamp AT TIME ZONE '${TZ}') END, '[)')`;
  }

  private assertDates(from: string, to: string | null): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || (to !== null && !/^\d{4}-\d{2}-\d{2}$/.test(to))) throw new InvalidInputError('Fechas en formato AAAA-MM-DD', {});
    if (to !== null && to <= from) throw new InvalidInputError('La vigencia tiene que terminar después de empezar', {});
  }

  private assertRules(rules: RuleInput[]): void {
    const keys = new Set(rules.map((r) => `${r.serviceType}/${r.scope}/${r.season}/${r.timeBand}`));
    if (rules.length !== 16 || keys.size !== 16) throw new InvalidInputError('Se esperan exactamente 16 reglas, una por servicio × alcance × temporada × franja', {});
    for (const r of rules) {
      const where = `${r.serviceType}/${r.scope}/${r.season}/${r.timeBand}`;
      for (const [k, v] of Object.entries({ flagFallCents: r.flagFallCents, unitValueCents: r.unitValueCents, minimumFareCents: r.minimumFareCents, distanceUnitM: r.distanceUnitM, timeUnitS: r.timeUnitS })) {
        if (!Number.isInteger(v) || v <= 0) throw new InvalidInputError(`${where}: ${k} tiene que ser un entero mayor a 0`, { rule: where, field: k });
      }
      if (r.minimumFareCents < r.flagFallCents) throw new InvalidInputError(`${where}: la tarifa mínima no puede ser menor que la bajada de bandera`, { rule: where });
      if (!(r.referenceSpeedKmh > 0 && r.referenceSpeedKmh <= 120)) throw new InvalidInputError(`${where}: velocidad de referencia inválida`, { rule: where });
      if (!(r.returnCoefficientPct >= 0 && r.returnCoefficientPct <= 100)) throw new InvalidInputError(`${where}: el retorno es un porcentaje entre 0 y 100`, { rule: where });
    }
  }

  private async lockDraft(c: PoolClient, id: string) {
    const { rows } = await c.query<Record<string, unknown> & { status: string; code: string; created_by: string | null; valid_from: string; valid_to: string | null }>(
      `SELECT id, code, legal_instrument, status, created_by,
              to_char(lower(validity) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS valid_from,
              to_char(upper(validity) AT TIME ZONE '${TZ}', 'YYYY-MM-DD') AS valid_to,
              to_char(night_starts_at, 'HH24:MI') AS night_starts_at, to_char(night_ends_at, 'HH24:MI') AS night_ends_at,
              interurban_min_outside_m, rounding_step_cents, quote_ttl_seconds
       FROM tariff_schedules WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Cuadro tarifario inexistente', { id });
    if (rows[0].status !== 'DRAFT') throw new DomainError('INVALID_TRANSITION', 'Solo se edita un borrador. Un cuadro aprobado no se modifica: creá uno nuevo.');
    return rows[0];
  }

  /** Traduce errores de la base a mensajes para el usuario. */
  private friendly = (err: { code?: string; constraint?: string; message?: string }): never => {
    if (err.code === '23505') throw new InvalidInputError('Ya existe un cuadro con ese código', {});
    if (err.code === '23P01') throw new DomainError('INVALID_TRANSITION', 'La vigencia se superpone con otro cuadro aprobado');
    if (err.code === '23514') throw new InvalidInputError(err.message ?? 'Datos inválidos para el cuadro tarifario', { constraint: err.constraint });
    throw err;
  };

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

function summary(q: FareQuote) {
  return {
    totalCents: q.totalCents,
    scheduleCode: q.tariff.scheduleCode,
    scope: q.scope,
    season: q.tariff.season,
    timeBand: q.tariff.timeBand,
    distanceMeters: q.route.distanceMeters,
    lines: q.lines,
  };
}
