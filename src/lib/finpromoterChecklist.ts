export type FinPromoterCondition =
  | 'sempre'
  | 'societa_capitali'
  | 'persone_ordinaria'
  | 'persone_semplificata'
  | 'cooperativa'
  | 'gruppo'
  | 'investimento'
  | 'garante'
  | 'mediazione'
  | 'ammissione_socio';

export type FinPromoterCompanyType =
  | 'sconosciuta'
  | 'societa_capitali'
  | 'societa_persone'
  | 'impresa_individuale'
  | 'cooperativa';

export type RegimeContabile = 'ordinaria' | 'semplificata' | null;
export type RequirementInputType = 'upload' | 'text' | 'contacts';

export interface FinPromoterProfile {
  tipo: FinPromoterCompanyType;
  regime: RegimeContabile;
  condizioni: {
    gruppo: boolean;
    investimento: boolean;
    garante: boolean;
    mediazione: boolean;
    ammissione_socio: boolean;
  };
}

export interface BankRequirementConditioned {
  condizione?: FinPromoterCondition | string | null;
  input_type?: RequirementInputType | string | null;
}

export const normalizeChecklistName = (value?: string | null) => (value ?? '')
  .toUpperCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[.'’`]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function classifyFinPromoterCompany(
  formaGiuridica?: string | null,
  regime?: RegimeContabile,
  override?: FinPromoterCompanyType | null,
): FinPromoterProfile {
  const normalized = normalizeChecklistName(formaGiuridica);
  let tipo: FinPromoterCompanyType = override && override !== 'sconosciuta' ? override : 'sconosciuta';

  if (tipo === 'sconosciuta') {
    if (/\bCOOPERATIVA\b/.test(normalized)) tipo = 'cooperativa';
    else if (/\b(?:IMPRESA|DITTA)\s+INDIVIDUALE\b/.test(normalized)) tipo = 'impresa_individuale';
    else if (/\b(?:SNC|S N C|SAS|S A S|SOCIETA\s+SEMPLICE|SOCIETA\s+DI\s+PERSONE|SS|S S)\b/.test(normalized)) tipo = 'societa_persone';
    else if (/\b(?:SRL|S R L|SPA|S P A|SAPA|S A P A|SOCIETA\s+DI\s+CAPITALI)\b/.test(normalized)) tipo = 'societa_capitali';
  }

  return {
    tipo,
    regime: regime ?? null,
    condizioni: {
      gruppo: false,
      investimento: false,
      garante: false,
      mediazione: false,
      ammissione_socio: false,
    },
  };
}

const FINPROMOTER_STANDARD_REPLACEMENTS: Array<{
  requirementNames: string[];
  standardNames: string[];
}> = [
  {
    requirementNames: ['Visura camerale'],
    standardNames: ['Visura Camerale Aggiornata'],
  },
  {
    requirementNames: [
      'Ultimi due bilanci approvati completi + dati provvisori di bilancio',
      'Ultime due dichiarazioni dei redditi + situazioni contabili complete + dati provvisori',
      'Ultime due dichiarazioni dei redditi + situazioni contabili + dati provvisori di Conto Economico',
    ],
    standardNames: ['Bilancio Depositato', 'Bilancio Provvisorio'],
  },
  {
    requirementNames: ['Relazione sullo scopo e sulla natura dell’operazione'],
    standardNames: ['Motivazione della Richiesta'],
  },
];

/**
 * Restituisce i documenti standard sostituiti da una specifica voce FinPromoter.
 * La mappatura è volutamente esplicita per evitare eliminazioni basate su somiglianze
 * testuali troppo permissive.
 */
export function standardDocumentsReplacedBy(requirementName: string): string[] {
  const normalizedRequirement = normalizeChecklistName(requirementName);
  const match = FINPROMOTER_STANDARD_REPLACEMENTS.find(group =>
    group.requirementNames.some(name => normalizeChecklistName(name) === normalizedRequirement)
  );
  return match?.standardNames ?? [];
}

export function requirementInputType(requirementName: string): RequirementInputType {
  const normalized = normalizeChecklistName(requirementName);
  if (normalized === normalizeChecklistName(
    'Cellulari ed e-mail — legale rappresentante, amministratore e titolari effettivi'
  )) {
    return 'contacts';
  }
  if (normalized === normalizeChecklistName('Relazione sullo scopo e sulla natura dell’operazione')) {
    return 'text';
  }
  return 'upload';
}

export function requirementApplies(
  requirement: BankRequirementConditioned,
  profile: FinPromoterProfile,
): boolean {
  const condition = requirement.condizione ?? 'sempre';
  if (condition === 'sempre' || !condition) return true;
  if (condition === 'societa_capitali') return profile.tipo === 'societa_capitali' || profile.tipo === 'cooperativa';
  if (condition === 'cooperativa') return profile.tipo === 'cooperativa';
  if (condition === 'persone_ordinaria') {
    return (profile.tipo === 'societa_persone' || profile.tipo === 'impresa_individuale') && profile.regime === 'ordinaria';
  }
  if (condition === 'persone_semplificata') {
    return (profile.tipo === 'societa_persone' || profile.tipo === 'impresa_individuale') && profile.regime === 'semplificata';
  }
  if (condition in profile.condizioni) {
    return profile.condizioni[condition as keyof FinPromoterProfile['condizioni']];
  }
  // Condizioni non ancora riconosciute non devono nascondere un documento
  // configurato dall'amministratore.
  return true;
}

export function finPromoterConditionLabel(condition?: string | null): string {
  switch (condition) {
    case 'societa_capitali': return 'Società di capitali';
    case 'persone_ordinaria': return 'Società di persone / impresa individuale — ordinaria';
    case 'persone_semplificata': return 'Società di persone / impresa individuale — semplificata';
    case 'cooperativa': return 'Società cooperativa';
    case 'gruppo': return 'Imprese collegate/associate';
    case 'investimento': return 'Investimento';
    case 'garante': return 'Presenza di garanti';
    case 'mediazione': return 'Pratica presentata da mediatore';
    case 'ammissione_socio': return 'Richiesta ammissione a socio FinPromoter';
    default: return 'Tutte le imprese';
  }
}
