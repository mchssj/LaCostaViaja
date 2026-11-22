'use client';

import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

type P = { lat: number; lng: number };

const pin = (bg: string, label: string, size = 32) =>
  L.divIcon({
    className: '',
    html: `<div class="pin" style="width:${size}px;height:${size}px;background:${bg};color:#fff">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

const ICONS = {
  origin: pin('#0F6B72', 'A'),
  destination: pin('#B3261E', 'B'),
  car: pin('#0A3A3C', '🚕', 38),
  me: L.divIcon({ className: '', html: '<div style="width:16px;height:16px;border-radius:9999px;background:#1D6FE0;border:3px solid #fff;box-shadow:0 0 0 6px rgba(29,111,224,.25)"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
};

function Clicks({ onPick }: { onPick?: (p: P) => void }) {
  useMapEvents({ click: (e) => onPick?.({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Encuadra cuando cambian los puntos de referencia (no con cada movimiento del auto). */
function Fit({ points, fitKey }: { points: P[]; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView([points[0]!.lat, points[0]!.lng], 16);
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [44, 44], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

export default function PickMap({
  origin,
  destination,
  car,
  me,
  onPick,
  fit,
}: {
  origin?: P | null;
  destination?: P | null;
  car?: P | null;
  me?: P | null;
  onPick?: (p: P) => void;
  /** Puntos a encuadrar y una clave que cambia cuando hay que reencuadrar. */
  fit: { points: P[]; key: string };
}) {
  // Clave por instancia: con Fast Refresh / StrictMode, Leaflet no admite reusar el mismo contenedor.
  const [instance] = useState(() => Math.random().toString(36).slice(2));
  const center = origin ?? me ?? { lat: -36.6875, lng: -56.68 };
  return (
    <MapContainer key={instance} center={[center.lat, center.lng]} zoom={15} style={{ height: '100%', width: '100%' }} zoomControl={false}>
      <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Clicks onPick={onPick} />
      {me && <Marker position={[me.lat, me.lng]} icon={ICONS.me} />}
      {origin && <Marker position={[origin.lat, origin.lng]} icon={ICONS.origin} />}
      {destination && <Marker position={[destination.lat, destination.lng]} icon={ICONS.destination} />}
      {origin && destination && (
        <Polyline positions={[[origin.lat, origin.lng], [destination.lat, destination.lng]]} pathOptions={{ color: '#0F6B72', weight: 3, dashArray: '6 8' }} />
      )}
      {car && <Marker position={[car.lat, car.lng]} icon={ICONS.car} zIndexOffset={1000} />}
      <Fit points={fit.points} fitKey={fit.key} />
    </MapContainer>
  );
}
