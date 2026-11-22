import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { apiFetch, clearToken } from '../lib/api';

export default function Turno() {
  const router = useRouter();
  const [vehicleId, setVehicleId] = useState('');
  const [prefersInterurban, setPrefersInterurban] = useState(true);
  const [onShift, setOnShift] = useState(false);
  const [loading, setLoading] = useState(false);
  const [backhaulNotice, setBackhaulNotice] = useState<string | null>(null);

  async function startShift() {
    setLoading(true);
    try {
      await apiFetch('/drivers/me/shift', { method: 'POST', body: JSON.stringify({ vehicleId }) });
      setOnShift(true);
      Alert.alert('Turno iniciado', prefersInterurban ? 'Preferencia: interurbano habilitado' : 'Preferencia: solo urbano');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  // Aviso de Viaje de Vuelta: al terminar un viaje interurbano, el chofer queda en modo backhaul.
  function notifyBackhaul(destination: string) {
    setBackhaulNotice(`Viaje de Vuelta activo: podés aceptar viajes hacia ${destination} con bonificación.`);
  }

  async function endShift() {
    setLoading(true);
    try {
      await apiFetch('/drivers/me/shift', { method: 'DELETE' });
      setOnShift(false);
      Alert.alert('Turno cerrado');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await clearToken();
    router.replace('/login');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Turno</Text>
      {!onShift ? (
        <>
          <TextInput style={styles.input} placeholder="ID del vehículo" value={vehicleId} onChangeText={setVehicleId} />
          <TouchableOpacity style={[styles.toggle, prefersInterurban && styles.toggleOn]} onPress={() => setPrefersInterurban(!prefersInterurban)}>
            <Text style={styles.toggleText}>{prefersInterurban ? '✓ Interurbano habilitado' : 'Solo urbano'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={startShift} disabled={loading}>
            <Text style={styles.btnText}>{loading ? 'Iniciando…' : 'Iniciar turno'}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          {backhaulNotice && <View style={styles.banner}><Text style={styles.bannerText}>{backhaulNotice}</Text></View>}
          <Text style={styles.sub}>Turno activo. Esperando ofertas…</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.push('/oferta')}>
            <Text style={styles.btnText}>Ver oferta</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { backgroundColor: '#A31F1F', marginTop: 12 }]} onPress={endShift} disabled={loading}>
            <Text style={styles.btnText}>{loading ? 'Cerrando…' : 'Cerrar turno'}</Text>
          </TouchableOpacity>
        </>
      )}
      <TouchableOpacity style={{ marginTop: 24 }} onPress={logout}>
        <Text style={{ color: '#0F6B72', fontWeight: '600' }}>Cerrar sesión</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F4F8F8' },
  title: { fontSize: 22, fontWeight: '700', color: '#0A3A3C', textAlign: 'center', marginBottom: 24 },
  sub: { fontSize: 14, color: '#34454D', textAlign: 'center', marginBottom: 16 },
  input: { height: 48, borderWidth: 2, borderColor: '#4F5F67', borderRadius: 10, paddingHorizontal: 12, fontSize: 16, color: '#0A3A3C', backgroundColor: '#fff', marginBottom: 12 },
  btn: { height: 48, backgroundColor: '#0F6B72', borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  toggle: { height: 44, borderWidth: 2, borderColor: '#4F5F67', borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 12, backgroundColor: '#fff' },
  toggleOn: { borderColor: '#0F6B72', backgroundColor: '#E6F4F5' },
  toggleText: { color: '#0A3A3C', fontWeight: '600', fontSize: 14 },
  banner: { backgroundColor: '#FFF1CC', borderRadius: 10, padding: 12, marginBottom: 12 },
  bannerText: { color: '#7A5200', fontSize: 13, fontWeight: '600' },
});