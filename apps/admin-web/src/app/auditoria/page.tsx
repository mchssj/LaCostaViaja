'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge, CardTitle, EmptyRow, Two } from '@/components/TableParts';
import { Field } from '@/components/ui';
import { api } from '@/lib/api';
import { fechaHora } from '@/lib/format';
import { texto, tono } from '@/lib/labels';

interface AuditItem {
  id: string;
  occurred_at: string;
  actor_kind: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  changes: Record<string, unknown>;
  ip: string | null;
  user_agent: string | null;
}

const ACTIONS = ['CREATE', 'UPDATE', 'DELETE', 'SUSPEND', 'REVOKE', 'APPROVE', 'REJECT', 'VERIFY', 'LOGIN', 'LOGIN_FAILED', 'PASSWORD_RESET', 'MFA_CHANGE'];
const ENTITIES = ['operator_user', 'system_setting', 'tariff_schedule', 'season_period', 'driver', 'vehicle', 'agency', 'habilitation_document', 'driver_vehicle_compliance'];

/** Auditoría: registro inmutable de las acciones administrativas (solo lectura). */
export default function AuditoriaPage() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [filters, setFilters] = useState({ action: '', entityType: '', from: '', to: '' });
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(
    (before?: string) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
      if (before) q.set('before', before);
      return api.get<{ items: AuditItem[]; nextBefore: string | null }>(`/admin/audit?${q.toString()}`);
    },
    [filters],
  );

  useEffect(() => {
    query()
      .then((r) => {
        setItems(r.items);
        setNext(r.nextBefore);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [query]);

  const more = async () => {
    if (!next) return;
    const r = await query(next);
    setItems((prev) => [...prev, ...r.items]);
    setNext(r.nextBefore);
  };

  return (
    <Shell requires="audit.view">
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Auditoría</h1>
      <div className="card grid gap-3 md:grid-cols-4">
        <Field label="Acción">
          <select className="in" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
            <option value="">Todas</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{texto('auditAction', a)}</option>)}
          </select>
        </Field>
        <Field label="Sobre">
          <select className="in" value={filters.entityType} onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}>
            <option value="">Todo</option>
            {ENTITIES.map((a) => <option key={a} value={a}>{texto('entityType', a)}</option>)}
          </select>
        </Field>
        <Field label="Desde"><input className="in" type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></Field>
        <Field label="Hasta"><input className="in" type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></Field>
      </div>
      {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
      <div className="card">
        <CardTitle title="Registros" count={items.length} hint="Inmutables: no se editan ni se borran. Hora de Buenos Aires." />
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Fecha y hora</th><th>Quién</th><th>Acción</th><th>Sobre</th><th>Origen</th><th /></tr>
            </thead>
            <tbody>
              {items.length === 0 && <EmptyRow cols={6} />}
              {items.map((i) => (
                <Fragment key={i.id}>
                  <tr>
                    <td className="whitespace-nowrap tabular-nums">{fechaHora(i.occurred_at)}</td>
                    <td><Two main={i.actor_name ?? i.actor_username ?? (i.actor_kind === 'SYSTEM' ? 'Sistema' : '—')} sub={i.actor_username ?? undefined} /></td>
                    <td><Badge t={tono('auditAction', i.action)}>{texto('auditAction', i.action)}</Badge></td>
                    <td><Two main={texto('entityType', i.entity_type)} sub={i.entity_id ? <span className="font-mono">{i.entity_id.slice(0, 8)}</span> : undefined} /></td>
                    <td className="text-[12px] text-[#5B6B72]">{i.ip ?? '—'}</td>
                    <td><button className="text-[13px] font-bold text-[#0F6B72]" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Ocultar' : 'Detalle'}</button></td>
                  </tr>
                  {open === i.id && (
                    <tr>
                      <td colSpan={6}>
                        <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[8px] bg-[#0A3A3C] p-3 text-[12px] text-[#E6F4F5]">{JSON.stringify(i.changes, null, 2)}</pre>
                        {i.user_agent && <div className="mt-1 text-[11px] text-[#7A8A91]">{i.user_agent}</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {next && <button className="bo mt-3 h-9 text-[13px]" onClick={more}>Ver más</button>}
      </div>
    </Shell>
  );
}
