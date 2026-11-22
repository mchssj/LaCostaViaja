'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { apiFetch } from '@/lib/api';

interface Alert {
  id: string;
  raised_by: string;
  status: string;
  snapshot: any;
  occurred_at: string;
  trip_public_code?: string;
  driver_first_name?: string;
  driver_last_name?: string;
  vehicle_plate?: string;
  locality_id?: string;
}

export default function ComAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let socket: Socket | null = null;
    (async () => {
      try {
        const data = await apiFetch<Alert[]>('/com/alerts');
        setAlerts(data ?? []);
      } catch (e: any) {
        setError(e.message);
      }
    })();

    const token = localStorage.getItem('lc_token');
    if (token) {
      socket = io('http://localhost:3000/com', { auth: { token }, transports: ['websocket'] });
      socket.on('panic.alert', (ev: any) => {
        setAlerts((prev) => [ev.data ?? ev, ...prev]);
      });
    }
    return () => {
      socket?.disconnect();
    };
  }, []);

  async function ack(id: string) {
    await apiFetch(`/com/alerts/${id}/ack`, { method: 'POST' });
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'ACKNOWLEDGED' } : a)));
  }

  return (
    <div className="card w-[360px] flex-none overflow-hidden p-0 border-[#B3261E] flex flex-col">
      <div className="bg-[#B3261E] px-4 py-3.5 text-white">
        <div className="text-[13px] font-bold">ALERTAS COM ACTIVAS</div>
        <div className="text-[18px] font-bold">{alerts.length} abierta(s)</div>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4 overflow-auto">
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
        {alerts.length === 0 && <div className="text-[14px] text-[#34454D]">Sin alertas activas.</div>}
        {alerts.map((a) => (
          <div key={a.id} className="border-b border-[#E3EAEC] pb-3 last:border-0">
            <div className="text-[15px] font-bold text-[#0A3A3C]">
              {a.snapshot?.passengerName ?? 'Pasajero'}{' '}
              <span className="pl g ml-1.5">DNI verificado</span>
            </div>
            <div className="mt-1 text-[13px] text-[#0A3A3C]">
              {a.driver_first_name} {a.driver_last_name} · {a.vehicle_plate}
            </div>
            <div className="text-[13px] text-[#0A3A3C]">Viaje {a.trip_public_code ?? a.id.slice(0, 8)}</div>
            <div className="mt-2 flex gap-2">
              <button onClick={() => ack(a.id)} className="btn h-9 bg-[#B3261E] text-[13px]">Atender</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}