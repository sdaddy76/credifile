import { parseSoci, parseVisuraCompleta } from '@/lib/parseVisura';

describe('parseSoci', () => {
  it('estrae più soci da una tabella con nome, quota, percentuale e codice fiscale', () => {
    const soci = parseSoci(`
      4. SOCI E TITOLARI DI QUOTE
      Cognome e nome Valore quota Percentuale Codice fiscale
      ROSSI MARIO 6.000,00 60,00% RSSMRA80A01H501Z
      BIANCHI LUCA 4.000,00 40,00% BNCLCU82B02H501Y
      5. ORGANO AMMINISTRATIVO
      AMMINISTRATORE UNICO VERDI PAOLO VRDPLA75C03H501X
    `);

    expect(soci).toEqual([
      expect.objectContaining({ nome: 'ROSSI MARIO', codice_fiscale: 'RSSMRA80A01H501Z', percentuale: '60,00%' }),
      expect.objectContaining({ nome: 'BIANCHI LUCA', codice_fiscale: 'BNCLCU82B02H501Y', percentuale: '40,00%' }),
    ]);
  });

  it('riconosce soci società con P.IVA e ordine colonne variabile', () => {
    const soci = parseSoci(`
      ELENCO SOCI
      ALFA HOLDING SRL 01234567890 25.000,00 75%
      BETA INVESTIMENTI S.P.A. 09876543210 8.333,33 25%
      CARICHE SOCIALI
      PRESIDENTE ROSSI MARIO RSSMRA80A01H501Z
    `);

    expect(soci).toHaveLength(2);
    expect(soci.map(s => s.codice_fiscale)).toEqual(['01234567890', '09876543210']);
  });

  it('mantiene i soci con etichette su righe separate', () => {
    const soci = parseSoci(`
      COMPOSIZIONE SOCIETARIA
      Socio: DE LUCA ANNA MARIA
      Codice fiscale: DLCNMR79D41F205Q
      Quota: EUR 10.000,00
      Percentuale: 100%
      ORGANI SOCIALI
      Amministratore unico: NERI GIORGIO
    `);

    expect(soci).toEqual([
      expect.objectContaining({ nome: 'DE LUCA ANNA MARIA', codice_fiscale: 'DLCNMR79D41F205Q', valore: '10.000,00', percentuale: '100%' }),
    ]);
  });

  it('salta riepilogo e indice InfoCamere e legge la sezione soci effettiva', () => {
    const soci = parseSoci(`
      L'IMPRESA IN CIFRE
      Soci e titolari di diritti su
      azioni e quote
      1
      Amministratori 1

      Indice
      4 Soci e titolari di diritti su azioni e quote ..... 6
      5 Amministratori ..... 7

      4 Soci e titolari di diritti su azioni e quote
      Sintesi della composizione societaria e degli altri titolari di diritti su azioni o quote sociali al 17/09/2025
      Socio Valore % Tipo diritto
      SCARSELLA LUCA 20.000,00 100 % proprieta'
      SCRLCU93T02A269D

      Elenco dei soci e degli altri titolari di diritti su azioni o quote sociali al 17/09/2025
      capitale sociale Capitale sociale dichiarato: 20.000,00 Euro
      Quota di nominali: 20.000,00 Euro
      Proprieta'
      Di cui versati: 20.000,00
      SCARSELLA LUCA Codice fiscale: SCRLCU93T02A269D
      Tipo di diritto: proprieta'
      Domicilio del titolare o rappresentante comune
      FERENTINO (FR) VIA CASILINA NORD 188 CAP 03013

      5 Amministratori
      Amministratore Unico SCARSELLA LUCA
      Codice fiscale: SCRLCU93T02A269D
    `);

    expect(soci).toEqual([
      expect.objectContaining({
        nome: 'SCARSELLA LUCA',
        codice_fiscale: 'SCRLCU93T02A269D',
        valore: '20.000,00',
        percentuale: '100%',
      }),
    ]);
  });
});

it('separa soci e amministratori nel parsing completo', () => {
  const parsed = parseVisuraCompleta(`
    Denominazione/Ragione Sociale: ACME COSTRUZIONI SRL
    Partita IVA: 12345678901
    4. SOCI E TITOLARI DI QUOTE
    ROSSI MARIO 6.000,00 60% RSSMRA80A01H501Z
    BIANCHI LUCA 4.000,00 40% BNCLCU82B02H501Y
    5. ORGANO AMMINISTRATIVO
    Amministratore unico VERDI PAOLO VRDPLA75C03H501X
    Codice ATECO: 41.20.00
  `);

  expect(parsed.soci.map(s => s.codice_fiscale)).toEqual(['RSSMRA80A01H501Z', 'BNCLCU82B02H501Y']);
  expect(parsed.amministratori.map(a => a.codice_fiscale)).toContain('VRDPLA75C03H501X');
});

it('legge il formato Report Impresa BPER/CRIF', () => {
  const parsed = parseVisuraCompleta(`
    ANAGRAFICA IMPRESA
    INTENT S.P.A.
    INFORMAZIONI GENERALI
    Sede dell'impresa
    VIA PRENESTINA NUOVA, 301/C - 00036 PALESTRINA (RM)
    Forma giuridica
    SOCIETA' PER AZIONI
    Codice fiscale
    12326171001
    Partita IVA
    12326171001
    CLASSIFICAZIONE ATTIVITA'
    Ateco 2025
    62.20.10 - ATTIVITÀ DI CONSULENZA INFORMATICA
    Ateco 2007
    62.02 - CONSULENZA NEL SETTORE DELLE TECNOLOGIE DELL'INFORMATICA

    ELENCO SOCI
    ELENCO SOCI E DEGLI ALTRI TITOLARI DI DIRITTI SU AZIONI E QUOTE SOCIALI
    Dettaglio quote e azioni
    Tipo di Diritto Capitale Posseduto Quota
    PRIMERANO FRANCESCO MARIA
    PRMFNC71H18M208A
    PROPRIETA' AMMONTARE 2.850.000,00 EURO 57.00 %
    PRIMERANO ANNA
    PRMNNA70L62F537L
    PROPRIETA' AMMONTARE 1.050.000,00 EURO 21.00 %
    PETRASSI PIETRO
    PTRPTR88T08H501A
    PROPRIETA' AMMONTARE 550.000,00 EURO 11.00 %
    LUCIBELLO GIUSEPPE
    LCBGPP73R24H703W
    PROPRIETA' AMMONTARE 550.000,00 EURO 11.00 %
    PARTECIPAZIONI

    ESPONENTI, CONSIGLIO DI AMMINISTRAZIONE
    PRIMERANO FRANCESCO MARIA
    CODICE FISCALE
    PRMFNC71H18M208A
    AMMINISTRATORE UNICO
  `);

  expect(parsed.ragione_sociale).toBe('INTENT S.P.A.');
  expect(parsed.piva).toBe('12326171001');
  expect(parsed.indirizzo).toBe('VIA PRENESTINA NUOVA, 301/C - 00036 PALESTRINA (RM)');
  expect(parsed.codice_ateco).toBe('62.20.10');
  expect(parsed.ateco_descrizione).toContain('ATTIVITÀ DI CONSULENZA INFORMATICA');
  expect(parsed.soci).toHaveLength(4);
  expect(parsed.soci.map(socio => socio.nome)).toEqual([
    'PRIMERANO FRANCESCO MARIA',
    'PRIMERANO ANNA',
    'PETRASSI PIETRO',
    'LUCIBELLO GIUSEPPE',
  ]);
  expect(parsed.soci.map(socio => socio.codice_fiscale)).toEqual([
    'PRMFNC71H18M208A',
    'PRMNNA70L62F537L',
    'PTRPTR88T08H501A',
    'LCBGPP73R24H703W',
  ]);
  expect(parsed.amministratori).toEqual(expect.arrayContaining([
    expect.objectContaining({
      nome: 'PRIMERANO FRANCESCO MARIA',
      carica: expect.stringMatching(/AMMINISTRATORE UNICO/i),
      codice_fiscale: 'PRMFNC71H18M208A',
    }),
  ]));
});
