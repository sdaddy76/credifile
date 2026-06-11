export type PracticeStatus =
  | 'bozza'
  | 'raccolta_documenti'
  | 'inviata_banca'
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
  created_at: string;
}

export interface PracticeDocument {
  id: string;
  practice_id: string;
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
  raccolta_documenti: 'Raccolta Documenti',
  inviata_banca: 'Inviata alla Banca',
  integrazioni_richieste: 'Integrazioni Richieste',
  completata: 'Completata',
  approvata: 'Approvata',
  rifiutata: 'Rifiutata',
  declinata: 'Declinata',
};

export const STATUS_COLORS: Record<PracticeStatus, string> = {
  bozza: 'bg-muted text-muted-foreground',
  raccolta_documenti: 'bg-blue-100 text-blue-800',
  inviata_banca: 'bg-purple-100 text-purple-800',
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
