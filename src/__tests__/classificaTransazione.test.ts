import { classificaTransazione, classificaTransazioneConConfidenza } from '@/lib/classificaTransazione';

describe('classificaTransazione', () => {
  it('classifica una riga con importo in DARE come uscita fornitore', () => {
    expect(classificaTransazione('BON.SEPA TELEMATICO pagamento materiale', 'uscita')).toBe('fornitore');
  });

  it('classifica un bonifico disposto a favore come uscita fornitore', () => {
    expect(classificaTransazione('disposto a favore di Simone Palombo', 'uscita')).toBe('fornitore');
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

  it('non confonde una uscita senza keyword con un fornitore', () => {
    expect(classificaTransazione('Operazione generica non riconosciuta', 'uscita')).toBe('altro_uscita');
  });

  it('non confonde una entrata senza keyword con un incasso cliente', () => {
    expect(classificaTransazione('Operazione generica non riconosciuta', 'entrata')).toBe('altro_entrata');
  });

  it('espone la confidenza e la regola che ha determinato la categoria', () => {
    expect(classificaTransazioneConConfidenza('DELEGA F24 ERARIO', 'uscita')).toEqual({
      categoria: 'tributo',
      confidenza: 'alta',
      regola: 'F24',
    });

    expect(classificaTransazioneConConfidenza('Operazione generica', 'entrata')).toEqual({
      categoria: 'altro_entrata',
      confidenza: 'bassa',
      regola: 'NESSUNA REGOLA SPECIFICA',
    });
  });
});
