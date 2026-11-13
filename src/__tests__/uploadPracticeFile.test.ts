const mockGetUser = jest.fn();
const mockStorageUpload = jest.fn();
const mockStorageRemove = jest.fn();
const mockInsertSingle = jest.fn();
const mockInsertSelect = jest.fn(() => ({ single: mockInsertSingle }));
const mockInsert = jest.fn(() => ({ select: mockInsertSelect }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    storage: { from: () => ({ upload: mockStorageUpload, remove: mockStorageRemove }) },
    from: () => ({ insert: mockInsert }),
  },
}));

import { uploadPracticeFile } from '@/lib/uploadFile';

describe('uploadPracticeFile system attribution', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null });
    mockStorageUpload.mockResolvedValue({ error: null });
    mockInsertSingle.mockResolvedValue({ data: { id: 'file-123' }, error: null });
  });

  it('attributes generated reports to the authenticated user for RLS checks', async () => {
    const result = await uploadPracticeFile({
      practiceId: 'practice-123',
      file: new Blob(['report']),
      fileName: 'Bancabilita_test.pdf',
      mimeType: 'application/pdf',
      size: 6,
      uploadedBy: 'sistema',
    });

    expect(result.error).toBeNull();
    expect(result.uploadedFileId).toBe('file-123');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      practice_id: 'practice-123',
      uploaded_by: 'user-123',
    }));
  });

  it('does not upload an orphaned file when the session is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await uploadPracticeFile({
      practiceId: 'practice-123',
      file: new Blob(['report']),
      fileName: 'Bancabilita_test.pdf',
      mimeType: 'application/pdf',
      uploadedBy: 'sistema',
    });

    expect(result.error?.message).toContain('Sessione non valida');
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it.each([
    ['bilancio.xlsx', 'application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['relazione.docx', '', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['bilancio.xbrl', '', 'application/xbrl+xml'],
    ['documenti.zip', '', 'application/zip'],
  ])('uploads %s with the canonical MIME and unchanged original filename', async (fileName, reported, expected) => {
    const result = await uploadPracticeFile({
      practiceId: 'practice-123',
      file: new Blob(['file'], { type: reported }),
      fileName,
      mimeType: reported,
      uploadedBy: 'cliente',
    });
    expect(result.error).toBeNull();
    expect(mockStorageUpload).toHaveBeenCalledWith(
      expect.stringContaining(fileName),
      expect.any(Blob),
      expect.objectContaining({ contentType: expected, upsert: false }),
    );
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      nome_file: fileName,
      mime_type: expected,
      dimensione: 4,
    }));
  });

  it('rejects unsupported extensions before storage upload', async () => {
    const result = await uploadPracticeFile({
      practiceId: 'practice-123', file: new Blob(['file']), fileName: 'eseguibile.exe',
    });
    expect(result.error?.message).toContain('Formato non supportato');
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });
});
