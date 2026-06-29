import { classificaTransazione } from '@/lib/classificaTransazione';

describe('classificaTransazione', () => {
  it('classifica una riga con importo in DARE come uscita fornitore', () => {
    expect(classificaTransazione('BON.SEPA TELEMATICO pagamento materiale', 'uscita')).toBe('fornitore');
  });

  it('classifica una riga con importo in AVERE come entrata incasso cliente', () => {
    expect(classificaTransazione('BONIFICO A VOSTRO FAVORE da cliente Rossi', 'entrata')).toBe('incasso_cliente');
  });

  it('riconosce keyword SBF come anticipo_sbf', () => {
    expect(classificaTransazione('ACCREDITO SBF portafoglio commerciale', 'entrata')).toBe('anticipo_sbf');
  });

  it('riconosce keyword STIPENDI come stipendio', () => {
    expect(classificaTransazione('PAGAMENTO STIPENDI mese maggio', 'uscita')).toBe('stipendio');
  });

  it('riconosce keyword F24/ERARIO come tributo', () => {
    expect(classificaTransazione('DELEGA F24 ERARIO', 'uscita')).toBe('tributo');
  });

  it('riconosce keyword RATA/MUTUO come rata_finanziamento', () => {
    expect(classificaTransazione('ADDEBITO RATA MUTUO', 'uscita')).toBe('rata_finanziamento');
  });

  it('classifica una uscita senza keyword nota come fornitore', () => {
    expect(classificaTransazione('Operazione generica non riconosciuta', 'uscita')).toBe('fornitore');
  });

  it('classifica una entrata senza keyword nota come incasso_cliente', () => {
    expect(classificaTransazione('Operazione generica non riconosciuta', 'entrata')).toBe('incasso_cliente');
  });
});
