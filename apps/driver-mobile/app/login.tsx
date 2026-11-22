import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { apiFetch, setToken } from '../lib/api';

export default function Login() {
  const router = useRouter();
  const [dni, setDni] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true);
    try {
      const data = await apiFetch<{ accessToken: string }>('/auth/driver/login', {
        method: 'POST',
        body: JSON.stringify({ dni, pin }),
      });
      await setToken(data.accessToken);
      router.replace('/turno');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LaCostaViaja — Chofer</Text>
      <TextInput style={styles.input} placeholder="DNI" value={dni} onChangeText={setDni} keyboardType="numeric" />
      <TextInput style={styles.input} placeholder="PIN (6 dígitos)" value={pin} onChangeText={setPin} secureTextEntry keyboardType="numeric" maxLength={6} />
      <TouchableOpacity style={styles.btn} onPress={login} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Ingresando…' : 'Ingresar'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#F4F8F8' },
  title: { fontSize: 22, fontWeight: '700', color: '#0A3A3C', textAlign: 'center', marginBottom: 24 },
  input: { height: 48, borderWidth: 2, borderColor: '#4F5F67', borderRadius: 10, paddingHorizontal: 12, fontSize: 16, color: '#0A3A3C', backgroundColor: '#fff', marginBottom: 12 },
  btn: { height: 48, backgroundColor: '#0F6B72', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});