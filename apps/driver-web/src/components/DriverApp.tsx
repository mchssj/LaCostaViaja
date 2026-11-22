'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { io } from 'socket.io-client';
import {
  ApiError,
  PingBuffer,
  connectRealtime,
  uuid,
  type CurrentOffer,
  type DriverAction,
  type DriverProfile,
  type DriverState,
  type DriverVehicle,
  type IoFactory,
  type Ping,
  type RealtimeConnection,
  type TripView,
} from '@lacosta/driver-core';
import { api, DEV_TOOLS, driverApi, hasSession, setSessionExpiredHandler } from '@/lib/client';
import { useLocation, type GpsMode } from '@/lib/useLocation';
import Login from './Login';
import VehiclePicker from './VehiclePicker';
import OfferSheet from './OfferSheet';
import TripPanel from './TripPanel';
import PanicButton from './PanicButton';
import DevTools from './DevTools';
import MapBoundary from './MapBoundary';

const TripMap = dynamic(() => import('./TripMap'), { ssr: false, loading: () => <div className="h-full w-full bg-[#E3EAEC]" /> });

const SAN_BERNARDO = { lat: -36.6875, lng: -56.68 };
const FLUSH_MS = 5_000;
const FALLBACK_POLL_MS = 8_000;

type Phase = 'loading' | 'login' | 'app';

export default function DriverApp() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [vehicles, setVehicles] = useState<DriverVehicle[]>([]);
  const [state, setState] = useState<DriverState>({ status: 'OFFLINE' });
  const [offer, setOffer] = useState<CurrentOffer | null>(null);
  const [trip, setTrip] = useState<TripView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [gpsMode, setGpsMode] = useState<GpsMode>(DEV_TOOLS ? 'simulated' : 'real');
  const [simStart, setSimStart] = useState(SAN_BERNARDO);

  const buffer = useRef(new PingBuffer({ batchSize: 50 }));
  const rt = useRef<RealtimeConnection | null>(null);
  const tripRef = useRef<TripView | null>(null);
  tripRef.current = trip;
  const offerRef = useRef<CurrentOffer | null>(null);
  offerRef.current = offer;

  const onShift = state.status !== 'OFFLINE';
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  // ------------------------------------------------------------------ sesión
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setPhase('login');
      setNotice('Tu sesión venció. Ingresá de nuevo.');
    });
    setPhase(hasSession() ? 'app' : 'login');
  }, []);

  // ------------------------------------------------------------------ carga y sincronización
  const loadTrip = useCallback(async (id: string) => {
    const t = await driverApi.trip(id);
    setTrip(t);
    rt.current?.follow(t.id, t.last_seq);
    return t;
  }, []);

  const refresh = useCallback(async () => {
    const s = await driverApi.state();
    setState(s);
    if (s.tripId) {
      if (tripRef.current?.id !== s.tripId || !tripRef.current) await loadTrip(s.tripId);
    }
    if (s.status === 'OFFERED') {
      const o = await driverApi.currentOffer();
      setOffer(o);
    } else if (offerRef.current) {
      setOffer(null);
    }
  }, [loadTrip]);

  useEffect(() => {
    if (phase !== 'app') return;
    (async () => {
      try {
        const [p, v] = await Promise.all([driverApi.me(), driverApi.vehicles()]);
        setProfile(p);
        setVehicles(v);
        await refresh();
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setPhase('login');
        else fail(e);
      }
    })();
  }, [phase, refresh]);

  // Socket: ofertas, cambios del viaje y cancelaciones.
  useEffect(() => {
    if (phase !== 'app') return;
    const conn = connectRealtime(io as unknown as IoFactory, api, 'driver', {
      onConnectionChange: setConnected,
      onOffer: () => {
        driverApi
          .currentOffer()
          .then((o) => {
            if (!o) return;
            setOffer(o);
            if ('vibrate' in navigator) navigator.vibrate?.([300, 150, 300]);
          })
          .catch(() => undefined);
      },
      onOfferClosed: (m) => {
        if (offerRef.current?.offer_id === m.data.offerId) {
          setOffer(null);
          if (m.data.outcome === 'EXPIRED') setNotice('La oferta venció y pasó a otro chofer.');
          if (m.data.outcome === 'CANCELLED') setNotice('El pasajero canceló antes de que aceptaras.');
        }
      },
      onTripEvent: (m) => {
        if (tripRef.current?.id === m.tripId) loadTrip(m.tripId).catch(() => undefined);
      },
      onTripCancelled: (m) => {
        if (tripRef.current?.id === m.tripId) {
          loadTrip(m.tripId).catch(() => undefined);
          setNotice(m.data.reason ? `Viaje cancelado: ${m.data.reason}` : 'El viaje fue cancelado.');
        }
        refresh().catch(() => undefined);
      },
    });
    rt.current = conn;
    if (tripRef.current) conn.follow(tripRef.current.id, tripRef.current.last_seq);
    return () => {
      conn.close();
      rt.current = null;
    };
  }, [phase, loadTrip, refresh]);

  // Respaldo sin socket: consulta el estado cada 8 s.
  useEffect(() => {
    if (phase !== 'app' || connected) return;
    const t = setInterval(() => refresh().catch(() => undefined), FALLBACK_POLL_MS);
    return () => clearInterval(t);
  }, [phase, connected, refresh]);

  // ------------------------------------------------------------------ GPS
  const simTarget = useMemo(() => {
    if (!trip) return null;
    if (['ASSIGNED', 'DRIVER_EN_ROUTE'].includes(trip.status)) return trip.origin;
    if (trip.status === 'DRIVER_ARRIVED') return null;
    if (trip.status === 'IN_PROGRESS') return trip.destination;
    return null;
  }, [trip]);

  const onShiftRef = useRef(onShift);
  onShiftRef.current = onShift;
  const location = useLocation({
    enabled: phase === 'app',
    mode: gpsMode,
    simStart,
    simTarget,
    onPing: (p: Ping) => {
      if (onShiftRef.current) buffer.current.add(p);
    },
  });

  const flush = useCallback(async () => {
    await buffer.current.flush((pings) =>
      driverApi.positions(pings).catch((e: unknown) => {
        // Turno cerrado del lado de la API (reinicio, vencimiento): se resincroniza.
        if (e instanceof ApiError && e.status === 409) refresh().catch(() => undefined);
        throw e;
      }),
    );
  }, [refresh]);

  useEffect(() => {
    if (!onShift) return;
    const t = setInterval(() => flush().catch(() => undefined), FLUSH_MS);
    return () => clearInterval(t);
  }, [onShift, flush]);

  // ------------------------------------------------------------------ acciones
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      fail(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const startShift = (v: DriverVehicle) =>
    run(async () => {
      await driverApi.startShift(v.vehicle_id);
      // Primera posición: sin ella el despacho no lo ve.
      if (location.position) buffer.current.add({ ...location.position, recordedAt: Date.now() });
      await flush();
      await refresh();
      if (!location.position) setNotice('Turno iniciado, pero todavía no tenemos tu ubicación: no vas a recibir ofertas hasta que el GPS responda.');
    });

  const endShift = () =>
    run(async () => {
      await driverApi.endShift();
      setOffer(null);
      await refresh();
    });

  const accept = () =>
    run(async () => {
      const o = offerRef.current;
      if (!o) return;
      try {
        await driverApi.accept(o.offer_id, o.trip_id);
      } finally {
        setOffer(null);
      }
      await loadTrip(o.trip_id);
      await refresh();
    });

  const reject = () =>
    run(async () => {
      const o = offerRef.current;
      if (!o) return;
      setOffer(null);
      await driverApi.reject(o.offer_id, o.trip_id);
    });

  const here = location.position ? { lat: location.position.lat, lng: location.position.lng } : undefined;

  const doAction = (a: DriverAction) =>
    run(async () => {
      const t = tripRef.current;
      if (!t) return;
      await flush().catch(() => undefined); // que la API tenga la última posición antes de la transición
      if (a.key === 'arrived') await driverApi.arrived(t.id, here);
      if (a.key === 'start') await driverApi.start(t.id, here);
      if (a.key === 'complete') await driverApi.complete(t.id, here);
      if (a.key === 'noShow') await driverApi.noShow(t.id, here);
      if (a.key === 'withdraw') await driverApi.withdraw(t.id);
      await loadTrip(t.id);
      await refresh();
    });

  const confirmCash = () =>
    run(async () => {
      const t = tripRef.current;
      if (!t) return;
      await driverApi.confirmCash(t.id);
      await loadTrip(t.id);
    });

  const closeTrip = () => {
    setTrip(null);
    setError(null);
    refresh().catch(fail);
  };

  const panic = async () => {
    const pos = location.position;
    if (!pos) throw new Error('No tenemos tu ubicación.');
    await driverApi.panic({
      clientEventId: uuid(),
      location: { lat: pos.lat, lng: pos.lng },
      ...(pos.accuracyM !== undefined ? { accuracyM: pos.accuracyM } : {}),
      tripId: tripRef.current?.id ?? null,
      channel: 'APP',
    });
    await flush().catch(() => undefined);
  };

  const logout = async () => {
    if (onShift && !window.confirm('Tenés el turno abierto. ¿Cerrarlo y salir?')) return;
    if (onShift) await driverApi.endShift().catch(() => undefined);
    await driverApi.logout();
    setProfile(null);
    setTrip(null);
    setOffer(null);
    setState({ status: 'OFFLINE' });
    setPhase('login');
  };

  // ------------------------------------------------------------------ render
  if (phase === 'loading') return <main className="flex min-h-[100dvh] items-center justify-center muted">Cargando…</main>;
  if (phase === 'login')
    return (
      <>
        {notice && <div className="fixed inset-x-4 top-4 z-50 ok">{notice}</div>}
        <Login
          onDone={() => {
            setNotice(null);
            setPhase('app');
          }}
        />
      </>
    );

  const vehicle = vehicles.find((v) => v.vehicle_id === state.vehicleId);
  const activeTrip = trip;
  const car = location.position ? { lat: location.position.lat, lng: location.position.lng } : null;
  // Puntos a encuadrar además del auto: el próximo objetivo del viaje.
  const focus = activeTrip ? [['IN_PROGRESS', 'COMPLETED'].includes(activeTrip.status) ? activeTrip.destination : activeTrip.origin] : [];

  const statusChip = !onShift
    ? { text: 'Fuera de turno', cls: 'bg-[#EEF2F3] text-[#4F5F67]' }
    : activeTrip && !['COMPLETED'].includes(activeTrip.status)
      ? { text: 'En viaje', cls: 'bg-[#E6F0FA] text-[#1D4F86]' }
      : state.status === 'RETURNING'
        ? { text: 'Disponible · volviendo a base', cls: 'bg-[#E3F4E8] text-[#1B6B35]' }
        : { text: 'Disponible', cls: 'bg-[#E3F4E8] text-[#1B6B35]' };

  return (
    <main className="flex h-[100dvh] flex-col">
      {/* Encabezado */}
      <header className="flex flex-none items-center justify-between gap-2 border-b-2 border-[#C9D3D8] bg-white px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[16px] font-bold">{profile ? `${profile.first_name} ${profile.last_name}` : '…'}</div>
          <div className="flex items-center gap-2 text-[12px] text-[#5B6B72]">
            <span className={`chip ${statusChip.cls}`}>{statusChip.text}</span>
            {vehicle && <span className="font-mono font-bold">{vehicle.plate}</span>}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2 text-[12px]">
          <span title={connected ? 'Conectado en tiempo real' : 'Sin conexión en tiempo real (se consulta cada 8 s)'} className={`chip ${connected ? 'bg-[#E3F4E8] text-[#1B6B35]' : 'bg-[#FFF4DB] text-[#7A5300]'}`}>
            {connected ? '● En línea' : '○ Reconectando'}
          </span>
          <button onClick={logout} className="rounded-[8px] px-2 py-1 font-bold text-[#0F6B72]">Salir</button>
        </div>
      </header>

      {/* Mapa */}
      <div className="relative min-h-[180px] flex-1">
        <MapBoundary>
          {(attempt) => <TripMap key={attempt} car={car} origin={activeTrip?.origin} destination={activeTrip?.destination} focus={focus} />}
        </MapBoundary>
        <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-col gap-1">
          <span className={`chip pointer-events-auto shadow ${location.error ? 'bg-[#FDECEA] text-[#A31F1F]' : location.position ? 'bg-white text-[#0A3A3C]' : 'bg-[#FFF4DB] text-[#7A5300]'}`}>
            {location.error
              ? '⚠ Sin GPS'
              : location.position
                ? `📍 GPS ${gpsMode === 'simulated' ? 'simulado' : `±${location.position.accuracyM ?? '?'} m`}`
                : '📍 Buscando GPS…'}
          </span>
          {onShift && buffer.current.lastError && <span className="chip bg-[#FFF4DB] text-[#7A5300] shadow">Posiciones pendientes de envío: {buffer.current.size}</span>}
        </div>
      </div>

      {/* Panel inferior */}
      <section className="max-h-[62dvh] flex-none overflow-auto rounded-t-[20px] border-t-2 border-[#C9D3D8] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,.06)]">
        <div className="flex flex-col gap-3">
          {location.error && <div className="err">{location.error}</div>}
          {notice && (
            <button className="ok text-left" onClick={() => setNotice(null)}>
              {notice} <span className="font-normal">(tocar para cerrar)</span>
            </button>
          )}

          {activeTrip ? (
            <TripPanel trip={activeTrip} busy={busy} error={error} onAction={doAction} onConfirmCash={confirmCash} onClose={closeTrip} />
          ) : onShift ? (
            <>
              <div className="card flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0F6B72] opacity-60" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-[#0F6B72]" />
                </span>
                <div>
                  <div className="text-[17px] font-bold">Esperando viajes</div>
                  <div className="muted">Te avisamos con sonido y vibración cuando llegue una oferta.</div>
                </div>
              </div>
              {error && <div className="err">{error}</div>}
              <button className="btn-outline" onClick={endShift} disabled={busy}>{busy ? 'Cerrando…' : 'Cerrar turno'}</button>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-[19px] font-bold">Iniciar turno</h2>
                <p className="muted">Elegí el vehículo con el que vas a trabajar.</p>
              </div>
              {error && <div className="err">{error}</div>}
              <VehiclePicker vehicles={vehicles} busy={busy} onPick={startShift} />
            </>
          )}

          {onShift && <PanicButton onTrigger={panic} />}
          {DEV_TOOLS && <DevTools mode={gpsMode} setMode={setGpsMode} simStart={simStart} setSimStart={setSimStart} position={car} />}
        </div>
      </section>

      {offer && !activeTrip && (
        <OfferSheet
          offer={offer}
          busy={busy}
          error={error}
          onAccept={accept}
          onReject={reject}
          onExpired={() => {
            setOffer(null);
            setNotice('La oferta venció y pasó a otro chofer.');
          }}
        />
      )}
    </main>
  );
}
