import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { PG_POOL } from '../../database/database.module';
import type { Pool, PoolClient } from 'pg';

@Injectable()
export class VouchersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async createProgram(input: { name: string; programType: string; periodStart: string; periodEnd: string; budgetCents: number }) {
    const { rows } = await this.pool.query(
      `INSERT INTO municipal_programs (name, program_type, period_start, period_end, budget_cents)
       VALUES ($1, $2, $3::date, $4::date, $5) RETURNING *`,
      [input.name, input.programType, input.periodStart, input.periodEnd, input.budgetCents],
    );
    return rows[0];
  }

  async listPrograms() {
    const { rows } = await this.pool.query('SELECT * FROM municipal_programs ORDER BY created_at DESC');
    return rows;
  }

  async createVoucher(input: { code: string; programId: string; initialBalanceCents: number; validFrom: string; validUntil: string; beneficiaryDni?: string; beneficiaryPassengerId?: string }) {
    const { rows } = await this.pool.query(
      `INSERT INTO vouchers (code, program_id, initial_balance_cents, balance_cents, valid_from, valid_until, beneficiary_dni_hash, beneficiary_passenger_id)
       VALUES ($1, $2, $3, $3, $4::timestamptz, $5::timestamptz, $6, $7) RETURNING *`,
      [input.code, input.programId, input.initialBalanceCents, input.validFrom, input.validUntil,
        input.beneficiaryDni ? (await (async () => { const { createHash } = await import('node:crypto'); return createHash('sha256').update(input.beneficiaryDni!).digest('hex'); })()) : null,
        input.beneficiaryPassengerId ?? null],
    );
    return rows[0];
  }

  async listVouchers(programId?: string) {
    const q = programId
      ? 'SELECT * FROM vouchers WHERE program_id = $1 ORDER BY created_at DESC'
      : 'SELECT * FROM vouchers ORDER BY created_at DESC';
    const { rows } = await this.pool.query(q, programId ? [programId] : []);
    return rows;
  }

  async getVoucher(id: string) {
    const { rows } = await this.pool.query('SELECT * FROM vouchers WHERE id = $1', [id]);
    if (!rows[0]) throw new NotFoundException('Voucher no encontrado');
    return rows[0];
  }

  async reserve(voucherId: string, tripId: string, amountCents: number) {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT balance_cents, is_active, valid_from, valid_until FROM vouchers WHERE id = $1 FOR UPDATE', [voucherId]);
      const v = rows[0];
      if (!v) throw new NotFoundException('Voucher no encontrado');
      if (!v.is_active) throw new BadRequestException('Voucher inactivo');
      if (new Date() < new Date(v.valid_from) || new Date() > new Date(v.valid_until)) throw new BadRequestException('Voucher fuera de vigencia');
      if (v.balance_cents < amountCents) throw new ConflictException('Saldo insuficiente');
      await client.query('UPDATE vouchers SET balance_cents = balance_cents - $2, updated_at = now() WHERE id = $1', [voucherId, amountCents]);
      const { rows: b } = await client.query('SELECT balance_cents FROM vouchers WHERE id = $1', [voucherId]);
      await client.query(
        `INSERT INTO voucher_movements (voucher_id, trip_id, movement_type, amount_cents, balance_after_cents) VALUES ($1, $2, 'RESERVE', $3, $4)`,
        [voucherId, tripId, amountCents, b[0].balance_cents],
      );
      await client.query('COMMIT');
      return { ok: true, balanceCents: b[0].balance_cents };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async consume(voucherId: string, tripId: string, amountCents: number) {
    // El consumo se registra; el saldo ya se redujo en la reserva.
    const { rows: b } = await this.pool.query('SELECT balance_cents FROM vouchers WHERE id = $1', [voucherId]);
    if (!b[0]) throw new NotFoundException('Voucher no encontrado');
    await this.pool.query(
      `INSERT INTO voucher_movements (voucher_id, trip_id, movement_type, amount_cents, balance_after_cents) VALUES ($1, $2, 'CONSUME', $3, $4)`,
      [voucherId, tripId, amountCents, b[0].balance_cents],
    );
    return { ok: true };
  }

  async release(voucherId: string, tripId: string, amountCents: number) {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE vouchers SET balance_cents = balance_cents + $2, updated_at = now() WHERE id = $1', [voucherId, amountCents]);
      const { rows: b } = await client.query('SELECT balance_cents FROM vouchers WHERE id = $1', [voucherId]);
      await client.query(
        `INSERT INTO voucher_movements (voucher_id, trip_id, movement_type, amount_cents, balance_after_cents) VALUES ($1, $2, 'RELEASE', $3, $4)`,
        [voucherId, tripId, amountCents, b[0].balance_cents],
      );
      await client.query('COMMIT');
      return { ok: true, balanceCents: b[0].balance_cents };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
