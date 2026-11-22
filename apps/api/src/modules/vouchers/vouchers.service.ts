import { Inject, Injectable } from '@nestjs/common';
import { DomainError, NotFoundError, toLocalParts } from '@lacosta/domain';
import { createHmac, randomInt } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { PG_POOL } from '../../database/database.module';
import { deriveKey } from '../../security/crypto';

const rejected = (reason: string, message: string, details: Record<string, unknown> = {}): DomainError =>
  new DomainError('VOUCHER_REJECTED', message, { reason, ...details });

interface LockedVoucher {
  id: string;
  program_id: string;
  balance_cents: number;
  is_active: boolean;
  valid_from: Date;
  valid_until: Date;
  beneficiary_passenger_id: string | null;
  program_active: boolean;
  period_start: string;
  period_end: string;
  budget_cents: number;
  spent_cents: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Vouchers y Cuenta Corriente Municipal. El saldo se maneja SOLO desde el ciclo del viaje y dentro
 * de su transacción: reserva al pedir, ajuste si cambia el destino, consumo al terminar y liberación
 * al cancelar. Voucher y programa se bloquean (FOR UPDATE): dos viajes simultáneos no gastan el
 * mismo saldo ni pasan el presupuesto del programa.
 */
@Injectable()
export class VouchersService {
  private readonly dniKey: Buffer;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.dniKey = deriveKey(config.security.jwtSecret, 'voucher-dni');
  }

  // ------------------------------------------------------------ administración (municipio)
  async createProgram(input: { name: string; programType: string; periodStart: string; periodEnd: string; budgetCents: number }) {
    const { rows } = await this.pool.query(
      `INSERT INTO municipal_programs (name, program_type, period_start, period_end, budget_cents)
       VALUES ($1, $2::municipal_program_type, $3::date, $4::date, $5) RETURNING *`,
      [input.name, input.programType, input.periodStart, input.periodEnd, input.budgetCents],
    );
    return rows[0];
  }

  async listPrograms() {
    const { rows } = await this.pool.query(
      `SELECT p.*, municipal_program_held_cents(p.id) AS held_cents FROM municipal_programs p ORDER BY p.created_at DESC`,
    );
    return rows;
  }

  async createVoucher(input: {
    code?: string;
    programId: string;
    initialBalanceCents: number;
    validFrom: string;
    validUntil: string;
    beneficiaryDni?: string;
    beneficiaryPassengerId?: string;
  }) {
    const code = input.code ?? this.generateCode();
    const { rows } = await this.pool.query(
      `INSERT INTO vouchers (code, program_id, initial_balance_cents, balance_cents, valid_from, valid_until,
                             beneficiary_dni_hash, beneficiary_passenger_id)
       VALUES ($1, $2, $3, $3, $4::timestamptz, $5::timestamptz, $6, $7)
       RETURNING id, code, program_id, initial_balance_cents, balance_cents, valid_from, valid_until,
                 beneficiary_passenger_id, is_active, created_at`,
      [
        code,
        input.programId,
        input.initialBalanceCents,
        input.validFrom,
        input.validUntil,
        input.beneficiaryDni ? this.hashDni(input.beneficiaryDni) : null,
        input.beneficiaryPassengerId ?? null,
      ],
    );
    return rows[0];
  }

  async listVouchers(programId?: string) {
    const { rows } = await this.pool.query(
      `SELECT id, code, program_id, initial_balance_cents, balance_cents, valid_from, valid_until,
              beneficiary_passenger_id, (beneficiary_dni_hash IS NOT NULL) AS has_beneficiary_dni, is_active, created_at
       FROM vouchers WHERE ($1::uuid IS NULL OR program_id = $1) ORDER BY created_at DESC`,
      [programId ?? null],
    );
    return rows;
  }

  async getVoucher(id: string) {
    const { rows } = await this.pool.query(
      `SELECT v.id, v.code, v.program_id, v.initial_balance_cents, v.balance_cents, v.valid_from, v.valid_until,
              v.beneficiary_passenger_id, v.is_active,
              COALESCE(json_agg(m ORDER BY m.created_at) FILTER (WHERE m.id IS NOT NULL), '[]') AS movements
       FROM vouchers v LEFT JOIN voucher_movements m ON m.voucher_id = v.id
       WHERE v.id = $1 GROUP BY v.id`,
      [id],
    );
    if (!rows[0]) throw new NotFoundError('Voucher inexistente', { id });
    return rows[0];
  }

  // ------------------------------------------------------------ ciclo del viaje (transaccional)
  /** Reserva el monto cotizado al pedir el viaje. */
  async reserveForTrip(client: PoolClient, p: { code: string; passengerId: string; tripId: string; amountCents: number }): Promise<string> {
    const v = await this.lockByCode(client, p.code);
    this.assertUsable(v, p.passengerId);
    await this.reserve(client, v, p.tripId, p.amountCents);
    return v.id;
  }

  /** Lleva la reserva al nuevo monto (cambio de destino). */
  async adjustForTrip(client: PoolClient, tripId: string, newAmountCents: number): Promise<void> {
    const hold = await this.holdOf(client, tripId);
    if (!hold) return;
    const v = await this.lockById(client, hold.voucherId);
    if (newAmountCents > hold.cents) await this.reserve(client, v, tripId, newAmountCents - hold.cents);
    else if (newAmountCents < hold.cents) await this.movement(client, v.id, tripId, 'RELEASE', hold.cents - newAmountCents, +1);
  }

  /** Al terminar: consume el monto final y libera lo que sobró de la reserva. */
  async settleForTrip(client: PoolClient, tripId: string, finalAmountCents: number): Promise<string | null> {
    const hold = await this.holdOf(client, tripId);
    if (!hold) return null;
    const v = await this.lockById(client, hold.voucherId);
    let held = hold.cents;
    if (finalAmountCents > held) {
      await this.reserve(client, v, tripId, finalAmountCents - held);
      held = finalAmountCents;
    }
    await this.movement(client, v.id, tripId, 'CONSUME', finalAmountCents, 0);
    if (held > finalAmountCents) await this.movement(client, v.id, tripId, 'RELEASE', held - finalAmountCents, +1);
    await client.query(`UPDATE municipal_programs SET spent_cents = spent_cents + $2 WHERE id = $1`, [v.program_id, finalAmountCents]);
    return v.id;
  }

  /** Al cancelar: devuelve todo lo reservado. */
  async releaseForTrip(client: PoolClient, tripId: string): Promise<void> {
    const hold = await this.holdOf(client, tripId);
    if (!hold) return;
    await this.lockById(client, hold.voucherId);
    await this.movement(client, hold.voucherId, tripId, 'RELEASE', hold.cents, +1);
  }

  // ------------------------------------------------------------ internos
  private async reserve(client: PoolClient, v: LockedVoucher, tripId: string, amount: number): Promise<void> {
    if (amount <= 0) return;
    const { rows } = await client.query<{ balance_cents: number }>(`SELECT balance_cents FROM vouchers WHERE id = $1`, [v.id]);
    if ((rows[0]?.balance_cents ?? 0) < amount) {
      throw rejected('INSUFFICIENT_BALANCE', 'El voucher no tiene saldo suficiente para este viaje', {
        balanceCents: rows[0]?.balance_cents ?? 0,
        requiredCents: amount,
      });
    }
    const { rows: held } = await client.query<{ held: number }>(`SELECT municipal_program_held_cents($1) AS held`, [v.program_id]);
    if (v.spent_cents + (held[0]?.held ?? 0) + amount > v.budget_cents) {
      throw rejected('PROGRAM_BUDGET_EXHAUSTED', 'El programa municipal agotó su presupuesto del período');
    }
    await this.movement(client, v.id, tripId, 'RESERVE', amount, -1);
  }

  private async movement(client: PoolClient, voucherId: string, tripId: string, type: 'RESERVE' | 'CONSUME' | 'RELEASE', amount: number, balanceSign: -1 | 0 | 1): Promise<void> {
    if (amount <= 0) return;
    const { rows } = await client.query<{ balance_cents: number }>(
      `UPDATE vouchers SET balance_cents = balance_cents + $2 WHERE id = $1 RETURNING balance_cents`,
      [voucherId, balanceSign * amount],
    );
    await client.query(
      `INSERT INTO voucher_movements (voucher_id, trip_id, movement_type, amount_cents, balance_after_cents)
       VALUES ($1, $2, $3, $4, $5)`,
      [voucherId, tripId, type, amount, rows[0]!.balance_cents],
    );
  }

  private async holdOf(client: PoolClient, tripId: string): Promise<{ voucherId: string; cents: number } | null> {
    const { rows } = await client.query<{ voucher_id: string; hold: number }>(
      `SELECT voucher_id, SUM(CASE movement_type WHEN 'RESERVE' THEN amount_cents ELSE -amount_cents END)::int AS hold
       FROM voucher_movements WHERE trip_id = $1 GROUP BY voucher_id`,
      [tripId],
    );
    const r = rows[0];
    return r && r.hold > 0 ? { voucherId: r.voucher_id, cents: r.hold } : r ? { voucherId: r.voucher_id, cents: 0 } : null;
  }

  private lockByCode(client: PoolClient, code: string): Promise<LockedVoucher> {
    return this.lock(client, 'v.code = $1', code);
  }

  private lockById(client: PoolClient, id: string): Promise<LockedVoucher> {
    return this.lock(client, 'v.id = $1', id);
  }

  private async lock(client: PoolClient, where: string, value: string): Promise<LockedVoucher> {
    const { rows } = await client.query<LockedVoucher>(
      `SELECT v.id, v.program_id, v.balance_cents, v.is_active, v.valid_from, v.valid_until, v.beneficiary_passenger_id,
              p.is_active AS program_active, to_char(p.period_start, 'YYYY-MM-DD') AS period_start,
              to_char(p.period_end, 'YYYY-MM-DD') AS period_end, p.budget_cents, p.spent_cents
       FROM vouchers v JOIN municipal_programs p ON p.id = v.program_id
       WHERE ${where}
       FOR UPDATE OF v, p`,
      [value],
    );
    if (!rows[0]) throw rejected('NOT_FOUND', 'El código de voucher no existe');
    return rows[0];
  }

  private assertUsable(v: LockedVoucher, passengerId: string): void {
    const now = new Date();
    const today = toLocalParts(now).isoDate; // fecha argentina, no UTC
    if (!v.is_active || !v.program_active) throw rejected('INACTIVE', 'El voucher o su programa no están activos');
    if (now < v.valid_from || now > v.valid_until) throw rejected('OUT_OF_VALIDITY', 'El voucher está fuera de vigencia');
    if (today < v.period_start || today > v.period_end) throw rejected('PROGRAM_OUT_OF_PERIOD', 'El programa municipal no está vigente');
    if (v.beneficiary_passenger_id && v.beneficiary_passenger_id !== passengerId) {
      throw rejected('NOT_BENEFICIARY', 'Este voucher está asignado a otro pasajero');
    }
  }

  private generateCode(): string {
    const pick = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    return `LCV-${pick()}-${pick()}`;
  }

  /** HMAC (no SHA-256 pelado): un DNI tiene pocos dígitos y se podría reconstruir por fuerza bruta. */
  private hashDni(dni: string): string {
    return createHmac('sha256', this.dniKey).update(dni.replace(/\D/g, '')).digest('hex');
  }
}
