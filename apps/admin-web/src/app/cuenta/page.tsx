'use client';

import { useState } from 'react';
import Shell from '@/components/Shell';
import { api, type OperatorProfile } from '@/lib/api';
import { useSession } from '@/lib/session';
import { fechaHora } from '@/lib/format';

/** Mi cuenta: cambio de contraseña y segundo factor. También es la pantalla de "configuración pendiente". */
export default function CuentaPage() {
  const { user, setUser } = useSession();
  return (
    <Shell>
      <h1 className="text-[22px] font-bold text-[#0A3A3C]">Mi cuenta</h1>
      {user && user.setupRequired.length > 0 && (
        <div className="rounded-[10px] border-2 border-[#F1D28A] bg-[#FFF4DB] p-4 text-[14px] text-[#7A5300]">
          <b>Antes de usar el panel completá:</b>
          <ul className="mt-1 list-disc pl-5">
            {user.setupRequired.includes('PASSWORD') && <li>Cambiar la contraseña temporal por una propia.</li>}
            {user.setupRequired.includes('MFA') && <li>Activar el segundo factor (tu rol lo exige).</li>}
          </ul>
        </div>
      )}
      {user && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card flex flex-col gap-1.5 text-[14px]">
            <h2 className="mb-1 text-[16px] font-bold text-[#0A3A3C]">Datos</h2>
            <div><b>Usuario:</b> {user.username}</div>
            <div><b>Nombre:</b> {user.fullName ?? '—'}</div>
            <div><b>Correo:</b> {user.email ?? '—'}</div>
            <div><b>Rol:</b> {user.roleName}{user.agencyName ? ` · ${user.agencyName}` : ''}</div>
            <div><b>Último ingreso:</b> {fechaHora(user.lastLoginAt)}</div>
            <p className="mt-2 text-[12px] text-[#5B6B72]">Para cambiar tu nombre, correo o rol pedíselo a un administrador.</p>
          </div>
          <PasswordCard user={user} onDone={setUser} />
          <MfaCard user={user} onDone={setUser} />
        </div>
      )}
    </Shell>
  );
}

function PasswordCard({ user, onDone }: { user: OperatorProfile; onDone: (u: OperatorProfile) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = user.setupRequired.includes('PASSWORD');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== repeat) return setMsg({ ok: false, text: 'Las contraseñas nuevas no coinciden.' });
    setBusy(true);
    try {
      const res = await api.post<{ accessToken: string; refreshToken: string; user: OperatorProfile }>('/auth/me/password', { currentPassword: current, newPassword: next });
      await api.saveSession({ accessToken: res.accessToken, refreshToken: res.refreshToken });
      setCurrent('');
      setNext('');
      setRepeat('');
      setMsg({ ok: true, text: 'Contraseña actualizada. Se cerraron tus otras sesiones abiertas.' });
      onDone(res.user);
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={`card flex flex-col gap-3 ${pending ? 'border-[#D99A00]' : ''}`}>
      <h2 className="text-[16px] font-bold text-[#0A3A3C]">{pending ? '1. Cambiá tu contraseña temporal' : 'Cambiar contraseña'}</h2>
      <label className="flex flex-col gap-1 text-[13px] font-bold text-[#34454D]">
        Contraseña actual{pending ? ' (la temporal)' : ''}
        <input className="in" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-bold text-[#34454D]">
        Contraseña nueva
        <input className="in" type="password" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} required />
        <span className="text-[12px] font-normal text-[#5B6B72]">12 caracteres o más, con letras y números, sin tu nombre de usuario. Una frase sirve (ej.: «Faro de San Clemente 1923»).</span>
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-bold text-[#34454D]">
        Repetir la nueva
        <input className="in" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
      </label>
      <button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Cambiar contraseña'}</button>
      {msg && <Msg {...msg} />}
    </form>
  );
}

function MfaCard({ user, onDone }: { user: OperatorProfile; onDone: (u: OperatorProfile) => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const blockedByPassword = user.setupRequired.includes('PASSWORD');

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const start = () => run(async () => setSetup(await api.post('/auth/me/mfa/setup')));
  const enable = () =>
    run(async () => {
      const res = await api.post<{ recoveryCodes: string[]; user: OperatorProfile }>('/auth/me/mfa/enable', { code: code.trim() });
      setCodes(res.recoveryCodes);
      setSetup(null);
      setCode('');
      onDone(res.user);
    });
  const disable = () =>
    run(async () => {
      await api.post('/auth/me/mfa/disable', { code: code.trim() });
      setCode('');
      const me = await api.get<{ user: OperatorProfile }>('/auth/me');
      onDone(me.user);
      setMsg({ ok: true, text: 'Segundo factor desactivado.' });
    });

  const download = () => {
    const blob = new Blob([`La Costa Viaja · códigos de recuperación de ${user.username}\nCada código sirve UNA vez.\n\n${codes!.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `codigos-recuperacion-${user.username}.txt`;
    a.click();
  };

  return (
    <div className={`card flex flex-col gap-3 ${user.setupRequired.includes('MFA') ? 'border-[#D99A00]' : ''} lg:col-span-2`}>
      <h2 className="text-[16px] font-bold text-[#0A3A3C]">
        {user.setupRequired.includes('MFA') ? '2. Activá el segundo factor' : 'Segundo factor (código del teléfono)'}
        <span className={`ml-2 rounded-full px-2 py-0.5 text-[12px] ${user.mfaEnabled ? 'bg-[#E3F4E8] text-[#1B6B35]' : 'bg-[#EEF2F3] text-[#4F5F67]'}`}>{user.mfaEnabled ? 'Activo' : 'Inactivo'}</span>
      </h2>
      {codes && (
        <div className="rounded-[10px] border-2 border-[#0F6B72] bg-[#E6F4F5] p-3 text-[14px]">
          <b>Guardá estos códigos de recuperación.</b> Sirven para entrar si perdés el teléfono; cada uno se usa una sola vez y no se vuelven a mostrar.
          <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-[15px] sm:grid-cols-5">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div className="mt-2 flex gap-2">
            <button className="bo h-9 text-[13px]" onClick={download}>Descargar .txt</button>
            <button className="bo h-9 text-[13px]" onClick={() => setCodes(null)}>Ya los guardé</button>
          </div>
        </div>
      )}
      {!user.mfaEnabled && !setup && (
        <>
          <p className="text-[14px]">Además de la contraseña, al ingresar se pide un código de 6 dígitos que genera una app en tu teléfono (Google Authenticator, Microsoft Authenticator, Authy…).</p>
          <button className="btn max-w-[280px]" onClick={start} disabled={busy || blockedByPassword}>Configurar</button>
          {blockedByPassword && <p className="text-[12px] text-[#5B6B72]">Primero cambiá la contraseña.</p>}
        </>
      )}
      {setup && (
        <div className="flex flex-col gap-3 text-[14px]">
          <ol className="list-decimal pl-5">
            <li>En la app de autenticación elegí «Agregar cuenta» → «Ingresar una clave de configuración».</li>
            <li>Cuenta: <b>La Costa Viaja ({user.username})</b>. Clave: copiá la de abajo. Tipo: basada en tiempo.</li>
            <li>Escribí el código de 6 dígitos que muestra la app.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-[8px] border-2 border-[#C9D3D8] bg-white px-3 py-2 font-mono text-[16px] tracking-wider">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            <button className="bo h-9 text-[13px]" onClick={() => navigator.clipboard?.writeText(setup.secret)}>Copiar</button>
            <a className="text-[13px] font-bold text-[#0F6B72] underline" href={setup.otpauthUrl}>Abrir en la app (desde el teléfono)</a>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <input className="in w-[180px] text-center font-mono text-[20px] tracking-[0.3em]" inputMode="numeric" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn" onClick={enable} disabled={busy || code.trim().length !== 6}>{busy ? 'Verificando…' : 'Activar'}</button>
          </div>
        </div>
      )}
      {user.mfaEnabled && !user.mfaRequired && (
        <div className="flex flex-wrap items-end gap-2">
          <input className="in w-[180px] text-center font-mono" placeholder="Código" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="br" onClick={disable} disabled={busy || !code.trim()}>Desactivar segundo factor</button>
        </div>
      )}
      {user.mfaEnabled && user.mfaRequired && <p className="text-[13px] text-[#5B6B72]">Tu rol exige el segundo factor: no se puede desactivar. Si cambiás de teléfono, pedile a un administrador que lo resetee.</p>}
      {msg && <Msg {...msg} />}
    </div>
  );
}

function Msg({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div role="status" className={`rounded-[8px] border px-3 py-2 text-[13px] font-semibold ${ok ? 'border-[#A9D8B6] bg-[#E3F4E8] text-[#1B6B35]' : 'border-[#F2B8B5] bg-[#FDECEA] text-[#A31F1F]'}`}>
      {text}
    </div>
  );
}
