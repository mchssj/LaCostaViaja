import { Controller, Get, Inject, Query, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InvalidInputError } from '@lacosta/domain';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { Allow, OPERATORS, RequirePermission } from '../../security/principal';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Auditoría: solo lectura, con filtros y paginado por id descendente (registros inmutables). */
@ApiTags('admin · auditoría')
@ApiBearerAuth()
@Allow(...OPERATORS)
@RequirePermission('audit.view')
@Controller({ path: 'admin', version: ['1', VERSION_NEUTRAL] })
export class AuditController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('audit')
  async list(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('before') before?: string,
    @Query('limit') limitRaw?: string,
  ) {
    for (const [k, v] of Object.entries({ actorId, entityId })) if (v && !UUID.test(v)) throw new InvalidInputError(`${k} inválido`, {});
    for (const [k, v] of Object.entries({ from, to })) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new InvalidInputError(`${k} debe ser AAAA-MM-DD`, {});
    const limit = Math.min(200, Math.max(1, Number(limitRaw) || 50));
    const { rows } = await this.pool.query(
      `SELECT l.id, l.occurred_at, l.actor_kind, l.actor_id, o.username AS actor_username, o.full_name AS actor_name,
              l.action, l.entity_type, l.entity_id, l.changes, l.ip, l.user_agent
       FROM audit_log l LEFT JOIN operator_users o ON o.id = l.actor_id
       WHERE ($1::uuid IS NULL OR l.actor_id = $1)
         AND ($2::text IS NULL OR l.action::text = $2)
         AND ($3::text IS NULL OR l.entity_type = $3)
         AND ($4::uuid IS NULL OR l.entity_id = $4)
         -- Fechas civiles de Buenos Aires.
         AND ($5::date IS NULL OR l.occurred_at >= ($5::date)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
         AND ($6::date IS NULL OR l.occurred_at < ($6::date + 1)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires')
         AND ($7::bigint IS NULL OR l.id < $7)
       ORDER BY l.id DESC LIMIT $8`,
      [actorId || null, action || null, entityType || null, entityId || null, from || null, to || null, before && /^\d+$/.test(before) ? before : null, limit],
    );
    return { items: rows, nextBefore: rows.length === limit ? String(rows.at(-1)!.id) : null };
  }
}
