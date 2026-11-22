import { DomainError } from './errors';
import { InvalidTransitionError, planTripTransition, TRIP_TRANSITIONS, type TripAction } from './trip-lifecycle';
import { summarizeTrack } from './track-summary';

describe('máquina de estados del viaje', () => {
  it('camino feliz del chofer', () => {
    expect(planTripTransition('ASSIGNED', 'DRIVER_ARRIVED', 'DRIVER').to).toBe('DRIVER_ARRIVED');
    expect(planTripTransition('DRIVER_ARRIVED', 'START', 'DRIVER').to).toBe('IN_PROGRESS');
    expect(planTripTransition('IN_PROGRESS', 'COMPLETE', 'DRIVER').to).toBe('COMPLETED');
  });

  it('el chofer que se baja antes de llegar devuelve el viaje a búsqueda', () => {
    expect(planTripTransition('ASSIGNED', 'DRIVER_CANCEL', 'DRIVER')).toMatchObject({ to: 'SEARCHING', eventType: 'DRIVER_WITHDREW' });
    expect(() => planTripTransition('IN_PROGRESS', 'DRIVER_CANCEL', 'DRIVER')).toThrow(InvalidTransitionError);
  });

  it('rechaza actores que no corresponden', () => {
    expect(() => planTripTransition('ASSIGNED', 'DRIVER_ARRIVED', 'PASSENGER')).toThrow(DomainError);
    expect(() => planTripTransition('IN_PROGRESS', 'COMPLETE', 'PASSENGER')).toThrow(/no puede/);
    expect(() => planTripTransition('SEARCHING', 'PASSENGER_CANCEL', 'DRIVER')).toThrow(/no puede/);
  });

  it('el pasajero no cancela un viaje en curso ni uno cerrado; el operador sí cancela en curso', () => {
    expect(() => planTripTransition('IN_PROGRESS', 'PASSENGER_CANCEL', 'PASSENGER')).toThrow(InvalidTransitionError);
    expect(() => planTripTransition('COMPLETED', 'PASSENGER_CANCEL', 'PASSENGER')).toThrow(InvalidTransitionError);
    expect(planTripTransition('IN_PROGRESS', 'OPERATOR_CANCEL', 'OPERATOR').to).toBe('CANCELLED_BY_OPERATOR');
  });

  it('"no se presentó" exige la espera mínima en la puerta', () => {
    const arrived = new Date('2026-11-22T12:00:00Z');
    expect(() =>
      planTripTransition('DRIVER_ARRIVED', 'DRIVER_NO_SHOW', 'DRIVER', {
        driverArrivedAt: arrived,
        now: new Date('2026-11-22T12:03:00Z'),
        noShowWaitMs: 300_000,
      }),
    ).toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'NO_SHOW_WAIT_NOT_REACHED', remainingSeconds: 120 }) }));
    expect(
      planTripTransition('DRIVER_ARRIVED', 'DRIVER_NO_SHOW', 'DRIVER', {
        driverArrivedAt: arrived,
        now: new Date('2026-11-22T12:05:00Z'),
        noShowWaitMs: 300_000,
      }).to,
    ).toBe('CANCELLED_BY_DRIVER');
  });

  it('ninguna transición sale de un estado terminal', () => {
    for (const action of Object.keys(TRIP_TRANSITIONS) as TripAction[]) {
      for (const terminal of ['COMPLETED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_OPERATOR', 'NO_DRIVER_AVAILABLE'] as const) {
        expect(TRIP_TRANSITIONS[action].from).not.toContain(terminal);
      }
    }
  });
});

describe('summarizeTrack', () => {
  const t0 = Date.UTC(2026, 10, 22, 12, 0, 0);
  it('suma la distancia y descarta imprecisos y saltos imposibles', () => {
    const s = summarizeTrack([
      { lat: -36.6875, lng: -56.68, recordedAt: t0 },
      { lat: -36.6965, lng: -56.68, recordedAt: t0 + 60_000 }, // ~1 km en 1 min
      { lat: -36.75, lng: -56.68, recordedAt: t0 + 61_000 }, // salto imposible
      { lat: -36.7, lng: -56.68, recordedAt: t0 + 90_000, accuracyM: 500 }, // impreciso
      { lat: -36.7055, lng: -56.68, recordedAt: t0 + 120_000 }, // ~1 km más
    ]);
    expect(s.distanceMeters).toBeGreaterThan(1_950);
    expect(s.distanceMeters).toBeLessThan(2_050);
    expect(s).toMatchObject({ durationSeconds: 120, usedPoints: 3, discardedPoints: 2 });
  });

  it('recorrido vacío', () => {
    expect(summarizeTrack([])).toEqual({ distanceMeters: 0, durationSeconds: 0, usedPoints: 0, discardedPoints: 0 });
  });
});
