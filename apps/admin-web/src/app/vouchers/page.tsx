'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import { apiFetch } from '@/lib/api';

export default function VouchersPage() {
  const router = useRouter();
  const [programs, setPrograms] = useState<any[]>([]);
  const [vouchers, setVouchers] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progForm, setProgForm] = useState({ name: '', programType: 'HEALTH', periodStart: '', periodEnd: '', budgetCents: 1000000 });
  const [vForm, setVForm] = useState({ code: '', programId: '', initialBalanceCents: 100000, validFrom: '', validUntil: '' });

  async function load() {
    try {
      const [p, v] = await Promise.all([apiFetch<any[]>('/municipal-programs'), apiFetch<any[]>('/vouchers')]);
      setPrograms(p); setVouchers(v);
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => {
    if (!localStorage.getItem('lc_token')) { router.push('/login'); return; }
    load();
  }, [router]);

  async function createProgram(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch('/municipal-programs', { method: 'POST', body: JSON.stringify(progForm) });
    setProgForm({ name: '', programType: 'HEALTH', periodStart: '', periodEnd: '', budgetCents: 1000000 });
    load();
  }

  async function createVoucher(e: React.FormEvent) {
    e.preventDefault();
    await apiFetch('/vouchers', { method: 'POST', body: JSON.stringify(vForm) });
    setVForm({ code: '', programId: '', initialBalanceCents: 100000, validFrom: '', validUntil: '' });
    load();
  }

  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">5. Vouchers y Beneficios</h1>
      {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}

      <div className="grid grid-cols-2 gap-4">
        <form onSubmit={createProgram} className="card flex flex-col gap-3">
          <h3 className="text-[16px] font-bold text-[#0A3A3C]">Nuevo programa</h3>
          <input className="in" placeholder="Nombre" value={progForm.name} onChange={(e) => setProgForm({ ...progForm, name: e.target.value })} required />
          <select className="in" value={progForm.programType} onChange={(e) => setProgForm({ ...progForm, programType: e.target.value })}>
            <option value="HEALTH">Salud</option>
            <option value="DISABILITY">Discapacidad</option>
            <option value="EMPLOYEE">Empleado</option>
            <option value="OTHER">Otro</option>
          </select>
          <input className="in" type="date" value={progForm.periodStart} onChange={(e) => setProgForm({ ...progForm, periodStart: e.target.value })} required />
          <input className="in" type="date" value={progForm.periodEnd} onChange={(e) => setProgForm({ ...progForm, periodEnd: e.target.value })} required />
          <input className="in" type="number" placeholder="Presupuesto (¢)" value={progForm.budgetCents} onChange={(e) => setProgForm({ ...progForm, budgetCents: Number(e.target.value) })} required />
          <button type="submit" className="btn">Crear programa</button>
        </form>

        <form onSubmit={createVoucher} className="card flex flex-col gap-3">
          <h3 className="text-[16px] font-bold text-[#0A3A3C]">Nuevo voucher</h3>
          <input className="in" placeholder="Código" value={vForm.code} onChange={(e) => setVForm({ ...vForm, code: e.target.value })} required />
          <select className="in" value={vForm.programId} onChange={(e) => setVForm({ ...vForm, programId: e.target.value })} required>
            <option value="">Programa…</option>
            {programs.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
          </select>
          <input className="in" type="number" placeholder="Saldo inicial (¢)" value={vForm.initialBalanceCents} onChange={(e) => setVForm({ ...vForm, initialBalanceCents: Number(e.target.value) })} required />
          <input className="in" type="datetime-local" value={vForm.validFrom} onChange={(e) => setVForm({ ...vForm, validFrom: e.target.value })} required />
          <input className="in" type="datetime-local" value={vForm.validUntil} onChange={(e) => setVForm({ ...vForm, validUntil: e.target.value })} required />
          <button type="submit" className="btn">Crear voucher</button>
        </form>
      </div>

      <div className="card">
        <h3 className="mb-2">Programas ({programs.length})</h3>
        <table>
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Período</th><th>Presupuesto (¢)</th><th>Gastado (¢)</th></tr></thead>
          <tbody>{programs.map((p) => (
            <tr key={p.id}><td>{p.name}</td><td>{p.program_type}</td><td>{p.period_start} → {p.period_end}</td><td>{p.budget_cents}</td><td>{p.spent_cents}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card">
        <h3 className="mb-2">Vouchers ({vouchers.length})</h3>
        <table>
          <thead><tr><th>Código</th><th>Saldo (¢)</th><th>Inicial (¢)</th><th>Vigencia</th><th>Activo</th></tr></thead>
          <tbody>{vouchers.map((v) => (
            <tr key={v.id}><td>{v.code}</td><td>{v.balance_cents}</td><td>{v.initial_balance_cents}</td><td>{v.valid_from} → {v.valid_until}</td><td>{String(v.is_active)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Shell>
  );
}