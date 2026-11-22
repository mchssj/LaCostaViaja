'use client';

import { useEffect, useRef, useState } from 'react';
import { simulatedPosition, type Ping } from '@lacosta/driver-core';

export type GpsMode = 'real' | 'simulated';

export interface LocationState {
  readonly position: Ping | null;
  readonly error: string | null;
  readonly mode: GpsMode;
}

/**
 * Ubicación del chofer. En modo real usa watchPosition; en modo simulado mueve el auto en línea
 * recta hacia `simTarget` (útil para probar en la computadora). Llama a `onPing` con cada punto.
 */
export function useLocation(opts: {
  enabled: boolean;
  mode: GpsMode;
  simStart: { lat: number; lng: number };
  simTarget: { lat: number; lng: number } | null;
  onPing: (p: Ping) => void;
}): LocationState {
  const [position, setPosition] = useState<Ping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onPing = useRef(opts.onPing);
  onPing.current = opts.onPing;
  const lastRef = useRef<Ping | null>(null);

  const emit = (p: Ping) => {
    lastRef.current = p;
    setPosition(p);
    onPing.current(p);
  };

  // GPS real
  useEffect(() => {
    if (!opts.enabled || opts.mode !== 'real') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Este dispositivo no tiene GPS disponible en el navegador.');
      return;
    }
    setError(null);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setError(null);
        emit({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          recordedAt: pos.timestamp || Date.now(),
          accuracyM: Math.round(pos.coords.accuracy),
          ...(pos.coords.speed !== null && pos.coords.speed >= 0 ? { speedKmh: Math.round(pos.coords.speed * 3.6) } : {}),
          ...(pos.coords.heading !== null && !Number.isNaN(pos.coords.heading) ? { headingDeg: Math.round(pos.coords.heading) } : {}),
        });
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Permití el acceso a la ubicación para recibir viajes.'
            : err.code === err.TIMEOUT
              ? 'El GPS tarda en responder. Revisá que la ubicación esté activada.'
              : 'No se pudo obtener la ubicación.',
        );
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.mode]);

  // GPS simulado: cada 2 s avanza hacia el objetivo (o se queda quieto si no hay).
  const targetKey = opts.simTarget ? `${opts.simTarget.lat},${opts.simTarget.lng}` : 'none';
  const startKey = `${opts.simStart.lat},${opts.simStart.lng}`;
  const lastStartKey = useRef(startKey);
  useEffect(() => {
    if (!opts.enabled || opts.mode !== 'simulated') return;
    setError(null);
    // Si se eligió otro punto de partida, el auto "salta" ahí; si no, sigue desde donde estaba.
    const restart = lastStartKey.current !== startKey;
    lastStartKey.current = startKey;
    const from = (!restart && lastRef.current) || { ...opts.simStart, recordedAt: Date.now() };
    const to = opts.simTarget ?? from;
    const startedAt = Date.now();
    const tick = () => emit(simulatedPosition(from, to, startedAt, Date.now(), 40));
    tick();
    const t = setInterval(tick, 2_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.mode, targetKey, startKey]);

  return { position, error, mode: opts.mode };
}
