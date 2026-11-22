'use client';

import { useEffect, useState } from 'react';
import { driverActions, driverStatusText, pesos, regresiva, texto, type DriverAction, type TripView } from '@lacosta/driver-core';

function mapsLink(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving`;
}
function wazeLink(p: { lat: number; lng: number }): string {
  return `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`;
}

/** Panel inferior del viaje: estado, direcciones, navegación y la acción que corresponde. */
export default function TripPanel({
  trip,
  busy,
  error,
  onAction,
  onConfirmCash,
  onClose,
}: {
  trip: TripView;
  busy: boolean;
  error: string | null;
  onAction: (a: DriverAction) => void;
  onConfirmCash: () => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [pending, setPending] = useState<DriverAction | null>(null);
  // Si el viaje cambia de estado (por ejemplo, lo canceló el pasajero), se descarta la confirmación.
  useEffect(() => setPending(null), [trip.status]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  const actions = driverActions(trip, now);
  const goingToPickup = trip.status === 'ASSIGNED' || trip.status === 'DRIVER_EN_ROUTE' || trip.status === 'DRIVER_ARRIVED';
  const target = goingToPickup ? trip.origin : trip.destination;
  const finished = trip.status === 'COMPLETED';
  const closed = finished || trip.status.startsWith('CANCELLED') || trip.status === 'NO_DRIVER_AVAILABLE' || trip.status === 'SEARCHING';

  if (closed) {
    const paid = trip.payment_status === 'PAID';
    const cash = trip.payment_method === 'CASH';
    return (
      <div className="flex flex-col gap-4">
        <div className="text-[13px] font-bold uppercase tracking-wide text-[#0F6B72]">Viaje {trip.public_code}</div>
        <div className="text-[20px] font-bold">{driverStatusText(trip.status)}</div>
        {finished && (
          <>
            <div className="card flex items-end justify-between">
              <div>
                <div className="lbl">Total a cobrar</div>
                <div className="text-[32px] font-bold leading-none">{pesos(trip.final_fare_cents ?? trip.quoted_fare_cents)}</div>
                {trip.final_fare_cents !== null && trip.final_fare_cents !== trip.quoted_fare_cents && (
                  <div className="muted mt-1">Cotizado: {pesos(trip.quoted_fare_cents)}</div>
                )}
              </div>
              <span className={`chip ${paid ? 'bg-[#E3F4E8] text-[#1B6B35]' : 'bg-[#FFF4DB] text-[#7A5300]'}`}>{texto('paymentStatus', trip.payment_status)}</span>
            </div>
            <div className="muted">Forma de pago: <b>{texto('payment', trip.payment_method)}</b></div>
            {cash && !paid && (
              <button className="btn" onClick={onConfirmCash} disabled={busy}>{busy ? 'Registrando…' : 'Cobré en efectivo'}</button>
            )}
            {!cash && !paid && <div className="muted">El pasajero paga desde su teléfono. Vas a ver el pago acreditado acá.</div>}
          </>
        )}
        {error && <div className="err" role="alert">{error}</div>}
        <button className={finished && cash && !paid ? 'btn-outline' : 'btn'} onClick={onClose}>Volver a recibir viajes</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold uppercase tracking-wide text-[#0F6B72]">
          Viaje {trip.public_code} · {texto('service', trip.service_type)}
        </span>
        <span className="text-[18px] font-bold">{pesos(trip.quoted_fare_cents, true)}</span>
      </div>
      <div className="text-[20px] font-bold leading-tight">{driverStatusText(trip.status)}</div>

      <div className="flex gap-3 rounded-[14px] bg-[#F4F8F8] p-3">
        <span className={`pin h-7 w-7 flex-none text-[13px] text-white ${goingToPickup ? 'bg-[#0F6B72]' : 'bg-[#B3261E]'}`}>{goingToPickup ? 'A' : 'B'}</span>
        <div className="min-w-0">
          <div className="lbl">{goingToPickup ? 'Punto de encuentro' : 'Destino'}</div>
          <div className="text-[16px] font-semibold">{target.address || target.locality}</div>
          {target.address && <div className="muted">{target.locality}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <a className="btn-outline min-h-[44px] text-[15px]" href={mapsLink(target)} target="_blank" rel="noreferrer">Google Maps</a>
        <a className="btn-outline min-h-[44px] text-[15px]" href={wazeLink(target)} target="_blank" rel="noreferrer">Waze</a>
      </div>

      {error && <div className="err" role="alert">{error}</div>}

      {pending ? (
        <div className="flex flex-col gap-2 rounded-[14px] border-2 border-[#0F6B72] bg-[#E6F4F5] p-3" role="alertdialog" aria-label={pending.confirm}>
          <div className="text-[16px] font-bold">{pending.confirm}</div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-outline" onClick={() => setPending(null)} disabled={busy}>No</button>
            <button
              className={pending.tone === 'danger' ? 'btn bg-[#A31F1F]' : 'btn'}
              disabled={busy}
              onClick={() => {
                const a = pending;
                setPending(null);
                onAction(a);
              }}
            >
              Sí, confirmar
            </button>
          </div>
        </div>
      ) : (
        actions.map((a) => (
          <button
            key={a.key}
            className={a.tone === 'primary' ? 'btn min-h-[58px] text-[18px]' : a.tone === 'danger' ? 'btn-danger' : 'btn-outline'}
            disabled={busy || a.availableInMs !== undefined}
            onClick={() => (a.confirm ? setPending(a) : onAction(a))}
          >
            {busy && a.tone === 'primary' ? 'Enviando…' : a.label}
            {a.availableInMs !== undefined && <span className="font-semibold tabular-nums"> (en {regresiva(a.availableInMs)})</span>}
          </button>
        ))
      )}
    </div>
  );
}
