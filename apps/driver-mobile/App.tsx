import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, Vibration, View } from 'react-native';
import { io } from 'socket.io-client';
import {
  ApiError,
  PingBuffer,
  connectRealtime,
  distancia,
  driverActions,
  driverStatusText,
  duracion,
  metrosEntre,
  motivoBloqueo,
  pesos,
  regresiva,
  texto,
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
import { api, driverApi, hasSession, setSessionExpiredHandler } from './lib/client';

// Misma lógica que driver-web (packages/driver-core); acá solo cambia la interfaz y el GPS (expo-location).

const C = { teal: '#0F6B72', ink: '#0A3A3C', muted: '#5B6B72', line: '#C9D3D8', bg: '#F4F8F8', red: '#A31F1F', okBg: '#E3F4E8', okInk: '#1B6B35', warnBg: '#FFF4DB', warnInk: '#7A5300' };

type Phase = 'loading' | 'login' | 'app';

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setPhase('login');
      setNotice('Tu sesión venció. Ingresá de nuevo.');
    });
    hasSession().then((ok) => setPhase(ok ? 'app' : 'login'));
  }, []);

  return (
    <SafeAreaView style={s.screen}>
      <StatusBar style="dark" />
      {phase === 'loading' && <ActivityIndicator style={{ marginTop: 80 }} color={C.teal} />}
      {phase === 'login' && (
        <Login
          notice={notice}
          onDone={() => {
            setNotice(null);
            setPhase('app');
          }}
        />
      )}
      {phase === 'app' && <Driver onLogout={() => setPhase('login')} />}
    </SafeAreaView>
  );
}

// ------------------------------------------------------------------ ingreso
function Login({ notice, onDone }: { notice: string | null; onDone: () => void }) {
  const [dni, setDni] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await driverApi.login(dni, pin);
      onDone();
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 401 ? 'DNI o PIN incorrectos. Después de 5 intentos el PIN se bloquea por 15 minutos.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={[s.pad, { paddingTop: 72, gap: 14 }]} keyboardShouldPersistTaps="handled">
      <Text style={[s.h1, { textAlign: 'center' }]}>La Costa Viaja</Text>
      <Text style={[s.muted, { textAlign: 'center', marginBottom: 12 }]}>App del chofer habilitado</Text>
      {notice && <Text style={s.ok}>{notice}</Text>}
      <Text style={s.lbl}>DNI</Text>
      <TextInput style={s.in} keyboardType="number-pad" placeholder="Sin puntos" value={dni} onChangeText={(t) => setDni(t.replace(/\D/g, ''))} />
      <Text style={s.lbl}>PIN</Text>
      <TextInput style={s.in} keyboardType="number-pad" secureTextEntry maxLength={6} placeholder="6 dígitos" value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, ''))} />
      {error && <Text style={s.err}>{error}</Text>}
      <Btn label={busy ? 'Ingresando…' : 'Ingresar'} onPress={submit} disabled={busy || dni.length < 7 || pin.length !== 6} />
    </ScrollView>
  );
}

// ------------------------------------------------------------------ app del chofer
function Driver({ onLogout }: { onLogout: () => void }) {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [vehicles, setVehicles] = useState<DriverVehicle[]>([]);
  const [state, setState] = useState<DriverState>({ status: 'OFFLINE' });
  const [offer, setOffer] = useState<CurrentOffer | null>(null);
  const [trip, setTrip] = useState<TripView | null>(null);
  const [position, setPosition] = useState<Ping | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState<DriverAction | null>(null);
  const [now, setNow] = useState(Date.now());

  const buffer = useRef(new PingBuffer({ batchSize: 50 }));
  const rt = useRef<RealtimeConnection | null>(null);
  const tripRef = useRef<TripView | null>(null);
  tripRef.current = trip;
  const offerRef = useRef<CurrentOffer | null>(null);
  offerRef.current = offer;
  const onShift = state.status !== 'OFFLINE';
  const onShiftRef = useRef(onShift);
  onShiftRef.current = onShift;

  const loadTrip = useCallback(async (id: string) => {
    const t = await driverApi.trip(id);
    setTrip(t);
    rt.current?.follow(t.id, t.last_seq);
  }, []);

  const refresh = useCallback(async () => {
    const st = await driverApi.state();
    setState(st);
    if (st.tripId && tripRef.current?.id !== st.tripId) await loadTrip(st.tripId);
    if (st.status === 'OFFERED') setOffer(await driverApi.currentOffer());
    else if (offerRef.current) setOffer(null);
  }, [loadTrip]);

  // Carga inicial.
  useEffect(() => {
    (async () => {
      try {
        const [p, v] = await Promise.all([driverApi.me(), driverApi.vehicles()]);
        setProfile(p);
        setVehicles(v);
        await refresh();
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) onLogout();
        else setError((e as Error).message);
      }
    })();
  }, [refresh, onLogout]);

  // Socket.
  useEffect(() => {
    const conn = connectRealtime(io as unknown as IoFactory, api, 'driver', {
      onConnectionChange: setConnected,
      onOffer: () => {
        driverApi
          .currentOffer()
          .then((o) => {
            if (!o) return;
            setOffer(o);
            Vibration.vibrate([0, 300, 150, 300]);
          })
          .catch(() => undefined);
      },
      onOfferClosed: (m) => {
        if (offerRef.current?.offer_id === m.data.offerId) {
          setOffer(null);
          if (m.data.outcome === 'EXPIRED') setNotice('La oferta venció y pasó a otro chofer.');
        }
      },
      onTripEvent: (m) => {
        if (tripRef.current?.id === m.tripId) loadTrip(m.tripId).catch(() => undefined);
      },
      onTripCancelled: (m) => {
        if (tripRef.current?.id === m.tripId) loadTrip(m.tripId).catch(() => undefined);
        setNotice(m.data.reason ? `Viaje cancelado: ${m.data.reason}` : 'El viaje fue cancelado.');
        refresh().catch(() => undefined);
      },
    });
    rt.current = conn;
    return () => conn.close();
  }, [loadTrip, refresh]);

  // Respaldo sin socket.
  useEffect(() => {
    if (connected) return;
    const t = setInterval(() => refresh().catch(() => undefined), 8_000);
    return () => clearInterval(t);
  }, [connected, refresh]);

  // GPS (primer plano). El seguimiento en segundo plano queda para la Fase 6.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsError('Permití el acceso a la ubicación para recibir viajes.');
        return;
      }
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 3_000, distanceInterval: 5 }, (loc) => {
        const p: Ping = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          recordedAt: loc.timestamp,
          ...(loc.coords.accuracy !== null ? { accuracyM: Math.round(loc.coords.accuracy) } : {}),
          ...(loc.coords.speed !== null && loc.coords.speed >= 0 ? { speedKmh: Math.round(loc.coords.speed * 3.6) } : {}),
          ...(loc.coords.heading !== null && loc.coords.heading >= 0 ? { headingDeg: Math.round(loc.coords.heading) } : {}),
        };
        setGpsError(null);
        setPosition(p);
        if (onShiftRef.current) buffer.current.add(p);
      });
    })().catch(() => setGpsError('No se pudo iniciar el GPS.'));
    return () => sub?.remove();
  }, []);

  const flush = useCallback(
    () =>
      buffer.current.flush((pings) =>
        driverApi.positions(pings).catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 409) refresh().catch(() => undefined);
          throw e;
        }),
      ),
    [refresh],
  );

  useEffect(() => {
    if (!onShift) return;
    const t = setInterval(() => flush().catch(() => undefined), 5_000);
    return () => clearInterval(t);
  }, [onShift, flush]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => setPending(null), [trip?.status]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const here = position ? { lat: position.lat, lng: position.lng } : undefined;

  const startShift = (v: DriverVehicle) =>
    run(async () => {
      await driverApi.startShift(v.vehicle_id);
      if (position) buffer.current.add({ ...position, recordedAt: Date.now() });
      await flush();
      await refresh();
      if (!position) setNotice('Turno iniciado, pero todavía no tenemos tu ubicación: no vas a recibir ofertas hasta que el GPS responda.');
    });

  const doAction = (a: DriverAction) =>
    run(async () => {
      const t = tripRef.current;
      if (!t) return;
      await flush().catch(() => undefined);
      if (a.key === 'arrived') await driverApi.arrived(t.id, here);
      if (a.key === 'start') await driverApi.start(t.id, here);
      if (a.key === 'complete') await driverApi.complete(t.id, here);
      if (a.key === 'noShow') await driverApi.noShow(t.id, here);
      if (a.key === 'withdraw') await driverApi.withdraw(t.id);
      await loadTrip(t.id);
      await refresh();
    });

  const panic = () =>
    run(async () => {
      if (!position) throw new Error('No tenemos tu ubicación. Si es urgente, llamá al 911.');
      await driverApi.panic({ clientEventId: uuid(), location: { lat: position.lat, lng: position.lng }, ...(position.accuracyM !== undefined ? { accuracyM: position.accuracyM } : {}), tripId: tripRef.current?.id ?? null, channel: 'APP' });
      Vibration.vibrate([0, 200, 100, 200]);
      setNotice('Alerta enviada al COM. Mantené la app abierta: compartimos tu ubicación.');
    });

  const logout = () =>
    run(async () => {
      if (onShift) await driverApi.endShift().catch(() => undefined);
      await driverApi.logout();
      onLogout();
    });

  const vehicle = vehicles.find((v) => v.vehicle_id === state.vehicleId);
  const closed = trip && !['ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(trip.status);

  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.h2} numberOfLines={1}>{profile ? `${profile.first_name} ${profile.last_name}` : '…'}</Text>
          <Text style={s.muted}>
            {onShift ? (trip && !closed ? 'En viaje' : 'Disponible') : 'Fuera de turno'}
            {vehicle ? ` · ${vehicle.plate}` : ''} · {connected ? '● En línea' : '○ Reconectando'}
          </Text>
        </View>
        <Pressable onPress={logout} hitSlop={12}>
          <Text style={{ color: C.teal, fontWeight: '700' }}>Salir</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[s.pad, { gap: 12 }]}>
        <Text style={[s.chip, gpsError ? { backgroundColor: '#FDECEA', color: C.red } : position ? null : { backgroundColor: C.warnBg, color: C.warnInk }]}>
          {gpsError ?? (position ? `📍 GPS ±${position.accuracyM ?? '?'} m` : '📍 Buscando GPS…')}
        </Text>
        {notice && (
          <Pressable onPress={() => setNotice(null)}>
            <Text style={s.ok}>{notice} (tocar para cerrar)</Text>
          </Pressable>
        )}
        {error && <Text style={s.err}>{error}</Text>}

        {trip ? (
          closed ? (
            <View style={{ gap: 12 }}>
              <Text style={s.kicker}>Viaje {trip.public_code}</Text>
              <Text style={s.h1}>{driverStatusText(trip.status)}</Text>
              {trip.status === 'COMPLETED' && (
                <View style={s.card}>
                  <Text style={s.lbl}>Total a cobrar</Text>
                  <Text style={s.big}>{pesos(trip.final_fare_cents ?? trip.quoted_fare_cents)}</Text>
                  <Text style={s.muted}>
                    {texto('payment', trip.payment_method)} · {texto('paymentStatus', trip.payment_status)}
                  </Text>
                </View>
              )}
              {trip.status === 'COMPLETED' && trip.payment_method === 'CASH' && trip.payment_status !== 'PAID' && (
                <Btn label="Cobré en efectivo" disabled={busy} onPress={() => run(async () => { await driverApi.confirmCash(trip.id); await loadTrip(trip.id); })} />
              )}
              <Btn label="Volver a recibir viajes" outline onPress={() => { setTrip(null); refresh().catch(() => undefined); }} />
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={s.kicker}>Viaje {trip.public_code} · {texto('service', trip.service_type)} · {pesos(trip.quoted_fare_cents, true)}</Text>
              <Text style={s.h1}>{driverStatusText(trip.status)}</Text>
              {(() => {
                const toPickup = trip.status !== 'IN_PROGRESS';
                const target = toPickup ? trip.origin : trip.destination;
                return (
                  <>
                    <View style={s.card}>
                      <Text style={s.lbl}>{toPickup ? 'Punto de encuentro (A)' : 'Destino (B)'}</Text>
                      <Text style={s.h2}>{target.address || target.locality}</Text>
                      {here && <Text style={s.muted}>A {distancia(metrosEntre(here, target))} en línea recta</Text>}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Btn outline label="Google Maps" onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`)} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Btn outline label="Waze" onPress={() => Linking.openURL(`https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`)} />
                      </View>
                    </View>
                  </>
                );
              })()}
              {pending ? (
                <View style={[s.card, { borderColor: C.teal, gap: 10 }]}>
                  <Text style={s.h2}>{pending.confirm}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Btn outline label="No" onPress={() => setPending(null)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Btn label="Sí, confirmar" danger={pending.tone === 'danger'} disabled={busy} onPress={() => { const a = pending; setPending(null); doAction(a); }} />
                    </View>
                  </View>
                </View>
              ) : (
                driverActions(trip, now).map((a) => (
                  <Btn
                    key={a.key}
                    label={`${a.label}${a.availableInMs !== undefined ? ` (en ${regresiva(a.availableInMs)})` : ''}`}
                    outline={a.tone !== 'primary'}
                    danger={a.tone === 'danger'}
                    disabled={busy || a.availableInMs !== undefined}
                    onPress={() => (a.confirm ? setPending(a) : doAction(a))}
                  />
                ))
              )}
            </View>
          )
        ) : onShift ? (
          <View style={{ gap: 12 }}>
            <View style={s.card}>
              <Text style={s.h2}>Esperando viajes</Text>
              <Text style={s.muted}>Te avisamos con vibración cuando llegue una oferta.</Text>
            </View>
            <Btn outline label={busy ? 'Cerrando…' : 'Cerrar turno'} disabled={busy} onPress={() => run(async () => { await driverApi.endShift(); setOffer(null); await refresh(); })} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <Text style={s.h1}>Iniciar turno</Text>
            <Text style={s.muted}>Elegí el vehículo con el que vas a trabajar.</Text>
            {vehicles.length === 0 && <Text style={s.muted}>No tenés vehículos autorizados. Consultá con tu agencia o con la Dirección de Transporte.</Text>}
            {vehicles.map((v) => (
              <Pressable key={v.vehicle_id} disabled={!v.is_eligible || busy} onPress={() => startShift(v)} style={({ pressed }) => [s.card, { gap: 6, opacity: v.is_eligible ? 1 : 0.8 }, pressed && { borderColor: C.teal }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={s.plate}>{v.plate}</Text>
                  <Text style={s.chip}>{texto('service', v.service_type)}</Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: '600', color: C.ink }}>
                  {v.make} {v.model} {v.model_year ?? ''} {v.color ? `· ${v.color}` : ''}
                </Text>
                {v.is_eligible ? (
                  <Text style={{ color: C.teal, fontWeight: '700' }}>Iniciar turno con este vehículo →</Text>
                ) : (
                  v.blocking_reasons.map((r) => (
                    <Text key={r} style={{ color: C.red, fontWeight: '600', fontSize: 13 }}>• {motivoBloqueo(r)}</Text>
                  ))
                )}
              </Pressable>
            ))}
          </View>
        )}

        {onShift && <Btn danger outline label="🚨 Pánico (mantener apretado)" onLongPress={panic} />}
      </ScrollView>

      {offer && !trip && (
        <OfferModal
          offer={offer}
          busy={busy}
          error={error}
          onAccept={() =>
            run(async () => {
              const o = offer;
              try {
                await driverApi.accept(o.offer_id, o.trip_id);
              } finally {
                setOffer(null);
              }
              await loadTrip(o.trip_id);
              await refresh();
            })
          }
          onReject={() =>
            run(async () => {
              const o = offer;
              setOffer(null);
              await driverApi.reject(o.offer_id, o.trip_id);
            })
          }
          onExpired={() => {
            setOffer(null);
            setNotice('La oferta venció y pasó a otro chofer.');
          }}
        />
      )}
    </View>
  );
}

function OfferModal({ offer, busy, error, onAccept, onReject, onExpired }: { offer: CurrentOffer; busy: boolean; error: string | null; onAccept: () => void; onReject: () => void; onExpired: () => void }) {
  const deadline = Date.parse(offer.expires_at);
  const [left, setLeft] = useState(deadline - Date.now());
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
  const meters = metrosEntre({ lat: offer.origin_lat, lng: offer.origin_lng }, { lat: offer.destination_lat, lng: offer.destination_lng });

  return (
    <View style={s.overlay}>
      <View style={s.sheet}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={s.kicker}>Nuevo viaje · {texto('service', offer.service_type)}</Text>
          <Text style={[s.h1, left < 5_000 && { color: C.red }]}>{regresiva(left)}</Text>
        </View>
        <Text style={s.big}>{pesos(offer.quoted_fare_cents, true)}</Text>
        <Text style={s.muted}>
          {texto('scope', offer.scope)} · {distancia(meters)} de viaje · {duracion(offer.eta_seconds)} hasta el pasajero
        </Text>
        <View style={[s.card, { backgroundColor: C.bg, gap: 6 }]}>
          <Text style={s.lbl}>A · Buscar en</Text>
          <Text style={s.h2}>{offer.origin_address || `${offer.origin_lat.toFixed(5)}, ${offer.origin_lng.toFixed(5)}`}</Text>
          <Text style={s.lbl}>B · Destino</Text>
          <Text style={s.h2}>{offer.destination_address || `${offer.destination_lat.toFixed(5)}, ${offer.destination_lng.toFixed(5)}`}</Text>
        </View>
        {error && <Text style={s.err}>{error}</Text>}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Btn outline danger label="Rechazar" disabled={busy} onPress={onReject} />
          </View>
          <View style={{ flex: 2 }}>
            <Btn label={busy ? 'Aceptando…' : 'Aceptar viaje'} disabled={busy || left <= 0} onPress={onAccept} />
          </View>
        </View>
      </View>
    </View>
  );
}

function Btn({ label, onPress, onLongPress, disabled, outline, danger }: { label: string; onPress?: () => void; onLongPress?: () => void; disabled?: boolean; outline?: boolean; danger?: boolean }) {
  const color = danger ? C.red : C.teal;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={2_000}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        outline ? { backgroundColor: '#fff', borderWidth: 2, borderColor: color } : { backgroundColor: color },
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.85 },
      ]}
    >
      <Text style={[s.btnText, outline && { color }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, paddingTop: 36, backgroundColor: '#fff', borderBottomWidth: 2, borderColor: C.line },
  h1: { fontSize: 22, fontWeight: '700', color: C.ink },
  h2: { fontSize: 17, fontWeight: '700', color: C.ink },
  big: { fontSize: 32, fontWeight: '700', color: C.ink },
  kicker: { fontSize: 13, fontWeight: '700', color: C.teal, textTransform: 'uppercase' },
  lbl: { fontSize: 14, fontWeight: '700', color: '#34454D' },
  muted: { fontSize: 14, color: C.muted },
  in: { height: 52, borderWidth: 2, borderColor: C.line, borderRadius: 12, paddingHorizontal: 16, fontSize: 18, backgroundColor: '#fff', color: C.ink },
  card: { backgroundColor: '#fff', borderWidth: 2, borderColor: C.line, borderRadius: 16, padding: 16 },
  btn: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700', textAlign: 'center' },
  chip: { alignSelf: 'flex-start', backgroundColor: '#fff', color: C.ink, fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  plate: { borderWidth: 2, borderColor: C.ink, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, fontSize: 16, fontWeight: '700', letterSpacing: 2, color: C.ink },
  err: { backgroundColor: '#FDECEA', borderColor: '#F2B8B5', borderWidth: 1, borderRadius: 10, padding: 10, color: C.red, fontWeight: '600' },
  ok: { backgroundColor: C.okBg, borderColor: '#A9D8B6', borderWidth: 1, borderRadius: 10, padding: 10, color: C.okInk, fontWeight: '600' },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(10,58,60,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 12 },
});
