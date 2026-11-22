'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getTripId, clearTripId } from '@/lib/api';

export default function ViajePage() {
  const router = useRouter();
  const [tripId, setTripId] = useState<string | null>(null);
  const [trip, setTrip] = useState<any>(null);
  const [metered, setMetered] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const id = await getTripId();
    if (!id) { router.push('/turno'); return; }
    setTripId(id);
    try {
      const t = await apiFetch<any>(`/trips/${id}`);
      setTrip(t);
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => {
    if (!localStorage.getItem('lc_driver_token')) { router.push('/'); return; }
    load();
  }, [router]);

  async function arrived() {
    if (!tripId) return;
    setLoading(true);
    try { await apiFetch(`/trips/${tripId}/arrived`, { method: 'POST' }); await load(); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }
  async function start() {
    if (!tripId) return;
    setLoading(true);
    try { await apiFetch(`/trips/${tripId}/start`, { method: 'POST' }); await load(); } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }
  async function complete() {
    if (!tripId || !trip) return;
    setLoading(true);
    try {
      await apiFetch(`/trips/${tripId}/complete`, { method: 'POST', body: JSON.stringify({ meteredFareCents: metered ? Number(metered) : undefined }) });
      await apiFetch(`/trips/${tripId}/payment/cash`, { method: 'POST', body: JSON.stringify({ amountCents: trip.quoted_fare_cents }) });
      await clearTripId();
      alert('Viaje completado');
      router.push('/turno');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }
  async function cancel() {
    if (!tripId) return;
    setLoading(true);
    try {
      await apiFetch(`/trips/${tripId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Chofer canceló' }) });
      await clearTripId();
      alert('Viaje cancelado');
      router.push('/turno');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }
  async function panico() {
    if (!tripId) return;
    setLoading(true);
    try {
      const clientEventId = Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
      await apiFetch('/panic', { method: 'POST', body: JSON.stringify({ clientEventId, tripId, raisedBy: 'DRIVER', location: { lat: -36.6875, lng: -56.68 }, channel: 'APP', snapshot: { tripId }, occurredAt: new Date().toISOString() }) });
      alert('Alerta enviada al COM');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen p-6 bg-[#F4F8F8]">
      <div className="max-w-md mx-auto flex flex-col gap-4">
        <h1 className="text-[22px] font-bold text-[#0A3A3C]">Viaje en curso</h1>
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
        {!trip ? <div className="card"><p>Cargando…</p></div> : (
          <>
            <div className="card flex flex-col gap-2">
              <div className="text-[15px] font-bold text-[#0A3A3C]">Estado: {trip.status}</div>
              <div className="text-[13px] text-[#34454D]">Tarifa: ${(trip.quoted_fare_cents / 100).toFixed(2)}</div>
            </div>
            {trip.status === 'ASSIGNED' && <button onClick={arrived} disabled={loading} className="btn">{loading ? '…' : 'Llegué (arrived)'}</button>}
            {trip.status === 'DRIVER_ARRIVED' && <button onClick={start} disabled={loading} className="btn">{loading ? '…' : 'Iniciar viaje'}</button>}
            {trip.status === 'IN_PROGRESS' && (
              <>
                <input className="in" placeholder="Taxímetro (centavos)" value={metered} onChange={(e) => setMetered(e.target.value)} />
                <button onClick={complete} disabled={loading} className="btn">{loading ? '…' : 'Completar viaje'}</button>
              </>
            )}
            {['ASSIGNED', 'DRIVER_ARRIVED'].includes(trip.status) && (
              <button onClick={cancel} disabled={loading} className="btn bg-[#A31F1F]">{loading ? '…' : 'Cancelar'}</button>
            )}
          </>
        )}
        <button onClick={panico} disabled={loading} className="btn bg-[#B3261E]">{loading ? '…' : '🚨 Botón de pánico'}</button>
        <a href="/turno" className="text-[#0F6B72] font-semibold text-center">Volver a turno</a>
      </div>
    </main>
  );
}