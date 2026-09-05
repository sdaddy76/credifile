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
}

const normalize = (value?: string | null) => (value ?? '')
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
  const normalized = normalize(formaGiuridica);
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
