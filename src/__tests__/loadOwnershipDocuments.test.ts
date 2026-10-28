import { supabase } from '@/lib/supabase';
import { extractPdfText } from '@/lib/parseVisura';
import { loadOwnershipDocuments, selectVisuraFiles } from '@/lib/loadOwnershipDocuments';
import type { Client } from '@/lib/types';

jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), storage: { from: jest.fn() } },
}));
jest.mock('@/lib/parseVisura', () => ({
  ...jest.requireActual('@/lib/parseVisura'),
  extractPdfText: jest.fn(),
}));

const client: Client = {
  id: 'client-one', ragione_sociale: 'ALFA SRL', piva: '01234567890',
  email: '', created_at: '', updated_at: '',
  visura_json: { client_visura: { storage_path: 'clienti/client-one/visura/alfa.pdf', nome_file: 'alfa.pdf', uploaded_at: '2026-10-27T10:00:00Z' } },
};
const clientFile = { storage_path: 'clienti/client-one/visura/alfa.pdf', nome_file: 'alfa.pdf', created_at: '2026-10-27T10:00:00Z' };
const betaFile = { storage_path: 'practice-one/doc-two/beta.pdf', nome_file: 'societa.pdf', created_at: '2026-10-27T11:00:00Z', practice_document_id: 'doc-two' };
const text = (company: string, cf: string, owner: string, ownerCf: string, quota: string) => `
  Denominazione ${company}
  Partita IVA ${cf}
  Codice fiscale ${cf}
  Forma giuridica Società a responsabilità limitata
  ELENCO SOCI
  ${owner} ${ownerCf} ${quota}
  ORGANI SOCIALI
`;

interface MockBuilder {
  select: jest.Mock;
  eq: jest.Mock;
  in: jest.Mock;
  order: jest.Mock;
  range: jest.Mock;
  abortSignal: jest.Mock;
}

function mockDatabase(files = [clientFile, betaFile]) {
  const calls: { table: string; filters: [string, unknown][]; ranges: number[] }[] = [];
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    const call = { table, filters: [] as [string, unknown][], ranges: [] as number[] };
    calls.push(call);
    const builder: MockBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn((column, value) => { call.filters.push([column, value]); return builder; }),
      in: jest.fn((column, value) => { call.filters.push([column, value]); return builder; }),
      order: jest.fn().mockReturnThis(),
      range: jest.fn((start, end) => { call.ranges.push(start, end); return builder; }),
      abortSignal: jest.fn(async () => ({
        data: table === 'practices' ? [{ id: 'practice-one' }]
          : table === 'practice_documents' ? [{ id: 'doc-two', nome: 'Visura società collegata' }]
            : files,
        error: null as Error | null,
      })),
    };
    return builder;
  });
  return calls;
}

describe('lettura visure del cliente', () => {
  beforeEach(() => {
    (supabase.storage.from as jest.Mock).mockReturnValue({
      download: jest.fn(async () => ({ data: { size: 100, arrayBuffer: async () => new ArrayBuffer(0) }, error: null as Error | null })),
    });
  });

  it('seleziona file o campi denominati visura e deduplica i riferimenti di storage', () => {
    const result = selectVisuraFiles([
      { ...clientFile, nome_file: 'visura_alfa.pdf' },
      betaFile,
      { storage_path: 'bilancio.pdf', nome_file: 'bilancio.pdf', created_at: '' },
    ], new Map([['doc-two', 'Visura società collegata']]), clientFile);
    expect(result.map(file => file.storage_path)).toEqual([clientFile.storage_path, betaFile.storage_path]);
  });

  it('legge più visure soltanto dalle pratiche del cliente, con download autenticato', async () => {
    const calls = mockDatabase();
    (extractPdfText as jest.Mock)
      .mockResolvedValueOnce(text('ALFA SRL', client.piva, 'BETA HOLDING SRL', '09876543210', '60%'))
      .mockResolvedValueOnce(text('BETA HOLDING SRL', '09876543210', 'ROSSI MARIO', 'RSSMRA80A01H501Z', '100%'));
    const result = await loadOwnershipDocuments(client, jest.fn(), new AbortController().signal);
    expect(result.documents).toHaveLength(2);
    expect(result.warnings).toEqual([]);
    expect(result.documents[0].identifiers).toEqual([client.piva]);
    expect(result.documents[0].sourceText).toContain('BETA HOLDING SRL');
    expect(result.documents[0].soci[0].codice_fiscale).toBe('09876543210');
    expect(calls.find(call => call.table === 'practices').filters).toEqual([['client_id', client.id]]);
    expect(calls.filter(call => call.table !== 'practices').every(call => JSON.stringify(call.filters) === JSON.stringify([['practice_id', ['practice-one']]]))).toBe(true);
    expect(supabase.storage.from).toHaveBeenCalledWith('practice-files');
    expect(supabase.storage.from('practice-files').download).toHaveBeenCalledTimes(2);
  });

  it('segnala PDF scansionati e continua con gli altri file senza inventare soci', async () => {
    mockDatabase();
    (extractPdfText as jest.Mock)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce(text('BETA HOLDING SRL', '09876543210', 'ROSSI MARIO', 'RSSMRA80A01H501Z', '100%'));
    const result = await loadOwnershipDocuments(client, jest.fn(), new AbortController().signal);
    expect(result.documents).toHaveLength(1);
    expect(result.warnings[0]).toContain('OCR');
    expect(result.fileCount).toBe(2);
  });

  it('non presenta il CF numerico come partita IVA se questa non è indicata', async () => {
    mockDatabase([clientFile]);
    (extractPdfText as jest.Mock).mockResolvedValueOnce(`
      Denominazione ALFA SRL
      Codice fiscale 01234567890
      ELENCO SOCI
      ROSSI MARIO RSSMRA80A01H501Z 100%
      ORGANI SOCIALI
    `);
    const result = await loadOwnershipDocuments(client, jest.fn(), new AbortController().signal);
    expect(result.documents[0].identifiers).toEqual(['01234567890']);
    expect(result.documents[0].piva).toBeUndefined();
  });

  it('non legge file se la ricerca delle pratiche fallisce', async () => {
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ order: () => ({ range: () => ({ abortSignal: async () => ({ data: null as unknown[] | null, error: new Error('Accesso negato') }) }) }) }) }),
    });
    await expect(loadOwnershipDocuments(client, jest.fn(), new AbortController().signal)).rejects.toThrow('Accesso negato');
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });

  it('annulla il caricamento alla chiusura senza altre richieste', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(loadOwnershipDocuments(client, jest.fn(), controller.signal)).rejects.toThrow('Operazione annullata');
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
