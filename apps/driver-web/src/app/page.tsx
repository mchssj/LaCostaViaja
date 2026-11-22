'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setToken, getToken } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [dni, setDni] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (getToken()) router.push('/turno');
  }, [router]);

  async function login() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ accessToken: string }>('/auth/driver/login', {
        method: 'POST',
        body: JSON.stringify({ dni, pin }),
      });
      setToken(data.accessToken);
      router.push('/turno');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F4F8F8] p-6">
      <div className="card w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-[22px] font-bold text-[#0A3A3C] text-center">LaCostaViaja — Chofer</h1>
        <input className="in" placeholder="DNI" value={dni} onChange={(e) => setDni(e.target.value)} />
        <input className="in" type="password" placeholder="PIN (6 dígitos)" value={pin} onChange={(e) => setPin(e.target.value)} maxLength={6} />
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
        <button onClick={login} disabled={loading} className="btn">
          {loading ? 'Ingresando…' : 'Ingresar'}
        </button>
        <p className="text-[12px] text-[#34454D] text-center">Demo: DNI <b>28456789</b>, PIN <b>123456</b>.</p>
      </div>
    </main>
  );
}