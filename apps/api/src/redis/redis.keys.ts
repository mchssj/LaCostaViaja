import type { ServiceType } from '@lacosta/domain';

/** Todas las claves de Redis del sistema, en un solo lugar (prefijo `lc:`). */
export const RK = {
  driver: (driverId: string): string => `lc:driver:${driverId}`,
  vehicleShift: (vehicleId: string): string => `lc:vehicle:${vehicleId}:driver`,
  geo: (service: ServiceType): string => `lc:geo:${service}`,
  corridor: (service: ServiceType): string => `lc:corridor:${service}`,
  zoneQueue: (zoneId: string | null): string => `lc:zone:${zoneId ?? 'none'}:queue`,
  lastSeen: 'lc:drivers:lastseen',
  rejections: (driverId: string): string => `lc:driver:${driverId}:rejections`,
  offer: (tripId: string): string => `lc:trip:${tripId}:offer`,
  lock: (tripId: string): string => `lc:trip:${tripId}:lock`,
  lease: (tripId: string): string => `lc:trip:${tripId}:dispatcher`,
  deadlines: 'lc:offers:deadlines',
  track: 'lc:gps:track',
} as const;

/** Miembro del ZSET de vencimientos: "tripId|driverId|offerId". */
export const deadlineMember = (tripId: string, driverId: string, offerId: string): string => `${tripId}|${driverId}|${offerId}`;

export function parseDeadlineMember(member: string): { tripId: string; driverId: string; offerId: string } | null {
  const [tripId, driverId, offerId] = member.split('|');
  return tripId && driverId && offerId ? { tripId, driverId, offerId } : null;
}
