import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch, clearTripId } from '../lib/api';

export default function Viaje() {
  const router = useRouter();
  const [tripId, setTripId] = useState<string | null>(null);
  const [trip, setTrip] = useState<any>(null);
  const [metered, setMetered] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const id = await AsyncStorage.getItem('lc_trip_id');
      setTripId(id);
      if (id) {
        const t = await apiFetch<any>(`/trips/${id}`);
        setTrip(t);
      }
    })();
  }, []);

  async function arrived() {
    if (!tripId) return;
    setLoading(true);
    try { await apiFetch(`/trips/${tripId}/arrived`, { method: 'POST' }); await refresh(); } catch (e: any) { Alert.alert('Error', e.message); } finally { setLoading(false); }
  }
  async function start() {
    if (!tripId) return;
    setLoading(true);
    try { await apiFetch(`/trips/${tripId}/start`, { method: 'POST' }); await refresh(); } catch (e: any) { Alert.alert('Error', e.message); } finally { setLoading(false); }
  }
  async function complete() {
    if (!tripId) return;
    setLoading(true);
    try {
      await apiFetch(`/trips/${tripId}/complete`, { method: 'POST', body: JSON.stringify({ meteredFareCents: metered ? Number(metered) : undefined }) });
      await apiFetch(`/trips/${tripId}/payment/cash`, { method: 'POST', body: JSON.stringify({ amountCents: trip?.quoted_fare_cents }) });
      await clearTripId();
      Alert.alert('Viaje completado');
      router.replace('/turno');
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setLoading(false); }
  }
  async function cancel() {
    if (!tripId) return;
    setLoading(true);
    try {
      await apiFetch(`/trips/${tripId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Chofer canceló' }) });
      await clearTripId();
      Alert.alert('Viaje cancelado');
      router.replace('/turno');
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setLoading(false); }
  }
  async function panico() {
    if (!tripId) return;
    setLoading(true);
    try {
      const clientEventId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); });
      await apiFetch('/panic', { method: 'POST', body: JSON.stringify({ clientEventId, tripId, raisedBy: 'DRIVER', driverId: null, location: { lat: -36.6875, lng: -56.68 }, channel: 'APP', snapshot: { tripId }, occurredAt: new Date().toISOString() }) });
      Alert.alert('Alerta enviada', 'El COM fue notificado.');
    } catch (e: any) { Alert.alert('Error', e.message); } finally { setLoading(false); }
  }

  async function refresh() {
    if (!tripId) return;
    const t = await apiFetch<any>(`/trips/${tripId}`);
    setTrip(t);
  }

  if (!trip) return <View style={styles.container}><Text>Cargando viaje…</Text></View>;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Viaje en curso</Text>
      <Text style={styles.sub}>Estado: {trip.status}</Text>
      <Text style={styles.sub}>Tarifa: ${(trip.quoted_fare_cents / 100).toFixed(2)}</Text>

      {trip.status === 'ASSIGNED' && (
        <TouchableOpacity style={styles.btn} onPress={arrived} disabled={loading}>
          <Text style={styles.btnText}>{loading ? '…' : 'Llegué (arrived)'}</Text>
        </TouchableOpacity>
      )}
      {trip.status === 'DRIVER_ARRIVED' && (
        <TouchableOpacity style={styles.btn} onPress={start} disabled={loading}>
          <Text style={styles.btnText}>{loading ? '…' : 'Iniciar viaje'}</Text>
        </TouchableOpacity>
      )}
      {trip.status === 'IN_PROGRESS' && (
        <>
          <TextInput style={styles.input} placeholder="Taxímetro (centavos)" value={metered} onChangeText={setMetered} keyboardType="numeric" />
          <TouchableOpacity style={styles.btn} onPress={complete} disabled={loading}>
            <Text style={styles.btnText}>{loading ? '…' : 'Completar viaje'}</Text>
          </TouchableOpacity>
        </>
      )}
      {['ASSIGNED', 'DRIVER_ARRIVED'].includes(trip.status) && (
        <TouchableOpacity style={[styles.btn, { backgroundColor: '#A31F1F', marginTop: 8 }]} onPress={cancel} disabled={loading}>
          <Text style={styles.btnText}>{loading ? '…' : 'Cancelar'}</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={[styles.btn, { backgroundColor: '#B3261E', marginTop: 16 }]} onPress={panico} disabled={loading}>
        <Text style={styles.btnText}>{loading ? '…' : '🚨 Botón de pánico'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F4F8F8' },
  title: { fontSize: 22, fontWeight: '700', color: '#0A3A3C', textAlign: 'center', marginBottom: 16 },
  sub: { fontSize: 14, color: '#34454D', textAlign: 'center', marginBottom: 8 },
  input: { height: 48, borderWidth: 2, borderColor: '#4F5F67', borderRadius: 10, paddingHorizontal: 12, fontSize: 16, color: '#0A3A3C', backgroundColor: '#fff', marginBottom: 12 },
  btn: { height: 48, backgroundColor: '#0F6B72', borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});