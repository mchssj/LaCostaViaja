import { TRIP_TRANSITIONS } from '@lacosta/domain';
import { ACTION_FROM, driverActions, passengerCanCancel, passengerStep } from './trip';

describe('trip', () => {
  it('ACTION_FROM coincide con TRIP_TRANSITIONS del dominio', () => {
    for (const [action, from] of Object.entries(ACTION_FROM)) {
      expect([...from].sort()).toEqual([...TRIP_TRANSITIONS[action as keyof typeof TRIP_TRANSITIONS].from].sort());
    }
  });

  it('acciones del chofer por estado', () => {
    const keys = (status: any, arrivedAgoMs = 0) =>
      driverActions({ status, driver_arrived_at: new Date(1_000_000 - arrivedAgoMs).toISOString() }, 1_000_000, 300_000).map((a) => a.key);
    expect(keys('ASSIGNED')).toEqual(['arrived', 'withdraw']);
    expect(keys('DRIVER_ARRIVED')).toEqual(['start', 'noShow']);
    expect(keys('IN_PROGRESS')).toEqual(['complete']);
    expect(keys('COMPLETED')).toEqual([]);
  });

  it('"no se presentó" queda deshabilitado hasta cumplir la espera', () => {
    const early = driverActions({ status: 'DRIVER_ARRIVED', driver_arrived_at: new Date(1_000_000 - 60_000).toISOString() }, 1_000_000, 300_000);
    expect(early.find((a) => a.key === 'noShow')?.availableInMs).toBe(240_000);
    const late = driverActions({ status: 'DRIVER_ARRIVED', driver_arrived_at: new Date(1_000_000 - 400_000).toISOString() }, 1_000_000, 300_000);
    expect(late.find((a) => a.key === 'noShow')?.availableInMs).toBeUndefined();
  });

  it('pasos y cancelación del pasajero', () => {
    expect(passengerStep('SEARCHING')).toBe(0);
    expect(passengerStep('IN_PROGRESS')).toBe(3);
    expect(passengerStep('NO_DRIVER_AVAILABLE')).toBe(-1);
    expect(passengerCanCancel('DRIVER_ARRIVED')).toBe(true);
    expect(passengerCanCancel('IN_PROGRESS')).toBe(false);
  });
});
