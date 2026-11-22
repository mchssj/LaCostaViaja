'use client';

import { useEffect, useRef, useState } from 'react';

const HOLD_MS = 2_000;

/**
 * Botón de pánico: hay que mantenerlo apretado 2 s (evita disparos por accidente en el bolsillo).
 * `onTrigger` recibe el control; el componente solo muestra el progreso y el resultado.
 */
export default function PanicButton({ onTrigger, compact = false }: { onTrigger: () => Promise<void>; compact?: boolean }) {
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const started = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const stop = () => {
    started.current = null;
    if (raf.current) cancelAnimationFrame(raf.current);
    setProgress(0);
  };

  const loop = () => {
    if (started.current === null) return;
    const p = Math.min(1, (Date.now() - started.current) / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      stop();
      setState('sending');
      onTrigger()
        .then(() => {
          setState('sent');
          setMsg('Alerta enviada al COM. Mantené la app abierta: compartimos tu ubicación.');
          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.([200, 100, 200]);
        })
        .catch((e: Error) => {
          setState('error');
          setMsg(`${e.message} Si es urgente, llamá al 911.`);
        });
      return;
    }
    raf.current = requestAnimationFrame(loop);
  };

  useEffect(() => () => stop(), []);

  const start = () => {
    if (state === 'sending') return;
    setMsg(null);
    setState('idle');
    started.current = Date.now();
    raf.current = requestAnimationFrame(loop);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-label="Botón de pánico: mantener apretado 2 segundos"
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative select-none overflow-hidden rounded-[12px] border-2 border-[#A31F1F] bg-white font-bold text-[#A31F1F] ${compact ? 'min-h-[44px] px-3 text-[14px]' : 'min-h-[52px] w-full text-[16px]'} ${state === 'sent' ? 'pulse bg-[#FDECEA]' : ''}`}
      >
        <span className="absolute inset-y-0 left-0 bg-[#F6C9C5]" style={{ width: `${progress * 100}%` }} />
        <span className="relative">
          {state === 'sending' ? 'Enviando alerta…' : state === 'sent' ? '🚨 Alerta enviada' : progress > 0 ? 'Mantené apretado…' : '🚨 Pánico (mantener)'}
        </span>
      </button>
      {msg && <div className={state === 'error' ? 'err' : 'ok'} role="status">{msg}</div>}
    </div>
  );
}
