import type { PracticeIntegrationRequest, PracticeStatus } from '@/lib/types';

export type PrimaryWorkflowStep =
  | 'bozza'
  | 'raccolta_documenti'
  | 'inviata_banca'
  | 'istruttoria'
  | 'in_delibera'
  | 'deliberata'
  | 'erogata';

export type PracticeTimelineItem =
  | {
      kind: 'primary';
      key: PrimaryWorkflowStep;
      label: string;
      state: 'past' | 'current' | 'future';
    }
  | {
      kind: 'integration';
      key: string;
      label: string;
      state: 'active' | 'completed' | 'cancelled';
      request: PracticeIntegrationRequest;
    };

export const PRIMARY_WORKFLOW_STEPS: Array<{
  key: PrimaryWorkflowStep;
  label: string;
}> = [
  { key: 'bozza', label: 'Bozza' },
  { key: 'raccolta_documenti', label: 'Raccolta Documentazione' },
  { key: 'inviata_banca', label: 'Inviata a Banca' },
  { key: 'istruttoria', label: 'Istruttoria' },
  { key: 'in_delibera', label: 'In Delibera' },
  { key: 'deliberata', label: 'Deliberata' },
  { key: 'erogata', label: 'Erogata' },
];

export function normalizePrimaryStatus(status: PracticeStatus | string): PrimaryWorkflowStep {
  switch (status) {
    case 'raccolta_documenti':
    case 'inviata_banca':
    case 'istruttoria':
    case 'in_delibera':
    case 'deliberata':
    case 'erogata':
      return status;
    case 'completata':
      return 'istruttoria';
    case 'approvata':
    case 'rifiutata':
    case 'declinata':
      return 'deliberata';
    case 'integrazioni_richieste':
      return 'raccolta_documenti';
    case 'bozza':
    default:
      return 'bozza';
  }
}

export function buildPracticeTimeline(
  currentStatus: PracticeStatus | string,
  integrationRequests: PracticeIntegrationRequest[]
): PracticeTimelineItem[] {
  const currentPrimary = normalizePrimaryStatus(currentStatus);
  const currentIndex = PRIMARY_WORKFLOW_STEPS.findIndex(step => step.key === currentPrimary);
  const integrationsByOrigin = new Map<PrimaryWorkflowStep, PracticeIntegrationRequest[]>();

  [...integrationRequests]
    .sort((left, right) => (
      new Date(left.requested_at).getTime() - new Date(right.requested_at).getTime()
    ))
    .forEach(request => {
      const origin = normalizePrimaryStatus(request.origin_status);
      const existing = integrationsByOrigin.get(origin) ?? [];
      existing.push(request);
      integrationsByOrigin.set(origin, existing);
    });

  return PRIMARY_WORKFLOW_STEPS.flatMap((step, index): PracticeTimelineItem[] => {
    const primary: PracticeTimelineItem = {
      kind: 'primary',
      key: step.key,
      label: step.label,
      state: index < currentIndex ? 'past' : index === currentIndex ? 'current' : 'future',
    };
    const integrations = (integrationsByOrigin.get(step.key) ?? []).map(
      (request, requestIndex): PracticeTimelineItem => ({
        kind: 'integration',
        key: `integration-${request.id}`,
        label: integrationRequests.length > 1
          ? `Integrazione Richiesta ${requestIndex + 1}`
          : 'Integrazione Richiesta',
        state: request.status === 'open'
          ? 'active'
          : request.status === 'cancelled'
            ? 'cancelled'
            : 'completed',
        request,
      })
    );

    return [primary, ...integrations];
  });
}

