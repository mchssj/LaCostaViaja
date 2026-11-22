'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setToken, setTripId } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const [qrCode, setQrCode] = useState('');
  const [origin, setOrigin] = useState({ lat: -36.6875, lng: -56.68 });
  const [destination, setDestination] = useState({ lat: -36.716, lng: -56.68 });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function startGuest() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ accessToken: string }>('/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ qrCode: qrCode || 'demo-qr' }),
      });
      setToken(data.accessToken);
      // Guardar origen/destino para la cotización.
      sessionStorage.setItem('lc_origin', JSON.stringify(origin));
      sessionStorage.setItem('lc_destination', JSON.stringify(destination));
      router.push('/cotizar');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#F4F8F8]">
      <div className="w-full max-w-md flex flex-col gap-4">
        <h1 className="text-[26px] font-bold text-[#0A3A3C] text-center">LaCostaViaja</h1>
        <p className="text-[14px] text-[#34454D] text-center">Modo Invitado — pedí tu taxi o remis sin registrarte.</p>

        <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[#34454D]">
          Código QR (de la parada/hotel)
          <input className="h-11 border-2 border-[#4F5F67] rounded-[10px] px-3 font-semibold text-[16px] text-[#0A3A3C] bg-white"
            value={qrCode} onChange={(e) => setQrCode(e.target.value)} placeholder="Escaneá o ingresá el código" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#34454D]">
            Origen (lat,lng)
            <input className="h-11 border-2 border-[#4F5F67] rounded-[10px] px-3 text-[14px] text-[#0A3A3C] bg-white"
              value={`${origin.lat},${origin.lng}`} onChange={(e) => {
                const [lat, lng] = e.target.value.split(',').map(Number);
                if (!isNaN(lat) && !isNaN(lng)) setOrigin({ lat, lng });
              }} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#34454D]">
            Destino (lat,lng)
            <input className="h-11 border-2 border-[#4F5F67] rounded-[10px] px-3 text-[14px] text-[#0A3A3C] bg-white"
              value={`${destination.lat},${destination.lng}`} onChange={(e) => {
                const [lat, lng] = e.target.value.split(',').map(Number);
                if (!isNaN(lat) && !isNaN(lng)) setDestination({ lat, lng });
              }} />
          </label>
        </div>

        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}

        <button onClick={startGuest} disabled={loading}
          className="h-12 border-0 rounded-[10px] bg-[#0F6B72] text-white font-bold text-[16px] cursor-pointer disabled:opacity-60">
          {loading ? 'Ingresando…' : 'Pedir taxi/remis'}
        </button>
      </div>
    </main>
  );
}