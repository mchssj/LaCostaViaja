'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginOperator, loginOperatorMfa } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const { user, setUser } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('expired')) setNotice('Tu sesión venció. Ingresá de nuevo.');
  }, []);

  useEffect(() => {
    if (user) router.replace(user.setupRequired.length ? '/cuenta' : '/');
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mfaToken) {
        setUser(await loginOperatorMfa(mfaToken, code.trim()));
        return;
      }
      const res = await loginOperator(username.trim(), password);
      if (res.mfaRequired) {
        setMfaToken(res.mfaToken);
        setPassword('');
      } else {
        setUser(res.user);
      }
    } catch (err) {
      setError((err as Error).message);
      if (mfaToken && /venció/.test((err as Error).message)) setMfaToken(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F8F8] p-4">
      <form onSubmit={onSubmit} className="card flex w-[380px] flex-col gap-4">
        <div className="flex items-center gap-3">
          <img src="/logo-la-costa.png" alt="Municipio de La Costa" className="h-14 w-auto" />
          <div className="leading-tight">
            <h1 className="text-[19px] font-bold text-[#0A3A3C]">La Costa Viaja</h1>
            <span className="text-[13px] font-semibold text-[#34454D]">Gestión Municipal</span>
          </div>
        </div>
        {notice && <div className="rounded-[8px] border border-[#F1D28A] bg-[#FFF4DB] px-3 py-2 text-[13px] font-semibold text-[#7A5300]">{notice}</div>}
        {!mfaToken ? (
          <>
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[#34454D]">
              Usuario
              <input className="in" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </label>
            <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[#34454D]">
              Contraseña
              <input className="in" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[#34454D]">
            Código de verificación
            <input
              className="in text-center font-mono text-[22px] tracking-[0.3em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              autoFocus
            />
            <span className="text-[12px] font-normal text-[#5B6B72]">
              Abrí la app de autenticación (Google Authenticator, Microsoft Authenticator…) y escribí el código de 6 dígitos. Si no tenés el teléfono, usá un código de recuperación (xxxx-xxxx).
            </span>
          </label>
        )}
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]" role="alert">{error}</div>}
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Verificando…' : mfaToken ? 'Verificar' : 'Ingresar'}
        </button>
        {mfaToken && (
          <button type="button" className="text-[13px] font-bold text-[#0F6B72]" onClick={() => { setMfaToken(null); setCode(''); }}>
            Volver
          </button>
        )}
        <p className="text-[12px] text-[#5B6B72]">¿Olvidaste la contraseña o perdiste el teléfono? Pedile a un administrador que la resetee.</p>
      </form>
    </div>
  );
}
