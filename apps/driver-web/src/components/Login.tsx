'use client';

import { useState } from 'react';
import { ApiError } from '@lacosta/driver-core';
import { driverApi } from '@/lib/client';

export default function Login({ onDone }: { onDone: () => void }) {
  const [dni, setDni] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await driverApi.login(dni, pin);
      onDone();
    } catch (err) {
      const e2 = err as ApiError;
      // El 401 del login significa DNI/PIN incorrectos o PIN bloqueado (la API no distingue a propósito).
      setError(e2.status === 401 ? 'DNI o PIN incorrectos. Después de 5 intentos el PIN se bloquea por 15 minutos.' : e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center p-5">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        <div className="mb-2 flex flex-col items-center gap-2 text-center">
          <img src="/icon.svg" alt="" className="h-16 w-16 rounded-[18px]" />
          <h1 className="text-[24px] font-bold">La Costa Viaja</h1>
          <p className="muted">App del chofer habilitado</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="lbl">DNI</span>
          <input className="in tabular-nums" inputMode="numeric" autoComplete="username" placeholder="Sin puntos" value={dni} onChange={(e) => setDni(e.target.value.replace(/[^\d.]/g, ''))} required />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="lbl">PIN</span>
          <input className="in tracking-[0.4em]" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} placeholder="6 dígitos" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required pattern="\d{6}" />
        </label>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn" disabled={busy || dni.length < 7 || pin.length !== 6}>{busy ? 'Ingresando…' : 'Ingresar'}</button>
        <p className="muted text-center text-[12px]">¿Olvidaste el PIN? Pedí uno nuevo en la Dirección de Transporte.</p>
      </form>
    </main>
  );
}
