'use client';

import { Fragment, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Shell from '@/components/Shell';
import { apiFetch } from '@/lib/api';
import { entero, fecha, pesos, porcentaje } from '@/lib/format';
import { texto } from '@/lib/labels';
import { Badge, CardTitle, CodeBadge, EmptyRow, Two } from '@/components/TableParts';

const SERVICES = ['TAXI', 'REMIS'] as const;
const SCOPES = ['URBAN', 'INTERURBAN'] as const;
const ORDER: Record<string, number> = { LOW: 0, HIGH: 1, DAY: 0, NIGHT: 1 };

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

  const scheduleCode = (id: string) => schedules.find((s) => s.id === id)?.code ?? '';
  const multipleSchedules = new Set(rules.map((r) => r.schedule_id)).size > 1;

  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">3. Cuadro Tarifario</h1>
      {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}

      <div className="card">
        <CardTitle title="Cuadros tarifarios" count={schedules.length} hint="Cada cuadro agrupa las reglas vigentes en un período y el acto administrativo que lo aprueba." />
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Código</th>
                <th>Estado</th>
                <th>Vigencia</th>
                <th>Horario nocturno</th>
                <th>Instrumento legal</th>
                <th className="num">Redondeo</th>
              </tr>
            </thead>
            <tbody>
              {schedules.length === 0 && <EmptyRow cols={6} />}
              {schedules.map((s) => {
                const ejemplo = /^EJEMPLO/i.test(s.legal_instrument ?? '');
                return (
                  <tr key={s.id}>
                    <td className="font-bold whitespace-nowrap">{s.code}</td>
                    <td><CodeBadge grupo="scheduleStatus" code={s.status} /></td>
                    <td className="whitespace-nowrap tabular-nums">
                      <Two main={`desde ${fecha(s.valid_from)}`} sub={s.valid_to ? `hasta ${fecha(s.valid_to)} (exclusive)` : 'sin fecha de fin'} />
                    </td>
                    <td className="whitespace-nowrap tabular-nums">{s.night_starts_at} a {s.night_ends_at}</td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        {ejemplo && <Badge t="aviso">Ejemplo, no oficial</Badge>}
                        <span className="text-[13px]">{s.legal_instrument}</span>
                      </div>
                    </td>
                    <td className="num">{pesos(s.rounding_step_cents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {SERVICES.map((service) => {
        const ofService = rules.filter((r) => r.service_type === service);
        return (
          <div className="card" key={service}>
            <CardTitle
              title={`Reglas tarifarias · ${texto('service', service)}`}
              count={ofService.length}
              hint="Importes en pesos. La ficha se cobra por cada tramo de distancia o de espera."
            />
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Temporada</th>
                    <th>Franja</th>
                    <th className="num">Bajada de bandera</th>
                    <th className="num">Ficha<span className="sub">valor · cada</span></th>
                    <th className="num">Tarifa mínima</th>
                    <th className="num">Retorno<span className="sub">solo interurbano</span></th>
                    {multipleSchedules && <th>Cuadro</th>}
                  </tr>
                </thead>
                <tbody>
                  {ofService.length === 0 && <EmptyRow cols={multipleSchedules ? 7 : 6}>Sin reglas para este servicio.</EmptyRow>}
                  {SCOPES.map((scope) => {
                    const group = ofService
                      .filter((r) => r.scope === scope)
                      .sort((a, b) => ORDER[a.season] - ORDER[b.season] || ORDER[a.time_band] - ORDER[b.time_band]);
                    if (group.length === 0) return null;
                    return (
                      <Fragment key={scope}>
                        <tr className="grp"><td colSpan={multipleSchedules ? 7 : 6}>{texto('scope', scope)}</td></tr>
                        {group.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <Badge t={r.season === 'HIGH' ? 'aviso' : 'info'}>Temporada {texto('season', r.season).toLowerCase()}</Badge>
                            </td>
                            <td className="whitespace-nowrap">{r.time_band === 'NIGHT' ? '🌙 ' : '☀️ '}{texto('timeBand', r.time_band)}</td>
                            <td className="num font-semibold">{pesos(r.flag_fall_cents)}</td>
                            <td className="num">
                              <div className="font-semibold">{pesos(r.unit_value_cents)}</div>
                              <div className="text-[12px] text-[#5B6B72]">{entero(r.distance_unit_m)} m o {entero(r.time_unit_s)} s de espera</div>
                            </td>
                            <td className="num font-semibold">{pesos(r.minimum_fare_cents)}</td>
                            <td className="num">
                              {r.scope === 'INTERURBAN'
                                ? <Two main={porcentaje(r.return_coefficient)} sub={r.backhaul_waives_return ? 'no se cobra con Viaje de Vuelta' : undefined} />
                                : <span className="text-[#9AA7AD]">—</span>}
                            </td>
                            {multipleSchedules && <td className="whitespace-nowrap">{scheduleCode(r.schedule_id)}</td>}
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </Shell>
  );
}
