import { inferBankStatementDirection } from '@/lib/bankStatementDirection';
import { parseBankStatementPdfRows } from '@/lib/parseBankStatementPdf';

describe('direzione movimenti estratto conto', () => {
  it('riconosce Uscite Business con importo negativo come uscita', () => {
    expect(inferBankStatementDirection(
      '13.01.2026 disposto a favore di Simone SI Uscite Business € -500,00',
      -500,
      '-500,00',
    )).toMatchObject({
      tipo: 'uscita',
      confidence: 'alta',
      conflict: false,
    });
  });

  it('non interpreta la preposizione "a" di disposto a favore come AVERE', () => {
    expect(inferBankStatementDirection(
      'Bonifico istantaneo da voi disposto a favore di Simone',
      500,
      '500,00',
    )).toMatchObject({
      tipo: 'uscita',
      rule: 'CAUSALE OPERAZIONE',
    });
  });

  it('riconosce un bonifico disposto da un cliente come entrata', () => {
    expect(inferBankStatementDirection(
      'Bonifico disposto da CLIENTE SRL',
      5000,
      '5000,00',
    )).toMatchObject({
      tipo: 'entrata',
    });
  });
});

describe('parser PDF estratto conto Intesa Sanpaolo', () => {
  it('analizza correttamente la riga del 13 gennaio 2026', () => {
    const result = parseBankStatementPdfRows([
      ['13.01.2026', 'disposto a favore di Simone', 'SI', 'Uscite Business', '€ -500,00'],
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      data_valuta: '2026-01-13',
      importo: 500,
      tipo: 'uscita',
      categoria: 'fornitore',
      descrizione: 'disposto a favore di Simone',
      parse_confidence: 'alta',
    });
  });

  it('conserva commissioni identiche realmente ripetute nello stesso giorno', () => {
    const result = parseBankStatementPdfRows([
      ['22.01.2026', 'Costo Bonifico Istantaneo Da Voi Disposto', 'SI', 'Uscite Business', '€ -1,00'],
      ['22.01.2026', 'Costo Bonifico Istantaneo Da Voi Disposto', 'SI', 'Uscite Business', '€ -1,00'],
    ]);

    expect(result).toHaveLength(2);
    expect(result.every(transaction => transaction.tipo === 'uscita')).toBe(true);
  });

  it('usa la categoria esplicita della banca anche in presenza di un segno incoerente', () => {
    const result = parseBankStatementPdfRows([
      ['01.02.2026', 'Operazione da verificare', 'SI', 'Uscite Business', '€ +100,00'],
    ]);

    expect(result[0]).toMatchObject({
      tipo: 'uscita',
      parse_confidence: 'media',
    });
  });

  it('ricostruisce una descrizione distribuita sopra e sotto la riga del movimento', () => {
    const result = parseBankStatementPdfRows([
      {
        tokens: ['Bonifico istantaneo da voi'],
        positionedTokens: [{ value: 'Bonifico istantaneo da voi', x: 125 }],
        page: 1,
        y: 773,
      },
      {
        tokens: ['13.01.2026', 'disposto a favore di Simone', 'SI', 'Uscite Business', '€ -500,00'],
        positionedTokens: [
          { value: '13.01.2026', x: 50 },
          { value: 'disposto a favore di Simone', x: 125 },
          { value: 'SI', x: 341 },
          { value: 'Uscite Business', x: 396 },
          { value: '€ -500,00', x: 502 },
        ],
        page: 1,
        y: 765,
      },
      {
        tokens: ['Palombo'],
        positionedTokens: [{ value: 'Palombo', x: 125 }],
        page: 1,
        y: 757,
      },
    ]);

    expect(result[0]).toMatchObject({
      tipo: 'uscita',
      categoria: 'fornitore',
      descrizione: 'Bonifico istantaneo da voi disposto a favore di Simone Palombo',
    });
  });

  it('associa l’importo quando il PDF lo posiziona su una riga grafica separata', () => {
    const result = parseBankStatementPdfRows([
      {
        tokens: ['Bonifico disposto da', 'Entrate'],
        positionedTokens: [
          { value: 'Bonifico disposto da', x: 126 },
          { value: 'Entrate', x: 396 },
        ],
        page: 1,
        y: 627,
      },
      {
        tokens: ['31.03.2026', 'SI'],
        positionedTokens: [
          { value: '31.03.2026', x: 50 },
          { value: 'SI', x: 341 },
        ],
        page: 1,
        y: 618,
      },
      {
        tokens: ['€ 218.000,00'],
        positionedTokens: [{ value: '€ 218.000,00', x: 482 }],
        page: 1,
        y: 621,
      },
      {
        tokens: ['Casa funeraria Michini', 'Business'],
        positionedTokens: [
          { value: 'Casa funeraria Michini', x: 126 },
          { value: 'Business', x: 396 },
        ],
        page: 1,
        y: 612,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      data_valuta: '2026-03-31',
      importo: 218000,
      tipo: 'entrata',
      categoria: 'incasso_cliente',
      descrizione: 'Bonifico disposto da Casa funeraria Michini',
    });
  });
});
