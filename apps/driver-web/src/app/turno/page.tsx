'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, clearToken, getTripId, setTripId, clearTripId } from '@/lib/api';

export default function TurnoPage() {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState('');
  const [onShift, setOnShift] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasTrip, setHasTrip] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('lc_driver_token')) { router.push('/'); return; }
    setHasTrip(!!getTripId());
  }, [router]);

  async function startShift() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/drivers/me/shift', { method: 'POST', body: JSON.stringify({ vehicleId }) });
      setOnShift(true);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function crearViajePrueba() {
    setLoading(true);
    setError(null);
    try {
      // 1. Crear sesión invitada (pasajero).
      const guest = await apiFetch<{ accessToken: string }>('/auth/guest', { method: 'POST', body: JSON.stringify({ qrCode: 'test-qr' }) });
      // 2. Crear viaje.
      const trip = await apiFetch<{ id: string }>('/trips', {
        method: 'POST',
        headers: { Authorization: `Bearer ${guest.accessToken}` },
        body: JSON.stringify({
          origin: { lat: -36.6875, lng: -56.68 },
          destination: { lat: -36.716, lng: -56.68 },
          serviceType: 'TAXI',
          paymentMethod: 'CASH',
          channel: 'GUEST_QR_PWA',
        }),
      });
      alert(`Viaje creado: ${trip.id.slice(0, 8)}. El despacho lo ofrecerá al chofer en unos segundos.`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function endShift() {
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/drivers/me/shift', { method: 'DELETE' });
      setOnShift(false);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  async function logout() {
    await clearToken();
    router.push('/');
  }

  return (
    <main className="min-h-screen p-6 bg-[#F4F8F8]">
      <div className="max-w-md mx-auto flex flex-col gap-4">
        <h1 className="text-[22px] font-bold text-[#0A3A3C]">Turno</h1>
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
        {!onShift ? (
          <>
            <input className="in" placeholder="ID del vehículo" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} />
            <button onClick={startShift} disabled={loading} className="btn">{loading ? 'Iniciando…' : 'Iniciar turno'}</button>
          </>
        ) : (
          <>
            <div className="card"><p className="text-[14px] text-[#34454D]">Turno activo. Esperando ofertas…</p></div>
            {hasTrip && <a href="/viaje" className="btn text-center">Ver viaje activo</a>}
            <button onClick={crearViajePrueba} disabled={loading} className="btn bg-[#7A5200]">{loading ? 'Creando…' : 'Crear viaje de prueba'}</button>
            <button onClick={() => window.location.href = '/oferta'} className="btn">Ver oferta</button>
            <button onClick={endShift} disabled={loading} className="btn bg-[#A31F1F]">{loading ? 'Cerrando…' : 'Cerrar turno'}</button>
          </>
        )}
        <button onClick={logout} className="text-[#0F6B72] font-semibold mt-4">Cerrar sesión</button>
      </div>
    </main>
  );
}