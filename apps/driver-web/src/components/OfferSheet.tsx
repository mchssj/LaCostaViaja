'use client';

import { useEffect, useState } from 'react';
import { distancia, duracion, metrosEntre, pesos, regresiva, texto, type CurrentOffer } from '@lacosta/driver-core';

/** Oferta a pantalla completa con cuenta regresiva. Al vencer se cierra sola (la API la reasigna). */
export default function OfferSheet({
  offer,
  busy,
  error,
  onAccept,
  onReject,
  onExpired,
}: {
  offer: CurrentOffer;
  busy: boolean;
  error: string | null;
  onAccept: () => void;
  onReject: () => void;
  onExpired: () => void;
}) {
  const deadline = Date.parse(offer.expires_at);
  const [left, setLeft] = useState(deadline - Date.now());
  const [total] = useState(Math.max(1, deadline - Date.now()));

  useEffect(() => {
    const t = setInterval(() => {
      const l = deadline - Date.now();
      setLeft(l);
      if (l <= 0) {
        clearInterval(t);
        onExpired();
      }
    }, 250);
    return () => clearInterval(t);
  }, [deadline, onExpired]);

  const tripMeters = metrosEntre({ lat: offer.origin_lat, lng: offer.origin_lng }, { lat: offer.destination_lat, lng: offer.destination_lng });

  return (
    <div className="fixed inset-0 z-[2000] flex flex-col bg-[#0A3A3C]/60 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Nueva oferta de viaje">
      <div className="mt-auto flex max-h-[100dvh] flex-col gap-4 overflow-auto rounded-t-[22px] bg-white p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-bold uppercase tracking-wide text-[#0F6B72]">Nuevo viaje · {texto('service', offer.service_type)}</span>
          <span className={`text-[22px] font-bold tabular-nums ${left < 5_000 ? 'text-[#A31F1F]' : 'text-[#0A3A3C]'}`}>{regresiva(left)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#E3EAEC]">
          <div className={`h-full transition-[width] duration-200 ${left < 5_000 ? 'bg-[#B3261E]' : 'bg-[#0F6B72]'}`} style={{ width: `${Math.max(0, (left / total) * 100)}%` }} />
        </div>

        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[34px] font-bold leading-none">{pesos(offer.quoted_fare_cents, true)}</div>
            <div className="muted mt-1">
              {texto('scope', offer.scope)} · {distancia(tripMeters)} de viaje
            </div>
          </div>
          <div className="text-right">
            <div className="text-[22px] font-bold leading-none">{duracion(offer.eta_seconds)}</div>
            <div className="muted mt-1">hasta el pasajero</div>
          </div>
        </div>

        {offer.backhaul_match && offer.backhaul_match !== 'NONE' && (
          <div className="ok">🏠 Viaje de Vuelta: te deja cerca de tu base.</div>
        )}

        <ol className="flex flex-col gap-3 rounded-[14px] bg-[#F4F8F8] p-3">
          <li className="flex gap-3">
            <span className="pin h-7 w-7 flex-none bg-[#0F6B72] text-[13px] text-white">A</span>
            <div>
              <div className="lbl">Buscar en</div>
              <div className="text-[16px] font-semibold">{offer.origin_address || `${offer.origin_lat.toFixed(5)}, ${offer.origin_lng.toFixed(5)}`}</div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="pin h-7 w-7 flex-none bg-[#B3261E] text-[13px] text-white">B</span>
            <div>
              <div className="lbl">Destino</div>
              <div className="text-[16px] font-semibold">{offer.destination_address || `${offer.destination_lat.toFixed(5)}, ${offer.destination_lng.toFixed(5)}`}</div>
            </div>
          </li>
        </ol>

        {error && <div className="err" role="alert">{error}</div>}

        <div className="grid grid-cols-[1fr_2fr] gap-3">
          <button className="btn-danger" onClick={onReject} disabled={busy}>Rechazar</button>
          <button className="btn min-h-[60px] text-[19px]" onClick={onAccept} disabled={busy || left <= 0}>{busy ? 'Aceptando…' : 'Aceptar viaje'}</button>
        </div>
      </div>
    </div>
  );
}
