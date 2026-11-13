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
});
