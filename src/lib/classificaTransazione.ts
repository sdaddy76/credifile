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
export function classificaTransazione(
  descrizione: string,
  tipo: TipoTransazione,
): CategoriaTransazione {
  const d = String(descrizione ?? '').toUpperCase();

  if (tipo === 'entrata') {
    if (KW_ANTICIPO_SBF.some(k => d.includes(k))) return 'anticipo_sbf';
    if (KW_VERSAMENTI.some(k => d.includes(k))) return 'versamento';
    if (KW_ENTRATA_NEUTRA.some(k => d.includes(k))) return 'altro_entrata';
    if (KW_INCASSI_CLIENTI.some(k => d.includes(k))) return 'incasso_cliente';
    if (d.includes('BONIFICO')) return 'incasso_cliente';
    if (d.includes('ACCREDITO')) return 'incasso_cliente';
    return 'incasso_cliente';
  }

  if (KW_STIPENDI.some(k => d.includes(k))) return 'stipendio';
  if (KW_TRIBUTI.some(k => d.includes(k))) return 'tributo';
  if (KW_RATE_FINANZIAMENTI.some(k => d.includes(k))) return 'rata_finanziamento';
  if (KW_SPESE_BANCARIE.some(k => d.includes(k))) return 'spesa_bancaria';
  if (KW_PRELIEVI.some(k => d.includes(k))) return 'prelievo';
  if (KW_FORNITORI.some(k => d.includes(k))) return 'fornitore';

  return 'fornitore';
}
