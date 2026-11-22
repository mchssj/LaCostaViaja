'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

// Eje aproximado de la RP11 (norte → sur) dentro del Partido de La Costa.
const RP11: [number, number][] = [
  [-36.35, -56.72], [-36.40, -56.71], [-36.45, -56.70], [-36.50, -56.695],
  [-36.54, -56.693], [-36.58, -56.69], [-36.62, -56.688], [-36.66, -56.685],
  [-36.6875, -56.68], [-36.70, -56.68], [-36.716, -56.68],
];

// Móviles activos (mock; en producción vienen de Redis/presencia).
const MOBILES: { lat: number; lng: number; plate: string }[] = [
  { lat: -36.6875, lng: -56.68, plate: 'AE123BC' },
  { lat: -36.537, lng: -56.693, plate: 'AD789FG' },
  { lat: -36.716, lng: -56.682, plate: 'AG987MN' },
];

// Alertas COM activas (mock).
const ALERTS: { lat: number; lng: number; plate: string }[] = [
  { lat: -36.6875, lng: -56.68, plate: 'AF 412 KD' },
];

export default function MapaCorredor() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <div className="h-full w-full bg-[#EEF2EC]" />;

  return (
    <MapContainer
      center={[-36.55, -56.69]}
      zoom={11}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Polyline positions={RP11} color="#B9C7C2" weight={6} />
      <Polyline positions={RP11} color="#fff" weight={3} />
      {MOBILES.map((m, i) => (
        <CircleMarker key={i} center={[m.lat, m.lng]} radius={6} color="#fff" weight={2.5} fillColor="#0F6B72" fillOpacity={1}>
          <Popup>{m.plate}</Popup>
        </CircleMarker>
      ))}
      {ALERTS.map((a, i) => (
        <CircleMarker key={`a-${i}`} center={[a.lat, a.lng]} radius={11} color="#fff" weight={3.5} fillColor="#B3261E" fillOpacity={1}>
          <Popup>Alerta COM · {a.plate}</Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}