import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerStyle: { backgroundColor: '#0F6B72' }, headerTintColor: '#fff' }}>
        <Stack.Screen name="index" options={{ title: 'LaCostaViaja Pasajero' }} />
        <Stack.Screen name="login" options={{ title: 'Ingreso' }} />
        <Stack.Screen name="cotizar" options={{ title: 'Cotización' }} />
        <Stack.Screen name="seguimiento" options={{ title: 'Seguimiento' }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}