import { parseLocalizedNumber } from '@/lib/numberParsing';

export type BankCostType =
  | 'tenuta_conto'
  | 'commissioni'
  | 'spese_operazione'
  | 'interessi_debitori'
  | 'interessi_finanziamento'
  | 'rata_finanziamento'
  | 'imposta_bollo'
  | 'canone'
  | 'altri_oneri';

export type BankCostConfidence = 'alta' | 'media' | 'bassa';

export interface BankCostTransaction {
  id?: string;
  data_valuta?: string | null;
  data_contabile?: string | null;
  importo: number | string;
  tipo: 'entrata' | 'uscita';
  categoria?: string | null;
  descrizione?: string | null;
  beneficiario_ordinante?: string | null;
  saldo_progressivo?: number | string | null;
  bank_cost_type?: BankCostType | null;
  bank_cost_confidence?: BankCostConfidence | null;
  interest_amount?: number | string | null;
  principal_amount?: number | string | null;
  interest_rate?: number | string | null;
  financing_reference?: string | null;
  bank_cost_notes?: string | null;
  classification_confidence?: BankCostConfidence | null;
  parse_confidence?: BankCostConfidence | null;
  file_nome?: string | null;
}

export interface BankCostMetadata {
  bank_cost_type: BankCostType | null;
  bank_cost_confidence: BankCostConfidence | null;
  interest_amount: number | null;
  principal_amount: number | null;
  interest_rate: number | null;
  financing_reference: string | null;
  bank_cost_notes: string | null;
}

export interface BankCostCategoryTotal {
  type: BankCostType;
  label: string;
  total: number;
  count: number;
  color: string;
}

export interface BankCostMonthlyTotal {
  month: string;
  label: string;
  total: number;
  interests: number;
  installments: number;
  other: number;
}

export interface BankCostAnalysis {
  totalCost: number;
  averageMonthlyCost: number;
  totalOutflows: number;
  costIncidence: number | null;
  interestPaid: number;
  principalPaid: number;
  identifiedInterestRates: number[];
  financingReferences: string[];
  transactions: BankCostTransaction[];
  categories: BankCostCategoryTotal[];
  monthly: BankCostMonthlyTotal[];
  reviewCount: number;
  sourceCount: number;
}

const CATEGORY_LABELS: Record<BankCostType, string> = {
  tenuta_conto: 'Tenuta conto',
  commissioni: 'Commissioni',
  spese_operazione: 'Spese operazione',
  interessi_debitori: 'Interessi debitori',
  interessi_finanziamento: 'Interessi finanziamento',
  rata_finanziamento: 'Rate finanziamento',
  imposta_bollo: 'Imposta di bollo',
  canone: 'Canoni',
  altri_oneri: 'Altri oneri bancari',
};

const CATEGORY_COLORS: Record<BankCostType, string> = {
  tenuta_conto: '#2563eb',
  commissioni: '#7c3aed',
  spese_operazione: '#0891b2',
  interessi_debitori: '#dc2626',
  interessi_finanziamento: '#ea580c',
  rata_finanziamento: '#4f46e5',
  imposta_bollo: '#64748b',
  canone: '#0f766e',
  altri_oneri: '#94a3b8',
};

const KEYWORDS: Array<{ type: BankCostType; words: string[] }> = [
  { type: 'interessi_debitori', words: ['INTERESSI DEBITORI', 'INTERESSI PASSIVI', 'INTERESSI SCONFINAMENTO', 'INTERESSI SU SCOPERTO', 'INTERESSI DI MORA'] },
  { type: 'interessi_finanziamento', words: ['QUOTA INTERESSI', 'INTERESSI FINANZIAMENTO', 'INTERESSI MUTUO', 'INTERESSI LEASING', 'INTERESSI SU RATA'] },
  { type: 'rata_finanziamento', words: ['RATA FINANZIAMENTO', 'PAGAMENTO RATA', 'ADDEBITO RATA', 'RATA MUTUO', 'RIMBORSO FINANZ', 'RATA LEASING', 'RATA PRESTITO'] },
  { type: 'tenuta_conto', words: ['TENUTA CONTO', 'TENUTA DEL CONTO', 'SPESE TENUTA', 'SPESE TENUTA CONTO', 'GESTIONE CONTO'] },
  { type: 'canone', words: ['CANONE CONTO', 'CANONE MENSILE', 'CANONE SERVIZIO', 'CANONE CARTA'] },
  { type: 'imposta_bollo', words: ['IMPOSTA BOLLO', 'IMPOSTA DI BOLLO', 'BOLLO ESTRATTO'] },
  { type: 'commissioni', words: ['COMMISSIONI', 'COMM. BANCARIE', 'COMM BANCARIE', 'COMMISSIONE'] },
  { type: 'spese_operazione', words: ['SPESE OPERAZIONE', 'SPESE BONIFICO', 'SPESE DISPOSIZIONE', 'SPESE INCASSO', 'SPESE PAGAMENTO', 'SPESE LIQUIDAZIONE', 'COMPETENZE'] },
];

const INTEREST_RATE_PATTERNS = [
  /(?:T\.?\s*A\.?\s*N\.?|TASSO(?:\s+ANNUO)?|TASSO\s+DEBITORE|TASSO\s+INTERESSE)\s*[:=]?\s*(\d{1,2}(?:[.,]\d{1,4})?)\s*%/i,
  /(\d{1,2}(?:[.,]\d{1,4})?)\s*%\s*(?:TAN|TASSO|INTERESSI)/i,
];

function number(value: number | string | null | undefined): number | null {
  return parseLocalizedNumber(value);
}

function text(transaction: BankCostTransaction): string {
  return `${transaction.descrizione ?? ''} ${transaction.beneficiario_ordinante ?? ''}`.trim().toUpperCase();
}

function keywordMatch(value: string, words: string[]): string | null {
  return words.find(word => value.includes(word)) ?? null;
}

function extractRate(description: string): number | null {
  for (const pattern of INTEREST_RATE_PATTERNS) {
    const match = pattern.exec(description);
    if (match?.[1]) {
      const parsed = Number(match[1].replace(',', '.'));
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return parsed;
    }
  }
  return null;
}

function extractReference(transaction: BankCostTransaction): string | null {
  const raw = `${transaction.beneficiario_ordinante ?? ''} ${transaction.descrizione ?? ''}`.trim();
  if (!raw) return null;
  const cleaned = raw
    .replace(/\b(?:PAGAMENTO|ADDEBITO|RATA|RIMBORSO|FINANZ|FINANZIAMENTO|MUTUO|LEASING|PRESTITO)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 120) : null;
}

export function classifyBankCost(transaction: BankCostTransaction): BankCostMetadata {
  if (transaction.tipo !== 'uscita') {
    return {
      bank_cost_type: null,
      bank_cost_confidence: null,
      interest_amount: null,
      principal_amount: null,
      interest_rate: null,
      financing_reference: null,
      bank_cost_notes: null,
    };
  }

  const description = text(transaction);
  let matchedType: BankCostType | null = null;
  let rule: string | null = null;

  for (const entry of KEYWORDS) {
    const match = keywordMatch(description, entry.words);
    if (match) {
      matchedType = entry.type;
      rule = match;
      break;
    }
  }

  if (!matchedType && transaction.categoria === 'rata_finanziamento') {
    matchedType = 'rata_finanziamento';
    rule = 'categoria rata_finanziamento';
  } else if (!matchedType && transaction.categoria === 'spesa_bancaria') {
    matchedType = 'altri_oneri';
    rule = 'categoria spesa_bancaria';
  }

  if (!matchedType) {
    return {
      bank_cost_type: null,
      bank_cost_confidence: null,
      interest_amount: null,
      principal_amount: null,
      interest_rate: null,
      financing_reference: null,
      bank_cost_notes: null,
    };
  }

  const explicitInterest = number(transaction.interest_amount);
  const explicitPrincipal = number(transaction.principal_amount);
  const interestAmount = explicitInterest ?? (
    matchedType === 'interessi_debitori' || matchedType === 'interessi_finanziamento'
      ? number(transaction.importo)
      : null
  );
  const confidence = transaction.bank_cost_confidence
    ?? (transaction.classification_confidence === 'bassa' || transaction.parse_confidence === 'bassa' ? 'bassa' : rule ? 'alta' : 'media');

  return {
    bank_cost_type: transaction.bank_cost_type ?? matchedType,
    bank_cost_confidence: confidence,
    interest_amount: interestAmount,
    principal_amount: explicitPrincipal ?? null,
    interest_rate: number(transaction.interest_rate) ?? extractRate(description),
    financing_reference: transaction.financing_reference ?? (
      matchedType === 'rata_finanziamento' || matchedType === 'interessi_finanziamento'
        ? extractReference(transaction)
        : null
    ),
    bank_cost_notes: transaction.bank_cost_notes ?? (
      matchedType === 'rata_finanziamento' && interestAmount === null
        ? 'Rata rilevata, quota capitale/interessi non separabile dall’estratto conto.'
        : null
    ),
  };
}

export function enrichBankCostTransaction(transaction: BankCostTransaction): BankCostTransaction & BankCostMetadata {
  return { ...transaction, ...classifyBankCost(transaction) };
}

function monthKey(transaction: BankCostTransaction): string | null {
  const raw = transaction.data_valuta ?? transaction.data_contabile;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('it-IT', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

export function bankCostLabel(type: BankCostType): string {
  return CATEGORY_LABELS[type];
}

export function analyzeBankCosts(input: BankCostTransaction[]): BankCostAnalysis {
  const enriched = input
    .map(enrichBankCostTransaction)
    .filter(transaction => transaction.bank_cost_type && transaction.tipo === 'uscita');

  const totalOutflows = input
    .filter(transaction => transaction.tipo === 'uscita')
    .reduce((sum, transaction) => sum + (number(transaction.importo) ?? 0), 0);
  const totalCost = enriched.reduce((sum, transaction) => sum + (number(transaction.importo) ?? 0), 0);
  const interestPaid = enriched.reduce((sum, transaction) => sum + (number(transaction.interest_amount) ?? 0), 0);
  const principalPaid = enriched.reduce((sum, transaction) => sum + (number(transaction.principal_amount) ?? 0), 0);
  const monthKeys = enriched.map(monthKey).filter(Boolean) as string[];
  const months = Array.from(new Set(monthKeys)).sort();
  const monthCount = Math.max(1, months.length);

  const categories = (Object.keys(CATEGORY_LABELS) as BankCostType[])
    .map(type => {
      const rows = enriched.filter(transaction => transaction.bank_cost_type === type);
      return {
        type,
        label: CATEGORY_LABELS[type],
        total: rows.reduce((sum, transaction) => sum + (number(transaction.importo) ?? 0), 0),
        count: rows.length,
        color: CATEGORY_COLORS[type],
      };
    })
    .filter(category => category.count > 0)
    .sort((a, b) => b.total - a.total);

  const monthly = months.map(month => {
    const rows = enriched.filter(transaction => monthKey(transaction) === month);
    const total = rows.reduce((sum, transaction) => sum + (number(transaction.importo) ?? 0), 0);
    const interests = rows
      .filter(transaction => transaction.bank_cost_type === 'interessi_debitori' || transaction.bank_cost_type === 'interessi_finanziamento')
      .reduce((sum, transaction) => sum + (number(transaction.importo) ?? 0), 0);
    const installments = rows
      .filter(transaction => transaction.bank_cost_type === 'rata_finanziamento')
      .reduce((sum, transaction) => sum + (number(transaction.importo) ?? 0), 0);
    return { month, label: monthLabel(month), total, interests, installments, other: Math.max(0, total - interests - installments) };
  });

  const rates = Array.from(new Set(
    enriched
      .map(transaction => number(transaction.interest_rate))
      .filter((rate): rate is number => rate !== null)
      .map(rate => Math.round(rate * 10000) / 10000),
  )).sort((a, b) => a - b);
  const references = Array.from(new Set(
    enriched.map(transaction => transaction.financing_reference).filter((reference): reference is string => Boolean(reference)),
  ));
  const sourceFiles = new Set(enriched.map(transaction => transaction.file_nome).filter(Boolean));
  const reviewCount = enriched.filter(transaction => transaction.bank_cost_confidence === 'bassa').length;

  return {
    totalCost,
    averageMonthlyCost: totalCost / monthCount,
    totalOutflows,
    costIncidence: totalOutflows > 0 ? (totalCost / totalOutflows) * 100 : null,
    interestPaid,
    principalPaid,
    identifiedInterestRates: rates,
    financingReferences: references,
    transactions: enriched,
    categories,
    monthly,
    reviewCount,
    sourceCount: sourceFiles.size,
  };
}
