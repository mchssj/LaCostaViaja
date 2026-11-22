'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import { apiFetch } from '@/lib/api';

export default function FlotaPage() {
  const router = useRouter();
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [agencies, setAgencies] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!localStorage.getItem('lc_token')) { router.push('/login'); return; }
    (async () => {
      try {
        const [d, v, a] = await Promise.all([
          apiFetch<any[]>('/drivers'),
          apiFetch<any[]>('/vehicles'),
          apiFetch<any[]>('/agencies'),
        ]);
        setDrivers(d); setVehicles(v); setAgencies(a);
      } catch (e: any) { setError(e.message); }
    })();
  }, [router]);

  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">2. Flota y Habilitaciones</h1>
      {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
      <div className="card">
        <h3 className="mb-2">Agencias ({agencies.length})</h3>
        <table>
          <thead><tr><th>Nombre comercial</th><th>CUIT</th><th>Estado</th></tr></thead>
          <tbody>{agencies.map((a) => (
            <tr key={a.id}><td>{a.trade_name}</td><td>{a.cuit}</td><td>{a.status}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card">
        <h3 className="mb-2">Choferes ({drivers.length})</h3>
        <table>
          <thead><tr><th>Apellido, Nombre</th><th>DNI</th><th>Agencia</th><th>Base</th><th>Estado</th></tr></thead>
          <tbody>{drivers.map((d) => (
            <tr key={d.id}><td>{d.last_name}, {d.first_name}</td><td>{d.dni}</td><td>{d.agency_name ?? '—'}</td><td>{d.base_locality_name ?? '—'}</td><td>{d.status}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card">
        <h3 className="mb-2">Vehículos ({vehicles.length})</h3>
        <table>
          <thead><tr><th>Patente</th><th>Servicio</th><th>Marca/Modelo</th><th>Agencia</th><th>Estado</th></tr></thead>
          <tbody>{vehicles.map((v) => (
            <tr key={v.id}><td>{v.plate}</td><td>{v.service_type}</td><td>{v.make} {v.model}</td><td>{v.agency_name ?? '—'}</td><td>{v.status}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Shell>
  );
}