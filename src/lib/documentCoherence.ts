import {
  analyzeBankStatement,
  normalizeCounterparty,
  type BankStatementTransaction,
  type StatementConfidence,
} from '@/lib/bankStatementAnalysis';

export type CoherenceSeverity = 'alta' | 'media' | 'bassa';
export type CoherenceCheckStatus = 'coerente' | 'da_approfondire' | 'non_verificabile';

export interface CoherenceFinding {
  id: string;
  title: string;
  category: string;
  severity: CoherenceSeverity;
  confidence: StatementConfidence;
  explanation: string;
  evidence: string[];
  possible_explanations: string[];
  recommended_checks: string[];
  suggested_question: string;
  sources: string[];
  source_fingerprint: string;
}

export interface CoherenceCheck {
  id: string;
  label: string;
  status: CoherenceCheckStatus;
  note: string;
  sources: string[];
}

export interface DocumentCoherenceResult {
  findings: CoherenceFinding[];
  checks: CoherenceCheck[];
  coverage: number;
  availableSources: string[];
}

export interface CoherenceClient {
  ragione_sociale?: string | null;
  piva?: string | null;
  codice_fiscale?: string | null;
  capitale_sociale?: number | string | null;
  codice_ateco?: string | null;
  visura_json?: Record<string, unknown> | null;
}

export interface CoherencePractice {
  codice_ateco?: string | null;
  importo_richiesto?: number | string | null;
}

export interface CoherenceBalance {
  id?: string;
  anno_esercizio?: number | null;
  ragione_sociale?: string | null;
  capitale_sociale?: number | string | null;
  debiti_banche_breve?: number | string | null;
  debiti_banche_lungo?: number | string | null;
  debiti_altri_finanziatori?: number | string | null;
}

export interface CoherenceFinancing {
  tipologia?: string | null;
  banca_finanziaria?: string | null;
  rata?: number | string | null;
  debito_residuo?: number | string | null;
  accordato?: number | string | null;
  accordato_operativo?: number | string | null;
  utilizzato?: number | string | null;
  fonte?: string | null;
  data_riferimento?: string | null;
}

export interface DocumentCoherenceInput {
  client: CoherenceClient | null;
  practice: CoherencePractice | null;
  balances: CoherenceBalance[];
  financing: CoherenceFinancing[];
  transactions: BankStatementTransaction[];
}

function numberValue(value: number | string | null | undefined): number | null {
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

function normalizedCompanyName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(srl|s r l|spa|s p a|snc|sas|societa|cooperativa|impresa|ditta)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companyNameSimilarity(left: string, right: string): number {
  const a = normalizedCompanyName(left);
  const b = normalizedCompanyName(right);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const aTokens = new Set(a.split(' ').filter(token => token.length >= 2));
  const bTokens = new Set(b.split(' ').filter(token => token.length >= 2));
  const intersection = [...aTokens].filter(token => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union > 0 ? intersection / union : 0;
}

function relativeDifference(left: number, right: number): number {
  const denominator = Math.max(Math.abs(left), Math.abs(right), 1);
  return Math.abs(left - right) / denominator;
}

function money(value: number): string {
  return `€ ${value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function stableFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function buildFinding(
  finding: Omit<CoherenceFinding, 'source_fingerprint'>,
): CoherenceFinding {
  return {
    ...finding,
    source_fingerprint: stableFingerprint({
      id: finding.id,
      evidence: finding.evidence,
      sources: finding.sources,
    }),
  };
}

function isCentralRisk(financing: CoherenceFinancing): boolean {
  return (financing.fonte ?? '').toLowerCase() === 'centrale_rischi';
}

function aggregate(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length > 0 ? available.reduce((sum, value) => sum + value, 0) : null;
}

export function analyzeDocumentCoherence(input: DocumentCoherenceInput): DocumentCoherenceResult {
  const findings: CoherenceFinding[] = [];
  const checks: CoherenceCheck[] = [];
  const availableSources: string[] = [];
  const latestBalance = [...input.balances]
    .sort((a, b) => (b.anno_esercizio ?? 0) - (a.anno_esercizio ?? 0))[0];
  const manualFinancing = input.financing.filter(financing => !isCentralRisk(financing));
  const centralRisk = input.financing.filter(isCentralRisk);
  const statementAnalysis = analyzeBankStatement(input.transactions);

  if (input.client?.visura_json || input.client?.ragione_sociale) availableSources.push('Visura / dati impresa');
  if (latestBalance) availableSources.push(`Bilancio ${latestBalance.anno_esercizio ?? ''}`.trim());
  if (manualFinancing.length > 0) availableSources.push('Finanziamenti dichiarati');
  if (centralRisk.length > 0) availableSources.push('Centrale Rischi');
  if (input.transactions.length > 0) availableSources.push('Estratto conto');

  if (input.client?.ragione_sociale && latestBalance?.ragione_sociale) {
    const similarity = companyNameSimilarity(input.client.ragione_sociale, latestBalance.ragione_sociale);
    if (similarity < 0.65) {
      findings.push(buildFinding({
        id: 'identity_company_name',
        title: 'Ragione sociale non allineata',
        category: 'identita_impresa',
        severity: similarity < 0.3 ? 'alta' : 'media',
        confidence: 'alta',
        explanation: 'La denominazione rilevata nel bilancio non coincide sufficientemente con quella acquisita dalla visura o dai dati impresa.',
        evidence: [
          `Visura/dati impresa: ${input.client.ragione_sociale}`,
          `Bilancio: ${latestBalance.ragione_sociale}`,
        ],
        possible_explanations: [
          'Variazione recente della denominazione sociale',
          'Bilancio associato a un’altra società o a una società del gruppo',
          'Lettura incompleta dell’intestazione del bilancio',
        ],
        recommended_checks: [
          'Confrontare partita IVA e codice fiscale presenti nei documenti originali',
          'Verificare eventuali variazioni storiche nella visura',
        ],
        suggested_question: 'La ragione sociale riportata nel bilancio non coincide con quella della visura. Potete confermare a quale società si riferisce il bilancio e fornire eventuale documentazione sulla variazione di denominazione?',
        sources: ['Visura / dati impresa', 'Bilancio'],
      }));
      checks.push({
        id: 'identity_company_name',
        label: 'Identità impresa tra visura e bilancio',
        status: 'da_approfondire',
        note: 'Denominazioni non sufficientemente allineate',
        sources: ['Visura / dati impresa', 'Bilancio'],
      });
    } else {
      checks.push({
        id: 'identity_company_name',
        label: 'Identità impresa tra visura e bilancio',
        status: 'coerente',
        note: 'Ragione sociale coerente',
        sources: ['Visura / dati impresa', 'Bilancio'],
      });
    }
  } else {
    checks.push({
      id: 'identity_company_name',
      label: 'Identità impresa tra visura e bilancio',
      status: 'non_verificabile',
      note: 'Ragione sociale non disponibile in entrambe le fonti',
      sources: ['Visura / dati impresa', 'Bilancio'],
    });
  }

  const clientCapital = numberValue(input.client?.capitale_sociale);
  const balanceCapital = numberValue(latestBalance?.capitale_sociale);
  if (clientCapital !== null && balanceCapital !== null) {
    const difference = relativeDifference(clientCapital, balanceCapital);
    if (difference > 0.05) {
      findings.push(buildFinding({
        id: 'capital_share_capital',
        title: 'Capitale sociale non allineato',
        category: 'patrimonio',
        severity: difference > 0.25 ? 'media' : 'bassa',
        confidence: 'alta',
        explanation: 'Il capitale sociale della visura/dati impresa differisce dal valore riportato nell’ultimo bilancio analizzato.',
        evidence: [
          `Visura/dati impresa: ${money(clientCapital)}`,
          `Bilancio ${latestBalance?.anno_esercizio ?? ''}: ${money(balanceCapital)}`,
        ],
        possible_explanations: [
          'Aumento o riduzione di capitale successivo alla chiusura del bilancio',
          'Valore della visura o del bilancio letto in modo incompleto',
        ],
        recommended_checks: [
          'Verificare la data di efficacia della variazione del capitale',
          'Controllare nota integrativa e visura storica',
        ],
        suggested_question: 'Il capitale sociale della visura non coincide con quello dell’ultimo bilancio analizzato. Potete indicare la causa e la data dell’eventuale variazione?',
        sources: ['Visura / dati impresa', 'Bilancio'],
      }));
      checks.push({
        id: 'capital_share_capital',
        label: 'Capitale sociale tra visura e bilancio',
        status: 'da_approfondire',
        note: `Scostamento ${(difference * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`,
        sources: ['Visura / dati impresa', 'Bilancio'],
      });
    } else {
      checks.push({
        id: 'capital_share_capital',
        label: 'Capitale sociale tra visura e bilancio',
        status: 'coerente',
        note: 'Valori coerenti',
        sources: ['Visura / dati impresa', 'Bilancio'],
      });
    }
  } else {
    checks.push({
      id: 'capital_share_capital',
      label: 'Capitale sociale tra visura e bilancio',
      status: 'non_verificabile',
      note: 'Capitale sociale non disponibile in entrambe le fonti',
      sources: ['Visura / dati impresa', 'Bilancio'],
    });
  }

  const practiceAteco = input.practice?.codice_ateco?.replace(/\D/g, '') || '';
  const clientAteco = input.client?.codice_ateco?.replace(/\D/g, '') || '';
  if (practiceAteco && clientAteco) {
    const aligned = practiceAteco === clientAteco
      || practiceAteco.startsWith(clientAteco)
      || clientAteco.startsWith(practiceAteco);
    if (!aligned) {
      findings.push(buildFinding({
        id: 'identity_ateco',
        title: 'Codice ATECO non allineato',
        category: 'identita_impresa',
        severity: 'media',
        confidence: 'alta',
        explanation: 'Il codice ATECO della pratica differisce da quello acquisito nei dati impresa.',
        evidence: [
          `Dati impresa: ${input.client?.codice_ateco}`,
          `Pratica: ${input.practice?.codice_ateco}`,
        ],
        possible_explanations: [
          'Attività prevalente aggiornata dopo l’apertura della pratica',
          'Pratica riferita a un ramo di attività secondario',
        ],
        recommended_checks: [
          'Confermare l’attività prevalente aggiornata',
          'Usare il codice corretto per benchmark e valutazione settoriale',
        ],
        suggested_question: 'Il codice ATECO della pratica non coincide con quello acquisito dalla visura. Potete confermare l’attività prevalente e il codice ATECO da utilizzare per l’analisi?',
        sources: ['Visura / dati impresa', 'Pratica'],
      }));
      checks.push({
        id: 'identity_ateco',
        label: 'Codice ATECO tra visura e pratica',
        status: 'da_approfondire',
        note: 'Codici ATECO differenti',
        sources: ['Visura / dati impresa', 'Pratica'],
      });
    } else {
      checks.push({
        id: 'identity_ateco',
        label: 'Codice ATECO tra visura e pratica',
        status: 'coerente',
        note: 'Codici ATECO coerenti',
        sources: ['Visura / dati impresa', 'Pratica'],
      });
    }
  } else {
    checks.push({
      id: 'identity_ateco',
      label: 'Codice ATECO tra visura e pratica',
      status: 'non_verificabile',
      note: 'Codice ATECO mancante in una delle fonti',
      sources: ['Visura / dati impresa', 'Pratica'],
    });
  }

  const balanceDebt = latestBalance
    ? aggregate([
        numberValue(latestBalance.debiti_banche_breve),
        numberValue(latestBalance.debiti_banche_lungo),
        numberValue(latestBalance.debiti_altri_finanziatori),
      ])
    : null;
  const declaredDebt = aggregate(manualFinancing.map(financing => numberValue(financing.debito_residuo)));
  if (balanceDebt !== null && declaredDebt !== null && Math.max(balanceDebt, declaredDebt) >= 1000) {
    const difference = relativeDifference(balanceDebt, declaredDebt);
    if (difference > 0.35) {
      findings.push(buildFinding({
        id: 'financing_balance_vs_declared',
        title: 'Esposizione finanziaria non allineata',
        category: 'indebitamento',
        severity: difference > 0.65 ? 'alta' : 'media',
        confidence: 'media',
        explanation: 'I debiti finanziari dell’ultimo bilancio differiscono dalla situazione finanziamenti dichiarata. Il confronto è temporale e deve considerare rimborsi, nuovi affidamenti e date di riferimento.',
        evidence: [
          `Bilancio ${latestBalance?.anno_esercizio ?? ''}: ${money(balanceDebt)}`,
          `Debito residuo dichiarato: ${money(declaredDebt)}`,
          `Scostamento: ${(difference * 100).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`,
        ],
        possible_explanations: [
          'Rimborsi o nuove erogazioni successive alla chiusura del bilancio',
          'Finanziamenti, leasing o affidamenti non inseriti nella situazione dichiarata',
          'Perimetro contabile differente tra le fonti',
        ],
        recommended_checks: [
          'Confrontare le date di riferimento delle due fonti',
          'Richiedere dettaglio aggiornato dei rapporti finanziari',
        ],
        suggested_question: 'L’esposizione finanziaria dell’ultimo bilancio non è allineata alla situazione finanziamenti inserita. Potete fornire un prospetto aggiornato con banca, tipologia, debito residuo e rata di ciascun rapporto?',
        sources: ['Bilancio', 'Finanziamenti dichiarati'],
      }));
      checks.push({
        id: 'financing_balance_vs_declared',
        label: 'Debiti finanziari tra bilancio e dichiarato',
        status: 'da_approfondire',
        note: 'Scostamento superiore al 35%',
        sources: ['Bilancio', 'Finanziamenti dichiarati'],
      });
    } else {
      checks.push({
        id: 'financing_balance_vs_declared',
        label: 'Debiti finanziari tra bilancio e dichiarato',
        status: 'coerente',
        note: 'Scostamento compatibile con la diversa data di riferimento',
        sources: ['Bilancio', 'Finanziamenti dichiarati'],
      });
    }
  } else {
    checks.push({
      id: 'financing_balance_vs_declared',
      label: 'Debiti finanziari tra bilancio e dichiarato',
      status: 'non_verificabile',
      note: 'Bilancio o situazione finanziamenti non disponibili',
      sources: ['Bilancio', 'Finanziamenti dichiarati'],
    });
  }

  const declaredMonthlyRate = aggregate(manualFinancing.map(financing => numberValue(financing.rata)));
  const statementMonthlyRate = statementAnalysis.recurringFinancingPayments.length > 0
    ? statementAnalysis.recurringFinancingPayments.reduce((sum, movement) => sum + movement.averageAmount, 0)
    : null;
  if (
    declaredMonthlyRate !== null
    && statementMonthlyRate !== null
    && statementAnalysis.monthsAnalyzed >= 2
    && Math.max(declaredMonthlyRate, statementMonthlyRate) >= 100
  ) {
    const difference = relativeDifference(declaredMonthlyRate, statementMonthlyRate);
    if (difference > 0.25) {
      findings.push(buildFinding({
        id: 'financing_installments_vs_statement',
        title: 'Rate mensili non allineate con l’estratto conto',
        category: 'indebitamento',
        severity: difference > 0.55 ? 'alta' : 'media',
        confidence: statementAnalysis.reliablePercentage >= 80 ? 'alta' : 'media',
        explanation: 'La media delle rate ricorrenti riconosciute sull’estratto conto differisce dal totale rate dichiarato.',
        evidence: [
          `Rate mensili dichiarate: ${money(declaredMonthlyRate)}`,
          `Rate ricorrenti rilevate: ${money(statementMonthlyRate)}`,
          `Periodo estratto conto: ${statementAnalysis.monthsAnalyzed} mesi`,
        ],
        possible_explanations: [
          'Rate addebitate su un altro conto',
          'Rapporti estinti o accesi nel periodo analizzato',
          'Movimenti bancari classificati con causale non riconoscibile',
        ],
        recommended_checks: [
          'Verificare i piani di ammortamento aggiornati',
          'Controllare i movimenti ricorrenti e quelli a bassa confidenza',
        ],
        suggested_question: 'Le rate ricorrenti rilevate sull’estratto conto non coincidono con il totale delle rate dichiarate. Potete confermare quali finanziamenti sono attivi e su quali conti vengono addebitati?',
        sources: ['Estratto conto', 'Finanziamenti dichiarati'],
      }));
      checks.push({
        id: 'financing_installments_vs_statement',
        label: 'Rate tra estratto conto e dichiarato',
        status: 'da_approfondire',
        note: 'Scostamento superiore al 25%',
        sources: ['Estratto conto', 'Finanziamenti dichiarati'],
      });
    } else {
      checks.push({
        id: 'financing_installments_vs_statement',
        label: 'Rate tra estratto conto e dichiarato',
        status: 'coerente',
        note: 'Rate ricorrenti compatibili con il dichiarato',
        sources: ['Estratto conto', 'Finanziamenti dichiarati'],
      });
    }
  } else {
    checks.push({
      id: 'financing_installments_vs_statement',
      label: 'Rate tra estratto conto e dichiarato',
      status: 'non_verificabile',
      note: 'Servono rate dichiarate e almeno due mesi di movimenti riconoscibili',
      sources: ['Estratto conto', 'Finanziamenti dichiarati'],
    });
  }

  if (centralRisk.length > 0 && manualFinancing.length > 0) {
    const centralExposure = aggregate(centralRisk.map(financing =>
      numberValue(financing.utilizzato)
      ?? numberValue(financing.debito_residuo)
      ?? numberValue(financing.accordato_operativo)
      ?? numberValue(financing.accordato)
    ));
    if (centralExposure !== null && declaredDebt !== null && Math.max(centralExposure, declaredDebt) >= 1000) {
      const difference = relativeDifference(centralExposure, declaredDebt);
      if (difference > 0.4) {
        findings.push(buildFinding({
          id: 'financing_declared_vs_central_risk',
          title: 'Situazione finanziamenti e Centrale Rischi non allineate',
          category: 'centrale_rischi',
          severity: difference > 0.7 ? 'alta' : 'media',
          confidence: 'media',
          explanation: 'L’esposizione aggregata della Centrale Rischi differisce dal debito residuo indicato nella situazione finanziamenti. Le grandezze possono avere perimetro e data differenti.',
          evidence: [
            `Esposizione Centrale Rischi: ${money(centralExposure)}`,
            `Debito residuo dichiarato: ${money(declaredDebt)}`,
          ],
          possible_explanations: [
            'Presenza di linee autoliquidanti o a revoca non incluse nel debito residuo',
            'Date di riferimento differenti',
            'Rapporti non indicati nella situazione finanziamenti',
          ],
          recommended_checks: [
            'Confrontare banca per banca e tipologia per tipologia',
            'Verificare data di riferimento e rapporti cointestati o garantiti',
          ],
          suggested_question: 'La situazione finanziamenti non risulta allineata con l’esposizione rilevata in Centrale Rischi. Potete fornire un dettaglio aggiornato di tutti gli affidamenti e finanziamenti, indicando anche le linee a revoca e autoliquidanti?',
          sources: ['Centrale Rischi', 'Finanziamenti dichiarati'],
        }));
        checks.push({
          id: 'financing_declared_vs_central_risk',
          label: 'Esposizione tra Centrale Rischi e dichiarato',
          status: 'da_approfondire',
          note: 'Scostamento aggregato superiore al 40%',
          sources: ['Centrale Rischi', 'Finanziamenti dichiarati'],
        });
      } else {
        checks.push({
          id: 'financing_declared_vs_central_risk',
          label: 'Esposizione tra Centrale Rischi e dichiarato',
          status: 'coerente',
          note: 'Valori aggregati compatibili',
          sources: ['Centrale Rischi', 'Finanziamenti dichiarati'],
        });
      }
    } else {
      checks.push({
        id: 'financing_declared_vs_central_risk',
        label: 'Esposizione tra Centrale Rischi e dichiarato',
        status: 'non_verificabile',
        note: 'Le fonti sono presenti ma non contengono valori confrontabili',
        sources: ['Centrale Rischi', 'Finanziamenti dichiarati'],
      });
    }
  } else {
    checks.push({
      id: 'financing_declared_vs_central_risk',
      label: 'Esposizione tra Centrale Rischi e dichiarato',
      status: 'non_verificabile',
      note: 'Centrale Rischi o finanziamenti dichiarati non disponibili',
      sources: ['Centrale Rischi', 'Finanziamenti dichiarati'],
    });
  }

  const declaredLenders = manualFinancing
    .map(financing => normalizeCounterparty(financing.banca_finanziaria))
    .filter(Boolean);
  const undeclaredRecurring = statementAnalysis.recurringFinancingPayments.filter(movement => {
    const movementName = normalizeCounterparty(movement.label);
    return declaredLenders.length > 0
      && !declaredLenders.some(lender => lender.includes(movementName) || movementName.includes(lender));
  });
  if (undeclaredRecurring.length > 0) {
    const evidence = undeclaredRecurring.slice(0, 4).map(movement =>
      `${movement.label}: ${movement.occurrences} addebiti, media ${money(movement.averageAmount)}`
    );
    findings.push(buildFinding({
      id: 'financing_unknown_recurring_lenders',
      title: 'Addebiti finanziari ricorrenti non associati',
      category: 'indebitamento',
      severity: undeclaredRecurring.length >= 2 ? 'media' : 'bassa',
      confidence: statementAnalysis.reliablePercentage >= 80 ? 'media' : 'bassa',
      explanation: 'Sono stati riconosciuti addebiti ricorrenti classificati come rate, ma la controparte non coincide con gli enti indicati nella situazione finanziamenti.',
      evidence,
      possible_explanations: [
        'Descrizione bancaria abbreviata o diversa dalla denominazione dell’ente',
        'Leasing, noleggi o finanziamenti non inseriti nel prospetto',
      ],
      recommended_checks: [
        'Associare ogni addebito ricorrente al relativo contratto',
        'Verificare i movimenti originali prima di richiedere chiarimenti',
      ],
      suggested_question: 'Nell’estratto conto risultano addebiti finanziari ricorrenti non associati ai rapporti dichiarati. Potete indicare a quali contratti si riferiscono e fornire il relativo piano o contratto?',
      sources: ['Estratto conto', 'Finanziamenti dichiarati'],
    }));
    checks.push({
      id: 'financing_unknown_recurring_lenders',
      label: 'Controparti rate tra estratto conto e dichiarato',
      status: 'da_approfondire',
      note: `${undeclaredRecurring.length} controparte/i non associate`,
      sources: ['Estratto conto', 'Finanziamenti dichiarati'],
    });
  } else if (input.transactions.length > 0 && manualFinancing.length > 0 && declaredLenders.length > 0) {
    checks.push({
      id: 'financing_unknown_recurring_lenders',
      label: 'Controparti rate tra estratto conto e dichiarato',
      status: 'coerente',
      note: 'Nessuna controparte ricorrente non associata',
      sources: ['Estratto conto', 'Finanziamenti dichiarati'],
    });
  } else {
    checks.push({
      id: 'financing_unknown_recurring_lenders',
      label: 'Controparti rate tra estratto conto e dichiarato',
      status: 'non_verificabile',
      note: declaredLenders.length === 0 && manualFinancing.length > 0
        ? 'Denominazione degli enti finanziatori non disponibile'
        : 'Estratto conto o finanziamenti dichiarati non disponibili',
      sources: ['Estratto conto', 'Finanziamenti dichiarati'],
    });
  }

  const executableChecks = checks.filter(check => check.status !== 'non_verificabile').length;
  return {
    findings,
    checks,
    coverage: checks.length > 0 ? Math.round((executableChecks / checks.length) * 100) : 0,
    availableSources,
  };
}
