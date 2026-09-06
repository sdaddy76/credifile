export type TipoTransazione = 'entrata' | 'uscita';

export type CategoriaTransazione =
  | 'incasso_cliente'
  | 'anticipo_sbf'
  | 'versamento'
  | 'altro_entrata'
  | 'fornitore'
  | 'rata_finanziamento'
  | 'tributo'
  | 'stipendio'
  | 'spesa_bancaria'
  | 'prelievo'
  | 'altro_uscita'
  | 'cliente'
  | 'altro';

export type ConfidenzaClassificazione = 'alta' | 'media' | 'bassa';

export interface EsitoClassificazione {
  categoria: CategoriaTransazione;
  confidenza: ConfidenzaClassificazione;
  regola: string;
}

const KW_STIPENDI = [
  'STIPEND', 'SALARIO', 'RETRIBUZ', 'CEDOLINO', 'PAGHE', 'EMOLUMENT',
  'COMPENSO DIPEND', 'BUSTA PAGA', 'PAGA MENSILE', 'LAVORO DIPEND',
];

const KW_TRIBUTI = [
  'F24', 'ERARIO', 'AGENZIA ENTRATE', 'AGENZIA DELLE ENTRATE',
  'INPS', 'INAIL', 'IRPEF', 'IVA', 'IRES', 'IMU', 'TARI', 'TASSE',
  'CONTRIBUTI PREV', 'CONTRIBUTI INPS', 'DELEGA F24', 'MOD. F24',
  'IMPOSTE', 'TRIBUTO', 'EQUITALIA', 'RISCOSSIONE',
];

const KW_RATE_FINANZIAMENTI = [
  'RIMBORSO FINANZ', 'PAGAMENTO RATA', 'ADDEBITO RATA', 'RATA MUTUO',
  'RATA FINANZIAMENTO', 'FINANZIAMENTI', 'LEASING', 'MUTUO', 'BANCA IFIS',
  'IFIS', 'FINDOMESTIC', 'BNL', 'DEUTSCHE BANK', 'AGOS', 'COMPASS',
  'FIDITALIA', 'SELMA', 'MEDIOCREDITO', 'SANTANDER',
];

const KW_SPESE_BANCARIE = [
  'COMMISSIONI', 'COMPETENZE', 'SPESE TENUTA', 'SPESE CONTO', 'SPESE LIQUIDAZIONE',
  'INTERESSI DEBITORI', 'INTERESSI PASSIVI', 'IMPOSTA BOLLO', 'CANONE CONTO',
];

const KW_PRELIEVI = [
  'PRELEVAMENTO', 'PREL. CONT', 'PRELIEVO SELF', 'PRELIEVO ATM', 'PREL CONT',
];

const KW_FORNITORI = [
  'FATT', 'FATTURA', 'FT N', 'FT.', 'SALDO FT', 'SALDO FATT', 'ACCONTO FT', 'ACCONTO FATT',
  'FORNITORE', 'PRESTAZ', 'SERVIZIO', 'CONSULENZ', 'LAVORI', 'APPALTO',
  'CANONE', 'NOLEGGIO', 'LOCAZIONE', 'AFFITTO', 'UTENZA', 'ENEL', 'ENI', 'A2A',
  'IREN', 'HERA', 'LUCE', 'GAS', 'ACQUA', 'TELEFONIA', 'TIM', 'VODAFONE',
  'WIND', 'FASTWEB', 'ASSICURAZ', 'PREMI ASS', 'ADD/PREMI', 'LOCAZIONI (FITTO',
  'VOSTRA DISPOSIZIONE', 'BON.SEPA TELEMATICO', 'BON. SEPA TELEMATICO',
  'DISPOSTO A FAVORE', 'DA VOI DISPOSTO',
  'VOSTRO ASSEGNO', 'ASSEGNO BANCARIO', 'ADDEBITO SDD', 'ADDEBITO DIRETTO',
  'PAGAMENTI DIVERSI', 'MASTERCARD', 'VISA', 'PAGAMENTO CARTA', 'PAG CARTA',
  'ADDEBITO CARTA', 'AMERICAN EXPRESS', 'AMEX', 'BANCOMAT',
];

const KW_INCASSI_CLIENTI = [
  'BONIFICO A VOSTRO FAVORE', 'BONIFICO IN ENTRATA', 'PAGAMENTO FATTURA',
  'PAGAMENTO FATT', 'PAGAMENTO FT', 'INCASSO', 'RIMESSA', 'GIROACCREDITO',
  'ACCREDITAMENTO', 'RI.BA', 'RIBA', 'SDD INCASSO', 'POS ', 'PAGOBANCOMAT',
];

const KW_ANTICIPO_SBF = [
  'GIROCONTO SBF', 'DISPOSIZIONI DI GIRO', 'ANTICIPO SBF', 'ANTICIPO RI.BA',
  'ANTICIPO RIBA', 'ACCREDITO SBF', 'PORTAFOGLIO SBF', 'EFFETTI SBF',
];

const KW_VERSAMENTI = [
  'VERSAMENTO', 'VERS.', 'VERS A/B', 'VERS.A/B', 'VERSAMENTO DI ASSEGNI',
  'VERSAMENTO DI CONTANTE', 'VERSAMENTO CONTANTE', 'VERS. CONTANTE',
];

const KW_ENTRATA_NEUTRA = [
  'SALDO INIZIALE', 'SALDO FINALE', 'RIACCREDITO', 'RETTIFICA', 'STORNO',
];

/**
 * Classifica una transazione bancaria in base a descrizione e direzione importo.
 * Default operativo richiesto:
 * - uscite non riconosciute => fornitore
 * - entrate non riconosciute => incasso_cliente
 */
function matchKeyword(descrizione: string, keywords: string[]): string | undefined {
  return keywords.find(keyword => descrizione.includes(keyword));
}

export function classificaTransazioneConConfidenza(
  descrizione: string,
  tipo: TipoTransazione,
): EsitoClassificazione {
  const d = String(descrizione ?? '').toUpperCase();

  if (tipo === 'entrata') {
    const anticipo = matchKeyword(d, KW_ANTICIPO_SBF);
    if (anticipo) return { categoria: 'anticipo_sbf', confidenza: 'alta', regola: anticipo };
    const versamento = matchKeyword(d, KW_VERSAMENTI);
    if (versamento) return { categoria: 'versamento', confidenza: 'alta', regola: versamento };
    const neutra = matchKeyword(d, KW_ENTRATA_NEUTRA);
    if (neutra) return { categoria: 'altro_entrata', confidenza: 'alta', regola: neutra };
    const incasso = matchKeyword(d, KW_INCASSI_CLIENTI);
    if (incasso) return { categoria: 'incasso_cliente', confidenza: 'alta', regola: incasso };
    if (d.includes('BONIFICO')) return { categoria: 'incasso_cliente', confidenza: 'media', regola: 'BONIFICO GENERICO' };
    if (d.includes('ACCREDITO')) return { categoria: 'incasso_cliente', confidenza: 'media', regola: 'ACCREDITO GENERICO' };
    return { categoria: 'altro_entrata', confidenza: 'bassa', regola: 'NESSUNA REGOLA SPECIFICA' };
  }

  const rules: Array<[CategoriaTransazione, string[]]> = [
    ['stipendio', KW_STIPENDI],
    ['tributo', KW_TRIBUTI],
    ['rata_finanziamento', KW_RATE_FINANZIAMENTI],
    ['spesa_bancaria', KW_SPESE_BANCARIE],
    ['prelievo', KW_PRELIEVI],
    ['fornitore', KW_FORNITORI],
  ];
  for (const [categoria, keywords] of rules) {
    const keyword = matchKeyword(d, keywords);
    if (keyword) return { categoria, confidenza: 'alta', regola: keyword };
  }

  return { categoria: 'altro_uscita', confidenza: 'bassa', regola: 'NESSUNA REGOLA SPECIFICA' };
}

export function classificaTransazione(
  descrizione: string,
  tipo: TipoTransazione,
): CategoriaTransazione {
  return classificaTransazioneConConfidenza(descrizione, tipo).categoria;
}
