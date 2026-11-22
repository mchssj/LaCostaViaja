'use client';

import { useCallback, useEffect, useState } from 'react';
import Shell from '@/components/Shell';
import { Badge } from '@/components/TableParts';
import { Field, Msg, useAction } from '@/components/ui';
import { api } from '@/lib/api';
import { fechaHora, pesos, pesosACentavos } from '@/lib/format';
import { useSession } from '@/lib/session';

interface Setting {
  key: string;
  group_name: string;
  label: string;
  description: string;
  value_type: 'INTEGER' | 'NUMBER' | 'BOOLEAN' | 'CENTS' | 'DURATION_MS';
  value: number | boolean;
  default_value: number | boolean;
  min_value: string | null;
  max_value: string | null;
  unit: string | null;
  updated_by_username: string | null;
  updated_at: string;
  effect: 'LIVE' | 'NOT_YET';
}

const GUEST_PWA_URL = process.env.NEXT_PUBLIC_GUEST_PWA_URL ?? 'http://localhost:3002';

/** Duraciones: se editan en segundos (la API guarda milisegundos). Importes: en pesos (la API guarda centavos). */
function toDisplay(s: Setting, v: number | boolean): string {
  if (typeof v === 'boolean') return String(v);
  if (s.value_type === 'DURATION_MS') return String(v / 1000);
  if (s.value_type === 'CENTS') return pesos(v).replace(/^\$\s?/, '');
  return String(v);
}
function fromDisplay(s: Setting, raw: string): number | null {
  if (s.value_type === 'DURATION_MS') {
    const n = Number(raw.replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 1000) : null;
  }
  if (s.value_type === 'CENTS') return pesosACentavos(raw);
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function unitOf(s: Setting): string {
  return s.value_type === 'DURATION_MS' ? 'segundos' : s.value_type === 'CENTS' ? 'pesos' : (s.unit ?? '');
}
function rangeOf(s: Setting): string {
  const f = (x: string | null) => (x === null ? null : s.value_type === 'DURATION_MS' ? Number(x) / 1000 : s.value_type === 'CENTS' ? pesos(Number(x)) : Number(x));
  const min = f(s.min_value);
  const max = f(s.max_value);
  return `Rango permitido: ${min ?? '—'} a ${max ?? '—'}${s.value_type === 'CENTS' ? '' : ` ${unitOf(s)}`}`;
}

export default function ConfiguracionPage() {
  const { can } = useSession();
  const [settings, setSettings] = useState<Setting[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { busy, msg, run } = useAction();
  const editable = can('settings.edit');

  const load = useCallback(async () => {
    const s = await api.get<Setting[]>('/admin/settings');
    setSettings(s);
    setDraft(Object.fromEntries(s.map((x) => [x.key, toDisplay(x, x.value)])));
  }, []);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  const save = (s: Setting) =>
    run(s.key, async () => {
      const value = s.value_type === 'BOOLEAN' ? draft[s.key] === 'true' : fromDisplay(s, draft[s.key] ?? '');
      if (value === null) throw new Error(`${s.label}: valor inválido`);
      await api.request('PATCH', `/admin/settings/${s.key}`, { value });
      await load();
      return `«${s.label}» actualizado. Se aplica en menos de 30 segundos.`;
    });

  const groups = [...new Set(settings.map((s) => s.group_name))];

  return (
    <Shell requires="settings.view">
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Configuración</h1>
      <p className="max-w-[860px] text-[14px]">
        Parámetros de funcionamiento del sistema. Cada cambio queda en la auditoría con quién lo hizo. {editable ? 'Los valores fuera del rango permitido se rechazan.' : 'Tu rol puede verlos pero no modificarlos.'}
      </p>
      <Msg msg={msg} />
      {groups.map((g) => (
        <div key={g} className="card">
          <h2 className="mb-3 text-[16px] font-bold text-[#0A3A3C]">{g}</h2>
          <div className="flex flex-col divide-y divide-[#E3EAEC]">
            {settings.filter((s) => s.group_name === g).map((s) => {
              const changed = draft[s.key] !== toDisplay(s, s.value);
              return (
                <div key={s.key} className="grid gap-3 py-3 md:grid-cols-[1fr_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-[#0A3A3C]">
                      {s.label}
                      {s.effect === 'NOT_YET' && <Badge t="aviso" title="El valor se guarda, pero el sistema todavía no lo usa">Sin efecto todavía</Badge>}
                    </div>
                    <div className="text-[13px] text-[#34454D]">{s.description}</div>
                    <div className="mt-1 text-[12px] text-[#5B6B72]">
                      {rangeOf(s)} · Por defecto: {toDisplay(s, s.default_value)} {s.value_type === 'CENTS' ? '' : unitOf(s)}
                      {s.updated_by_username && <> · Último cambio: {s.updated_by_username}, {fechaHora(s.updated_at)}</>}
                    </div>
                  </div>
                  <div className="flex items-end gap-2">
                    {s.value_type === 'BOOLEAN' ? (
                      <select className="in h-10 w-[120px]" disabled={!editable} value={draft[s.key]} onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}>
                        <option value="true">Sí</option>
                        <option value="false">No</option>
                      </select>
                    ) : (
                      <div className="relative">
                        {s.value_type === 'CENTS' && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-[#5B6B72]">$</span>}
                        <input
                          className={`in h-10 w-[150px] text-right tabular-nums ${s.value_type === 'CENTS' ? 'pl-7' : ''}`}
                          disabled={!editable}
                          inputMode="decimal"
                          value={draft[s.key] ?? ''}
                          onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
                        />
                      </div>
                    )}
                    <span className="w-[70px] pb-2 text-[13px] text-[#5B6B72]">{s.value_type === 'CENTS' ? '' : unitOf(s)}</span>
                    {editable && (
                      <button className="btn h-10 px-4 text-[14px]" disabled={!changed || busy === s.key} onClick={() => save(s)}>
                        {busy === s.key ? '…' : 'Guardar'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {can('qr.issue') && <QrIssuer />}
    </Shell>
  );
}

/** QR firmados del Modo Invitado para imprimir en paradas, hoteles y accesos de playa. */
function QrIssuer() {
  const [label, setLabel] = useState('');
  const [zone, setZone] = useState('');
  const [issued, setIssued] = useState<{ label: string; url: string } | null>(null);
  const { busy, msg, run } = useAction();

  const issue = (e: React.FormEvent) => {
    e.preventDefault();
    run('qr', async () => {
      const res = await api.post<{ qrCode: string; label: string }>('/auth/guest-qr-codes', { label: label.trim(), ...(zone.trim() ? { zoneCode: zone.trim().toUpperCase() } : {}) });
      setIssued({ label: res.label, url: `${GUEST_PWA_URL}/?qr=${encodeURIComponent(res.qrCode)}` });
    });
  };

  return (
    <form onSubmit={issue} className="card flex flex-col gap-3">
      <h2 className="text-[16px] font-bold text-[#0A3A3C]">Modo Invitado · QR para imprimir</h2>
      <p className="text-[13px]">Genera la dirección firmada que va en el cartel. El turista la abre escaneando el QR con la cámara y entra directo a pedir el viaje.</p>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
        <Field label="Lugar (se muestra al pasajero)">
          <input className="in" placeholder="Ej.: Parada Av. Chiozza y Costanera" value={label} onChange={(e) => setLabel(e.target.value)} required minLength={3} maxLength={120} />
        </Field>
        <Field label="Código de zona (opcional)">
          <input className="in uppercase" placeholder="SB_PARADA_COSTANERA" value={zone} onChange={(e) => setZone(e.target.value)} maxLength={40} />
        </Field>
        <div className="flex items-end"><button className="btn" disabled={busy === 'qr'}>Generar</button></div>
      </div>
      {issued && (
        <div className="rounded-[10px] border-2 border-[#0F6B72] bg-[#E6F4F5] p-3 text-[13px]">
          <b>{issued.label}</b>
          <div className="mt-1 break-all font-mono text-[12px]">{issued.url}</div>
          <div className="mt-2 flex gap-2">
            <button type="button" className="bo h-8 px-3 text-[12px]" onClick={() => navigator.clipboard?.writeText(issued.url)}>Copiar dirección</button>
          </div>
          <p className="mt-2 text-[12px] text-[#34454D]">Convertí esta dirección en un código QR con la herramienta de imprenta del municipio. (El dibujo del QR desde el panel queda pendiente.)</p>
        </div>
      )}
      <Msg msg={msg} />
    </form>
  );
}
