'use client';

import { useState } from 'react';

export type MsgState = { ok: boolean; text: string } | null;

export function Msg({ msg }: { msg: MsgState }) {
  if (!msg) return null;
  return (
    <div role="status" className={`rounded-[8px] border px-3 py-2 text-[13px] font-semibold ${msg.ok ? 'border-[#A9D8B6] bg-[#E3F4E8] text-[#1B6B35]' : 'border-[#F2B8B5] bg-[#FDECEA] text-[#A31F1F]'}`}>
      {msg.text}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[13px] font-bold text-[#34454D]">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-[#5B6B72]">{hint}</span>}
    </label>
  );
}

/** Ejecuta una acción mostrando "procesando" y el resultado. */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<MsgState>(null);
  async function run(key: string, fn: () => Promise<string | void>) {
    setBusy(key);
    setMsg(null);
    try {
      const ok = await fn();
      if (ok) setMsg({ ok: true, text: ok });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }
  return { busy, msg, setMsg, run };
}

/**
 * Acción peligrosa en dos pasos: el primer clic muestra el resumen (y pide motivo si corresponde);
 * el segundo confirma.
 */
export function ConfirmAction({
  label,
  summary,
  askReason,
  danger,
  disabled,
  onConfirm,
  small,
}: {
  label: string;
  summary: React.ReactNode;
  askReason?: string;
  danger?: boolean;
  disabled?: boolean;
  small?: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const cls = `${danger ? 'br' : 'bo'} ${small ? 'h-8 px-2.5 text-[12px]' : 'h-9 text-[13px]'}`;
  if (!open) {
    return (
      <button type="button" className={cls} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className={`flex w-full flex-col gap-2 rounded-[10px] border-2 p-3 ${danger ? 'border-[#F2B8B5] bg-[#FDF6F5]' : 'border-[#C9D3D8] bg-[#F7FAFA]'}`}>
      <div className="text-[13px] text-[#0A3A3C]">{summary}</div>
      {askReason && <input className="in h-9 text-[14px]" placeholder={askReason} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />}
      <div className="flex gap-2">
        <button type="button" className="bo h-8 px-3 text-[12px]" onClick={() => { setOpen(false); setReason(''); }}>Cancelar</button>
        <button
          type="button"
          className={`${danger ? 'btn bg-[#A31F1F]' : 'btn'} h-8 px-3 text-[12px]`}
          disabled={!!askReason && reason.trim().length < 3}
          onClick={() => { onConfirm(reason.trim()); setOpen(false); setReason(''); }}
        >
          Confirmar
        </button>
      </div>
    </div>
  );
}

/** Secreto mostrado UNA sola vez (contraseña temporal, PIN). */
export function OneTimeSecret({ title, value, note, onClose }: { title: string; value: string; note: string; onClose: () => void }) {
  return (
    <div className="rounded-[12px] border-2 border-[#0F6B72] bg-[#E6F4F5] p-4">
      <div className="text-[14px] font-bold text-[#0A3A3C]">{title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="rounded-[8px] border-2 border-[#0F6B72] bg-white px-3 py-1.5 font-mono text-[20px] font-bold tracking-wider">{value}</code>
        <button className="bo h-9 text-[13px]" onClick={() => navigator.clipboard?.writeText(value)}>Copiar</button>
        <button className="bo h-9 text-[13px]" onClick={onClose}>Listo, ya lo entregué</button>
      </div>
      <p className="mt-2 text-[12px] text-[#34454D]">{note}</p>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ key: T; label: string; badge?: number }> }) {
  return (
    <div className="flex flex-wrap gap-1 border-b-2 border-[#C9D3D8]">
      {items.map((t) => (
        <button
          key={t.key}
          className={`-mb-[2px] border-b-[3px] px-3 py-2 text-[14px] font-bold ${value === t.key ? 'border-[#0F6B72] text-[#0F6B72]' : 'border-transparent text-[#5B6B72]'}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.badge ? <span className="ml-1.5 rounded-full bg-[#B3261E] px-1.5 text-[11px] text-white">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}
