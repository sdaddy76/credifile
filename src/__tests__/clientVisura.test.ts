jest.mock('@/lib/supabase', () => ({
  supabase: {},
}));

import {
  buildPracticeDocumentRows,
  getClientVisuraReference,
  isVisuraDocumentName,
} from '@/lib/clientVisura';

describe('clientVisura', () => {
  it.each([
    'Visura Camerale Aggiornata',
    'VISURA CAMERALE',
    'Nuova visùra società',
  ])('riconosce il documento visura: %s', (name) => {
    expect(isVisuraDocumentName(name)).toBe(true);
  });

  it('non confonde altri documenti standard con la visura', () => {
    expect(isVisuraDocumentName('Bilancio 2025')).toBe(false);
  });

  it('legge una visura cliente valida senza perdere i metadati', () => {
    const reference = getClientVisuraReference({
      ragione_sociale: 'Impresa Test Srl',
      client_visura: {
        storage_path: 'clienti/client-1/visura/visura.pdf',
        nome_file: 'visura.pdf',
        mime_type: 'application/pdf',
        dimensione: 12345,
        uploaded_at: '2026-10-07T10:00:00.000Z',
        uploaded_by: 'user-1',
      },
    });

    expect(reference).toEqual({
      storage_path: 'clienti/client-1/visura/visura.pdf',
      nome_file: 'visura.pdf',
      mime_type: 'application/pdf',
      dimensione: 12345,
      uploaded_at: '2026-10-07T10:00:00.000Z',
      uploaded_by: 'user-1',
    });
  });

  it('ignora metadati incompleti e lascia la visura da richiedere', () => {
    expect(getClientVisuraReference({
      client_visura: { nome_file: 'visura.pdf' },
    })).toBeNull();
  });

  it('inizializza la visura come caricata solo se esiste nel cliente', () => {
    const templates = [
      { id: 'visura-template', nome: 'Visura Camerale Aggiornata', obbligatorio: true },
      { id: 'bilancio-template', nome: 'Ultimo Bilancio', obbligatorio: true },
    ];
    const clientVisura = {
      storage_path: 'clienti/client-1/visura/visura.pdf',
      nome_file: 'visura.pdf',
      mime_type: 'application/pdf',
      dimensione: 100,
      uploaded_at: '2026-10-07T10:00:00.000Z',
      uploaded_by: 'user-1',
    };

    expect(buildPracticeDocumentRows('practice-1', templates, clientVisura)).toEqual([
      expect.objectContaining({ nome: 'Visura Camerale Aggiornata', status: 'caricato', uploaded_at: clientVisura.uploaded_at }),
      expect.objectContaining({ nome: 'Ultimo Bilancio', status: 'richiesto', uploaded_at: null }),
    ]);
    expect(buildPracticeDocumentRows('practice-2', templates, null)).toEqual([
      expect.objectContaining({ nome: 'Visura Camerale Aggiornata', status: 'richiesto', uploaded_at: null }),
      expect.objectContaining({ nome: 'Ultimo Bilancio', status: 'richiesto', uploaded_at: null }),
    ]);
  });
});
