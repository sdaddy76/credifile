const mockAssignments = jest.fn();
const mockProfiles = jest.fn();
const mockEq = jest.fn();
const mockOrder = jest.fn();
const mockAssignmentSelect = jest.fn();
const mockProfileSelect = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args) },
}));

import { loadAgentSecretaries } from '@/lib/loadAgentSecretaries';

describe('loadAgentSecretaries', () => {
  beforeEach(() => {
    mockAssignments.mockResolvedValue({ data: [], error: null });
    mockProfiles.mockResolvedValue({ data: [], error: null });
    const query = { eq: mockEq, then: (resolve: (value: unknown) => unknown) => mockAssignments().then(resolve) };
    mockEq.mockReturnValue(query);
    mockOrder.mockReturnValue(query);
    mockAssignmentSelect.mockReturnValue({ order: mockOrder });
    mockProfileSelect.mockReturnValue({ in: mockProfiles });
    mockFrom.mockImplementation(table => ({ select: table === 'admin_profiles' ? mockProfileSelect : mockAssignmentSelect }));
  });

  it('does not query profiles without assignments', async () => {
    expect(await loadAgentSecretaries()).toEqual({});
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockAssignmentSelect).toHaveBeenCalledWith('agent_user_id,segreteria_user_id');
  });

  it('maps visible profiles without an embedded relationship and deduplicates ids', async () => {
    mockAssignments.mockResolvedValue({ data: [
      { agent_user_id: 'a', segreteria_user_id: 's' },
      { agent_user_id: 'b', segreteria_user_id: 's' },
      { agent_user_id: 'c', segreteria_user_id: 'not-visible' },
    ], error: null });
    mockProfiles.mockResolvedValue({ data: [{ id: 's', nome: 'Segreteria', email: 'segreteria@example.test' }], error: null });
    expect(await loadAgentSecretaries()).toEqual({
      a: { nome: 'Segreteria', email: 'segreteria@example.test' },
      b: { nome: 'Segreteria', email: 'segreteria@example.test' },
    });
    expect(mockProfiles).toHaveBeenCalledWith('id', ['s', 'not-visible']);
  });

  it('filters a single agent and preserves the first visible assignment', async () => {
    mockAssignments.mockResolvedValue({ data: [
      { agent_user_id: 'a', segreteria_user_id: 's' },
      { agent_user_id: 'a', segreteria_user_id: 't' },
    ], error: null });
    mockProfiles.mockResolvedValue({ data: [
      { id: 's', nome: null, email: 'first@example.test' },
      { id: 't', nome: 'Second', email: 'second@example.test' },
    ], error: null });
    expect((await loadAgentSecretaries('a')).a.email).toBe('first@example.test');
    expect(mockEq).toHaveBeenCalledWith('agent_user_id', 'a');
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: true });
  });

  it.each(['assignments', 'profiles'])('reports errors reading %s', async source => {
    mockAssignments.mockResolvedValue({ data: [{ agent_user_id: 'a', segreteria_user_id: 's' }], error: null });
    (source === 'assignments' ? mockAssignments : mockProfiles).mockResolvedValue({ data: null, error: { message: 'Lettura negata' } });
    await expect(loadAgentSecretaries()).rejects.toThrow('Lettura negata');
  });
});
