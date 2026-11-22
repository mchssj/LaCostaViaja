'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import { cuit, dni, telefono } from '@/lib/format';
import { Badge, CardTitle, CodeBadge, EmptyRow, Two, Vence } from '@/components/TableParts';

export default function FlotaPage() {
  const router = useRouter();
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [agencies, setAgencies] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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

  const venceHint = (
    <span className="flex items-center gap-3">
      <span><b className="text-[#A31F1F]">Rojo</b>: vencido</span>
      <span><b className="text-[#7A5300]">Ámbar</b>: vence en 30 días o menos</span>
    </span>
  );

  return (
    <Shell requires="fleet.view">
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">2. Flota y Habilitaciones</h1>
      {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}

      <div className="card">
        <CardTitle title="Agencias de remis" count={agencies.length} hint={venceHint} />
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Agencia</th><th>CUIT</th><th>Localidad</th><th>Habilitación municipal</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {agencies.length === 0 && <EmptyRow cols={5} />}
              {agencies.map((a) => (
                <tr key={a.id}>
                  <td><Two main={a.trade_name} sub={a.legal_name !== a.trade_name ? a.legal_name : undefined} /></td>
                  <td className="tabular-nums whitespace-nowrap">{cuit(a.cuit)}</td>
                  <td><Two main={a.locality_name ?? '—'} sub={a.address} /></td>
                  <td className="whitespace-nowrap"><Two main={`N.º ${a.municipal_permit_number}`} sub={<>vence <Vence value={a.permit_expires_on} /></>} /></td>
                  <td><CodeBadge grupo="permitStatus" code={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <CardTitle title="Choferes" count={drivers.length} hint={venceHint} />
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Chofer</th><th>DNI</th><th>Agencia</th><th>Base</th><th>Habilitación municipal</th><th>Licencia profesional</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {drivers.length === 0 && <EmptyRow cols={7} />}
              {drivers.map((d) => (
                <tr key={d.id}>
                  <td className="whitespace-nowrap"><Two main={`${d.last_name}, ${d.first_name}`} sub={telefono(d.phone)} /></td>
                  <td className="tabular-nums whitespace-nowrap">{dni(d.dni)}</td>
                  <td>{d.agency_name ?? <span className="text-[#5B6B72]">Independiente</span>}</td>
                  <td>{d.base_locality_name ?? '—'}</td>
                  <td className="whitespace-nowrap"><Two main={`N.º ${d.municipal_driver_permit_number}`} sub={<>vence <Vence value={d.municipal_driver_permit_expires_on} /></>} /></td>
                  <td className="whitespace-nowrap"><Two main={`Clase ${d.professional_license_class ?? '—'}`} sub={<>vence <Vence value={d.professional_license_expires_on} /></>} /></td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <CodeBadge grupo="permitStatus" code={d.status} />
                      {d.pin_locked && <Badge t="error">PIN bloqueado</Badge>}
                      {d.suspension_reason && <span className="max-w-[220px] text-[12px] leading-snug text-[#A31F1F]">{d.suspension_reason}</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <CardTitle title="Vehículos" count={vehicles.length} hint={venceHint} />
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Patente</th><th>Servicio</th><th>Vehículo</th><th className="num">Plazas</th><th>Agencia</th><th>VTV</th><th>Seguro de pasajeros</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {vehicles.length === 0 && <EmptyRow cols={8} />}
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td><span className="rounded-[6px] border-2 border-[#0A3A3C] bg-white px-2 py-0.5 font-mono text-[13px] font-bold tracking-wider">{v.plate}</span></td>
                  <td><CodeBadge grupo="service" code={v.service_type} /></td>
                  <td><Two main={`${v.make} ${v.model}`} sub={[v.model_year, v.color].filter(Boolean).join(' · ')} /></td>
                  <td className="num">
                    {v.passenger_seats ?? '—'}
                    {v.wheelchair_accessible && <span title="Accesible para silla de ruedas" className="ml-1.5">♿</span>}
                  </td>
                  <td>{v.agency_name ?? <span className="text-[#5B6B72]">—</span>}</td>
                  <td className="whitespace-nowrap"><Vence value={v.vtv_expires_on} /></td>
                  <td className="whitespace-nowrap"><Two main={v.insurer_name ?? '—'} sub={<>vence <Vence value={v.passenger_insurance_expires_on} /></>} /></td>
                  <td><CodeBadge grupo="permitStatus" code={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
