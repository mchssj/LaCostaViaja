'use client';

import { useState } from 'react';
import {
  PASSENGER_STEPS,
  passengerCanCancel,
  passengerStatusText,
  passengerStep,
  pesos,
  texto,
  type TripView,
} from '@lacosta/driver-core';
import PanicButton from './PanicButton';

/** Seguimiento del viaje: pasos, chofer y móvil, cancelación, pago y calificación. */
export default function Tracking({
  trip,
  busy,
  error,
  onCancel,
  onRetry,
  onPay,
  onRate,
  onNew,
  onPanic,
}: {
  trip: TripView;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onRetry: () => void;
  onPay: () => void;
  onRate: (stars: number) => void;
  onNew: () => void;
  onPanic: () => Promise<void>;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [stars, setStars] = useState(0);
  const step = passengerStep(trip.status);
  const finished = trip.status === 'COMPLETED';
  const failed = step === -1;
  const searching = step === 0;
  const onlinePay = trip.payment_method !== 'CASH';
  const paid = trip.payment_status === 'PAID';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold uppercase tracking-wide text-[#0F6B72]">
          Viaje {trip.public_code} · {texto('service', trip.service_type)}
        </span>
        <span className="text-[18px] font-bold">{pesos(trip.final_fare_cents ?? trip.quoted_fare_cents, true)}</span>
      </div>
      <div className="text-[21px] font-bold leading-tight" aria-live="polite">
        {passengerStatusText(trip.status)}
      </div>

      {!failed && (
        <ol className="grid grid-cols-5 gap-1" aria-label="Avance del viaje">
          {PASSENGER_STEPS.map((s, i) => (
            <li key={s.key} className="flex flex-col items-center gap-1 text-center">
              <span className={`h-2 w-full rounded-full ${i <= step ? 'bg-[#0F6B72]' : 'bg-[#E3EAEC]'} ${i === step && !finished ? 'animate-pulse' : ''}`} />
              <span className={`text-[11px] leading-tight ${i === step ? 'font-bold text-[#0A3A3C]' : 'text-[#5B6B72]'}`}>{s.label}</span>
            </li>
          ))}
        </ol>
      )}

      {trip.driver && trip.vehicle && !failed && (
        <div className="card flex items-center gap-3">
          <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-[#E6F4F5] text-[22px]">🚕</div>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold">
              {trip.driver.first_name} {trip.driver.last_name}
            </div>
            <div className="muted">
              {trip.vehicle.make} {trip.vehicle.model} {trip.vehicle.color ? `· ${trip.vehicle.color}` : ''}
            </div>
          </div>
          <span className="flex-none rounded-[6px] border-2 border-[#0A3A3C] px-2 py-0.5 font-mono text-[16px] font-bold tracking-wider">{trip.vehicle.plate}</span>
        </div>
      )}

      {searching && <div className="muted">Esto suele tardar menos de un minuto. Podés cancelar sin costo mientras buscamos.</div>}

      {finished && (
        <>
          <div className="card flex items-end justify-between">
            <div>
              <div className="lbl">Total del viaje</div>
              <div className="text-[30px] font-bold leading-none">{pesos(trip.final_fare_cents ?? trip.quoted_fare_cents)}</div>
              {trip.final_fare_cents !== null && trip.final_fare_cents !== trip.quoted_fare_cents && <div className="muted mt-1">Cotizado: {pesos(trip.quoted_fare_cents)}</div>}
            </div>
            <span className={`chip ${paid ? 'bg-[#E3F4E8] text-[#1B6B35]' : 'bg-[#FFF4DB] text-[#7A5300]'}`}>{texto('paymentStatus', trip.payment_status)}</span>
          </div>
          {onlinePay && !paid && (
            <button className="btn" onClick={onPay} disabled={busy}>
              {busy ? 'Generando pago…' : 'Pagar con Mercado Pago'}
            </button>
          )}
          {!onlinePay && !paid && <div className="muted">Pagás en efectivo al chofer.</div>}

          {trip.passenger_rating ? (
            <div className="ok">¡Gracias por calificar el viaje con {trip.passenger_rating} ★!</div>
          ) : (
            <div className="card flex flex-col gap-2">
              <div className="lbl">¿Cómo fue el viaje?</div>
              <div className="flex justify-between" role="radiogroup" aria-label="Calificación de 1 a 5 estrellas">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={stars === n}
                    aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                    className={`h-12 w-12 text-[30px] ${n <= stars ? 'text-[#E0A800]' : 'text-[#C9D3D8]'}`}
                    onClick={() => setStars(n)}
                  >
                    ★
                  </button>
                ))}
              </div>
              <button className="btn-outline" disabled={!stars || busy} onClick={() => onRate(stars)}>Enviar calificación</button>
            </div>
          )}
        </>
      )}

      {error && <div className="err" role="alert">{error}</div>}

      {trip.status === 'NO_DRIVER_AVAILABLE' && <button className="btn" onClick={onRetry} disabled={busy}>Volver a pedir</button>}
      {(finished || failed) && <button className={finished ? 'btn-outline' : 'btn-outline'} onClick={onNew}>Pedir otro viaje</button>}

      {passengerCanCancel(trip.status) &&
        (confirmCancel ? (
          <div className="flex flex-col gap-2 rounded-[14px] border-2 border-[#A31F1F] bg-[#FDECEA] p-3">
            <div className="text-[15px] font-bold text-[#A31F1F]">¿Cancelar el viaje?</div>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-outline min-h-[44px]" onClick={() => setConfirmCancel(false)}>No</button>
              <button
                className="btn min-h-[44px] bg-[#A31F1F]"
                disabled={busy}
                onClick={() => {
                  setConfirmCancel(false);
                  onCancel();
                }}
              >
                Sí, cancelar
              </button>
            </div>
          </div>
        ) : (
          <button className="btn-danger" onClick={() => setConfirmCancel(true)} disabled={busy}>Cancelar viaje</button>
        ))}

      {!finished && !failed && <PanicButton onTrigger={onPanic} />}
    </div>
  );
}
