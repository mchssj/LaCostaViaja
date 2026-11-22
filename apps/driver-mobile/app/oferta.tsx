import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { apiFetch } from '../lib/api';

export default function Oferta() {
  const router = useRouter();
  const [offer, setOffer] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const o = await apiFetch<any>('/drivers/me/offer');
      setOffer(o);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }

  useEffect(() => { load(); const t = setInterval(load, 3000); return () => clearInterval(t); }, []);

  async function accept() {
    if (!offer) return;
    setLoading(true);
    try {
      await apiFetch(`/offers/${offer.offer_id}/accept`, { method: 'POST', body: JSON.stringify({ tripId: offer.trip_id }) });
      await setTripIdGlobal(offer.trip_id);
      router.replace('/viaje');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function reject() {
    if (!offer) return;
    setLoading(true);
    try {
      await apiFetch(`/offers/${offer.offer_id}/reject`, { method: 'POST', body: JSON.stringify({ tripId: offer.trip_id }) });
      setOffer(null);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  if (!offer) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Esperando ofertas…</Text>
        <TouchableOpacity style={styles.btn} onPress={load}>
          <Text style={styles.btnText}>Actualizar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nueva oferta</Text>
      <Text style={styles.sub}>Viaje: {offer.trip_id?.slice(0, 8)}</Text>
      <Text style={styles.sub}>ETA: {offer.eta_seconds}s · Score: {offer.score_seconds}s</Text>
      <Text style={styles.sub}>Tarifa: ${(offer.quoted_fare_cents / 100).toFixed(2)}</Text>
      <TouchableOpacity style={styles.btn} onPress={accept} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Aceptando…' : 'Aceptar'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, { backgroundColor: '#A31F1F', marginTop: 8 }]} onPress={reject} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Rechazando…' : 'Rechazar'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// helper para guardar tripId (importado lazy para evitar circular)
async function setTripIdGlobal(id: string) {
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem('lc_trip_id', id);
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F4F8F8' },
  title: { fontSize: 22, fontWeight: '700', color: '#0A3A3C', textAlign: 'center', marginBottom: 16 },
  sub: { fontSize: 14, color: '#34454D', textAlign: 'center', marginBottom: 8 },
  btn: { height: 48, backgroundColor: '#0F6B72', borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});