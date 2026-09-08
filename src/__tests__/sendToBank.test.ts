import { supabase } from '@/lib/supabase';
import { invokeSendToBank } from '@/lib/sendToBank';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
  },
}));

const getSessionMock = supabase.auth.getSession as jest.Mock;

describe('invokeSendToBank', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('recupera la sessione Supabase e invia il token alla funzione Vercel', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: 'test-access-token' } },
      error: null,
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      success: true,
      message_id: 'message-1',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    const result = await invokeSendToBank({
      practice_id: 'practice-1',
      bank_id: 'bank-1',
      note: 'Invio test',
    });

    expect(result.error).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('/api/send-to-bank', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-access-token',
      }),
    }));
  });

  it('blocca l’invio quando la sessione non è disponibile', async () => {
    getSessionMock.mockResolvedValue({
      data: { session: null },
      error: null,
    });
    const fetchMock = jest.spyOn(global, 'fetch');

    const result = await invokeSendToBank({
      practice_id: 'practice-1',
      bank_id: 'bank-1',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.error?.message).toContain('Sessione scaduta');
  });
});
