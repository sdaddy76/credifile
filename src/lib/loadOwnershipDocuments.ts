import { supabase } from './supabase';
import { getClientVisuraReference, isVisuraDocumentName } from './clientVisura';
import { extractPdfText, parseVisuraCompleta } from './parseVisura';
import { normalizeTaxId, ownershipCompanyIdentity, ownershipCompanyIdentifiers, ownershipDocumentDate, type OwnershipDocument } from './partecipogramma';
import type { Client } from './types';

interface VisuraFile {
  storage_path: string;
  nome_file: string;
  created_at: string;
  mime_type?: string | null;
  practice_document_id?: string | null;
}

export function selectVisuraFiles(
  files: VisuraFile[],
  documentNames: Map<string, string>,
  clientFile?: VisuraFile,
): VisuraFile[] {
  const selected = new Map<string, VisuraFile>();
  if (clientFile) selected.set(clientFile.storage_path, clientFile);
  files.forEach(file => {
    if (isVisuraDocumentName(file.nome_file) || isVisuraDocumentName(documentNames.get(file.practice_document_id ?? '') ?? '')) {
      if (!selected.has(file.storage_path)) selected.set(file.storage_path, file);
    }
  });
  return [...selected.values()];
}

// Ogni lettura è limitata al cliente e alle pratiche visibili alla sessione (RLS).
// Le range evitano di perdere silenziosamente allegati oltre il limite Supabase.
export async function loadOwnershipDocuments(client: Client, onProgress: (message: string) => void, signal: AbortSignal) {
  const check = () => { if (signal.aborted) throw new DOMException('Operazione annullata', 'AbortError'); };
  const practiceIds: string[] = [];
  for (let offset = 0; ; offset += 500) {
    check();
    const { data, error } = await supabase.from('practices').select('id').eq('client_id', client.id).order('id').range(offset, offset + 499).abortSignal(signal);
    if (error) throw error;
    practiceIds.push(...(data ?? []).map(row => row.id as string));
    if ((data ?? []).length < 500) break;
  }
  const documentNames = new Map<string, string>();
  const files: VisuraFile[] = [];
  for (let batch = 0; batch < practiceIds.length; batch += 50) {
    const ids = practiceIds.slice(batch, batch + 50);
    for (let offset = 0; ; offset += 500) {
      check();
      const { data, error } = await supabase.from('practice_documents').select('id,nome').in('practice_id', ids).order('id').range(offset, offset + 499).abortSignal(signal);
      if (error) throw error;
      (data ?? []).forEach(row => documentNames.set(row.id, row.nome));
      if ((data ?? []).length < 500) break;
    }
    for (let offset = 0; ; offset += 500) {
      check();
      const { data, error } = await supabase.from('uploaded_files')
        .select('storage_path,nome_file,created_at,mime_type,practice_document_id')
        .in('practice_id', ids).order('id').range(offset, offset + 499).abortSignal(signal);
      if (error) throw error;
      files.push(...(data ?? []) as VisuraFile[]);
      if ((data ?? []).length < 500) break;
    }
  }
  const ref = getClientVisuraReference(client.visura_json);
  const selected = selectVisuraFiles(files, documentNames, ref ? {
    ...ref, created_at: ref.uploaded_at,
  } : undefined);
  const documents: OwnershipDocument[] = [];
  const warnings: string[] = [];
  for (const [index, file] of selected.entries()) {
    check();
    onProgress(`Lettura visura ${index + 1} di ${selected.length}…`);
    try {
      if (file.mime_type && file.mime_type !== 'application/pdf' && !file.nome_file.toLowerCase().endsWith('.pdf')) {
        throw new Error('formato non PDF: occorre una visura PDF con testo selezionabile');
      }
      const { data, error } = await supabase.storage.from('practice-files').download(file.storage_path);
      if (error || !data) throw new Error(error?.message ?? 'file non disponibile');
      check();
      if (data.size > 40 * 1024 * 1024) throw new Error('PDF oltre 40 MB: usare una versione ridotta');
      const text = await extractPdfText(await data.arrayBuffer());
      check();
      if (text.replace(/\s/g, '').length < 50) throw new Error('testo non leggibile: PDF scansionato, occorre OCR');
      const parsed = parseVisuraCompleta(text);
      // Non usare il fallback generico del parser sul primo numero di 11 cifre:
      // potrebbe essere un numero casuale o il CF di un socio.
      const identifiers = ownershipCompanyIdentifiers(text);
      if (!identifiers.length) throw new Error('codice fiscale/P.IVA della società non riconosciuto: nessun collegamento automatico');
      const matchesClient = identifiers.some(id => [client.piva, client.codice_fiscale].map(normalizeTaxId).includes(id));
      if (!parsed.ragione_sociale && !matchesClient) {
        warnings.push(`${file.nome_file}: denominazione non rilevata; la società è identificata dal CF/P.IVA ${identifiers[0]}.`);
      }
      documents.push({
        id: file.storage_path, name: file.nome_file, uploadedAt: file.created_at,
        documentDate: ownershipDocumentDate(text),
        companyName: matchesClient ? client.ragione_sociale : parsed.ragione_sociale || `Società CF ${identifiers[0]}`,
        identifiers,
        soci: parsed.soci,
        piva: ownershipCompanyIdentity(text).piva || undefined,
        capitaleSociale: parsed.capitale_sociale,
        amministratori: parsed.amministratori,
      });
    } catch (error) {
      check();
      warnings.push(`${file.nome_file}: ${error instanceof Error ? error.message : 'errore di lettura'}.`);
    }
  }
  return { documents, warnings, fileCount: selected.length };
}
