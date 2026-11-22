'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { io } from 'socket.io-client';
import {
  ApiError,
  connectRealtime,
  isOpen,
  pesos,
  regresiva,
  texto,
  uuid,
  type IoFactory,
  type PaymentMethod,
  type Point,
  type Quote,
  type RealtimeConnection,
  type ServiceType,
  type TripView,
} from '@lacosta/driver-core';
import { api, clearTripId, DEV_TOOLS, extractQrCode, hasSession, passengerApi, savedTripId, saveTripId, setSessionExpiredHandler } from '@/lib/client';
import Tracking from './Tracking';
import MapBoundary from './MapBoundary';

const PickMap = dynamic(() => import('./PickMap'), { ssr: false, loading: () => <div className="h-full w-full bg-[#E3EAEC]" /> });
const QrScanner = dynamic(() => import('./QrScanner'), { ssr: false });

type Step = 'loading' | 'entry' | 'request' | 'quote' | 'tracking';
type Picking = 'origin' | 'destination';

const fmt = (p: Point) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

export default function GuestApp() {
  const [step, setStep] = useState<Step>('loading');
  const [place, setPlace] = useState<string | null>(null);
  const [qrInput, setQrInput] = useState('');
  const [scanning, setScanning] = useState(false);

  const [me, setMe] = useState<(Point & { accuracyM?: number }) | null>(null);
  const [origin, setOrigin] = useState<Point | null>(null);
  const [destination, setDestination] = useState<Point | null>(null);
  const [originAddress, setOriginAddress] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [picking, setPicking] = useState<Picking>('destination');
  const [service, setService] = useState<ServiceType>('TAXI');
  const [payment, setPayment] = useState<PaymentMethod>('CASH');

  const [quote, setQuote] = useState<Quote | null>(null);
  const [now, setNow] = useState(Date.now());
  const [trip, setTrip] = useState<TripView | null>(null);
  const [car, setCar] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const rt = useRef<RealtimeConnection | null>(null);
  const tripRef = useRef<TripView | null>(null);
  tripRef.current = trip;

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------------------ entrada (QR) y recuperación
  const enter = useCallback(async (rawCode: string) => {
    const code = extractQrCode(rawCode);
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const res = await passengerApi.guestLogin(code);
      const label = (res.user as { origin?: { label?: string } }).origin?.label ?? null;
      setPlace(label);
      try {
        if (label) sessionStorage.setItem('lc_guest_place', label);
      } catch {
        /* nada */
      }
      setStep('request');
    } catch (e) {
      setError(e instanceof ApiError && e.status === 401 ? 'Este código QR no es válido o venció. Probá escanear otro cartel de La Costa Viaja.' : (e as Error).message);
      setStep('entry');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setStep('entry');
      setNotice('Tu sesión de invitado venció. Escaneá el QR otra vez.');
    });
    const qr = new URLSearchParams(window.location.search).get('qr');
    if (qr) {
      // El código no queda en la barra de direcciones ni en el historial.
      window.history.replaceState(null, '', window.location.pathname);
      enter(qr);
      return;
    }
    try {
      setPlace(sessionStorage.getItem('lc_guest_place'));
    } catch {
      /* nada */
    }
    if (!hasSession()) {
      setStep('entry');
      return;
    }
    const id = savedTripId();
    if (!id) {
      setStep('request');
      return;
    }
    passengerApi
      .trip(id)
      .then((t) => {
        setTrip(t);
        setStep('tracking');
      })
      .catch(() => {
        clearTripId();
        setStep('request');
      });
  }, [enter]);

  // Service worker: el shell de la app abre aunque la red esté saturada.
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  // ------------------------------------------------------------------ ubicación del teléfono
  const locate = useCallback((setAsOrigin: boolean) => {
    if (!navigator.geolocation) {
      setNotice('Tu navegador no permite usar la ubicación. Tocá el mapa para marcar dónde estás.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: Math.round(pos.coords.accuracy) };
        setMe(p);
        if (setAsOrigin) {
          setOrigin({ lat: p.lat, lng: p.lng });
          setPicking('destination');
        }
      },
      () => {
        setNotice('No pudimos obtener tu ubicación. Tocá el mapa para marcar dónde estás.');
        // Sin GPS, el primer toque en el mapa marca el punto de encuentro.
        if (setAsOrigin) setPicking((p) => (p === 'destination' ? 'origin' : p));
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, []);

  useEffect(() => {
    if (step === 'request' && !origin) locate(true);
  }, [step, origin, locate]);

  // ------------------------------------------------------------------ tiempo real
  const loadTrip = useCallback(async (id: string) => {
    const t = await passengerApi.trip(id);
    setTrip(t);
    if (!isOpen(t.status)) setCar(null);
    return t;
  }, []);

  useEffect(() => {
    if (step !== 'tracking' || !trip) return;
    const conn = connectRealtime(io as unknown as IoFactory, api, 'passenger', {
      onConnectionChange: setConnected,
      onTripEvent: (m) => {
        if (m.tripId === tripRef.current?.id) loadTrip(m.tripId).catch(() => undefined);
      },
      onDriverLocation: (m) => {
        if (m.tripId === tripRef.current?.id) setCar({ lat: m.data.lat, lng: m.data.lng });
      },
    });
    conn.follow(trip.id, trip.last_seq);
    rt.current = conn;
    return () => {
      conn.close();
      rt.current = null;
    };
    // Se reconecta solo si cambia de viaje.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, trip?.id, loadTrip]);

  // Respaldo sin socket.
  useEffect(() => {
    if (step !== 'tracking' || !trip || connected || !isOpen(trip.status)) return;
    const t = setInterval(() => loadTrip(trip.id).catch(() => undefined), 6_000);
    return () => clearInterval(t);
  }, [step, trip, connected, loadTrip]);

  // Reloj para la validez de la cotización.
  useEffect(() => {
    if (step !== 'quote') return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [step]);

  // ------------------------------------------------------------------ acciones
  const askQuote = () =>
    run(async () => {
      if (!origin || !destination) throw new Error('Marcá el origen y el destino en el mapa.');
      const q = await passengerApi.quote(origin, destination, service);
      setQuote(q);
      setNow(Date.now());
      setStep('quote');
    });

  const confirmTrip = () =>
    run(async () => {
      if (!origin || !destination || !quote) return;
      let q = quote;
      if (Date.parse(q.validUntil) <= Date.now() + 2_000) {
        // Venció: se recotiza y se muestra el precio nuevo antes de confirmar.
        q = await passengerApi.quote(origin, destination, service);
        setQuote(q);
        if (q.totalCents !== quote.totalCents) {
          setNotice(`La cotización venció y el precio cambió a ${pesos(q.totalCents)}. Revisalo y confirmá de nuevo.`);
          return;
        }
      }
      const t = await passengerApi.createTrip({
        origin,
        destination,
        serviceType: service,
        paymentMethod: payment,
        quoteToken: q.quoteToken,
        ...(originAddress.trim() ? { originAddress: originAddress.trim() } : {}),
        ...(destinationAddress.trim() ? { destinationAddress: destinationAddress.trim() } : {}),
      });
      saveTripId(t.id);
      setNotice(null);
      setTrip(t);
      setStep('tracking');
    });

  const cancel = () =>
    run(async () => {
      if (!trip) return;
      await passengerApi.cancel(trip.id);
      await loadTrip(trip.id);
    });

  const retry = () => {
    setTrip(null);
    clearTripId();
    askQuote();
  };

  const pay = () =>
    run(async () => {
      if (!trip) return;
      const p = await passengerApi.payWithMercadoPago(trip.id);
      if (!p.payment_link) throw new Error('No se pudo generar el link de pago.');
      if (p.payment_link.includes('.invalid/')) {
        setNotice('Pago simulado (desarrollo): el link de Mercado Pago no es real. En producción se abre el checkout.');
        return;
      }
      window.location.href = p.payment_link;
    });

  const rate = (stars: number) =>
    run(async () => {
      if (!trip) return;
      await passengerApi.rate(trip.id, stars);
      await loadTrip(trip.id);
    });

  const newTrip = () => {
    clearTripId();
    setTrip(null);
    setQuote(null);
    setCar(null);
    setDestination(null);
    setDestinationAddress('');
    setPicking('destination');
    setError(null);
    setStep('request');
  };

  const panic = async () => {
    const pos = await new Promise<{ lat: number; lng: number; accuracyM?: number }>((resolve) => {
      if (!navigator.geolocation) return resolve(me ?? origin ?? { lat: -36.6875, lng: -56.68 });
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
        () => resolve(car ?? me ?? origin ?? { lat: -36.6875, lng: -56.68 }),
        { enableHighAccuracy: true, timeout: 5_000, maximumAge: 10_000 },
      );
    });
    await passengerApi.panic({
      clientEventId: uuid(),
      location: { lat: pos.lat, lng: pos.lng },
      ...(pos.accuracyM !== undefined ? { accuracyM: pos.accuracyM } : {}),
      tripId: tripRef.current?.id ?? null,
    });
  };

  const onMapPick = (p: Point) => {
    if (step !== 'request') return;
    if (picking === 'origin') {
      setOrigin(p);
      setPicking('destination');
    } else {
      setDestination(p);
    }
  };

  // ------------------------------------------------------------------ render
  if (step === 'loading') return <main className="flex min-h-[100dvh] items-center justify-center muted">Cargando…</main>;

  if (step === 'entry') {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center p-5">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <div className="mb-2 flex flex-col items-center gap-2 text-center">
            <img src="/icon.svg" alt="" className="h-16 w-16 rounded-[18px]" />
            <h1 className="text-[26px] font-bold">La Costa Viaja</h1>
            <p className="muted">Pedí un taxi o remis habilitado sin registrarte. Precio cerrado antes de confirmar.</p>
          </div>
          {notice && <div className="ok">{notice}</div>}
          {scanning ? (
            <QrScanner
              onScan={(code) => {
                setScanning(false);
                enter(code);
              }}
              onError={(e) => {
                setScanning(false);
                setError(e);
              }}
            />
          ) : (
            <button className="btn" onClick={() => setScanning(true)} disabled={busy}>📷 Escanear el QR del cartel</button>
          )}
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              enter(qrInput);
            }}
          >
            <label className="lbl" htmlFor="qr">O escribí el código del cartel</label>
            <input id="qr" className="in" value={qrInput} onChange={(e) => setQrInput(e.target.value)} placeholder="Código QR" autoComplete="off" />
            <button className="btn-outline" disabled={busy || !qrInput.trim()}>{busy ? 'Ingresando…' : 'Continuar'}</button>
          </form>
          {error && <div className="err" role="alert">{error}</div>}
          {DEV_TOOLS && (
            <button className="rounded-[12px] border-2 border-dashed border-[#D99A00] bg-[#FFFBF0] p-3 text-[14px] font-bold text-[#7A5300]" onClick={() => enter('test-qr')} disabled={busy}>
              🧪 Entrar con código de prueba (solo desarrollo)
            </button>
          )}
          <p className="muted text-center text-[12px]">Los carteles con QR están en paradas, hoteles y accesos a la playa del Partido de La Costa.</p>
        </div>
      </main>
    );
  }

  const fitPoints =
    step === 'tracking' && trip
      ? [trip.origin, trip.destination, ...(car ? [car] : [])]
      : ([origin, destination].filter(Boolean) as Point[]).concat(!origin && me ? [me] : []);
  const fitKey =
    step === 'tracking' && trip ? `t:${trip.id}:${car ? 'car' : 'nocar'}` : `${origin ? fmt(origin) : '-'}|${destination ? fmt(destination) : '-'}|${me && !origin ? 'me' : ''}`;
  const quoteLeft = quote ? Date.parse(quote.validUntil) - now : 0;

  return (
    <main className="flex h-[100dvh] flex-col">
      <header className="flex flex-none items-center justify-between gap-2 border-b-2 border-[#C9D3D8] bg-white px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[16px] font-bold">La Costa Viaja</div>
          <div className="truncate text-[12px] text-[#5B6B72]">
            {/* Los QR sin firmar (solo desarrollo) traen una etiqueta técnica "sin-firma:…". */}
            {place ? `📍 ${place.startsWith('sin-firma:') ? 'Código de prueba' : place}` : 'Modo Invitado'}
          </div>
        </div>
        {step === 'tracking' && (
          <span className={`chip ${connected ? 'bg-[#E3F4E8] text-[#1B6B35]' : 'bg-[#FFF4DB] text-[#7A5300]'}`}>{connected ? '● En vivo' : '○ Reconectando'}</span>
        )}
      </header>

      <div className="relative min-h-[200px] flex-1">
        <MapBoundary>
          {(attempt) => (
            <PickMap
              key={attempt}
              origin={step === 'tracking' && trip ? trip.origin : origin}
              destination={step === 'tracking' && trip ? trip.destination : destination}
              car={step === 'tracking' ? car : null}
              me={me}
              onPick={onMapPick}
              fit={{ points: fitPoints, key: fitKey }}
            />
          )}
        </MapBoundary>
        {step === 'request' && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex justify-center">
            <span className="chip pointer-events-auto bg-white px-3 py-2 text-[13px] text-[#0A3A3C] shadow">
              {picking === 'origin' ? 'Tocá el mapa donde te buscamos (A)' : destination ? 'Tocá de nuevo para mover el destino (B)' : 'Tocá el mapa para marcar el destino (B)'}
            </span>
          </div>
        )}
      </div>

      <section className="max-h-[64dvh] flex-none overflow-auto rounded-t-[20px] border-t-2 border-[#C9D3D8] bg-white p-4 pb-[max(16px,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,.06)]">
        <div className="flex flex-col gap-3">
          {notice && (
            <button className="ok text-left" onClick={() => setNotice(null)}>
              {notice} <span className="font-normal">(tocar para cerrar)</span>
            </button>
          )}

          {step === 'request' && (
            <>
              <div className="flex flex-col gap-2">
                <div className={`flex items-center gap-3 rounded-[12px] border-2 p-2.5 ${picking === 'origin' ? 'border-[#0F6B72] bg-[#E6F4F5]' : 'border-[#E3EAEC]'}`}>
                  <span className="pin h-7 w-7 flex-none bg-[#0F6B72] text-[13px] text-white">A</span>
                  <div className="min-w-0 flex-1">
                    <div className="lbl">Te buscamos en</div>
                    <div className="truncate text-[15px] font-semibold">
                      {origin ? (me && origin.lat === me.lat && origin.lng === me.lng ? 'Tu ubicación actual' : 'Punto marcado en el mapa') : picking === 'origin' ? 'Tocá el mapa' : 'Buscando tu ubicación…'}
                    </div>
                  </div>
                  <button className="flex-none rounded-[8px] px-2 py-1 text-[13px] font-bold text-[#0F6B72]" onClick={() => setPicking('origin')}>Cambiar</button>
                </div>
                {origin && (
                  <input className="in h-11 text-[15px]" placeholder="Dirección o referencia (opcional): ej. Chiozza 2100, hotel…" value={originAddress} maxLength={200} onChange={(e) => setOriginAddress(e.target.value)} />
                )}
                <div className={`flex items-center gap-3 rounded-[12px] border-2 p-2.5 ${picking === 'destination' ? 'border-[#B3261E] bg-[#FDF2F1]' : 'border-[#E3EAEC]'}`}>
                  <span className="pin h-7 w-7 flex-none bg-[#B3261E] text-[13px] text-white">B</span>
                  <div className="min-w-0 flex-1">
                    <div className="lbl">Destino</div>
                    <div className="truncate text-[15px] font-semibold">{destination ? 'Punto marcado en el mapa' : 'Tocá el mapa'}</div>
                  </div>
                  {destination && <button className="flex-none rounded-[8px] px-2 py-1 text-[13px] font-bold text-[#0F6B72]" onClick={() => setPicking('destination')}>Cambiar</button>}
                </div>
                {destination && (
                  <input className="in h-11 text-[15px]" placeholder="Dirección del destino (opcional)" value={destinationAddress} maxLength={200} onChange={(e) => setDestinationAddress(e.target.value)} />
                )}
              </div>
              <button className="text-left text-[13px] font-bold text-[#0F6B72]" onClick={() => locate(true)}>📍 Usar mi ubicación como punto de encuentro</button>

              <div className="flex flex-col gap-1.5">
                <span className="lbl">Servicio</span>
                <div className="flex gap-2">
                  {(['TAXI', 'REMIS'] as const).map((s) => (
                    <button key={s} className="seg" aria-pressed={service === s} onClick={() => setService(s)}>{texto('service', s)}</button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="lbl">Pago</span>
                <div className="flex gap-2">
                  <button className="seg" aria-pressed={payment === 'CASH'} onClick={() => setPayment('CASH')}>💵 Efectivo</button>
                  <button className="seg" aria-pressed={payment === 'MERCADO_PAGO_LINK'} onClick={() => setPayment('MERCADO_PAGO_LINK')}>Mercado Pago</button>
                </div>
              </div>
              {error && <div className="err" role="alert">{error}</div>}
              <button className="btn" onClick={askQuote} disabled={busy || !origin || !destination}>{busy ? 'Calculando…' : 'Ver precio'}</button>
            </>
          )}

          {step === 'quote' && quote && (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="lbl">Precio cerrado</div>
                  <div className="text-[36px] font-bold leading-none">{pesos(quote.totalCents, true)}</div>
                </div>
                <div className="text-right text-[13px] text-[#5B6B72]">
                  {texto('service', quote.serviceType)} · {texto('scope', quote.scope)}
                  <br />
                  {texto('season', quote.tariff.season)} · {texto('timeBand', quote.tariff.timeBand)}
                </div>
              </div>
              <div className="muted">
                {quote.origin.locality.name} → {quote.destination.locality.name} · {(quote.route.distanceMeters / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km aprox.
              </div>
              <details className="rounded-[12px] bg-[#F4F8F8] p-3">
                <summary className="cursor-pointer text-[14px] font-bold">Ver el detalle del precio</summary>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {quote.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3 text-[14px]">
                      <span>
                        {l.label ?? l.code}
                        {l.detail && <span className="block text-[12px] text-[#5B6B72]">{l.detail}</span>}
                      </span>
                      <span className="whitespace-nowrap font-semibold tabular-nums">{pesos(l.amountCents)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[12px] text-[#5B6B72]">Cuadro tarifario {quote.tariff.scheduleCode}. Tarifa municipal oficial: el chofer no puede cobrarte más.</p>
              </details>
              <div className={`text-[13px] ${quoteLeft < 30_000 ? 'font-bold text-[#7A5300]' : 'text-[#5B6B72]'}`}>
                {quoteLeft > 0 ? `Precio garantizado por ${regresiva(quoteLeft)}` : 'El precio venció: al confirmar lo recalculamos.'}
              </div>
              <div className="muted">Pago: <b>{texto('payment', payment)}</b></div>
              {error && <div className="err" role="alert">{error}</div>}
              <button className="btn min-h-[58px] text-[18px]" onClick={confirmTrip} disabled={busy}>{busy ? 'Pidiendo…' : 'Confirmar y pedir'}</button>
              <button className="btn-outline" onClick={() => setStep('request')} disabled={busy}>Cambiar el viaje</button>
            </>
          )}

          {step === 'tracking' && trip && (
            <Tracking trip={trip} busy={busy} error={error} onCancel={cancel} onRetry={retry} onPay={pay} onRate={rate} onNew={newTrip} onPanic={panic} />
          )}
        </div>
      </section>
    </main>
  );
}
