import { buildPracticeTimeline, normalizePrimaryStatus } from '@/lib/practiceTimeline';
import type { PracticeIntegrationRequest } from '@/lib/types';

const request = (
  id: string,
  origin_status: string,
  status: PracticeIntegrationRequest['status'] = 'open',
  requested_at = '2026-09-04T10:00:00.000Z'
): PracticeIntegrationRequest => ({
  id,
  practice_id: 'practice-1',
  origin_status,
  status,
  requested_at,
  created_at: requested_at,
  updated_at: requested_at,
});

describe('practice timeline', () => {
  it.each([
    ['raccolta_documenti', 2],
    ['inviata_banca', 3],
    ['istruttoria', 4],
    ['in_delibera', 5],
  ])('inserisce una integrazione subito dopo %s', (origin, expectedIndex) => {
    const timeline = buildPracticeTimeline('in_delibera', [request('req-1', origin)]);

    expect(timeline[expectedIndex]).toMatchObject({
      kind: 'integration',
      key: 'integration-req-1',
      state: 'active',
    });
  });

  it('mantiene più cicli in fasi differenti e in ordine cronologico', () => {
    const timeline = buildPracticeTimeline('in_delibera', [
      request('req-2', 'istruttoria', 'open', '2026-09-04T12:00:00.000Z'),
      request('req-1', 'inviata_banca', 'completed', '2026-09-03T12:00:00.000Z'),
    ]);

    expect(timeline.filter(item => item.kind === 'integration')).toEqual([
      expect.objectContaining({ key: 'integration-req-1', state: 'completed' }),
      expect.objectContaining({ key: 'integration-req-2', state: 'active' }),
    ]);
    expect(timeline.find(item => item.kind === 'primary' && item.key === 'in_delibera'))
      .toMatchObject({ state: 'current' });
  });

  it('normalizza gli stati legacy senza far retrocedere la timeline', () => {
    expect(normalizePrimaryStatus('completata')).toBe('istruttoria');
    expect(normalizePrimaryStatus('approvata')).toBe('deliberata');
    expect(normalizePrimaryStatus('declinata')).toBe('deliberata');
  });
});

