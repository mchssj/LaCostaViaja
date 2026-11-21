import { resolveSeason, resolveTimeBand, type SeasonPeriod } from './tariff';
import { isMinuteInWindow, parseTimeOfDay, toLocalParts } from './time';

const NIGHT = { nightStartsAt: '22:00', nightEndsAt: '06:00' };

describe('franja horaria (hora argentina)', () => {
  it.each([
    ['2026-11-21T01:30:00Z', '2026-11-20', 22 * 60 + 30, 'NIGHT'], // 22:30 local del día anterior
    ['2026-11-20T09:00:00Z', '2026-11-20', 6 * 60, 'DAY'], // 06:00 → fin exclusivo
    ['2026-11-20T08:59:00Z', '2026-11-20', 5 * 60 + 59, 'NIGHT'],
    ['2026-11-21T00:59:00Z', '2026-11-20', 21 * 60 + 59, 'DAY'],
    ['2026-11-21T01:00:00Z', '2026-11-20', 22 * 60, 'NIGHT'], // 22:00 → inicio inclusivo
    ['2026-11-21T03:00:00Z', '2026-11-21', 0, 'NIGHT'], // medianoche
  ])('%s → %s %i min → %s', (iso, isoDate, minute, band) => {
    const local = toLocalParts(new Date(iso));
    expect(local.isoDate).toBe(isoDate);
    expect(local.minuteOfDay).toBe(minute);
    expect(resolveTimeBand(local.minuteOfDay, NIGHT)).toBe(band);
  });

  it('soporta ventanas que no cruzan medianoche', () => {
    expect(isMinuteInWindow(parseTimeOfDay('13:00'), parseTimeOfDay('12:00'), parseTimeOfDay('14:00'))).toBe(true);
    expect(isMinuteInWindow(parseTimeOfDay('14:00'), parseTimeOfDay('12:00'), parseTimeOfDay('14:00'))).toBe(false);
  });

  it('rechaza horas mal formadas', () => {
    expect(() => parseTimeOfDay('24:00')).toThrow();
    expect(() => parseTimeOfDay('7:00')).toThrow();
  });
});

describe('temporada', () => {
  const periods: SeasonPeriod[] = [
    { name: 'Verano', season: 'HIGH', startsOn: '2026-12-15', endsOnExclusive: '2027-03-15' },
    { name: 'Baja especial', season: 'LOW', startsOn: '2027-01-01', endsOnExclusive: '2027-01-02' },
  ];

  it('HIGH dentro del período, LOW en el día de fin (exclusivo) y fuera', () => {
    expect(resolveSeason('2027-01-15', periods)).toEqual({ season: 'HIGH', periodName: 'Verano' });
    expect(resolveSeason('2027-03-15', periods)).toEqual({ season: 'LOW', periodName: null });
    expect(resolveSeason('2026-11-20', periods)).toEqual({ season: 'LOW', periodName: null });
  });

  it('HIGH prevalece si se superpone con un período LOW', () => {
    expect(resolveSeason('2027-01-01', periods).season).toBe('HIGH');
  });
});
