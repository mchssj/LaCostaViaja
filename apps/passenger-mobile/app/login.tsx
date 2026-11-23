import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { apiFetch, setToken } from '../lib/api';

export default function Login() {
  const router = useRouter();
  const [origin, setOrigin] = useState('-36.6875,-56.68');
  const [destination, setDestination] = useState('-36.716,-56.68');
  const [loading, setLoading] = useState(false);

  async function start() {
    setLoading(true);
    try {
      const data = await apiFetch<{ accessToken: string }>('/auth/guest', { method: 'POST', body: JSON.stringify({ qrCode: 'demo-qr' }) });
      await setToken(data.accessToken);
      // Guardar origen/destino en AsyncStorage.
      const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
      await AsyncStorage.setItem('lc_origin', origin);
      await AsyncStorage.setItem('lc_destination', destination);
      router.replace('/cotizar');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LaCostaViaja — Pasajero</Text>
      <Text style={styles.sub}>Modo invitado: pedí tu taxi o remis sin registrarte.</Text>
      <TextInput style={styles.input} placeholder="Origen (lat,lng)" value={origin} onChangeText={setOrigin} />
      <TextInput style={styles.input} placeholder="Destino (lat,lng)" value={destination} onChangeText={setDestination} />
      <TouchableOpacity style={styles.btn} onPress={start} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Ingresando…' : 'Continuar'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F4F8F8' },
  title: { fontSize: 22, fontWeight: '700', color: '#0A3A3C', textAlign: 'center', marginBottom: 8 },
  sub: { fontSize: 14, color: '#34454D', textAlign: 'center', marginBottom: 24 },
  input: { height: 48, borderWidth: 2, borderColor: '#4F5F67', borderRadius: 10, paddingHorizontal: 12, fontSize: 16, color: '#0A3A3C', backgroundColor: '#fff', marginBottom: 12 },
  btn: { height: 48, backgroundColor: '#0F6B72', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});