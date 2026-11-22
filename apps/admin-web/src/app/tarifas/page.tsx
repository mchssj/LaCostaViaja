'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import { apiFetch } from '@/lib/api';

export default function TarifasPage() {
  const router = useRouter();
  const [schedules, setSchedules] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem('lc_token')) { router.push('/login'); return; }
    (async () => {
      try {
        const [s, r] = await Promise.all([
          apiFetch<any[]>('/tariff-schedules'),
          apiFetch<any[]>('/tariff-rules'),
        ]);
        setSchedules(s); setRules(r);
      } catch (e: any) { setError(e.message); }
    })();
  }, [router]);

  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">3. Cuadro Tarifario</h1>
      {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
      <div className="card">
        <h3 className="mb-2">Cuadros tarifarios ({schedules.length})</h3>
        <table>
          <thead><tr><th>Código</th><th>Estado</th><th>Vigencia</th><th>Instrumento legal</th></tr></thead>
          <tbody>{schedules.map((s) => (
            <tr key={s.id}><td>{s.code}</td><td>{s.status}</td><td>{s.validity}</td><td>{s.legal_instrument}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card">
        <h3 className="mb-2">Reglas tarifarias ({rules.length})</h3>
        <table>
          <thead><tr><th>Servicio</th><th>Alcance</th><th>Temporada</th><th>Franja</th><th>Bandera (¢)</th><th>Ficha (¢)</th><th>Mínima (¢)</th></tr></thead>
          <tbody>{rules.map((r) => (
            <tr key={r.id}><td>{r.service_type}</td><td>{r.scope}</td><td>{r.season}</td><td>{r.time_band}</td><td>{r.flag_fall_cents}</td><td>{r.unit_value_cents}</td><td>{r.minimum_fare_cents}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Shell>
  );
}