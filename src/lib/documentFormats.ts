/** Un'unica lista per la pratica, il portale cliente e il selettore Dropbox. */
export const DOCUMENT_FILE_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.xbrl', '.xml', '.zip',
  '.jpg', '.jpeg', '.png', '.webp',
] as const;

export const DOCUMENT_FILE_ACCEPT = DOCUMENT_FILE_EXTENSIONS.join(',');
export const MAX_DOCUMENT_BYTES = 30 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xbrl': 'application/xbrl+xml',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export function documentMimeType(fileName: string, fallback?: string | null): string {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return MIME_BY_EXTENSION[extension] || fallback || 'application/octet-stream';
}

export function validateDocumentFile(file: { name: string; size: number }): string | null {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!DOCUMENT_FILE_EXTENSIONS.some(supported => supported === extension)) {
    return `Formato non supportato per "${file.name}". Usa PDF, Excel, Word, XBRL/XML, ZIP o immagini.`;
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return `"${file.name}" troppo grande. Massimo 30 MB.`;
  }
  return null;
}
