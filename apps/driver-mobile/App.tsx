import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = 'http://localhost:3000/api';

async function apiFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await AsyncStorage.getItem('lc_driver_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers as any) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) { const t = await res.text(); throw new Error(`API ${res.status}: ${t}`); }
  return res.json();
}

export default function App() {
  const [screen, setScreen] = useState<'login' | 'turno' | 'oferta' | 'viaje'>('login');
  const [dni, setDni] = useState('');
  const [pin, setPin] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [onShift, setOnShift] = useState(false);
  const [offer, setOffer] = useState<any>(null);
  const [trip, setTrip] = useState<any>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  async function login() {
    setLoading(true);
    try {
      const data = await apiFetch('/auth/driver/login', { method: 'POST', body: JSON.stringify({ dni, pin }) });
      await AsyncStorage.setItem('lc_driver_token', data.accessToken);
      setScreen('turno');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function startShift() {
    setLoading(true);
    try {
      await apiFetch('/drivers/me/shift', { method: 'POST', body: JSON.stringify({ vehicleId }) });
      setOnShift(true);
      Alert.alert('Turno iniciado');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function endShift() {
    setLoading(true);
    try {
      await apiFetch('/drivers/me/shift', { method: 'DELETE' });
      setOnShift(false);
      Alert.alert('Turno cerrado');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function loadOffer() {
    try {
      const o = await apiFetch('/drivers/me/offer');
      setOffer(o);
    } catch { setOffer(null); }
  }

  async function accept() {
    if (!offer) return;
    setLoading(true);
    try {
      await apiFetch(`/offers/${offer.offer_id}/accept`, { method: 'POST', body: JSON.stringify({ tripId: offer.trip_id }) });
      await AsyncStorage.setItem('lc_trip_id', offer.trip_id);
      setTripId(offer.trip_id);
      const t = await apiFetch(`/trips/${offer.trip_id}`);
      setTrip(t);
      setOffer(null);
      setScreen('viaje');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function reject() {
    if (!offer) return;
    setLoading(true);
    try {
      await apiFetch(`/offers/${offer.offer_id}/reject`, { method: 'POST', body: JSON.stringify({ tripId: offer.trip_id }) });
      setOffer(null);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function arrived() {
    if (!tripId) return;
    setLoading(true);
    try { await apiFetch(`/trips/${tripId}/arrived`, { method: 'POST' }); const t = await apiFetch(`/trips/${tripId}`); setTrip(t); }
    catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function startTrip() {
    if (!tripId) return;
    setLoading(true);
    try { await apiFetch(`/trips/${tripId}/start`, { method: 'POST' }); const t = await apiFetch(`/trips/${tripId}`); setTrip(t); }
    catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function completeTrip() {
    if (!tripId || !trip) return;
    setLoading(true);
    try {
      await apiFetch(`/trips/${tripId}/complete`, { method: 'POST', body: JSON.stringify({}) });
      await apiFetch(`/trips/${tripId}/payment/cash`, { method: 'POST', body: JSON.stringify({ amountCents: trip.quoted_fare_cents }) });
      await AsyncStorage.removeItem('lc_trip_id');
      Alert.alert('Viaje completado');
      setTrip(null); setTripId(null); setScreen('turno');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function cancelTrip() {
    if (!tripId) return;
    setLoading(true);
    try {
      await apiFetch(`/trips/${tripId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Chofer canceló' }) });
      await AsyncStorage.removeItem('lc_trip_id');
      Alert.alert('Viaje cancelado');
      setTrip(null); setTripId(null); setScreen('turno');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function panico() {
    if (!tripId) return;
    setLoading(true);
    try {
      const clientEventId = Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
      await apiFetch('/panic', { method: 'POST', body: JSON.stringify({ clientEventId, tripId, raisedBy: 'DRIVER', location: { lat: -36.6875, lng: -56.68 }, channel: 'APP', snapshot: { tripId }, occurredAt: new Date().toISOString() }) });
      Alert.alert('Alerta enviada', 'El COM fue notificado.');
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }

  async function logout() {
    await AsyncStorage.removeItem('lc_driver_token');
    setScreen('login');
  }

  // --- Screens ---
  if (screen === 'login') {
    return (
      <View style={s.container}>
        <Text style={s.title}>LaCostaViaja — Chofer</Text>
        <TextInput style={s.input} placeholder="DNI" value={dni} onChangeText={setDni} keyboardType="numeric" />
        <TextInput style={s.input} placeholder="PIN (6 dígitos)" value={pin} onChangeText={setPin} secureTextEntry keyboardType="numeric" maxLength={6} />
        <TouchableOpacity style={s.btn} onPress={login} disabled={loading}>
          <Text style={s.btnText}>{loading ? 'Ingresando…' : 'Ingresar'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === 'turno') {
    return (
      <View style={s.container}>
        <Text style={s.title}>Turno</Text>
        {!onShift ? (
          <>
            <TextInput style={s.input} placeholder="ID del vehículo" value={vehicleId} onChangeText={setVehicleId} />
            <TouchableOpacity style={s.btn} onPress={startShift} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'Iniciando…' : 'Iniciar turno'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.sub}>Turno activo. Esperando ofertas…</Text>
            <TouchableOpacity style={s.btn} onPress={() => { loadOffer(); setScreen('oferta'); }}>
              <Text style={s.btnText}>Ver oferta</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, { backgroundColor: '#A31F1F', marginTop: 12 }]} onPress={endShift} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'Cerrando…' : 'Cerrar turno'}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity style={{ marginTop: 24 }} onPress={logout}>
          <Text style={{ color: '#0F6B72', fontWeight: '600' }}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (screen === 'oferta') {
    return (
      <View style={s.container}>
        <Text style={s.title}>Oferta</Text>
        {!offer ? (
          <>
            <Text style={s.sub}>Sin oferta vigente.</Text>
            <TouchableOpacity style={s.btn} onPress={loadOffer}>
              <Text style={s.btnText}>Actualizar</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, { backgroundColor: '#888', marginTop: 8 }]} onPress={() => setScreen('turno')}>
              <Text style={s.btnText}>Volver</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={s.sub}>Viaje: {String(offer.trip_id).slice(0, 8)}</Text>
            <Text style={s.sub}>ETA: {offer.eta_seconds}s</Text>
            <Text style={s.sub}>Tarifa: ${(offer.quoted_fare_cents / 100).toFixed(2)}</Text>
            <TouchableOpacity style={s.btn} onPress={accept} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'Aceptando…' : 'Aceptar'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, { backgroundColor: '#A31F1F', marginTop: 8 }]} onPress={reject} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'Rechazando…' : 'Rechazar'}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  // viaje
  return (
    <View style={s.container}>
      <Text style={s.title}>Viaje en curso</Text>
      {!trip ? <Text style={s.sub}>Cargando…</Text> : (
        <>
          <Text style={s.sub}>Estado: {trip.status}</Text>
          <Text style={s.sub}>Tarifa: ${(trip.quoted_fare_cents / 100).toFixed(2)}</Text>
          {trip.status === 'ASSIGNED' && (
            <TouchableOpacity style={s.btn} onPress={arrived} disabled={loading}>
              <Text style={s.btnText}>{loading ? '…' : 'Llegué (arrived)'}</Text>
            </TouchableOpacity>
          )}
          {trip.status === 'DRIVER_ARRIVED' && (
            <TouchableOpacity style={s.btn} onPress={startTrip} disabled={loading}>
              <Text style={s.btnText}>{loading ? '…' : 'Iniciar viaje'}</Text>
            </TouchableOpacity>
          )}
          {trip.status === 'IN_PROGRESS' && (
            <TouchableOpacity style={s.btn} onPress={completeTrip} disabled={loading}>
              <Text style={s.btnText}>{loading ? '…' : 'Completar viaje'}</Text>
            </TouchableOpacity>
          )}
          {['ASSIGNED', 'DRIVER_ARRIVED'].includes(trip.status) && (
            <TouchableOpacity style={[s.btn, { backgroundColor: '#A31F1F', marginTop: 8 }]} onPress={cancelTrip} disabled={loading}>
              <Text style={s.btnText}>{loading ? '…' : 'Cancelar'}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
      <TouchableOpacity style={[s.btn, { backgroundColor: '#B3261E', marginTop: 16 }]} onPress={panico} disabled={loading}>
        <Text style={s.btnText}>{loading ? '…' : '🚨 Pánico'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={{ marginTop: 24 }} onPress={() => setScreen('turno')}>
        <Text style={{ color: '#0F6B72', fontWeight: '600' }}>Volver a turno</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F4F8F8' },
  title: { fontSize: 22, fontWeight: '700', color: '#0A3A3C', textAlign: 'center', marginBottom: 16 },
  sub: { fontSize: 14, color: '#34454D', textAlign: 'center', marginBottom: 8 },
  input: { height: 48, borderWidth: 2, borderColor: '#4F5F67', borderRadius: 10, paddingHorizontal: 12, fontSize: 16, color: '#0A3A3C', backgroundColor: '#fff', marginBottom: 12 },
  btn: { height: 48, backgroundColor: '#0F6B72', borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});