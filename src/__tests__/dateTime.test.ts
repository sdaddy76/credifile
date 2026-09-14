import { formatRomeDate, formatRomeDateTime, formatRomeTime, APP_TIME_ZONE } from '@/lib/dateTime';

describe('dateTime Credifile', () => {
  it('usa sempre il fuso Europe/Rome', () => {
    expect(APP_TIME_ZONE).toBe('Europe/Rome');
    // 22:30 UTC del 13 settembre = 00:30 del 14 settembre a Roma (CEST).
    expect(formatRomeDateTime('2026-09-13T22:30:00.000Z')).toContain('14/09/26');
    expect(formatRomeTime('2026-09-13T22:30:00.000Z')).toBe('00:30');
  });

  it('gestisce le date non valide senza rompere la UI', () => {
    expect(formatRomeDate('not-a-date')).toBe('—');
    expect(formatRomeDateTime(null)).toBe('—');
  });
});
