import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerStyle: { backgroundColor: '#0F6B72' }, headerTintColor: '#fff' }}>
        <Stack.Screen name="index" options={{ title: 'LaCostaViaja Chofer' }} />
        <Stack.Screen name="login" options={{ title: 'Ingreso' }} />
        <Stack.Screen name="turno" options={{ title: 'Turno' }} />
        <Stack.Screen name="oferta" options={{ title: 'Oferta' }} />
        <Stack.Screen name="viaje" options={{ title: 'Viaje' }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}