'use client';

import { motivoBloqueo, texto, type DriverVehicle } from '@lacosta/driver-core';

/** Lista de vehículos autorizados. Los no elegibles se muestran con el motivo y no se pueden elegir. */
export default function VehiclePicker({ vehicles, busy, onPick }: { vehicles: DriverVehicle[]; busy: boolean; onPick: (v: DriverVehicle) => void }) {
  if (vehicles.length === 0) {
    return <div className="card muted">No tenés vehículos autorizados. Consultá con tu agencia o con la Dirección de Transporte.</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      {vehicles.map((v) => (
        <button
          key={v.vehicle_id}
          type="button"
          disabled={!v.is_eligible || busy}
          onClick={() => onPick(v)}
          className={`card flex w-full flex-col gap-2 text-left ${v.is_eligible ? 'active:border-[#0F6B72]' : 'opacity-80'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-[6px] border-2 border-[#0A3A3C] px-2 py-0.5 font-mono text-[16px] font-bold tracking-wider">{v.plate}</span>
            <span className={`chip ${v.service_type === 'TAXI' ? 'bg-[#FFF4DB] text-[#7A5300]' : 'bg-[#E6F0FA] text-[#1D4F86]'}`}>{texto('service', v.service_type)}</span>
          </div>
          <div className="text-[15px] font-semibold">
            {v.make} {v.model} {v.model_year ?? ''} {v.color ? `· ${v.color}` : ''}
          </div>
          {v.agency_name && <div className="muted">{v.agency_name}</div>}
          {v.is_eligible ? (
            <div className="text-[14px] font-bold text-[#0F6B72]">Iniciar turno con este vehículo →</div>
          ) : (
            <ul className="flex flex-col gap-1 text-[13px] font-semibold text-[#A31F1F]">
              {v.blocking_reasons.map((r) => (
                <li key={r}>• {motivoBloqueo(r)}</li>
              ))}
            </ul>
          )}
        </button>
      ))}
    </div>
  );
}
