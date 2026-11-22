'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, setTripId } from '@/lib/api';

export default function OfertaPage() {
  const router = useRouter();
  const [offer, setOffer] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const o = await apiFetch<any>('/drivers/me/offer');
      setOffer(o);
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => {
    if (!localStorage.getItem('lc_driver_token')) { router.push('/'); return; }
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [router]);

  async function accept() {
    if (!offer) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/offers/${offer.offer_id}/accept`, { method: 'POST', body: JSON.stringify({ tripId: offer.trip_id }) });
      await setTripId(offer.trip_id);
      router.push('/viaje');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function reject() {
    if (!offer) return;
    setLoading(true);
    setError(null);
    try {
      await apiFetch(`/offers/${offer.offer_id}/reject`, { method: 'POST', body: JSON.stringify({ tripId: offer.trip_id }) });
      setOffer(null);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen p-6 bg-[#F4F8F8]">
      <div className="max-w-md mx-auto flex flex-col gap-4">
        <h1 className="text-[22px] font-bold text-[#0A3A3C]">Oferta</h1>
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
        {!offer ? (
          <>
            <div className="card"><p className="text-[14px] text-[#34454D]">Sin oferta vigente.</p></div>
            <button onClick={load} className="btn">Actualizar</button>
          </>
        ) : (
          <>
            <div className="card flex flex-col gap-2">
              <div className="text-[15px] font-bold text-[#0A3A3C]">Viaje {String(offer.trip_id).slice(0, 8)}</div>
              <div className="text-[13px] text-[#34454D]">ETA: {offer.eta_seconds}s</div>
              <div className="text-[13px] text-[#34454D]">Tarifa: ${(offer.quoted_fare_cents / 100).toFixed(2)}</div>
            </div>
            <button onClick={accept} disabled={loading} className="btn">{loading ? 'Aceptando…' : 'Aceptar'}</button>
            <button onClick={reject} disabled={loading} className="btn bg-[#A31F1F]">{loading ? 'Rechazando…' : 'Rechazar'}</button>
          </>
        )}
        <a href="/turno" className="text-[#0F6B72] font-semibold">Volver a turno</a>
      </div>
    </main>
  );
}