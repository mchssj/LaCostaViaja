'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge, CardTitle, CodeBadge, EmptyRow, Two } from '@/components/TableParts';
import { ConfirmAction, Field, Msg, useAction } from '@/components/ui';
import { api } from '@/lib/api';
import { entero, fecha, fechaHora, pesos, pesosACentavos } from '@/lib/format';
import { texto } from '@/lib/labels';
import { useSession } from '@/lib/session';

interface Schedule {
  id: string;
  code: string;
  legal_instrument: string;
  status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  valid_from: string;
  valid_to: string | null;
  in_force: boolean;
  night_starts_at: string;
  night_ends_at: string;
  interurban_min_outside_m: number;
  rounding_step_cents: number;
  quote_ttl_seconds: number;
  created_by: string | null;
  created_by_username: string | null;
  approved_by_username: string | null;
  approved_at: string | null;
  rule_count: number;
}
interface Rule {
  service_type: 'TAXI' | 'REMIS';
  scope: 'URBAN' | 'INTERURBAN';
  season: 'LOW' | 'HIGH';
  time_band: 'DAY' | 'NIGHT';
  flag_fall_cents: number;
  unit_value_cents: number;
  distance_unit_m: number;
  time_unit_s: number;
  reference_speed_kmh: number;
  minimum_fare_cents: number;
  return_coefficient_pct: number;
  backhaul_waives_return: boolean;
}
interface Detail extends Schedule { rules: Rule[] }
interface Season { id: string; name: string; starts_on: string; ends_on: string }
interface Locality { code: string; name: string; lat: number; lng: number }

type EditRule = Rule & { flag: string; unit: string; min: string; ret: string };

const STATUS_BADGE = { DRAFT: 'aviso', APPROVED: 'ok', RETIRED: 'neutro' } as const;
const toPesos = (c: number) => pesos(c).replace(/^\$\s?/, '');

export default function TarifasPage() {
  const { can, user } = useSession();
  const [list, setList] = useState<Schedule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [rules, setRules] = useState<EditRule[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const { busy, msg, setMsg, run } = useAction();

  const loadList = useCallback(async () => {
    const l = await api.get<Schedule[]>('/admin/tariff-schedules');
    setList(l);
    setSelectedId((cur) => cur ?? l.find((s) => s.in_force && s.status === 'APPROVED')?.id ?? l[0]?.id ?? null);
    setSeasons(await api.get<Season[]>('/admin/season-periods'));
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const d = await api.get<Detail>(`/admin/tariff-schedules/${id}`);
    setDetail(d);
    setRules(d.rules.map((r) => ({ ...r, flag: toPesos(r.flag_fall_cents), unit: toPesos(r.unit_value_cents), min: toPesos(r.minimum_fare_cents), ret: String(r.return_coefficient_pct) })));
  }, []);

  useEffect(() => {
    loadList().catch(() => undefined);
    api.public<Locality[]>('GET', '/localities').then(setLocalities).catch(() => undefined);
  }, [loadList]);
  useEffect(() => {
    if (selectedId) loadDetail(selectedId).catch(() => undefined);
  }, [selectedId, loadDetail]);

  const isDraft = detail?.status === 'DRAFT';
  const editable = isDraft && can('tariffs.edit');
  const reload = async (id = selectedId) => {
    await loadList();
    if (id) await loadDetail(id);
  };

  const saveRules = () =>
    run('rules', async () => {
      const payload = rules.map((r) => {
        const flag = pesosACentavos(r.flag);
        const unit = pesosACentavos(r.unit);
        const min = pesosACentavos(r.min);
        const key = `${texto('service', r.service_type)} ${texto('scope', r.scope)} ${texto('season', r.season)} ${texto('timeBand', r.time_band)}`;
        if (flag === null || unit === null || min === null) throw new Error(`${key}: importe inválido`);
        return {
          serviceType: r.service_type,
          scope: r.scope,
          season: r.season,
          timeBand: r.time_band,
          flagFallCents: flag,
          unitValueCents: unit,
          distanceUnitM: Number(r.distance_unit_m),
          timeUnitS: Number(r.time_unit_s),
          referenceSpeedKmh: Number(r.reference_speed_kmh),
          minimumFareCents: min,
          returnCoefficientPct: r.scope === 'URBAN' ? 0 : Number(r.ret.replace(',', '.')),
          backhaulWaivesReturn: r.scope === 'URBAN' ? false : r.backhaul_waives_return,
        };
      });
      await api.request('PUT', `/admin/tariff-schedules/${detail!.id}/rules`, { rules: payload });
      await reload();
      return 'Reglas del borrador guardadas.';
    });

  const setRule = (i: number, patch: Partial<EditRule>) => setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Shell requires="tariffs.view">
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Cuadro Tarifario</h1>
      <Msg msg={msg} />

      <div className="card">
        <CardTitle title="Cuadros tarifarios" count={list.length} hint="Lo aprobado no se modifica: los cambios se hacen en un cuadro nuevo que aprueba otro administrador." />
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Código</th><th>Estado</th><th>Vigencia</th><th>Instrumento legal</th><th>Armó / aprobó</th><th /></tr></thead>
            <tbody>
              {list.length === 0 && <EmptyRow cols={6} />}
              {list.map((s) => (
                <tr key={s.id} className={s.id === selectedId ? '!bg-[#E6F4F5]' : ''}>
                  <td className="whitespace-nowrap font-bold">{s.code}</td>
                  <td>
                    <div className="flex flex-col items-start gap-1">
                      <CodeBadge grupo="scheduleStatus" code={s.status} />
                      {s.in_force && s.status === 'APPROVED' && <Badge t="ok">Vigente</Badge>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap tabular-nums"><Two main={`desde ${fecha(s.valid_from)}`} sub={s.valid_to ? `hasta ${fecha(s.valid_to)} (exclusive)` : 'sin fecha de fin'} /></td>
                  <td className="max-w-[340px] text-[13px]">{/^(EJEMPLO|Borrador)/i.test(s.legal_instrument) ? <Badge t="aviso">{s.status === 'DRAFT' ? 'A completar' : 'Ejemplo, no oficial'}</Badge> : null} {s.legal_instrument}</td>
                  <td className="text-[13px]"><Two main={s.created_by_username ?? '—'} sub={s.approved_by_username ? `aprobó ${s.approved_by_username}` : undefined} /></td>
                  <td><button className="bo h-8 px-3 text-[12px]" onClick={() => { setMsg(null); setSelectedId(s.id); }}>{s.id === selectedId ? 'Viendo' : 'Ver'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {can('tariffs.edit') && <NewDraft list={list} onCreated={async (id) => { setSelectedId(id); await reload(id); }} run={run} busy={busy} />}
      </div>

      {detail && (
        <>
          <div className="card">
            <CardTitle
              title={`${detail.code} · ${texto('scheduleStatus', detail.status)}`}
              hint={isDraft ? (editable ? 'Borrador: podés editarlo. Los importes se cargan en pesos.' : 'Borrador (solo lectura para tu rol).') : 'Solo lectura.'}
            />
            <ScheduleParams detail={detail} editable={!!editable} run={run} busy={busy} onSaved={() => reload()} />
          </div>

          {(['TAXI', 'REMIS'] as const).map((service) => (
            <div className="card" key={service}>
              <CardTitle title={`Reglas · ${texto('service', service)}`} hint="Ficha: valor y cada cuántos metros o segundos de espera se cobra." />
              <div className="tbl-wrap">
                <table className="tbl">
                  <thead>
                    <tr><th>Temporada</th><th>Franja</th><th className="num">Bajada de bandera</th><th className="num">Ficha<span className="sub">valor · cada</span></th><th className="num">Tarifa mínima</th><th className="num">Retorno<span className="sub">solo interurbano</span></th></tr>
                  </thead>
                  <tbody>
                    {(['URBAN', 'INTERURBAN'] as const).map((scope) => {
                      const group = rules.map((r, i) => ({ r, i })).filter(({ r }) => r.service_type === service && r.scope === scope);
                      if (!group.length) return null;
                      return (
                        <Fragment key={scope}>
                          <tr className="grp"><td colSpan={6}>{texto('scope', scope)}</td></tr>
                          {group.map(({ r, i }) => (
                            <tr key={`${scope}-${r.season}-${r.time_band}`}>
                              <td><Badge t={r.season === 'HIGH' ? 'aviso' : 'info'}>{texto('season', r.season)}</Badge></td>
                              <td className="whitespace-nowrap">{r.time_band === 'NIGHT' ? '🌙 ' : '☀️ '}{texto('timeBand', r.time_band)}</td>
                              <td className="num">{editable ? <MoneyCell value={r.flag} onChange={(v) => setRule(i, { flag: v })} /> : <b>{pesos(r.flag_fall_cents)}</b>}</td>
                              <td className="num">
                                {editable ? (
                                  <div className="flex flex-col items-end gap-1">
                                    <MoneyCell value={r.unit} onChange={(v) => setRule(i, { unit: v })} />
                                    <span className="flex items-center gap-1 text-[12px]">
                                      <input className="in h-7 w-[64px] px-1 text-right text-[12px]" value={r.distance_unit_m} onChange={(e) => setRule(i, { distance_unit_m: Number(e.target.value) || 0 })} /> m o
                                      <input className="in h-7 w-[52px] px-1 text-right text-[12px]" value={r.time_unit_s} onChange={(e) => setRule(i, { time_unit_s: Number(e.target.value) || 0 })} /> s
                                    </span>
                                  </div>
                                ) : (
                                  <>
                                    <div className="font-semibold">{pesos(r.unit_value_cents)}</div>
                                    <div className="text-[12px] text-[#5B6B72]">{entero(r.distance_unit_m)} m o {entero(r.time_unit_s)} s</div>
                                  </>
                                )}
                              </td>
                              <td className="num">{editable ? <MoneyCell value={r.min} onChange={(v) => setRule(i, { min: v })} /> : <b>{pesos(r.minimum_fare_cents)}</b>}</td>
                              <td className="num">
                                {scope === 'URBAN' ? <span className="text-[#9AA7AD]">—</span> : editable ? (
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="flex items-center gap-1"><input className="in h-8 w-[64px] px-1 text-right" value={r.ret} onChange={(e) => setRule(i, { ret: e.target.value })} /> %</span>
                                    <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={r.backhaul_waives_return} onChange={(e) => setRule(i, { backhaul_waives_return: e.target.checked })} /> no se cobra con Viaje de Vuelta</label>
                                  </div>
                                ) : (
                                  <Two main={`${r.return_coefficient_pct} %`} sub={r.backhaul_waives_return ? 'no se cobra con Viaje de Vuelta' : undefined} />
                                )}
                              </td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {editable && <button className="btn max-w-[320px]" onClick={saveRules} disabled={busy === 'rules'}>{busy === 'rules' ? 'Guardando…' : 'Guardar reglas del borrador'}</button>}

          <Simulator scheduleId={detail.id} code={detail.code} localities={localities} />

          {isDraft && (can('tariffs.approve') || can('tariffs.edit')) && (
            <div className="card flex flex-col gap-3">
              <h2 className="text-[16px] font-bold text-[#0A3A3C]">Aprobación</h2>
              {can('tariffs.approve') && (
                detail.created_by === user?.id ? (
                  <div className="rounded-[8px] border border-[#F1D28A] bg-[#FFF4DB] px-3 py-2 text-[13px] text-[#7A5300]">
                    <b>Doble control:</b> vos armaste este borrador ({detail.created_by_username}); lo tiene que aprobar otro administrador.
                  </div>
                ) : (
                  <Approve detail={detail} run={run} busy={busy} onDone={() => reload()} />
                )
              )}
              {can('tariffs.edit') && (
                <ConfirmAction danger label="Descartar borrador" summary={<>Se borra el borrador <b>{detail.code}</b> y sus reglas.</>} onConfirm={() =>
                  run('discard', async () => {
                    await api.delete(`/admin/tariff-schedules/${detail.id}`);
                    setSelectedId(null);
                    setDetail(null);
                    await loadList();
                    return 'Borrador descartado.';
                  })
                } />
              )}
            </div>
          )}
          {detail.status === 'APPROVED' && !detail.in_force && can('tariffs.approve') && (
            <div className="card">
              <ConfirmAction danger label="Retirar cuadro" summary={<>El cuadro <b>{detail.code}</b> queda retirado y no se vuelve a usar.</>} onConfirm={() => run('retire', async () => { await api.post(`/admin/tariff-schedules/${detail.id}/retire`); await reload(); return 'Cuadro retirado.'; })} />
            </div>
          )}
        </>
      )}

      <Seasons seasons={seasons} editable={can('tariffs.edit')} run={run} busy={busy} onChange={() => loadList()} />
    </Shell>
  );
}

type Run = ReturnType<typeof useAction>['run'];

function MoneyCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ok = pesosACentavos(value) !== null;
  return (
    <span className="inline-flex items-center gap-1">
      $<input className={`in h-8 w-[110px] px-2 text-right tabular-nums ${ok ? '' : '!border-[#A31F1F]'}`} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))} />
    </span>
  );
}

function NewDraft({ list, onCreated, run, busy }: { list: Schedule[]; onCreated: (id: string) => Promise<void>; run: Run; busy: string | null }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: '', copyFromId: '', validFrom: '', validTo: '' });
  if (!open) return <button className="bo mt-3 h-9 text-[13px]" onClick={() => setOpen(true)}>+ Nuevo borrador</button>;
  return (
    <form
      className="mt-3 grid gap-3 rounded-[10px] border-2 border-[#C9D3D8] p-3 md:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        run('draft', async () => {
          const d = await api.post<{ id: string }>('/admin/tariff-schedules', { code: f.code.trim().toUpperCase(), validFrom: f.validFrom, validTo: f.validTo || null, ...(f.copyFromId ? { copyFromId: f.copyFromId } : {}) });
          setOpen(false);
          await onCreated(d.id);
          return 'Borrador creado: ajustá las reglas y pedile a otro administrador que lo apruebe.';
        });
      }}
    >
      <Field label="Código"><input className="in uppercase" placeholder="CT-2027-2028" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required pattern="[A-Za-z0-9-]{3,40}" /></Field>
      <Field label="Copiar de">
        <select className="in" value={f.copyFromId} onChange={(e) => setF({ ...f, copyFromId: e.target.value })}>
          <option value="">El vigente</option>
          {list.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
        </select>
      </Field>
      <Field label="Vigente desde"><input className="in" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} required /></Field>
      <Field label="Hasta (opcional, exclusive)"><input className="in" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></Field>
      <div className="flex items-end gap-2">
        <button className="btn" disabled={busy === 'draft'}>Crear</button>
        <button type="button" className="bo" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </form>
  );
}

function ScheduleParams({ detail, editable, run, busy, onSaved }: { detail: Detail; editable: boolean; run: Run; busy: string | null; onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ nightStartsAt: detail.night_starts_at, nightEndsAt: detail.night_ends_at, interurban: String(detail.interurban_min_outside_m), rounding: toPesos(detail.rounding_step_cents), validFrom: detail.valid_from, validTo: detail.valid_to ?? '' });
  useEffect(() => {
    setF({ nightStartsAt: detail.night_starts_at, nightEndsAt: detail.night_ends_at, interurban: String(detail.interurban_min_outside_m), rounding: toPesos(detail.rounding_step_cents), validFrom: detail.valid_from, validTo: detail.valid_to ?? '' });
  }, [detail]);
  if (!editable) {
    return (
      <div className="grid gap-2 text-[14px] md:grid-cols-4">
        <div><b>Vigencia:</b> {fecha(detail.valid_from)} a {detail.valid_to ? fecha(detail.valid_to) : 'sin fin'}</div>
        <div><b>Horario nocturno:</b> {detail.night_starts_at} a {detail.night_ends_at}</div>
        <div><b>Umbral interurbano:</b> {entero(detail.interurban_min_outside_m)} m fuera del origen</div>
        <div><b>Redondeo:</b> {pesos(detail.rounding_step_cents)}</div>
        {detail.approved_at && <div className="md:col-span-4 text-[13px] text-[#5B6B72]">Aprobado por {detail.approved_by_username} el {fechaHora(detail.approved_at)} · {detail.legal_instrument}</div>}
      </div>
    );
  }
  return (
    <form
      className="grid gap-3 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        run('params', async () => {
          const rounding = pesosACentavos(f.rounding);
          if (rounding === null) throw new Error('Redondeo inválido');
          await api.request('PATCH', `/admin/tariff-schedules/${detail.id}`, {
            nightStartsAt: f.nightStartsAt, nightEndsAt: f.nightEndsAt, interurbanMinOutsideM: Number(f.interurban), roundingStepCents: rounding, validFrom: f.validFrom, validTo: f.validTo || null,
          });
          await onSaved();
          return 'Parámetros del borrador guardados.';
        });
      }}
    >
      <Field label="Vigente desde"><input className="in" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></Field>
      <Field label="Hasta (exclusive)"><input className="in" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></Field>
      <Field label="Noche desde"><input className="in" type="time" value={f.nightStartsAt} onChange={(e) => setF({ ...f, nightStartsAt: e.target.value })} /></Field>
      <Field label="Noche hasta"><input className="in" type="time" value={f.nightEndsAt} onChange={(e) => setF({ ...f, nightEndsAt: e.target.value })} /></Field>
      <Field label="Umbral interurbano (m)" hint="Metros mínimos fuera de la localidad de origen"><input className="in" inputMode="numeric" value={f.interurban} onChange={(e) => setF({ ...f, interurban: e.target.value })} /></Field>
      <Field label="Redondeo ($)"><input className="in" inputMode="decimal" value={f.rounding} onChange={(e) => setF({ ...f, rounding: e.target.value })} /></Field>
      <div className="md:col-span-6"><button className="bo h-9 text-[13px]" disabled={busy === 'params'}>Guardar parámetros</button></div>
    </form>
  );
}

function Simulator({ scheduleId, code, localities }: { scheduleId: string; code: string; localities: Locality[] }) {
  const [f, setF] = useState({ from: 'SAN_BERNARDO', to: 'MAR_DE_AJO', service: 'TAXI', at: '' });
  const [res, setRes] = useState<{ draft: { totalCents: number; scope: string; season: string; timeBand: string; distanceMeters: number }; current: { totalCents: number; scheduleCode: string } | null; diffPct: number | null } | null>(null);
  const { busy, msg, run } = useAction();
  const loc = (c: string) => localities.find((l) => l.code === c);
  return (
    <div className="card flex flex-col gap-3">
      <h2 className="text-[16px] font-bold text-[#0A3A3C]">Simulador · {code} contra el vigente</h2>
      <div className="grid gap-3 md:grid-cols-5">
        <Field label="Desde"><select className="in" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>{localities.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></Field>
        <Field label="Hasta"><select className="in" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>{localities.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></Field>
        <Field label="Servicio"><select className="in" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}><option value="TAXI">Taxi</option><option value="REMIS">Remis</option></select></Field>
        <Field label="Momento (opcional)" hint="Define franja y temporada"><input className="in" type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
        <div className="flex items-end">
          <button
            className="btn"
            disabled={busy === 'sim' || !loc(f.from) || !loc(f.to)}
            onClick={() =>
              run('sim', async () => {
                const o = loc(f.from)!;
                const d = loc(f.to)!;
                setRes(await api.post('/admin/tariffs/simulate', { scheduleId, origin: { lat: o.lat, lng: o.lng }, destination: { lat: d.lat, lng: d.lng }, serviceType: f.service, ...(f.at ? { at: `${f.at}:00-03:00` } : {}) }));
              })
            }
          >
            Simular
          </button>
        </div>
      </div>
      <Msg msg={msg} />
      {res && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-[10px] bg-[#F4F8F8] p-3"><div className="text-[12px] font-bold text-[#5B6B72]">{code}</div><div className="text-[26px] font-bold">{pesos(res.draft.totalCents)}</div><div className="text-[12px]">{texto('scope', res.draft.scope)} · {texto('season', res.draft.season)} · {texto('timeBand', res.draft.timeBand)} · {(res.draft.distanceMeters / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km</div></div>
          <div className="rounded-[10px] bg-[#F4F8F8] p-3"><div className="text-[12px] font-bold text-[#5B6B72]">Vigente {res.current ? `(${res.current.scheduleCode})` : ''}</div><div className="text-[26px] font-bold">{res.current ? pesos(res.current.totalCents) : '—'}</div></div>
          <div className="rounded-[10px] bg-[#F4F8F8] p-3"><div className="text-[12px] font-bold text-[#5B6B72]">Diferencia</div><div className={`text-[26px] font-bold ${res.diffPct && res.diffPct > 0 ? 'text-[#A31F1F]' : 'text-[#1B6B35]'}`}>{res.diffPct === null ? '—' : `${res.diffPct > 0 ? '+' : ''}${res.diffPct.toLocaleString('es-AR')} %`}</div></div>
        </div>
      )}
    </div>
  );
}

function Approve({ detail, run, busy, onDone }: { detail: Detail; run: Run; busy: string | null; onDone: () => Promise<void> }) {
  const [f, setF] = useState({ legalInstrument: '', validFrom: detail.valid_from, validTo: detail.valid_to ?? '', closeCurrent: true });
  return (
    <form
      className="grid gap-3 md:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        run('approve', async () => {
          await api.post(`/admin/tariff-schedules/${detail.id}/approve`, { legalInstrument: f.legalInstrument.trim(), validFrom: f.validFrom, validTo: f.validTo || null, closeCurrent: f.closeCurrent });
          await onDone();
          return `Cuadro ${detail.code} aprobado. Rige desde ${fecha(f.validFrom)}.`;
        });
      }}
    >
      <Field label="Acto administrativo" hint="Ordenanza o decreto que aprueba el cuadro" className="md:col-span-2"><input className="in" placeholder="Ordenanza N.º 1234/2027" value={f.legalInstrument} onChange={(e) => setF({ ...f, legalInstrument: e.target.value })} required minLength={5} /></Field>
      <Field label="Rige desde"><input className="in" type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} required /></Field>
      <Field label="Hasta (opcional)"><input className="in" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-[13px] md:col-span-3"><input type="checkbox" checked={f.closeCurrent} onChange={(e) => setF({ ...f, closeCurrent: e.target.checked })} /> Si se superpone con el vigente, terminar el vigente el día en que empieza este.</label>
      <div><button className="btn" disabled={busy === 'approve'}>{busy === 'approve' ? 'Aprobando…' : 'Aprobar cuadro'}</button></div>
    </form>
  );
}

function Seasons({ seasons, editable, run, busy, onChange }: { seasons: Season[]; editable: boolean; run: Run; busy: string | null; onChange: () => Promise<void> }) {
  const [f, setF] = useState({ name: '', startsOn: '', endsOn: '' });
  return (
    <div className="card flex flex-col gap-3">
      <CardTitle title="Calendario de temporada alta" count={seasons.length} hint="Fuera de estos períodos rige la tarifa de temporada baja." />
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Período</th><th>Desde</th><th>Hasta (inclusive)</th>{editable && <th />}</tr></thead>
          <tbody>
            {seasons.length === 0 && <EmptyRow cols={editable ? 4 : 3} />}
            {seasons.map((s) => (
              <tr key={s.id}>
                <td className="font-semibold">{s.name}</td>
                <td className="tabular-nums">{s.starts_on}</td>
                <td className="tabular-nums">{s.ends_on}</td>
                {editable && <td><ConfirmAction small danger label="Borrar" summary={<>Borrar «{s.name}». Esos días pasan a temporada baja.</>} onConfirm={() => run(`season-${s.id}`, async () => { await api.delete(`/admin/season-periods/${s.id}`); await onChange(); return 'Período borrado.'; })} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            run('season', async () => {
              await api.post('/admin/season-periods', f);
              setF({ name: '', startsOn: '', endsOn: '' });
              await onChange();
              return 'Período agregado.';
            });
          }}
        >
          <Field label="Nombre"><input className="in" placeholder="Verano 2027/2028" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={3} /></Field>
          <Field label="Desde"><input className="in" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} required /></Field>
          <Field label="Hasta (inclusive)"><input className="in" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} required /></Field>
          <div className="flex items-end"><button className="bo" disabled={busy === 'season'}>Agregar período</button></div>
        </form>
      )}
    </div>
  );
}
