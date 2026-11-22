'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setToken } from '@/lib/api';
import QrScanner from '@/components/QrScanner';

interface Locality { code: string; name: string; lat: number; lng: number; }

export default function HomePage() {
  const router = useRouter();
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [originCode, setOriginCode] = useState('');
  const [destCode, setDestCode] = useState('');
  const [originAddress, setOriginAddress] = useState('');
  const [destAddress, setDestAddress] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<Locality[]>('/localities').then(setLocalities).catch((e) => setError(e.message));
  }, []);

  async function startGuest() {
    setLoading(true);
    setError(null);
    try {
      const originLoc = localities.find((l) => l.code === originCode);
      const destLoc = localities.find((l) => l.code === destCode);
      if (!originLoc || !destLoc) { setError('Elegí origen y destino'); setLoading(false); return; }
      const data = await apiFetch<{ accessToken: string }>('/auth/guest', {
        method: 'POST',
        body: JSON.stringify({ qrCode: qrCode || 'demo-qr' }),
      });
      setToken(data.accessToken);
      sessionStorage.setItem('lc_origin', JSON.stringify({ lat: originLoc.lat, lng: originLoc.lng }));
      sessionStorage.setItem('lc_destination', JSON.stringify({ lat: destLoc.lat, lng: destLoc.lng }));
      sessionStorage.setItem('lc_origin_address', originAddress || originLoc.name);
      sessionStorage.setItem('lc_destination_address', destAddress || destLoc.name);
      sessionStorage.setItem('lc_origin_name', originLoc.name);
      sessionStorage.setItem('lc_destination_name', destLoc.name);
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

        <div className="flex flex-col gap-1.5">
          <span className="text-[14px] font-semibold text-[#34454D]">Código QR (parada/hotel)</span>
          {scanning ? (
            <QrScanner onScan={(code) => { setQrCode(code); setScanning(false); }} onError={(e) => { setError(e); setScanning(false); }} />
          ) : (
            <button type="button" onClick={() => setScanning(true)}
              className="h-11 border-2 border-[#0F6B72] rounded-[10px] bg-white text-[#0F6B72] font-bold text-[15px]">
              📷 Escanear QR con la cámara
            </button>
          )}
          <input className="h-11 border-2 border-[#4F5F67] rounded-[10px] px-3 font-semibold text-[16px] text-[#0A3A3C] bg-white"
            value={qrCode} onChange={(e) => setQrCode(e.target.value)} placeholder="O ingresá el código manualmente" />
        </div>

        <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[#34454D]">
          Origen
          <select className="h-11 border-2 border-[#4F5F67] rounded-[10px] px-3 font-semibold text-[16px] text-[#0A3A3C] bg-white"
            value={originCode} onChange={(e) => setOriginCode(e.target.value)}>
            <option value="">Elegí localidad…</option>
            {localities.map((l) => (<option key={l.code} value={l.code}>{l.name}</option>))}
          </select>
          <input className="h-11 border-2 border-[#4F5F67] rounded-[10px] px-3 text-[14px] text-[#0A3A3C] bg-white"
            value={originAddress} onChange={(e) => setOriginAddress(e.target.value)} placeholder="Dirección (opcional)" />
        </label>

        <label className="flex flex-col gap-1.5 text-[14px] font-semibold text-[#34454D]">
          Destino
          <select className="h-11 border-2 border-[#4F5F67] rounded-[10px] px-3 font-semibold text-[16px] text-[#0A3A3C] bg-white"
            value={destCode} onChange={(e) => setDestCode(e.target.value)}>
            <option value="">Elegí localidad…</option>
            {localities.map((l) => (<option key={l.code} value={l.code}>{l.name}</option>))}
          </select>
          <input className="h-11 border-2 border-[#4F5F67] rounded-[10px] px-3 text-[14px] text-[#0A3A3C] bg-white"
            value={destAddress} onChange={(e) => setDestAddress(e.target.value)} placeholder="Dirección (opcional)" />
        </label>

        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}

        <button onClick={startGuest} disabled={loading}
          className="h-12 border-0 rounded-[10px] bg-[#0F6B72] text-white font-bold text-[16px] cursor-pointer disabled:opacity-60">
          {loading ? 'Ingresando…' : 'Pedir taxi/remis'}
        </button>
      </div>
    </main>
  );
}