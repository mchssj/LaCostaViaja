'use client';

import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge, CardTitle, CodeBadge, EmptyRow, Two, Vence } from '@/components/TableParts';
import { ConfirmAction, Field, Msg, OneTimeSecret, Tabs, useAction } from '@/components/ui';
import { api, openProtectedFile, uploadForm } from '@/lib/api';
import { dni as fmtDni, fecha, fechaHora } from '@/lib/format';
import { texto, tono } from '@/lib/labels';
import { useSession } from '@/lib/session';

type EntityType = 'DRIVER' | 'VEHICLE';
interface Doc {
  id: string;
  entity_type: EntityType | 'AGENCY';
  entity_id: string;
  entity_label: string | null;
  document_type: string;
  file_name: string;
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  rejected_reason: string | null;
  expires_on: string | null;
  uploaded_at: string;
  uploaded_by_username: string | null;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  superseded_by: string | null;
}
interface Expiration { entity_type: string; entity_id: string; label: string; item: string; expires_on: string; days_left: number }

const DOC_TYPES: Record<EntityType, string[]> = {
  DRIVER: ['DNI', 'LICENCIA_PROFESIONAL', 'HABILITACION_MUNICIPAL', 'ANTECEDENTES_PENALES', 'OTRO'],
  VEHICLE: ['VTV', 'SEGURO_PASAJEROS', 'HABILITACION_MUNICIPAL', 'OTRO'],
};

type Tab = 'pending' | 'drivers' | 'vehicles' | 'expirations' | 'new';

export default function HabilitacionesPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<Doc[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [selected, setSelected] = useState<{ type: EntityType; id: string } | null>(null);
  const { msg, setMsg } = useAction();

  const load = useCallback(async () => {
    const [p, d, v] = await Promise.all([api.get<Doc[]>('/admin/documents?status=PENDING'), api.get<any[]>('/drivers'), api.get<any[]>('/vehicles')]);
    setPending(p.filter((x) => !x.superseded_by));
    setDrivers(d);
    setVehicles(v);
  }, []);
  useEffect(() => {
    load().catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, [load, setMsg]);

  const open = (type: EntityType, id: string) => {
    setSelected({ type, id });
    setTab(type === 'DRIVER' ? 'drivers' : 'vehicles');
  };

  return (
    <Shell requires="fleet.view">
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Habilitaciones</h1>
      <Msg msg={msg} />
      <Tabs
        value={tab}
        onChange={(t) => { setTab(t); setSelected(null); }}
        items={[
          { key: 'pending', label: 'Documentos a revisar', badge: pending.length },
          { key: 'drivers', label: 'Choferes' },
          { key: 'vehicles', label: 'Vehículos' },
          { key: 'expirations', label: 'Vencimientos' },
          ...(can('fleet.edit') ? [{ key: 'new' as const, label: 'Alta' }] : []),
        ]}
      />

      {tab === 'pending' && (
        <div className="card">
          <CardTitle title="Documentos pendientes de revisión" count={pending.length} hint="Se verifican contra el original. Al verificar se puede corregir el vencimiento." />
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>De</th><th>Documento</th><th>Vence</th><th>Subido</th><th /></tr></thead>
              <tbody>
                {pending.length === 0 && <EmptyRow cols={5}>No hay documentos pendientes.</EmptyRow>}
                {pending.map((d) => (
                  <tr key={d.id}>
                    <td><Two main={<button className="font-semibold text-[#0F6B72] underline" onClick={() => d.entity_type !== 'AGENCY' && open(d.entity_type, d.entity_id)}>{d.entity_label ?? '—'}</button>} sub={texto('entity', d.entity_type)} /></td>
                    <td>{texto('docType', d.document_type)}</td>
                    <td>{d.expires_on ? <Vence value={d.expires_on} /> : '—'}</td>
                    <td><Two main={fechaHora(d.uploaded_at)} sub={d.uploaded_by_username ?? undefined} /></td>
                    <td><button className="bo h-8 px-3 text-[12px]" onClick={() => openProtectedFile(`/admin/documents/${d.id}/file`).catch((e: Error) => setMsg({ ok: false, text: e.message }))}>Ver archivo</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-[#5B6B72]">Para verificar o rechazar, abrí el chofer o vehículo (clic en el nombre).</p>
        </div>
      )}

      {(tab === 'drivers' || tab === 'vehicles') && !selected && (
        <EntityList type={tab === 'drivers' ? 'DRIVER' : 'VEHICLE'} rows={tab === 'drivers' ? drivers : vehicles} onOpen={open} />
      )}
      {selected && <EntityDetail key={selected.id} type={selected.type} id={selected.id} row={(selected.type === 'DRIVER' ? drivers : vehicles).find((x) => x.id === selected.id)} vehicles={vehicles} onBack={() => setSelected(null)} onChanged={load} />}
      {tab === 'expirations' && <Expirations onOpen={open} />}
      {tab === 'new' && <NewEntity onCreated={async (type, id) => { await load(); open(type, id); }} />}
    </Shell>
  );
}

function EntityList({ type, rows, onOpen }: { type: EntityType; rows: any[]; onOpen: (t: EntityType, id: string) => void }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const shown = rows.filter((r) => (!status || r.status === status) && (!q || JSON.stringify([r.first_name, r.last_name, r.plate, r.dni, r.agency_name]).toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="card">
      <CardTitle
        title={type === 'DRIVER' ? 'Choferes' : 'Vehículos'}
        count={shown.length}
        hint={
          <span className="flex gap-2">
            <select className="in h-9 w-[160px] text-[14px]" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos los estados</option>
              <option value="PENDING">Pendientes</option>
              <option value="ACTIVE">Habilitados</option>
              <option value="SUSPENDED">Suspendidos</option>
              <option value="REVOKED">Revocados</option>
            </select>
            <input className="in h-9 w-[220px] text-[14px]" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
        }
      />
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr>{type === 'DRIVER' ? <><th>Chofer</th><th>DNI</th></> : <><th>Patente</th><th>Vehículo</th></>}<th>Agencia</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <EmptyRow cols={5} />}
            {shown.map((r) => (
              <tr key={r.id}>
                {type === 'DRIVER' ? (
                  <><td className="font-semibold">{r.last_name}, {r.first_name}</td><td className="tabular-nums">{fmtDni(r.dni)}</td></>
                ) : (
                  <><td><span className="rounded-[6px] border-2 border-[#0A3A3C] px-2 py-0.5 font-mono text-[13px] font-bold">{r.plate}</span></td><td>{r.make} {r.model} {r.model_year}</td></>
                )}
                <td>{r.agency_name ?? <span className="text-[#5B6B72]">Independiente</span>}</td>
                <td><CodeBadge grupo="permitStatus" code={r.status} /></td>
                <td><button className="bo h-8 px-3 text-[12px]" onClick={() => onOpen(type, r.id)}>Abrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EntityDetail({ type, id, row, vehicles, onBack, onChanged }: { type: EntityType; id: string; row: any; vehicles: any[]; onBack: () => void; onChanged: () => Promise<void> }) {
  const { can } = useSession();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [req, setReq] = useState<{ required: string[]; missing: string[]; ready: boolean } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [upload, setUpload] = useState({ documentType: DOC_TYPES[type][0]!, expiresOn: '', file: null as File | null });
  const [review, setReview] = useState<Record<string, { expiresOn: string }>>({});
  const [auth, setAuth] = useState({ vehicleId: '', role: 'PRIMARY_DRIVER', authorizationNumber: '', validFrom: '', validTo: '' });
  const { busy, msg, run } = useAction();
  const path = type === 'DRIVER' ? 'drivers' : 'vehicles';

  const load = useCallback(async () => {
    const [d, r] = await Promise.all([api.get<Doc[]>(`/admin/documents?entityType=${type}&entityId=${id}`), api.get<typeof req>(`/admin/requirements/${type}/${id}`)]);
    setDocs(d);
    setReq(r);
  }, [type, id]);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const after = async (text: string) => {
    await Promise.all([load(), onChanged()]);
    return text;
  };

  if (!row) return <div className="card">Cargando… <button className="bo ml-2 h-8 px-3 text-[12px]" onClick={onBack}>Volver</button></div>;
  const title = type === 'DRIVER' ? `${row.last_name}, ${row.first_name}` : `${row.plate} · ${row.make} ${row.model}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button className="bo h-9 text-[13px]" onClick={onBack}>← Volver</button>
        <h2 className="text-[19px] font-bold text-[#0A3A3C]">{title}</h2>
        <CodeBadge grupo="permitStatus" code={row.status} />
      </div>
      {secret && <OneTimeSecret title="PIN temporal del chofer" value={secret} note="Se muestra una sola vez. Entregáselo al chofer personalmente." onClose={() => setSecret(null)} />}
      <Msg msg={msg} />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="card">
          <CardTitle title="Documentos" count={docs.filter((d) => !d.superseded_by).length} />
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Documento</th><th>Estado</th><th>Vence</th><th>Subido / revisado</th><th>Acciones</th></tr></thead>
              <tbody>
                {docs.length === 0 && <EmptyRow cols={5}>Sin documentos cargados.</EmptyRow>}
                {docs.map((d) => (
                  <tr key={d.id} className={d.superseded_by ? 'opacity-50' : ''}>
                    <td><Two main={texto('docType', d.document_type)} sub={d.superseded_by ? 'Reemplazado por una versión más nueva' : d.file_name} /></td>
                    <td><div className="flex flex-col items-start gap-1"><Badge t={tono('docStatus', d.status)}>{texto('docStatus', d.status)}</Badge>{d.rejected_reason && <span className="text-[12px] text-[#A31F1F]">{d.rejected_reason}</span>}</div></td>
                    <td>{d.expires_on ? <Vence value={d.expires_on} /> : '—'}</td>
                    <td className="text-[12px]"><Two main={`${fechaHora(d.uploaded_at)} · ${d.uploaded_by_username ?? '—'}`} sub={d.reviewed_at ? `Revisó ${d.reviewed_by_username} el ${fecha(d.reviewed_at)}` : undefined} /></td>
                    <td className="min-w-[230px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button className="bo h-8 px-2.5 text-[12px]" onClick={() => openProtectedFile(`/admin/documents/${d.id}/file`).catch(() => undefined)}>Ver</button>
                        {d.status === 'PENDING' && !d.superseded_by && can('documents.review') && (
                          <>
                            <input className="in h-8 w-[130px] px-1 text-[12px]" type="date" title="Vencimiento (opcional)" value={review[d.id]?.expiresOn ?? d.expires_on ?? ''} onChange={(e) => setReview({ ...review, [d.id]: { expiresOn: e.target.value } })} />
                            <button className="btn h-8 px-2.5 text-[12px]" disabled={busy === d.id} onClick={() => run(d.id, async () => { await api.post(`/admin/documents/${d.id}/review`, { verified: true, expiresOn: review[d.id]?.expiresOn || d.expires_on || null }); return after('Documento verificado.'); })}>Verificar</button>
                            <ConfirmAction small danger label="Rechazar" askReason="Motivo (lo ve quien lo subió)" summary={<>Rechazar {texto('docType', d.document_type)}.</>} onConfirm={(reason) => run(d.id, async () => { await api.post(`/admin/documents/${d.id}/review`, { verified: false, reason }); return after('Documento rechazado.'); })} />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {can('documents.upload') && (
            <form
              className="mt-3 grid gap-3 rounded-[10px] border-2 border-dashed border-[#C9D3D8] p-3 md:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                run('upload', async () => {
                  if (!upload.file) throw new Error('Elegí el archivo');
                  const fd = new FormData();
                  fd.set('entityType', type);
                  fd.set('entityId', id);
                  fd.set('documentType', upload.documentType);
                  if (upload.expiresOn) fd.set('expiresOn', upload.expiresOn);
                  fd.set('file', upload.file);
                  await uploadForm('/admin/documents', fd);
                  setUpload({ ...upload, expiresOn: '', file: null });
                  (e.target as HTMLFormElement).reset();
                  return after('Documento subido: queda pendiente de verificación.');
                });
              }}
            >
              <Field label="Tipo"><select className="in" value={upload.documentType} onChange={(e) => setUpload({ ...upload, documentType: e.target.value })}>{DOC_TYPES[type].map((t) => <option key={t} value={t}>{texto('docType', t)}</option>)}</select></Field>
              <Field label="Vence (si corresponde)"><input className="in" type="date" value={upload.expiresOn} onChange={(e) => setUpload({ ...upload, expiresOn: e.target.value })} /></Field>
              <Field label="Archivo" hint="PDF, JPG o PNG · hasta 10 MB"><input className="text-[13px]" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setUpload({ ...upload, file: e.target.files?.[0] ?? null })} /></Field>
              <div className="flex items-end"><button className="btn" disabled={busy === 'upload'}>{busy === 'upload' ? 'Subiendo…' : 'Subir documento'}</button></div>
            </form>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="card flex flex-col gap-2 text-[14px]">
            <h3 className="text-[15px] font-bold text-[#0A3A3C]">Requisitos para habilitar</h3>
            {req?.required.map((d) => (
              <div key={d} className="flex items-center gap-2">{req.missing.includes(d) ? <span className="text-[#A31F1F]">✗</span> : <span className="text-[#1B6B35]">✔</span>} {texto('docType', d)}</div>
            ))}
            <p className="text-[12px] text-[#5B6B72]">Cada uno verificado y vigente. Lista provisoria, a confirmar por el municipio.</p>
          </div>

          {can('fleet.status') && (
            <div className="card flex flex-col gap-2">
              <h3 className="text-[15px] font-bold text-[#0A3A3C]">Estado de la habilitación</h3>
              {row.status !== 'ACTIVE' && row.status !== 'REVOKED' && (
                <ConfirmAction label="Habilitar" disabled={!req?.ready} summary={<>Habilitar a <b>{title}</b>: puede operar desde ahora.</>} onConfirm={() => run('status', async () => { await api.post(`/admin/${path}/${id}/status`, { status: 'ACTIVE' }); return after('Habilitado.'); })} />
              )}
              {row.status !== 'ACTIVE' && !req?.ready && row.status !== 'REVOKED' && <span className="text-[12px] text-[#5B6B72]">Faltan documentos verificados para habilitar.</span>}
              {row.status === 'ACTIVE' && (
                <ConfirmAction danger label="Suspender" askReason="Motivo de la suspensión" summary={<>Suspender a <b>{title}</b>. {type === 'DRIVER' ? 'Si está en turno, sale del despacho al instante.' : ''}</>} onConfirm={(reason) => run('status', async () => { await api.post(`/admin/${path}/${id}/status`, { status: 'SUSPENDED', reason }); return after('Suspendido.'); })} />
              )}
              {row.status !== 'REVOKED' && (
                <ConfirmAction danger label="Revocar (baja definitiva)" askReason="Motivo de la revocación" summary={<>Revocar a <b>{title}</b>. Es definitivo: para volver hace falta un alta nueva.</>} onConfirm={(reason) => run('status', async () => { await api.post(`/admin/${path}/${id}/status`, { status: 'REVOKED', reason }); return after('Revocado.'); })} />
              )}
              {row.suspension_reason && <div className="text-[12px] text-[#A31F1F]">Motivo de la suspensión: {row.suspension_reason}</div>}
            </div>
          )}

          {type === 'DRIVER' && can('drivers.pin_reset') && (
            <div className="card flex flex-col gap-2">
              <h3 className="text-[15px] font-bold text-[#0A3A3C]">PIN de la app</h3>
              <ConfirmAction label="Generar PIN temporal" summary="Se reemplaza el PIN actual del chofer y se desbloquea si estaba bloqueado." onConfirm={() => run('pin', async () => { const r = await api.post<{ temporaryPin: string }>(`/admin/drivers/${id}/reset-pin`); setSecret(r.temporaryPin); })} />
            </div>
          )}

          {type === 'DRIVER' && can('fleet.edit') && (
            <form
              className="card flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run('auth', async () => {
                  await api.post('/admin/authorizations', { driverId: id, ...auth, validTo: auth.validTo || null });
                  setAuth({ vehicleId: '', role: 'PRIMARY_DRIVER', authorizationNumber: '', validFrom: '', validTo: '' });
                  return 'Autorización cargada (pendiente de habilitación).';
                });
              }}
            >
              <h3 className="text-[15px] font-bold text-[#0A3A3C]">Autorizar a manejar un vehículo</h3>
              <select className="in h-10" value={auth.vehicleId} onChange={(e) => setAuth({ ...auth, vehicleId: e.target.value })} required>
                <option value="">Vehículo…</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.make} {v.model}</option>)}
              </select>
              <select className="in h-10" value={auth.role} onChange={(e) => setAuth({ ...auth, role: e.target.value })}>
                <option value="OWNER_DRIVER">Titular y chofer</option>
                <option value="PRIMARY_DRIVER">Chofer principal</option>
                <option value="RELIEF_DRIVER">Chofer suplente</option>
              </select>
              <input className="in h-10" placeholder="N.º de disposición" value={auth.authorizationNumber} onChange={(e) => setAuth({ ...auth, authorizationNumber: e.target.value })} required minLength={3} />
              <div className="grid grid-cols-2 gap-2">
                <input className="in h-10" type="date" title="Desde" value={auth.validFrom} onChange={(e) => setAuth({ ...auth, validFrom: e.target.value })} required />
                <input className="in h-10" type="date" title="Hasta (opcional)" value={auth.validTo} onChange={(e) => setAuth({ ...auth, validTo: e.target.value })} />
              </div>
              <button className="bo h-9 text-[13px]" disabled={busy === 'auth'}>Cargar autorización</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Expirations({ onOpen }: { onOpen: (t: EntityType, id: string) => void }) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Expiration[]>([]);
  useEffect(() => {
    api.get<Expiration[]>(`/admin/expirations?days=${days}`).then(setRows).catch(() => undefined);
  }, [days]);
  return (
    <div className="card">
      <CardTitle
        title="Vencimientos"
        count={rows.length}
        hint={
          <select className="in h-9 w-[200px] text-[14px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={0}>Ya vencidos</option>
            <option value={7}>Vencen en 7 días</option>
            <option value={15}>Vencen en 15 días</option>
            <option value={30}>Vencen en 30 días</option>
            <option value={90}>Vencen en 90 días</option>
          </select>
        }
      />
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Quién</th><th>Qué vence</th><th>Fecha</th><th>Situación</th></tr></thead>
          <tbody>
            {rows.length === 0 && <EmptyRow cols={4}>Nada vence en ese plazo.</EmptyRow>}
            {rows.map((r, i) => (
              <tr key={`${r.entity_id}-${r.item}-${i}`}>
                <td><Two main={r.entity_type === 'AGENCY' ? r.label : <button className="font-semibold text-[#0F6B72] underline" onClick={() => onOpen(r.entity_type as EntityType, r.entity_id)}>{r.label}</button>} sub={texto('entity', r.entity_type)} /></td>
                <td>{r.item}</td>
                <td><Vence value={r.expires_on} /></td>
                <td>{r.days_left < 0 ? <Badge t="error">Vencido hace {-r.days_left} días · bloquea</Badge> : r.days_left === 0 ? <Badge t="error">Vence hoy</Badge> : <Badge t="aviso">Faltan {r.days_left} días</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const EMPTY_DRIVER = { baseLocalityCode: 'SAN_BERNARDO', dni: '', cuil: '', firstName: '', lastName: '', phone: '+549', professionalLicenseNumber: '', professionalLicenseClass: 'D1', professionalLicenseExpiresOn: '', municipalDriverPermitNumber: '', municipalDriverPermitExpiresOn: '', criminalRecordExpiresOn: '', agencyId: '' };
const EMPTY_VEHICLE = { serviceType: 'TAXI', plate: '', make: '', model: '', modelYear: '', color: '', passengerSeats: '4', wheelchairAccessible: false, ownerName: '', ownerCuit: '', municipalVehiclePermitNumber: '', municipalVehiclePermitExpiresOn: '', vtvExpiresOn: '', insurerName: '', insurancePolicyNumber: '', passengerInsuranceExpiresOn: '', agencyId: '' };

function NewEntity({ onCreated }: { onCreated: (t: EntityType, id: string) => Promise<void> }) {
  const { user } = useSession();
  const [kind, setKind] = useState<EntityType>('DRIVER');
  const [d, setD] = useState(EMPTY_DRIVER);
  const [v, setV] = useState(EMPTY_VEHICLE);
  const [localities, setLocalities] = useState<Array<{ code: string; name: string }>>([]);
  const [agencies, setAgencies] = useState<Array<{ id: string; trade_name: string }>>([]);
  const { busy, msg, run } = useAction();
  const isAgency = user?.role === 'AGENCY_OPERATOR';

  useEffect(() => {
    api.public<Array<{ code: string; name: string }>>('GET', '/localities').then(setLocalities).catch(() => undefined);
    api.get<Array<{ id: string; trade_name: string }>>('/agencies').then(setAgencies).catch(() => undefined);
  }, []);

  const input = (obj: any, set: (x: any) => void, key: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input className="in" value={obj[key]} onChange={(e) => set({ ...obj, [key]: e.target.value })} {...props} />
  );

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex gap-2">
        <button className={kind === 'DRIVER' ? 'btn' : 'bo'} onClick={() => setKind('DRIVER')}>Nuevo chofer</button>
        <button className={kind === 'VEHICLE' ? 'btn' : 'bo'} onClick={() => setKind('VEHICLE')}>Nuevo vehículo</button>
      </div>
      <p className="text-[13px]">El alta queda <b>pendiente</b>. Después se suben los documentos y Habilitaciones los verifica antes de habilitar.{isAgency ? ' Se carga en tu agencia.' : ''}</p>
      <Msg msg={msg} />
      {kind === 'DRIVER' ? (
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            run('new', async () => {
              const r = await api.post<{ id: string }>('/admin/drivers', { ...d, agencyId: isAgency ? null : d.agencyId || null, criminalRecordExpiresOn: d.criminalRecordExpiresOn || null });
              setD(EMPTY_DRIVER);
              await onCreated('DRIVER', r.id);
            });
          }}
        >
          <Field label="Nombre">{input(d, setD, 'firstName', { required: true })}</Field>
          <Field label="Apellido">{input(d, setD, 'lastName', { required: true })}</Field>
          <Field label="Teléfono" hint="+549 y 10 dígitos, sin espacios">{input(d, setD, 'phone', { required: true, pattern: '\\+54(9)?[0-9]{10}' })}</Field>
          <Field label="DNI">{input(d, setD, 'dni', { required: true, inputMode: 'numeric' })}</Field>
          <Field label="CUIL" hint="Tiene que corresponder al DNI">{input(d, setD, 'cuil', { required: true })}</Field>
          <Field label="Localidad base" hint="Para el Viaje de Vuelta">
            <select className="in" value={d.baseLocalityCode} onChange={(e) => setD({ ...d, baseLocalityCode: e.target.value })}>{localities.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>
          </Field>
          <Field label="N.º de licencia profesional">{input(d, setD, 'professionalLicenseNumber', { required: true })}</Field>
          <Field label="Clase">
            <select className="in" value={d.professionalLicenseClass} onChange={(e) => setD({ ...d, professionalLicenseClass: e.target.value })}>{['D1', 'D2', 'D3', 'D4'].map((c) => <option key={c}>{c}</option>)}</select>
          </Field>
          <Field label="Vence la licencia">{input(d, setD, 'professionalLicenseExpiresOn', { type: 'date', required: true })}</Field>
          <Field label="N.º de habilitación municipal">{input(d, setD, 'municipalDriverPermitNumber', { required: true })}</Field>
          <Field label="Vence la habilitación">{input(d, setD, 'municipalDriverPermitExpiresOn', { type: 'date', required: true })}</Field>
          <Field label="Vence el certificado de antecedentes">{input(d, setD, 'criminalRecordExpiresOn', { type: 'date' })}</Field>
          {!isAgency && (
            <Field label="Agencia (vacío = independiente)">
              <select className="in" value={d.agencyId} onChange={(e) => setD({ ...d, agencyId: e.target.value })}><option value="">Independiente</option>{agencies.map((a) => <option key={a.id} value={a.id}>{a.trade_name}</option>)}</select>
            </Field>
          )}
          <div className="md:col-span-3"><button className="btn" disabled={busy === 'new'}>{busy === 'new' ? 'Guardando…' : 'Dar de alta (pendiente)'}</button></div>
        </form>
      ) : (
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            run('new', async () => {
              const r = await api.post<{ id: string }>('/admin/vehicles', { ...v, modelYear: Number(v.modelYear), passengerSeats: Number(v.passengerSeats), agencyId: isAgency ? null : v.agencyId || null });
              setV(EMPTY_VEHICLE);
              await onCreated('VEHICLE', r.id);
            });
          }}
        >
          <Field label="Servicio"><select className="in" value={v.serviceType} onChange={(e) => setV({ ...v, serviceType: e.target.value })}><option value="TAXI">Taxi</option><option value="REMIS">Remis (requiere agencia)</option></select></Field>
          <Field label="Patente" hint="AB123CD o ABC123">{input(v, setV, 'plate', { required: true })}</Field>
          <Field label="Marca">{input(v, setV, 'make', { required: true })}</Field>
          <Field label="Modelo">{input(v, setV, 'model', { required: true })}</Field>
          <Field label="Año">{input(v, setV, 'modelYear', { required: true, inputMode: 'numeric' })}</Field>
          <Field label="Color">{input(v, setV, 'color', { required: true })}</Field>
          <Field label="Plazas">{input(v, setV, 'passengerSeats', { required: true, inputMode: 'numeric' })}</Field>
          <label className="flex items-center gap-2 pt-6 text-[14px]"><input type="checkbox" checked={v.wheelchairAccessible} onChange={(e) => setV({ ...v, wheelchairAccessible: e.target.checked })} /> Accesible para silla de ruedas</label>
          <Field label="Titular">{input(v, setV, 'ownerName', { required: true })}</Field>
          <Field label="CUIT del titular">{input(v, setV, 'ownerCuit', { required: true })}</Field>
          <Field label="N.º de habilitación">{input(v, setV, 'municipalVehiclePermitNumber', { required: true })}</Field>
          <Field label="Vence la habilitación">{input(v, setV, 'municipalVehiclePermitExpiresOn', { type: 'date', required: true })}</Field>
          <Field label="Vence la VTV">{input(v, setV, 'vtvExpiresOn', { type: 'date', required: true })}</Field>
          <Field label="Aseguradora">{input(v, setV, 'insurerName', { required: true })}</Field>
          <Field label="N.º de póliza">{input(v, setV, 'insurancePolicyNumber', { required: true })}</Field>
          <Field label="Vence el seguro de pasajeros">{input(v, setV, 'passengerInsuranceExpiresOn', { type: 'date', required: true })}</Field>
          {!isAgency && (
            <Field label="Agencia">
              <select className="in" value={v.agencyId} onChange={(e) => setV({ ...v, agencyId: e.target.value })}><option value="">Sin agencia (taxi)</option>{agencies.map((a) => <option key={a.id} value={a.id}>{a.trade_name}</option>)}</select>
            </Field>
          )}
          <div className="md:col-span-3"><button className="btn" disabled={busy === 'new'}>{busy === 'new' ? 'Guardando…' : 'Dar de alta (pendiente)'}</button></div>
        </form>
      )}
    </div>
  );
}
