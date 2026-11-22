'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginOperator } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('com_operador');
  const [password, setPassword] = useState('demo');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await loginOperator(username, password);
      router.push('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F8F8]">
      <form onSubmit={onSubmit} className="card w-[360px] flex flex-col gap-4">
        <h1 className="text-[22px] font-bold text-[#0A3A3C]">Acceso al Panel Municipal</h1>
        <label className="f flex flex-col gap-1.5 text-[14px] font-semibold text-[#34454D]">
          Usuario
          <input className="in" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="f flex flex-col gap-1.5 text-[14px] font-semibold text-[#34454D]">
          Contraseña
          <input className="in" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
        <button type="submit" className="btn" disabled={loading}>
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
        <p className="text-[12px] text-[#34454D]">
          Demo: usuario <b>com_operador</b>, contraseña placeholder (el hash se valida contra la base).
        </p>
      </form>
    </div>
  );
}