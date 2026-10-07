import { supabase } from '@/lib/supabase';

export type ClientVisuraReference = {
  storage_path: string;
  nome_file: string;
  mime_type: string | null;
  dimensione: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
};

type VisuraJson = Record<string, unknown> & {
  client_visura?: ClientVisuraReference;
};

type PracticeTemplate = {
  id: string | null;
  nome: string;
  descrizione?: string | null;
  obbligatorio?: boolean | null;
};

type PracticeDocumentInsert = {
  practice_id: string;
  template_id: string | null;
  nome: string;
  descrizione: string | null;
  tipo: string;
  obbligatorio: boolean;
  status: 'caricato' | 'richiesto';
  uploaded_at: string | null;
};

const normalizeDocumentName = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('it-IT');

export const isVisuraDocumentName = (value: string) =>
  normalizeDocumentName(value).includes('visura');

export function getClientVisuraReference(value: unknown): ClientVisuraReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as VisuraJson).client_visura;
  if (!candidate || typeof candidate !== 'object') return null;
  if (typeof candidate.storage_path !== 'string' || !candidate.storage_path.trim()) return null;
  if (typeof candidate.nome_file !== 'string' || !candidate.nome_file.trim()) return null;
  return {
    storage_path: candidate.storage_path,
    nome_file: candidate.nome_file,
    mime_type: typeof candidate.mime_type === 'string' ? candidate.mime_type : null,
    dimensione: typeof candidate.dimensione === 'number' ? candidate.dimensione : null,
    uploaded_at: typeof candidate.uploaded_at === 'string' ? candidate.uploaded_at : new Date().toISOString(),
    uploaded_by: typeof candidate.uploaded_by === 'string' ? candidate.uploaded_by : null,
  };
}

export function buildPracticeDocumentRows(
  practiceId: string,
  templates: PracticeTemplate[],
  clientVisura: ClientVisuraReference | null,
): PracticeDocumentInsert[] {
  const uploadedAt = clientVisura?.uploaded_at ?? null;
  return templates.map(template => {
    const isVisura = isVisuraDocumentName(template.nome);
    const hasClientVisura = Boolean(isVisura && clientVisura);
    return {
      practice_id: practiceId,
      template_id: template.id,
      nome: template.nome,
      descrizione: template.descrizione ?? null,
      tipo: 'standard',
      obbligatorio: template.obbligatorio ?? true,
      status: hasClientVisura ? 'caricato' : 'richiesto',
      uploaded_at: hasClientVisura ? uploadedAt : null,
    };
  });
}

export async function saveClientVisura(
  clientId: string,
  file: File,
): Promise<ClientVisuraReference> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Sessione non valida. Accedi nuovamente.');
  const response = await fetch('/api/client-visura', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': file.type || 'application/pdf',
      'X-Client-Id': clientId,
      'X-File-Name': encodeURIComponent(file.name),
    },
    body: file,
  });
  const result = await response.json().catch(() => null) as {
    success?: boolean;
    reference?: ClientVisuraReference;
    error?: string;
  } | null;
  if (!response.ok || !result?.success || !result.reference) {
    throw new Error(result?.error || `Salvataggio non riuscito (HTTP ${response.status})`);
  }
  return result.reference;
}

export async function initializePracticeDocuments(
  practiceId: string,
  clientId: string,
  templates: PracticeTemplate[],
  fallbackClientVisuraJson?: unknown,
): Promise<void> {
  let clientVisuraJson = fallbackClientVisuraJson;
  if (clientVisuraJson === undefined) {
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('visura_json')
      .eq('id', clientId)
      .maybeSingle();
    if (clientError) throw clientError;
    clientVisuraJson = client?.visura_json;
  }
  const clientVisura = getClientVisuraReference(clientVisuraJson);
  const rows = buildPracticeDocumentRows(practiceId, templates, clientVisura);
  if (rows.length === 0) return;

  const { data: documents, error: documentError } = await supabase
    .from('practice_documents')
    .insert(rows)
    .select('id,nome');
  if (documentError) throw documentError;
  if (!clientVisura) return;

  const visuraDocument = (documents ?? []).find(document => isVisuraDocumentName(document.nome));
  if (!visuraDocument) return;
  const { error: fileError } = await supabase.from('uploaded_files').insert({
    practice_document_id: visuraDocument.id,
    practice_id: practiceId,
    nome_file: clientVisura.nome_file,
    storage_path: clientVisura.storage_path,
    mime_type: clientVisura.mime_type,
    dimensione: clientVisura.dimensione,
    uploaded_by: clientVisura.uploaded_by ?? 'admin',
  });
  if (fileError) throw fileError;
}
