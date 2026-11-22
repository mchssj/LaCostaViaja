'use client';

import { useEffect, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

type P = { lat: number; lng: number };

const pin = (bg: string, label: string, size = 30) =>
  L.divIcon({
    className: '',
    html: `<div class="pin" style="width:${size}px;height:${size}px;background:${bg};color:#fff">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

const ICONS = {
  car: pin('#0A3A3C', '🚕', 36),
  origin: pin('#0F6B72', 'A'),
  destination: pin('#B3261E', 'B'),
};

/**
 * Encuadra el auto y los puntos de referencia. Solo reencuadra cuando cambian las referencias
 * (A/B) o cuando el auto aparece por primera vez, no con cada ping (el chofer puede mover el mapa).
 */
function Fit({ car, points }: { car: P | null | undefined; points: P[] }) {
  const map = useMap();
  const key = `${car ? 'car' : 'nocar'}|${points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')}`;
  useEffect(() => {
    const all = [...(car ? [car] : []), ...points];
    if (all.length === 0) return;
    if (all.length === 1) map.setView([all[0]!.lat, all[0]!.lng], 15);
    else map.fitBounds(L.latLngBounds(all.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 16 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/** Mapa del viaje: auto, punto de encuentro (A) y destino (B). */
export default function TripMap({ car, origin, destination, focus }: { car?: P | null; origin?: P | null; destination?: P | null; focus: P[] }) {
  // Clave por instancia: con Fast Refresh / StrictMode, Leaflet no admite reusar el mismo contenedor.
  const [instance] = useState(() => Math.random().toString(36).slice(2));
  const center = car ?? origin ?? { lat: -36.6875, lng: -56.68 };
  return (
    <MapContainer key={instance} center={[center.lat, center.lng]} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false} attributionControl>
      <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {origin && <Marker position={[origin.lat, origin.lng]} icon={ICONS.origin} />}
      {destination && <Marker position={[destination.lat, destination.lng]} icon={ICONS.destination} />}
      {origin && destination && <Polyline positions={[[origin.lat, origin.lng], [destination.lat, destination.lng]]} pathOptions={{ color: '#0F6B72', weight: 3, dashArray: '6 8' }} />}
      {car && <Marker position={[car.lat, car.lng]} icon={ICONS.car} zIndexOffset={1000} />}
      <Fit car={car} points={focus} />
    </MapContainer>
  );
}
