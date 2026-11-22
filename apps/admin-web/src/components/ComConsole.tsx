'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, API_ORIGIN, apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';

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
}

export default function ComConsole() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Alert | null>(null);
  const { can } = useSession();

  useEffect(() => {
    let socket: Socket | null = null;
    (async () => {
      try {
        const data = await apiFetch<Alert[]>('/com/alerts');
        setAlerts(data ?? []);
      } catch (e: any) { setError(e.message); }
    })();
    socket = io(`${API_ORIGIN}/com`, {
      auth: (cb: (d: object) => void) => { api.freshAccessToken().then((token) => cb({ token })).catch(() => cb({})); },
      transports: ['websocket'],
    });
    socket.on('panic.alert', (ev: any) => {
      setAlerts((prev) => [ev.data ?? ev, ...prev]);
    });
    return () => { socket?.disconnect(); };
  }, []);

  async function ack(id: string) {
    await apiFetch(`/com/alerts/${id}/ack`, { method: 'POST' });
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'ACKNOWLEDGED' } : a)));
  }
  async function units(id: string) {
    await apiFetch(`/com/alerts/${id}/units-dispatched`, { method: 'POST' });
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'UNITS_DISPATCHED' } : a)));
  }
  async function resolve(id: string) {
    const notes = prompt('Notas de resolución:');
    await apiFetch(`/com/alerts/${id}/resolve`, { method: 'POST', body: JSON.stringify({ notes }) });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    setSelected(null);
  }

  return (
    <div className="flex flex-1 gap-4 min-h-0">
      <div className="card w-[420px] flex-none overflow-auto flex flex-col gap-3">
        <h3 className="text-[16px] font-bold text-[#0A3A3C]">Alertas activas ({alerts.length})</h3>
        {error && <div className="text-[13px] font-semibold text-[#A31F1F]">{error}</div>}
        {alerts.length === 0 && <div className="text-[14px] text-[#34454D]">Sin alertas activas.</div>}
        {alerts.map((a) => (
          <button key={a.id} onClick={() => setSelected(a)}
            className={`text-left rounded-[10px] border-2 p-3 ${selected?.id === a.id ? 'border-[#B3261E] bg-[#FDECEA]' : 'border-[#C9D3D8] bg-white'}`}>
            <div className="text-[15px] font-bold text-[#0A3A3C]">{a.snapshot?.passengerName ?? 'Pasajero'}</div>
            <div className="text-[13px] text-[#34454D]">{a.status} · {a.raised_by}</div>
            <div className="text-[12px] text-[#34454D]">{new Date(a.occurred_at).toLocaleString()}</div>
          </button>
        ))}
      </div>
      <div className="card flex-1 overflow-auto">
        {!selected ? (
          <div className="text-[14px] text-[#34454D]">Seleccioná una alerta para ver el detalle.</div>
        ) : (
          <div className="flex flex-col gap-3">
            <h3 className="text-[16px] font-bold text-[#0A3A3C]">Detalle de alerta</h3>
            <div><b>Pasajero:</b> {selected.snapshot?.passengerName ?? '—'}</div>
            <div><b>Chofer:</b> {selected.driver_first_name} {selected.driver_last_name}</div>
            <div><b>Móvil:</b> {selected.vehicle_plate}</div>
            <div><b>Viaje:</b> {selected.trip_public_code ?? selected.id}</div>
            <div><b>Estado:</b> {selected.status}</div>
            <div><b>Ocurrió:</b> {new Date(selected.occurred_at).toLocaleString()}</div>
            {can('com.alerts.act') ? (
              <div className="flex gap-2 mt-2">
                <button onClick={() => ack(selected.id)} className="btn h-9 bg-[#B3261E] text-[13px]">Atender</button>
                <button onClick={() => units(selected.id)} className="bo h-9 text-[13px]">Despachar móvil</button>
                <button onClick={() => resolve(selected.id)} className="bo h-9 text-[13px]">Resolver</button>
              </div>
            ) : (
              <div className="mt-2 text-[13px] text-[#5B6B72]">Solo lectura: atender y resolver alertas es tarea del Operador COM.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}