import { sanitizeFileName } from '@/lib/sanitizeFileName';

describe('sanitizeFileName', () => {
  it('pulisce spazi, apostrofi/accenti e conserva .pdf', () => {
    const result = sanitizeFileName('Carta d identità Ilaria Prisco.pdf');

    expect(result).toBe('Carta_d_identita_Ilaria_Prisco.pdf');
    expect(result).not.toMatch(/\s/);
    expect(result).not.toMatch(/[àèéìòù']/i);
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('pulisce un file con spazi e accenti', () => {
    expect(sanitizeFileName('file con spazi e àèì.docx')).toBe('file_con_spazi_e_aei.docx');
  });

  it('lascia invariato un filename già pulito', () => {
    expect(sanitizeFileName('bilancio_2024-OK.pdf')).toBe('bilancio_2024-OK.pdf');
  });

  it('preserva l’estensione maiuscola', () => {
    expect(sanitizeFileName('Documento Finale.PDF')).toBe('Documento_Finale.PDF');
  });
});
