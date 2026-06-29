import { supabase } from '@/lib/supabase';
import { sanitizeFileName, sanitizePracticeFileName } from '@/lib/sanitizeFileName';

export { sanitizeFileName, sanitizePracticeFileName };

export interface UploadPracticeFileParams {
  practiceId: string;
  practiceDocumentId?: string | null;
  file: File | Blob;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
  uploadedBy?: string | null;
  prefix?: string;
}

export interface UploadPracticeFileResult {
  path: string | null;
  nomefile_originale: string;
  error: Error | null;
}

export async function uploadPracticeFile({
  practiceId,
  practiceDocumentId = null,
  file,
  fileName,
  mimeType,
  size,
  uploadedBy = null,
  prefix,
}: UploadPracticeFileParams): Promise<UploadPracticeFileResult> {
  const nomefile_originale = fileName;
  const safeName = sanitizePracticeFileName(fileName);
  const folder = prefix ? `${prefix.replace(/^\/+|\/+$/g, '')}/${practiceId}` : practiceId;
  const path = `${folder}/${practiceDocumentId ?? 'documenti-liberi'}/${Date.now()}_${safeName}`;

  const { error: storageError } = await supabase.storage
    .from('practice-files')
    .upload(path, file, { cacheControl: '3600', upsert: false });

  if (storageError) {
    return { path: null, nomefile_originale, error: new Error(storageError.message) };
  }

  const payload: Record<string, unknown> = {
    practice_id: practiceId,
    nome_file: nomefile_originale,
    storage_path: path,
    mime_type: mimeType ?? (file instanceof File ? file.type : null),
    dimensione: size ?? (file instanceof File ? file.size : null),
    uploaded_by: uploadedBy,
  };

  if (practiceDocumentId) {
    payload.practice_document_id = practiceDocumentId;
  }

  const { error: dbError } = await supabase.from('uploaded_files').insert(payload);

  if (dbError) {
    await supabase.storage.from('practice-files').remove([path]);
    return { path, nomefile_originale, error: new Error(dbError.message) };
  }

  return { path, nomefile_originale, error: null };
}
