export type StatementConfidence = 'alta' | 'media' | 'bassa';

export interface BankStatementTransaction {
  data_valuta?: string | null;
  data_contabile?: string | null;
  importo: number | string;
  tipo: 'entrata' | 'uscita';
  categoria: string;
  descrizione?: string | null;
  beneficiario_ordinante?: string | null;
  saldo_progressivo?: number | string | null;
  classification_confidence?: StatementConfidence | null;
  parse_confidence?: StatementConfidence | null;
}

export interface RecurringMovement {
  key: string;
  label: string;
  category: string;
  occurrences: number;
  months: number;
  averageAmount: number;
  minAmount: number;
  maxAmount: number;
  regularity: number;
}

export interface StatementInsight {
  id: string;
  title: string;
  severity: 'alta' | 'media' | 'bassa';
  confidence: StatementConfidence;
  explanation: string;
  evidence: string[];
  recommendedChecks: string[];
}

export interface BankStatementAdvancedAnalysis {
  monthsAnalyzed: number;
  datedTransactions: number;
  reliableTransactions: number;
  reliablePercentage: number;
  lowConfidenceTransactions: number;
  negativeBalanceObservations: number;
  minimumBalance: number | null;
  customerReceiptConcentration: number | null;
  recurringPayments: RecurringMovement[];
  recurringFinancingPayments: RecurringMovement[];
  insights: StatementInsight[];
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let normalized = String(value).trim().replace(/[€\s]/g, '');
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot
      ? normalized.replace(/\./g, '').replace(',', '.')
      : normalized.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function transactionDate(transaction: BankStatementTransaction): Date | null {
  const raw = transaction.data_valuta || transaction.data_contabile;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthKey(transaction: BankStatementTransaction): string | null {
  const date = transactionDate(transaction);
  return date ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` : null;
}

export function normalizeCounterparty(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(iban|bonifico|sepa|sdd|rid|pagamento|rata|addebito|accredito|disposizione|fattura|ft|nr|n)\b/g, ' ')
    .replace(/\b[a-z]{2}\d{2}[a-z0-9]{10,30}\b/gi, ' ')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(token => token.length >= 3)
    .slice(0, 6)
    .join(' ');
}

function movementLabel(transaction: BankStatementTransaction): string {
  return (
    transaction.beneficiario_ordinante?.trim()
    || transaction.descrizione?.trim()
    || 'Controparte non identificata'
  ).slice(0, 90);
}

function buildRecurringMovements(
  transactions: BankStatementTransaction[],
  predicate: (transaction: BankStatementTransaction) => boolean,
): RecurringMovement[] {
  const groups = new Map<string, Array<{ transaction: BankStatementTransaction; amount: number; month: string }>>();

  for (const transaction of transactions) {
    if (!predicate(transaction)) continue;
    const amount = toNumber(transaction.importo);
    const month = monthKey(transaction);
    if (!amount || amount <= 0 || !month) continue;
    const label = movementLabel(transaction);
    const counterparty = normalizeCounterparty(label);
    if (!counterparty) continue;
    const key = `${transaction.categoria}:${counterparty}`;
    const rows = groups.get(key) ?? [];
    rows.push({ transaction, amount, month });
    groups.set(key, rows);
  }

  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const amounts = rows.map(row => row.amount);
      const averageAmount = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
      const variance = amounts.reduce((sum, amount) => sum + ((amount - averageAmount) ** 2), 0) / amounts.length;
      const coefficientOfVariation = averageAmount > 0 ? Math.sqrt(variance) / averageAmount : 1;
      return {
        key,
        label: movementLabel(rows[0].transaction),
        category: rows[0].transaction.categoria,
        occurrences: rows.length,
        months: new Set(rows.map(row => row.month)).size,
        averageAmount,
        minAmount: Math.min(...amounts),
        maxAmount: Math.max(...amounts),
        regularity: Math.max(0, Math.round((1 - Math.min(1, coefficientOfVariation)) * 100)),
      };
    })
    .filter(group => group.occurrences >= 2 && group.months >= 2)
    .sort((a, b) => (b.months - a.months) || (b.averageAmount - a.averageAmount));
}

function percentage(value: number): string {
  return `${value.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;
}

function money(value: number): string {
  return `€ ${value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function analyzeBankStatement(
  transactions: BankStatementTransaction[],
): BankStatementAdvancedAnalysis {
  const dated = transactions.filter(transaction => transactionDate(transaction));
  const months = new Set(dated.map(transaction => monthKey(transaction)).filter(Boolean) as string[]);
  const reliableTransactions = transactions.filter(transaction =>
    transaction.classification_confidence !== 'bassa'
    && transaction.parse_confidence !== 'bassa'
  ).length;
  const lowConfidenceTransactions = transactions.length - reliableTransactions;
  const balances = transactions
    .map(transaction => toNumber(transaction.saldo_progressivo))
    .filter((value): value is number => value !== null);
  const negativeBalanceObservations = balances.filter(balance => balance < 0).length;
  const minimumBalance = balances.length > 0 ? Math.min(...balances) : null;

  const customerReceipts = transactions
    .filter(transaction => transaction.tipo === 'entrata' && transaction.categoria === 'incasso_cliente')
    .map(transaction => ({
      key: normalizeCounterparty(transaction.beneficiario_ordinante || transaction.descrizione),
      amount: toNumber(transaction.importo) ?? 0,
    }))
    .filter(row => row.key && row.amount > 0);
  const receiptGroups = new Map<string, number>();
  customerReceipts.forEach(row => receiptGroups.set(row.key, (receiptGroups.get(row.key) ?? 0) + row.amount));
  const totalCustomerReceipts = customerReceipts.reduce((sum, row) => sum + row.amount, 0);
  const largestCustomerReceipt = Math.max(0, ...receiptGroups.values());
  const customerReceiptConcentration = totalCustomerReceipts > 0
    ? Math.round((largestCustomerReceipt / totalCustomerReceipts) * 1000) / 10
    : null;

  const recurringPayments = buildRecurringMovements(
    transactions,
    transaction => transaction.tipo === 'uscita',
  );
  const recurringFinancingPayments = recurringPayments.filter(movement =>
    movement.category === 'rata_finanziamento'
  );

  const insights: StatementInsight[] = [];
  const reliablePercentage = transactions.length > 0
    ? Math.round((reliableTransactions / transactions.length) * 1000) / 10
    : 0;

  if (transactions.length > 0 && reliablePercentage < 75) {
    insights.push({
      id: 'data_quality',
      title: 'Qualità di lettura da verificare',
      severity: reliablePercentage < 55 ? 'alta' : 'media',
      confidence: 'alta',
      explanation: 'Una parte rilevante dei movimenti non è stata letta o classificata con affidabilità sufficiente.',
      evidence: [
        `${lowConfidenceTransactions} movimenti su ${transactions.length} richiedono verifica`,
        `Copertura affidabile: ${percentage(reliablePercentage)}`,
      ],
      recommendedChecks: [
        'Preferire il file CSV/XLS originale della banca quando disponibile',
        'Controllare manualmente importi, segno e causale dei movimenti segnalati',
      ],
    });
  }

  if (negativeBalanceObservations > 0 && minimumBalance !== null) {
    insights.push({
      id: 'negative_balances',
      title: 'Saldi negativi rilevati',
      severity: negativeBalanceObservations >= 5 ? 'alta' : 'media',
      confidence: balances.length >= 5 ? 'alta' : 'media',
      explanation: 'Il saldo progressivo scende sotto zero in una o più rilevazioni dell’estratto conto.',
      evidence: [
        `${negativeBalanceObservations} rilevazioni con saldo negativo`,
        `Saldo minimo rilevato: ${money(minimumBalance)}`,
      ],
      recommendedChecks: [
        'Verificare durata e frequenza degli sconfinamenti',
        'Confrontare gli episodi con affidamenti accordati e Centrale Rischi',
      ],
    });
  }

  if (customerReceiptConcentration !== null && customerReceiptConcentration >= 45 && customerReceipts.length >= 3) {
    insights.push({
      id: 'receipt_concentration',
      title: 'Incassi concentrati su una controparte',
      severity: customerReceiptConcentration >= 65 ? 'alta' : 'media',
      confidence: receiptGroups.size >= 2 ? 'media' : 'bassa',
      explanation: 'Una quota significativa degli incassi classificati come clienti proviene dalla stessa controparte.',
      evidence: [
        `Prima controparte: ${percentage(customerReceiptConcentration)} degli incassi clienti rilevati`,
        `${receiptGroups.size} controparti clienti riconosciute`,
      ],
      recommendedChecks: [
        'Verificare la dipendenza commerciale dal principale cliente',
        'Confrontare il dato con partitario clienti e fatturato per controparte',
      ],
    });
  }

  if (months.size >= 3 && recurringFinancingPayments.length === 0) {
    insights.push({
      id: 'no_financing_payments',
      title: 'Rate finanziarie non riconosciute',
      severity: 'bassa',
      confidence: reliablePercentage >= 80 ? 'media' : 'bassa',
      explanation: 'Nell’intervallo analizzato non sono state riconosciute uscite ricorrenti classificate come rate di finanziamenti.',
      evidence: [`Periodo coperto: ${months.size} mesi`],
      recommendedChecks: [
        'Verificare se le rate sono addebitate su altri conti',
        'Controllare i movimenti a bassa confidenza e la situazione finanziamenti dichiarata',
      ],
    });
  }

  return {
    monthsAnalyzed: months.size,
    datedTransactions: dated.length,
    reliableTransactions,
    reliablePercentage,
    lowConfidenceTransactions,
    negativeBalanceObservations,
    minimumBalance,
    customerReceiptConcentration,
    recurringPayments,
    recurringFinancingPayments,
    insights,
  };
}
