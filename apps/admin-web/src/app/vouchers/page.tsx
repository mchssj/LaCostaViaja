'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { fecha, fechaHora, pesos, pesosACentavos } from '@/lib/format';
import { texto } from '@/lib/labels';
import { Badge, CardTitle, EmptyRow, Two } from '@/components/TableParts';

// Los importes se escriben en pesos y se mandan a la API en centavos enteros.
// Topes: los mismos que valida la API (CreateProgramDto / CreateVoucherDto).
const MAX_BUDGET_CENTS = 2_000_000_000;
const MAX_VOUCHER_CENTS = 100_000_000;
const PROGRAM_TYPES = ['HEALTH', 'DISABILITY', 'EMPLOYEE', 'OTHER'] as const;
const EMPTY_PROGRAM = { name: '', programType: 'HEALTH', periodStart: '', periodEnd: '', budget: '' };
const EMPTY_VOUCHER = { code: '', programId: '', balance: '', dni: '', validFrom: '', validUntil: '' };

type Msg = { ok: boolean; text: string } | null;

function Field({ label, hint, bad, children }: { label: string; hint?: string; bad?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-bold text-[#34454D]">{label}</span>
      {children}
      {hint && <span className={`text-[12px] ${bad ? 'font-semibold text-[#A31F1F]' : 'text-[#5B6B72]'}`}>{hint}</span>}
    </label>
  );
}

function MoneyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[#5B6B72]">$</span>
      <input className="in w-full pl-7 tabular-nums" inputMode="decimal" placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))} required />
    </div>
  );
}

function FormMsg({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div role="status" className={`rounded-[8px] border px-3 py-2 text-[13px] font-semibold ${msg.ok ? 'border-[#A9D8B6] bg-[#E3F4E8] text-[#1B6B35]' : 'border-[#F2B8B5] bg-[#FDECEA] text-[#A31F1F]'}`}>
      {msg.text}
    </div>
  );
}

export default function VouchersPage() {
  const router = useRouter();
  const { can } = useSession();
  const [programs, setPrograms] = useState<any[]>([]);
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progForm, setProgForm] = useState(EMPTY_PROGRAM);
  const [vForm, setVForm] = useState(EMPTY_VOUCHER);
  const [progMsg, setProgMsg] = useState<Msg>(null);
  const [vMsg, setVMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<'program' | 'voucher' | null>(null);

  const budgetCents = pesosACentavos(progForm.budget);
  const balanceCents = pesosACentavos(vForm.balance);

  async function load() {
    try {
      const [p, v] = await Promise.all([apiFetch<any[]>('/municipal-programs'), apiFetch<any[]>('/vouchers')]);
      setPrograms(p); setVouchers(v);
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => {
    load();
  }, [router]);

  async function createProgram(e: React.FormEvent) {
    e.preventDefault();
    setProgMsg(null);
    if (budgetCents === null) return setProgMsg({ ok: false, text: 'El presupuesto no es un importe válido. Ejemplo: 1.500.000 o 1500000,50.' });
    if (budgetCents > MAX_BUDGET_CENTS) return setProgMsg({ ok: false, text: `El presupuesto no puede superar ${pesos(MAX_BUDGET_CENTS)}.` });
    if (progForm.periodEnd < progForm.periodStart) return setProgMsg({ ok: false, text: 'La fecha de fin no puede ser anterior a la de inicio.' });
    setBusy('program');
    try {
      await apiFetch('/municipal-programs', {
        method: 'POST',
        body: JSON.stringify({ name: progForm.name.trim(), programType: progForm.programType, periodStart: progForm.periodStart, periodEnd: progForm.periodEnd, budgetCents }),
      });
      setProgMsg({ ok: true, text: `Programa "${progForm.name.trim()}" creado con ${pesos(budgetCents)} de presupuesto.` });
      setProgForm(EMPTY_PROGRAM);
      load();
    } catch (err: any) {
      setProgMsg({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  }

  async function createVoucher(e: React.FormEvent) {
    e.preventDefault();
    setVMsg(null);
    if (balanceCents === null || balanceCents < 1) return setVMsg({ ok: false, text: 'El saldo inicial no es un importe válido. Ejemplo: 15.000 o 15000,50.' });
    if (balanceCents > MAX_VOUCHER_CENTS) return setVMsg({ ok: false, text: `El saldo inicial no puede superar ${pesos(MAX_VOUCHER_CENTS)}.` });
    if (vForm.validUntil <= vForm.validFrom) return setVMsg({ ok: false, text: 'El fin de la vigencia tiene que ser posterior al inicio.' });
    setBusy('voucher');
    try {
      const created = await apiFetch<any>('/vouchers', {
        method: 'POST',
        body: JSON.stringify({
          code: vForm.code.trim().toUpperCase() || undefined,
          programId: vForm.programId,
          initialBalanceCents: balanceCents,
          // datetime-local no trae zona: se interpreta en hora de Buenos Aires (UTC−3, sin horario de verano).
          validFrom: `${vForm.validFrom}:00-03:00`,
          validUntil: `${vForm.validUntil}:00-03:00`,
          beneficiaryDni: vForm.dni.replace(/\D/g, '') || undefined,
        }),
      });
      setVMsg({ ok: true, text: `Voucher ${created?.code ?? ''} creado con ${pesos(balanceCents)} de saldo.` });
      setVForm(EMPTY_VOUCHER);
      load();
    } catch (err: any) {
      setVMsg({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell requires="vouchers.view">
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Vouchers y Beneficios</h1>
      {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}

      {can('vouchers.manage') && <div className="grid grid-cols-2 gap-4">
        <form onSubmit={createProgram} className="card flex flex-col gap-3">
          <h3 className="text-[16px] font-bold text-[#0A3A3C]">Nuevo programa</h3>
          <Field label="Nombre del programa">
            <input className="in" placeholder="Ej.: Traslados a hemodiálisis" minLength={3} maxLength={120} value={progForm.name} onChange={(e) => setProgForm({ ...progForm, name: e.target.value })} required />
          </Field>
          <Field label="Tipo">
            <select className="in" value={progForm.programType} onChange={(e) => setProgForm({ ...progForm, programType: e.target.value })}>
              {PROGRAM_TYPES.map((t) => <option key={t} value={t}>{texto('programType', t)}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Inicio del período">
              <input className="in" type="date" value={progForm.periodStart} onChange={(e) => setProgForm({ ...progForm, periodStart: e.target.value })} required />
            </Field>
            <Field label="Fin del período">
              <input className="in" type="date" min={progForm.periodStart || undefined} value={progForm.periodEnd} onChange={(e) => setProgForm({ ...progForm, periodEnd: e.target.value })} required />
            </Field>
          </div>
          <Field label="Presupuesto del período" hint={budgetCents !== null ? `= ${pesos(budgetCents)}` : progForm.budget ? 'Importe no válido' : 'En pesos. Ej.: 1.500.000'} bad={!!progForm.budget && budgetCents === null}>
            <MoneyInput value={progForm.budget} onChange={(budget) => setProgForm({ ...progForm, budget })} placeholder="1.500.000" />
          </Field>
          <button type="submit" className="btn disabled:opacity-60" disabled={busy === 'program'}>{busy === 'program' ? 'Creando…' : 'Crear programa'}</button>
          <FormMsg msg={progMsg} />
        </form>

        <form onSubmit={createVoucher} className="card flex flex-col gap-3">
          <h3 className="text-[16px] font-bold text-[#0A3A3C]">Nuevo voucher</h3>
          <Field label="Programa">
            <select className="in" value={vForm.programId} onChange={(e) => setVForm({ ...vForm, programId: e.target.value })} required>
              <option value="">Elegí un programa…</option>
              {programs.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Código" hint="Vacío = se genera solo">
              <input className="in font-mono uppercase" placeholder="LCV-XXXX-XXXX" pattern="[A-Za-z0-9\-]{6,32}" title="De 6 a 32 letras, números o guiones" value={vForm.code} onChange={(e) => setVForm({ ...vForm, code: e.target.value })} />
            </Field>
            <Field label="DNI del beneficiario" hint="Opcional: vacío = al portador">
              <input className="in" inputMode="numeric" placeholder="30111222" pattern="[0-9.]{7,11}" title="Entre 7 y 9 dígitos" value={vForm.dni} onChange={(e) => setVForm({ ...vForm, dni: e.target.value })} />
            </Field>
          </div>
          <Field label="Saldo inicial" hint={balanceCents !== null ? `= ${pesos(balanceCents)}` : vForm.balance ? 'Importe no válido' : 'En pesos. Ej.: 15.000'} bad={!!vForm.balance && balanceCents === null}>
            <MoneyInput value={vForm.balance} onChange={(balance) => setVForm({ ...vForm, balance })} placeholder="15.000" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Válido desde">
              <input className="in" type="datetime-local" value={vForm.validFrom} onChange={(e) => setVForm({ ...vForm, validFrom: e.target.value })} required />
            </Field>
            <Field label="Válido hasta">
              <input className="in" type="datetime-local" min={vForm.validFrom || undefined} value={vForm.validUntil} onChange={(e) => setVForm({ ...vForm, validUntil: e.target.value })} required />
            </Field>
          </div>
          <button type="submit" className="btn disabled:opacity-60" disabled={busy === 'voucher'}>{busy === 'voucher' ? 'Creando…' : 'Crear voucher'}</button>
          <FormMsg msg={vMsg} />
        </form>
      </div>}

      <div className="card">
        <CardTitle title="Programas municipales" count={programs.length} hint="Disponible = presupuesto − gastado − reservado en viajes en curso." />
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Programa</th><th>Tipo</th><th>Período</th><th className="num">Presupuesto</th><th className="num">Gastado</th><th className="num">Reservado</th><th className="num">Disponible</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {programs.length === 0 && <EmptyRow cols={8} />}
              {programs.map((p) => {
                const budget = Number(p.budget_cents) || 0;
                const used = (Number(p.spent_cents) || 0) + (Number(p.held_cents) || 0);
                const pct = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
                return (
                  <tr key={p.id}>
                    <td className="font-semibold">{p.name}</td>
                    <td><Badge t="info">{texto('programType', p.program_type)}</Badge></td>
                    <td className="whitespace-nowrap tabular-nums"><Two main={`${fecha(p.period_start)} al`} sub={fecha(p.period_end)} /></td>
                    <td className="num">{pesos(p.budget_cents)}</td>
                    <td className="num">{pesos(p.spent_cents)}</td>
                    <td className="num">{pesos(p.held_cents)}</td>
                    <td className="num">
                      <div className="font-bold">{pesos(budget - used)}</div>
                      <div className="mt-1 ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-[#E3EAEC]" title={`${pct} % usado`}>
                        <div className={`h-full ${pct >= 90 ? 'bg-[#B3261E]' : pct >= 70 ? 'bg-[#D99A00]' : 'bg-[#0F6B72]'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td>{p.is_active === false ? <Badge t="neutro">Inactivo</Badge> : <Badge t="ok">Activo</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <CardTitle title="Vouchers" count={vouchers.length} />
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Código</th><th>Programa</th><th className="num">Saldo</th><th className="num">Inicial</th><th>Vigencia</th><th>Beneficiario</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {vouchers.length === 0 && <EmptyRow cols={7} />}
              {vouchers.map((v) => {
                const expired = v.valid_until && new Date(v.valid_until).getTime() < Date.now();
                const notYet = v.valid_from && new Date(v.valid_from).getTime() > Date.now();
                const empty = Number(v.balance_cents) <= 0;
                return (
                  <tr key={v.id}>
                    <td className="font-mono font-bold whitespace-nowrap">{v.code}</td>
                    <td>{programs.find((p) => p.id === v.program_id)?.name ?? '—'}</td>
                    <td className="num font-bold">{pesos(v.balance_cents)}</td>
                    <td className="num text-[#5B6B72]">{pesos(v.initial_balance_cents)}</td>
                    <td className="whitespace-nowrap tabular-nums"><Two main={`${fechaHora(v.valid_from)} al`} sub={fechaHora(v.valid_until)} /></td>
                    <td className="text-[13px]">{v.beneficiary_passenger_id || v.has_beneficiary_dni ? 'Nominativo' : <span className="text-[#5B6B72]">Al portador</span>}</td>
                    <td>
                      {!v.is_active ? <Badge t="neutro">Inactivo</Badge>
                        : expired ? <Badge t="error">Vencido</Badge>
                        : notYet ? <Badge t="aviso">Todavía no vigente</Badge>
                        : empty ? <Badge t="neutro">Sin saldo</Badge>
                        : <Badge t="ok">Activo</Badge>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}