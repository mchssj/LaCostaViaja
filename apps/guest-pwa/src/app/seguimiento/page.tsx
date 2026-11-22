'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getTripId, clearTripId } from '@/lib/api';

interface Trip {
  id: string;
  status: string;
  quoted_fare_cents: number;
  final_fare_cents: number | null;
  payment_status: string;
  driver_id: string | null;
  vehicle_id: string | null;
}

export default function SeguimientoPage() {
  const router = useRouter();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panicking, setPanicking] = useState(false);

  useEffect(() => {
    const tripId = getTripId();
    if (!tripId) { router.push('/'); return; }
    let cancelled = false;
    async function poll() {
      try {
        const t = await apiFetch<Trip>(`/trips/${tripId}`);
        if (!cancelled) setTrip(t);
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      }
    }
    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [router]);

  async function panico() {
    const tripId = getTripId();
    if (!tripId) return;
    setPanicking(true);
    try {
      const clientEventId = crypto.randomUUID();
      await apiFetch('/panic', {
        method: 'POST',
        body: JSON.stringify({
          clientEventId,
          tripId,
          raisedBy: 'PASSENGER',
          location: { lat: -36.6875, lng: -56.68 },
          channel: 'PWA',
          snapshot: { tripId },
          occurredAt: new Date().toISOString(),
        }),
      });
      alert('Alerta de pánico enviada. Ayuda en camino.');
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setPanicking(false);
    }
  }

  function nuevoViaje() {
    clearTripId();
    router.push('/');
  }

  if (!trip) return <main className="min-h-screen flex items-center justify-center bg-[#F4F8F8]"><p>Cargando viaje…</p></main>;

  const completed = trip.status === 'COMPLETED';
  const cancelled = trip.status.startsWith('CANCELLED');

  return (
    <main className="min-h-screen flex flex-col items-center p-6 bg-[#F4F8F8]">
      <div className="w-full max-w-md flex flex-col gap-4">
        <h1 className="text-[22px] font-bold text-[#0A3A3C]">Seguimiento del viaje</h1>
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}

        <div className="bg-white border-2 border-[#C9D3D8] rounded-[14px] p-4 flex flex-col gap-2">
          <div className="text-[17px] font-bold text-[#0A3A3C]">Estado: {trip.status}</div>
          <div className="text-[14px] text-[#34454D]">Tarifa: ${(trip.quoted_fare_cents / 100).toFixed(2)}</div>
          {trip.final_fare_cents && <div className="text-[14px] text-[#34454D]">Final: ${(trip.final_fare_cents / 100).toFixed(2)}</div>}
          <div className="text-[13px] text-[#34454D]">Pago: {trip.payment_status}</div>
          {trip.driver_id && <div className="text-[13px] text-[#34454D]">Chofer asignado ✓</div>}
        </div>

        {(completed || cancelled) && (
          <button onClick={nuevoViaje} className="h-12 border-0 rounded-[10px] bg-[#0F6B72] text-white font-bold text-[16px]">
            Nuevo viaje
          </button>
        )}

        {!completed && !cancelled && (
          <button onClick={panico} disabled={panicking}
            className="h-12 border-2 border-[#A31F1F] rounded-[10px] bg-white text-[#A31F1F] font-bold text-[16px] disabled:opacity-60">
            {panicking ? 'Enviando…' : '🚨 Botón de pánico'}
          </button>
        )}
      </div>
    </main>
  );
}