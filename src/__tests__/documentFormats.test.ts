import {
  DOCUMENT_FILE_ACCEPT,
  documentMimeType,
  MAX_DOCUMENT_BYTES,
  validateDocumentFile,
} from '@/lib/documentFormats';

describe('documenti della pratica', () => {
  it.each(['bilancio.xls', 'bilancio.XLSX', 'relazione.doc', 'relazione.docx', 'bilancio.xbrl', 'bilancio.xml', 'documenti.zip'])(
    'consente il formato %s',
    name => {
      expect(validateDocumentFile({ name, size: 10 })).toBeNull();
      expect(DOCUMENT_FILE_ACCEPT).toContain(`.${name.split('.').pop()!.toLowerCase()}`);
    },
  );
  it('rifiuta estensioni non supportate e file oltre il limite', () => {
    expect(validateDocumentFile({ name: 'documento.exe', size: 1 })).toContain('Formato non supportato');
    expect(validateDocumentFile({ name: 'archivio.zip', size: MAX_DOCUMENT_BYTES + 1 })).toContain('30 MB');
    expect(validateDocumentFile({ name: 'archivio.zip', size: MAX_DOCUMENT_BYTES })).toBeNull();
  });
  it('normalizza i MIME vuoti o generici di Excel, Word, XML e ZIP', () => {
    expect(documentMimeType('BILANCIO.XLSX', 'application/zip')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(documentMimeType('relazione.docx', '')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(documentMimeType('bilancio.xbrl', '')).toBe('application/xbrl+xml');
    expect(documentMimeType('bilancio.xml', 'text/plain')).toBe('application/xml');
    expect(documentMimeType('documenti.zip', 'application/x-zip-compressed')).toBe('application/zip');
  });
});
