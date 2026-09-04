import { pdfTextItemsToLines } from '@/lib/pdfTextLines';

describe('pdfTextItemsToLines', () => {
  it('ricostruisce le righe per coordinata e ordina le colonne da sinistra a destra', () => {
    const lines = pdfTextItemsToLines([
      { str: '150.000', transform: [1, 0, 0, 1, 400, 700] },
      { str: 'Altri crediti', transform: [1, 0, 0, 1, 40, 700] },
      { str: 'Ricavi delle vendite', transform: [1, 0, 0, 1, 40, 680] },
      { str: '900.000', transform: [1, 0, 0, 1, 400, 680] },
    ]);

    expect(lines).toEqual([
      'Altri crediti 150.000',
      'Ricavi delle vendite 900.000',
    ]);
  });
});
