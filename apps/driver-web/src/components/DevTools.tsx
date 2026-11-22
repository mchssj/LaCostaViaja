'use client';

import { useEffect, useState } from 'react';
import { ApiClient, PassengerApi, type Session } from '@lacosta/driver-core';
import { api } from '@/lib/client';
import type { GpsMode } from '@/lib/useLocation';

type Loc = { code: string; name: string; lat: number; lng: number };

/**
 * Solo desarrollo: GPS simulado y "crear viaje de prueba" (un invitado con el QR sin firmar
 * `test-qr`, que la API acepta únicamente con ALLOW_UNSIGNED_QR=true).
 */
export default function DevTools({
  mode,
  setMode,
  simStart,
  setSimStart,
  position,
}: {
  mode: GpsMode;
  setMode: (m: GpsMode) => void;
  simStart: { lat: number; lng: number };
  setSimStart: (p: { lat: number; lng: number }) => void;
  position: { lat: number; lng: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const [locs, setLocs] = useState<Loc[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || locs.length) return;
    api.public<Loc[]>('GET', '/localities').then(setLocs).catch(() => undefined);
  }, [open, locs.length]);

  async function createTestTrip() {
    setBusy(true);
    setMsg(null);
    try {
      let s: Session | null = null;
      const guestApi = new PassengerApi(
        new ApiClient({ baseUrl: api.baseUrl, storage: { get: () => s, set: (v) => void (s = v), clear: () => void (s = null) } }),
      );
      await guestApi.guestLogin('test-qr');
      const here = position ?? simStart;
      const origin = { lat: here.lat + 0.004, lng: here.lng }; // ~450 m al norte
      const destination = { lat: here.lat - 0.02, lng: here.lng }; // ~2,2 km al sur
      const quote = await guestApi.quote(origin, destination, 'TAXI');
      const trip = await guestApi.createTrip({
        origin,
        destination,
        serviceType: 'TAXI',
        paymentMethod: 'CASH',
        quoteToken: quote.quoteToken,
        originAddress: 'Viaje de prueba (origen)',
        destinationAddress: 'Viaje de prueba (destino)',
      });
      setMsg(`Viaje ${trip.public_code} creado. La oferta llega en unos segundos si estás disponible.`);
    } catch (e) {
      setMsg(`No se pudo crear: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[12px] border-2 border-dashed border-[#D99A00] bg-[#FFFBF0] p-3">
      <button type="button" className="flex w-full items-center justify-between text-[13px] font-bold text-[#7A5300]" onClick={() => setOpen(!open)}>
        <span>🧪 Herramientas de prueba</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex items-center justify-between gap-2 text-[14px] font-semibold">
            GPS
            <select className="h-10 rounded-[8px] border-2 border-[#C9D3D8] bg-white px-2" value={mode} onChange={(e) => setMode(e.target.value as GpsMode)}>
              <option value="simulated">Simulado</option>
              <option value="real">Real del dispositivo</option>
            </select>
          </label>
          {mode === 'simulated' && (
            <label className="flex flex-col gap-1 text-[14px] font-semibold">
              Arrancar en
              <select
                className="h-10 rounded-[8px] border-2 border-[#C9D3D8] bg-white px-2"
                value=""
                onChange={(e) => {
                  const l = locs.find((x) => x.code === e.target.value);
                  if (l) setSimStart({ lat: l.lat, lng: l.lng });
                }}
              >
                <option value="">{`${simStart.lat.toFixed(4)}, ${simStart.lng.toFixed(4)}`} (elegí localidad…)</option>
                {locs.map((l) => (
                  <option key={l.code} value={l.code}>{l.name}</option>
                ))}
              </select>
              <span className="text-[12px] font-normal text-[#5B6B72]">Elegilo antes de iniciar el turno: un salto grande con el turno abierto la API lo descarta como GPS imposible. Durante el viaje, el auto simulado va solo hacia el pasajero y después al destino.</span>
            </label>
          )}
          <button type="button" className="btn-outline min-h-[44px] text-[15px]" onClick={createTestTrip} disabled={busy}>
            {busy ? 'Creando…' : 'Crear viaje de prueba cerca mío'}
          </button>
          {msg && <div className="text-[13px] text-[#34454D]">{msg}</div>}
        </div>
      )}
    </div>
  );
}
