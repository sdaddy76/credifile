export const sanitizeFileName = (name: string): string => {
  const trimmed = (name || 'file').trim();
  const lastDot = trimmed.lastIndexOf('.');
  const ext = lastDot > 0 ? trimmed.slice(lastDot) : '';
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const safeBase = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`´]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return `${safeBase || 'file'}${ext}`;
};

export const sanitizePracticeFileName = sanitizeFileName;
