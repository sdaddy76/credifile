export type PracticeStatus =
  | 'bozza'
  | 'raccolta_documenti'
  | 'inviata_banca'
  | 'istruttoria'
  | 'in_delibera'
  | 'deliberata'
  | 'erogata'
  | 'integrazioni_richieste'
  | 'completata'
  | 'approvata'
  | 'rifiutata'
  | 'declinata';

export type DocumentStatus = 'richiesto' | 'caricato' | 'approvato' | 'rifiutato';
export type DocumentType = 'standard' | 'banca' | 'integrazione';

export interface Socio {
  nome:           string;
  codice_fiscale: string;
  valore:         string;
  percentuale:    string;
}

export interface Amministratore {
  nome:            string;
  codice_fiscale?: string;
  carica:          string;
}

export interface Client {
  id: string;
  ragione_sociale: string;
  piva?: string;
  codice_fiscale?: string;
  email: string;
  telefono?: string;
  indirizzo?: string;
  data_costituzione?: string;
  capitale_sociale_versato?: string;
  soci?: Socio[];
  amministratori?: Amministratore[];
  forma_giuridica?: string;
  capitale_sociale?: number;
  ateco_descrizione?: string;
  codice_ateco?: string;
  provincia?: string;
  created_at: string;
  updated_at: string;
}

export interface Bank {
  id: string;
  nome: string;
  codice: string;
  contatto?: string;
  email?: string;
  email_invio_banca?: string;
  email_cc?: string;
  email_bcc?: string;
  note?: string;
  attiva: boolean;
  bank_user_id?: string;
  created_at: string;
}

export interface BankInterestRequest {
  id: string;
  practice_id: string;
  bank_id: string;
  requested_by: string;
  status: 'in_attesa' | 'approvata' | 'rifiutata';
  note_banca?: string;
  note_segreteria?: string;
  handled_by?: string;
  created_at: string;
  updated_at: string;
  banks?: Bank;
  practices?: { numero_pratica: string; clients?: { citta?: string; codice_ateco?: string } };
  requester?: { email: string; nome?: string };
}

export interface DocumentTemplate {
  id: string;
  nome: string;
  descrizione?: string;
  obbligatorio: boolean;
  ordine: number;
  created_at: string;
}

export interface BankDocumentRequirement {
  id: string;
  bank_id: string;
  nome: string;
  descrizione?: string;
  obbligatorio: boolean;
  ordine: number;
  condizione?: string | null;
  created_at: string;
}

export interface Practice {
  id: string;
  client_id: string;
  bank_id?: string;
  segnalatore_id?: string;
  numero_pratica: string;
  importo_richiesto?: number;
  motivazione?: string;
  status: PracticeStatus;
  note_admin?: string;
  assigned_to?: string;
  codice_ateco?: string;
  tipologia_azienda?: 'auto' | 'societa_capitali' | 'societa_persone' | 'impresa_individuale' | 'cooperativa' | null;
  regime_contabile?: 'ordinaria' | 'semplificata' | null;
  checklist_condizioni?: {
    gruppo?: boolean;
    investimento?: boolean;
    garante?: boolean;
    mediazione?: boolean;
    ammissione_socio?: boolean;
  } | null;
  created_at: string;
  updated_at: string;
  clients?: Client;
  banks?: Bank;
  segnalatore?: AdminProfile;
}

export interface AdminProfile {
  id: string;
  email: string;
  ruolo: string;
  nome?: string;
  created_at?: string;
}

export interface AgentSegnalatore {
  id: string;
  agent_id: string;
  segnalatore_id: string;
  created_at: string;
  segnalatore?: AdminProfile;
  agent?: AdminProfile;
}

export interface PracticeAccessCode {
  id: string;
  practice_id: string;
  codice: string;
  email_cliente: string;
  scadenza?: string;
  last_access?: string;
  privacy_consent_accepted_at?: string | null;
  privacy_consent_version?: string | null;
  privacy_consent_text?: string | null;
  privacy_consent_email?: string | null;
  privacy_consent_user_agent?: string | null;
  created_at: string;
}

export interface PracticeDocument {
  id: string;
  practice_id: string;
  integration_request_id?: string | null;
  template_id?: string;
  bank_requirement_id?: string;
  nome: string;
  descrizione?: string;
  tipo: DocumentType;
  obbligatorio: boolean;
  status: DocumentStatus;
  note_rifiuto?: string;
  uploaded_at?: string;
  created_at: string;
  uploaded_files?: UploadedFile[];
}

export interface PracticeIntegrationRequest {
  id: string;
  practice_id: string;
  origin_status: PracticeStatus | string;
  status: 'open' | 'completed' | 'cancelled';
  note?: string | null;
  created_by?: string | null;
  requested_at: string;
  sent_at?: string | null;
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadedFile {
  id: string;
  practice_document_id: string;
  practice_id: string;
  nome_file: string;
  storage_path: string;
  mime_type?: string;
  dimensione?: number;
  uploaded_by: string;
  created_at: string;
}

export interface PracticeStatusLog {
  id: string;
  practice_id: string;
  old_status?: string;
  new_status: string;
  note?: string;
  created_by?: string;
  created_at: string;
}

export const STATUS_LABELS: Record<PracticeStatus, string> = {
  bozza: 'Bozza',
  raccolta_documenti: 'Raccolta Documentazione',
  inviata_banca: 'Inviata a Banca',
  istruttoria: 'Istruttoria',
  in_delibera: 'In Delibera',
  deliberata: 'Deliberata',
  erogata: 'Erogata',
  integrazioni_richieste: 'Integrazione Richiesta (legacy)',
  completata: 'Istruttoria (legacy)',
  approvata: 'Deliberata (legacy)',
  rifiutata: 'Rifiutata',
  declinata: 'Declinata',
};

export const STATUS_COLORS: Record<PracticeStatus, string> = {
  bozza: 'bg-muted text-muted-foreground',
  raccolta_documenti: 'bg-blue-100 text-blue-800',
  inviata_banca: 'bg-purple-100 text-purple-800',
  istruttoria: 'bg-cyan-100 text-cyan-800',
  in_delibera: 'bg-amber-100 text-amber-800',
  deliberata: 'bg-emerald-100 text-emerald-800',
  erogata: 'bg-green-100 text-green-800',
  integrazioni_richieste: 'bg-amber-100 text-amber-800',
  completata: 'bg-green-100 text-green-800',
  approvata: 'bg-emerald-100 text-emerald-800',
  rifiutata: 'bg-red-100 text-red-800',
  declinata: 'bg-rose-100 text-rose-800',
};

export const DOC_STATUS_LABELS: Record<DocumentStatus, string> = {
  richiesto: 'Richiesto',
  caricato: 'Caricato',
  approvato: 'Approvato',
  rifiutato: 'Rifiutato',
};

export const DOC_STATUS_COLORS: Record<DocumentStatus, string> = {
  richiesto: 'bg-amber-100 text-amber-800',
  caricato: 'bg-blue-100 text-blue-800',
  approvato: 'bg-green-100 text-green-800',
  rifiutato: 'bg-red-100 text-red-800',
};
