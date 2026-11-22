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

  useEffect(() => {
    if (!localStorage.getItem('lc_token')) { router.push('/login'); return; }
    (async () => {
      try {
        const [p, v] = await Promise.all([
          apiFetch<any[]>('/municipal-programs'),
          apiFetch<any[]>('/vouchers'),
        ]);
        setPrograms(p); setVouchers(v);
      } catch (e: any) { setError(e.message); }
    })();
  }, [router]);

  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">5. Vouchers y Beneficios</h1>
      {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
      <div className="card">
        <h3 className="mb-2">Programas municipales ({programs.length})</h3>
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