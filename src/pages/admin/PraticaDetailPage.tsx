import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { uploadPracticeFile } from '@/lib/uploadFile';
import { invokeSendToBank } from '@/lib/sendToBank';
import { invokeAiMatching } from '@/lib/aiMatching';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import SchedaValutazioneRischio from '@/components/SchedaValutazioneRischio';
import AnalisiFinanziariaTab from '@/components/AnalisiFinanziariaTab';
import BancabilitaTab from '@/components/BancabilitaTab';
import ReputazioneTab from '@/components/ReputazioneTab';
import RelazioneTab from '@/components/RelazioneTab';
import { EstrattoConto } from '@/components/EstrattoConto';
import AmlReportTab from '@/components/AmlReportTab';
import {
  ArrowLeft, Copy, Plus, Link2, CheckCircle, XCircle,
  FileText, Clock, Download, Upload, RefreshCw, Building2, User, Euro, AlertCircle, Mail, Trash2,
  PlusCircle, Save, BellRing, Loader2, Send, MessageSquare, Calendar, FileDown, ClipboardCopy, Layout,
  CheckSquare, StickyNote, Pin, ListChecks, Phone, Pencil
} from 'lucide-react';
import { toast } from 'sonner';
import * as pdfjs from 'pdfjs-dist';
import { parseCentraleRischi, categoriaToTipologia, type CRRiga } from '@/lib/parseCentraleRischi';
import { jsPDF } from 'jspdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const ct = await pg.getTextContent();
    pages.push(ct.items.map((it: unknown) => (it as { str?: string }).str ?? '').join(' '));
  }
  return pages.join('\n');
}
import {
  STATUS_LABELS, STATUS_COLORS, DOC_STATUS_LABELS, DOC_STATUS_COLORS,
  type Practice, type PracticeDocument, type PracticeStatusLog,
  type Bank, type BankDocumentRequirement, type PracticeAccessCode, type Client, type Socio, type Amministratore,
  type PracticeIntegrationRequest, type PracticeStatus
} from '@/lib/types';
import { normalizePrimaryStatus } from '@/lib/practiceTimeline';
import { classifyFinPromoterCompany, requirementApplies, type FinPromoterCompanyType, type RegimeContabile } from '@/lib/finpromoterChecklist';

type AssignedAgent = { id: string; nome?: string; email: string };
type IntegrationRequestDraft = { nome: string; descrizione: string };
type PracticeBankStatus =
  | 'assegnata'
  | 'inviata'
  | 'istruttoria'
  | 'in_delibera'
  | 'deliberata'
  | 'erogata'
  | 'rifiutata';

const PRACTICE_BANK_STATUS_OPTIONS: Array<{ value: PracticeBankStatus; label: string }> = [
  { value: 'assegnata', label: 'Assegnata' },
  { value: 'inviata', label: 'Inviata alla banca' },
  { value: 'istruttoria', label: 'In istruttoria' },
  { value: 'in_delibera', label: 'In delibera' },
  { value: 'deliberata', label: 'Deliberata' },
  { value: 'erogata', label: 'Erogata' },
  { value: 'rifiutata', label: 'Rifiutata' },
];

const PRACTICE_BANK_STATUS_LABELS = Object.fromEntries(
  PRACTICE_BANK_STATUS_OPTIONS.map(option => [option.value, option.label])
) as Record<PracticeBankStatus, string>;

function practiceBankStatusClass(status: string): string {
  if (status === 'erogata' || status === 'deliberata') return 'bg-green-100 text-green-700 border-green-200';
  if (status === 'rifiutata') return 'bg-red-100 text-red-700 border-red-200';
  if (status === 'in_delibera') return 'bg-amber-100 text-amber-700 border-amber-200';
  if (status === 'istruttoria') return 'bg-cyan-100 text-cyan-700 border-cyan-200';
  if (status === 'inviata') return 'bg-blue-100 text-blue-700 border-blue-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}
type ClientQuestion = {
  id: string;
  integration_request_id?: string | null;
  domanda: string;
  risposta: string | null;
  stato: 'richiesta' | 'risposta';
  answered_at: string | null;
  created_at: string;
};

const PRIMARY_STATUS_OPTIONS: PracticeStatus[] = [
  'bozza',
  'raccolta_documenti',
  'inviata_banca',
  'istruttoria',
  'in_delibera',
  'deliberata',
  'erogata',
  'declinata',
];
type ClientBankPosition = {
  id: string;
  banca: string;
  tipo_rapporto: string | null;
  accordato: number | null;
  utilizzato: number | null;
  saldo: number | null;
  note: string | null;
};
type ClientEditForm = {
  ragione_sociale: string;
  piva: string;
  codice_fiscale: string;
  email: string;
  telefono: string;
  indirizzo: string;
  provincia: string;
  data_costituzione: string;
  forma_giuridica: string;
  capitale_sociale: string;
  capitale_sociale_versato: string;
  codice_ateco: string;
  ateco_descrizione: string;
  importo_richiesto: string;
  motivazione: string;
  soci: Socio[];
  amministratori: Amministratore[];
  tipologia_azienda: Exclude<NonNullable<Practice['tipologia_azienda']>, 'auto'> | 'auto';
  regime_contabile: Exclude<NonNullable<Practice['regime_contabile']>, null> | '';
};

const EMPTY_CLIENT_EDIT_FORM: ClientEditForm = {
  ragione_sociale: '',
  piva: '',
  codice_fiscale: '',
  email: '',
  telefono: '',
  indirizzo: '',
  provincia: '',
  data_costituzione: '',
  forma_giuridica: '',
  capitale_sociale: '',
  capitale_sociale_versato: '',
  codice_ateco: '',
  ateco_descrizione: '',
  importo_richiesto: '',
  motivazione: '',
  soci: [],
  amministratori: [],
  tipologia_azienda: 'auto',
  regime_contabile: '',
};

function parseItalianAmount(value: string): number | null {
  const normalized = value.trim().replace(/[€\s]/g, '');
  if (!normalized) return null;
  const decimalValue = normalized.includes(',')
    ? normalized.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(?:\.\d{3})+$/.test(normalized)
      ? normalized.replace(/\./g, '')
      : normalized;
  const parsed = Number(decimalValue);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Restituisce solo un indirizzo agente assegnato realmente presente nella pratica. */
function getAssignedAgentEmail(currentPractice: Practice | null): string | undefined {
  const email = (currentPractice as Practice & { assigned_agent?: AssignedAgent } | null)?.assigned_agent?.email?.trim();
  return email || undefined;
}

export default function PraticaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAgente, canEdit, canApprove, user, isSegnalatore, isSuperAdmin, isSegreteria } = useAuth();
  const adminFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingAdminDoc, setUploadingAdminDoc] = useState<string | null>(null);

  const [practice, setPractice] = useState<Practice | null>(null);
  const [documents, setDocuments] = useState<PracticeDocument[]>([]);
  const [logs, setLogs] = useState<PracticeStatusLog[]>([]);
  const [accessCode, setAccessCode] = useState<PracticeAccessCode | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentsForReassign, setAgentsForReassign] = useState<{id:string;nome?:string;email:string}[]>([]);
  const [showReassign, setShowReassign] = useState(false);
  const [reassignTo, setReassignTo] = useState('');
  const [savingReassign, setSavingReassign] = useState(false);
  // Modifica dati cliente e pratica
  const [showClientEdit, setShowClientEdit] = useState(false);
  const [clientEditForm, setClientEditForm] = useState<ClientEditForm>(EMPTY_CLIENT_EDIT_FORM);
  const [savingClientEdit, setSavingClientEdit] = useState(false);
  const [practiceBanks, setPracticeBanks] = useState<{id:string;bank_id:string;status:PracticeBankStatus;note?:string;data_invio?:string;status_updated_at?:string;banks:{nome:string;email?:string;email_invio_banca?:string}}[]>([]);
  const [updatingBankStatusId, setUpdatingBankStatusId] = useState<string | null>(null);
  const [addingBank, setAddingBank] = useState('');
  const [addingBankRequirements, setAddingBankRequirements] = useState<BankDocumentRequirement[]>([]);
  const [sendingBankId, setSendingBankId] = useState<string|null>(null);
  const [bankNote, setBankNote] = useState('');
  const [showSendBankDialog, setShowSendBankDialog] = useState<string|null>(null);
  const [integrationPracticeBankId, setIntegrationPracticeBankId] = useState('none');
  const [sendingIntegrationId, setSendingIntegrationId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('documenti');
  // Financing — gestito come stringhe per l'editing inline
  interface FinRow {
    id: string; tipologia: string; banca_finanziaria: string;
    importo_iniziale: string; rata: string; durata_mesi: string;
    debito_residuo: string; note: string;
    // Campi Centrale Rischi
    accordato?: string; accordato_operativo?: string; utilizzato?: string;
    saldo_medio?: string; tipo_garanzia?: string; stato_rapporto?: string;
    data_riferimento?: string; fonte?: string;
    _new?: boolean; _dirty?: boolean;
  }
  const TIPOLOGIE_FIN = [
    // Inserimento manuale – terminologia bancaria classica
    'Mutuo ipotecario', 'Prestito personale', 'Cessione del quinto',
    'Leasing auto', 'Leasing strumentale', 'Apertura di credito',
    'Fido bancario', 'Carta di credito revolving',
    // Importati da Centrale Rischi – categoriaToTipologia() restituisce questi valori
    'Mutuo/Prestito (CR - A Scadenza)',   // ex "Rischi a Scadenza": finanziamenti con piano di rientro (mutui, prestiti, CQ)
    'Fido/C.Corrente (CR - A Revoca)',    // ex "Rischi a Revoca": linee di credito revocabili (fidi cassa, scoperti CC)
    'Anticipo/SBF (CR - Autoliquidante)', // ex "Rischi Autoliquidanti": anticipi su crediti commerciali (fatture, SBF)
    'Sofferenza (CR)',
    'Altro',
  ];
  const [financing, setFinancing] = useState<FinRow[]>([]);
  const [savingFin, setSavingFin] = useState(false);
  // Centrale Rischi
  const [crParsing, setCrParsing]       = useState(false);
  const [crPreview, setCrPreview]       = useState<CRRiga[] | null>(null);
  const [crDate, setCrDate]             = useState('');
  const [crImporting, setCrImporting]   = useState(false);
  const crFileRef = useRef<HTMLInputElement>(null);


  // Dialogs
  const [showStatusChange, setShowStatusChange] = useState(false);
    const [showAddDoc, setShowAddDoc] = useState(false);
  const [showRejectDoc, setShowRejectDoc] = useState<string | null>(null);
  const [showIntegration, setShowIntegration] = useState(false);

  const [newStatus, setNewStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [noteDeclino, setNoteDeclino] = useState('');
  const [newDocName, setNewDocName] = useState('');
  const [newDocDesc, setNewDocDesc] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [integrationRequests, setIntegrationRequests] = useState<IntegrationRequestDraft[]>([
    { nome: '', descrizione: '' },
  ]);
  const [integrationQuestions, setIntegrationQuestions] = useState<string[]>(['']);
  const [clientQuestions, setClientQuestions] = useState<ClientQuestion[]>([]);
  const [integrationCycles, setIntegrationCycles] = useState<PracticeIntegrationRequest[]>([]);
  const [clientBankPositions, setClientBankPositions] = useState<ClientBankPosition[]>([]);
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showSollecita, setShowSollecita] = useState(false);
  const [sollecitando, setSollecitando] = useState(false);
  const [sendingNotif, setSendingNotif] = useState(false);

  // ── 1. TIMELINE ATTIVITÀ ──────────────────────────────────────────────────
  interface ActivityLog {
    id: string;
    practice_id: string;
    action: string;
    actor_nome?: string;
    actor_ruolo?: string;
    metadata?: Record<string, unknown>;
    created_at: string;
  }
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);

  const loadActivityLogs = async () => {
    if (!id) return;
    setLoadingActivity(true);
    const { data } = await supabase
      .from('practice_activity_log')
      .select('*')
      .eq('practice_id', id)
      .order('created_at', { ascending: false });
    setActivityLogs(data ?? []);
    setLoadingActivity(false);
  };

  // ── NOTE INTERNE ─────────────────────────────────────────────────────────
  interface PracticeNote { id: string; testo: string; autore_nome?: string; autore_ruolo?: string; pinned: boolean; created_at: string; }
  const [notes, setNotes] = useState<PracticeNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const loadNotes = async () => {
    if (!id) return;
    setLoadingNotes(true);
    const { data } = await supabase.from('practice_notes').select('*').eq('practice_id', id).order('pinned', { ascending: false }).order('created_at', { ascending: false });
    setNotes(data ?? []);
    setLoadingNotes(false);
  };

  const addNote = async () => {
    if (!newNoteText.trim() || !id) return;
    setSavingNote(true);
    const { data: profilo } = await supabase.from('admin_profiles').select('nome,ruolo').eq('id', user?.id ?? '').maybeSingle();
    const { error } = await supabase.from('practice_notes').insert({
      practice_id: id,
      testo: newNoteText.trim(),
      autore_id: user?.id,
      autore_nome: profilo?.nome ?? user?.email,
      autore_ruolo: profilo?.ruolo ?? null,
    });
    setSavingNote(false);
    if (error) { toast.error('Errore: ' + error.message); return; }
    setNewNoteText('');
    loadNotes();
    toast.success('Nota aggiunta');
  };

  const deleteNote = async (noteId: string) => {
    if (!confirm('Eliminare questa nota?')) return;
    await supabase.from('practice_notes').delete().eq('id', noteId);
    setNotes(prev => prev.filter(n => n.id !== noteId));
  };

  const togglePinNote = async (noteId: string, pinned: boolean) => {
    await supabase.from('practice_notes').update({ pinned: !pinned }).eq('id', noteId);
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, pinned: !pinned } : n));
  };

  // ── TASK PRATICA ─────────────────────────────────────────────────────────
  interface PracticeTask { id: string; titolo: string; descrizione?: string; stato: string; priorita: string; scadenza?: string; assegnato_nome?: string; created_at: string; }
  const [practiceTasks, setPracticeTasks] = useState<PracticeTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [newTaskTitolo, setNewTaskTitolo] = useState('');
  const [newTaskScadenza, setNewTaskScadenza] = useState('');
  const [newTaskPriorita, setNewTaskPriorita] = useState('media');
  const [savingTask, setSavingTask] = useState(false);

  const loadPracticeTasks = async () => {
    if (!id) return;
    setLoadingTasks(true);
    const { data } = await supabase.from('practice_tasks').select('*').eq('practice_id', id).order('scadenza', { ascending: true, nullsFirst: false }).order('priorita');
    setPracticeTasks(data ?? []);
    setLoadingTasks(false);
  };

  const addTask = async () => {
    if (!newTaskTitolo.trim() || !id) return;
    setSavingTask(true);
    const { data: profilo } = await supabase.from('admin_profiles').select('nome').eq('id', user?.id ?? '').maybeSingle();
    const { error } = await supabase.from('practice_tasks').insert({
      practice_id: id,
      titolo: newTaskTitolo.trim(),
      priorita: newTaskPriorita,
      scadenza: newTaskScadenza || null,
      created_by: user?.id,
      created_by_nome: profilo?.nome ?? user?.email,
      assegnato_a: user?.id,
      assegnato_nome: profilo?.nome ?? user?.email,
    });
    setSavingTask(false);
    if (error) { toast.error('Errore: ' + error.message); return; }
    setNewTaskTitolo(''); setNewTaskScadenza(''); setNewTaskPriorita('media');
    loadPracticeTasks();
    toast.success('Task aggiunto');
  };

  const updateTaskStato = async (taskId: string, stato: string) => {
    await supabase.from('practice_tasks').update({ stato, ...(stato === 'completata' ? { completata_at: new Date().toISOString() } : {}) }).eq('id', taskId);
    setPracticeTasks(prev => prev.map(t => t.id === taskId ? { ...t, stato } : t));
  };

  // ── STORICO EMAIL BANCHE ─────────────────────────────────────────────────
  interface EmailLog {
    id: string;
    bank_nome?: string;
    destinatari?: string[];
    cc?: string[];
    oggetto?: string;
    stato: string;
    sent_by_nome?: string;
    delivery_type?: 'pratica' | 'approfondimento';
    integration_request_id?: string | null;
    created_at: string;
    opened_at?: string | null;
    delivered_at?: string | null;
  }
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [loadingEmailLog, setLoadingEmailLog] = useState(false);

  const loadEmailLog = async () => {
    if (!id) return;
    setLoadingEmailLog(true);
    const { data } = await supabase.from('email_send_log').select('*').eq('practice_id', id).order('created_at', { ascending: false });
    setEmailLogs(data ?? []);
    setLoadingEmailLog(false);
  };

  // ── CHECKLIST DOCUMENTALE ────────────────────────────────────────────────
  interface ChecklistItem { id: string; template_item_id?: string; nome: string; obbligatorio: boolean; completata: boolean; ordine: number; }
  interface ChecklistTpl { id: string; nome: string; tipo_pratica?: string; }
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTpl[]>([]);
  const [loadingChecklist, setLoadingChecklist] = useState(false);
  const [selectedTplId, setSelectedTplId] = useState('');

  const loadChecklist = async () => {
    if (!id) return;
    setLoadingChecklist(true);
    const [{ data: items }, { data: tpls }] = await Promise.all([
      supabase.from('practice_checklist_items').select('*').eq('practice_id', id).order('ordine'),
      supabase.from('checklist_templates').select('id, nome, tipo_pratica').eq('attivo', true).order('nome'),
    ]);
    setChecklistItems((items ?? []) as ChecklistItem[]);
    setChecklistTemplates((tpls ?? []) as ChecklistTpl[]);
    setLoadingChecklist(false);
  };

  const applyTemplate = async () => {
    if (!selectedTplId || !id) return;
    const { data: tplItems } = await supabase.from('checklist_template_items').select('*').eq('template_id', selectedTplId).order('ordine');
    if (!tplItems?.length) { toast.error('Template vuoto'); return; }
    const rows = tplItems.map(i => ({ practice_id: id, template_item_id: i.id, nome: i.nome, obbligatorio: i.obbligatorio, ordine: i.ordine, completata: false }));
    const { error } = await supabase.from('practice_checklist_items').insert(rows);
    if (error) { toast.error('Errore: ' + error.message); return; }
    toast.success('Template applicato');
    loadChecklist();
  };

  const toggleChecklistItem = async (itemId: string, completata: boolean) => {
    await supabase.from('practice_checklist_items').update({ completata: !completata }).eq('id', itemId);
    setChecklistItems(prev => prev.map(i => i.id === itemId ? { ...i, completata: !completata } : i));
  };

  const deleteChecklistItem = async (itemId: string) => {
    await supabase.from('practice_checklist_items').delete().eq('id', itemId);
    setChecklistItems(prev => prev.filter(i => i.id !== itemId));
  };

  // ── WHATSAPP ─────────────────────────────────────────────────────────────
  const [sendingWA, setSendingWA] = useState(false);

  const sendWhatsApp = async (telefono: string) => {
    if (!telefono) { toast.error('Numero di telefono non disponibile'); return; }
    const msg = prompt('Messaggio WhatsApp da inviare al cliente:', `Gentile cliente, la sua pratica n° ${practice.numero_pratica} è in stato: ${practice.status}. Per informazioni contatti il suo consulente.`);
    if (!msg) return;
    setSendingWA(true);
    try {
      const res = await fetch('/api/send-whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to: telefono, message: msg, practice_numero: practice.numero_pratica, cliente: client?.ragione_sociale }) });
      const data = await res.json();
      if (data.success) toast.success('WhatsApp inviato ✓');
      else toast.error('Errore WhatsApp: ' + (data.error ?? 'sconosciuto'));
    } catch { toast.error('Errore di rete'); }
    setSendingWA(false);
  };

  // Fire-and-forget: invia WhatsApp automatico senza bloccare il flusso principale
  const inviaWhatsAppAuto = (telefono: string | undefined | null, messaggio: string) => {
    if (!telefono) return; // silenzioso se manca il numero
    fetch('/api/send-whatsapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: telefono,
        message: messaggio,
        practice_numero: practice?.numero_pratica,
        cliente: client?.ragione_sociale,
      }),
    }).catch(() => { /* ignora errori di rete — non bloccare il flusso */ });
  };
  const [scoreBancabilita, setScoreBancabilita] = useState<number | null>(null);
  const [scoreReputazione, setScoreReputazione] = useState<number | null>(null);
  const [segreteriaDiCompetenza, setSegreteriaDiCompetenza] = useState<{nome?: string; email: string} | null>(null);

  const loadScores = async () => {
    if (!id) return;

    // ── Score Bancabilità ─────────────────────────────────────────────────────
    // 1. Bilancio più recente per questa pratica
    const { data: bilancioRow } = await supabase
      .from('bilanci_kpi')
      .select('kpi')
      .eq('practice_id', id)
      .order('anno_esercizio', { ascending: false })
      .limit(1)
      .maybeSingle();

    type KpiAreaMap = Record<string, { valore: number | null }>;
    const latestKpi = (bilancioRow?.kpi ?? null) as Record<string, KpiAreaMap> | null;

    if (latestKpi) {
      // 2. Pesi di bancabilità (configurazione globale default, banca_id IS NULL)
      const { data: pesiRows } = await supabase
        .from('bancabilita_pesi')
        .select('kpi_key,kpi_area,peso,soglia_ottimo,soglia_suff,soglia_critica,inverso')
        .is('banca_id', null)
        .eq('attivo', true);

      type PesoRow = {
        kpi_key: string; kpi_area: string; peso: number;
        soglia_ottimo: number | null; soglia_suff: number | null;
        soglia_critica: number | null; inverso: boolean;
      };
      const pesiList = (pesiRows ?? []) as PesoRow[];

      if (pesiList.length > 0) {
        // Replica la logica calcolaScore di IndiceBancabilita.tsx
        const calcScore = (
          v: number,
          ottimo: number | null, suff: number | null, critica: number | null,
          inverso: boolean,
        ): number => {
          if (ottimo === null || suff === null || critica === null) return 50;
          if (!inverso) {
            if (v >= ottimo)  return 100;
            if (v <= critica) return 0;
            if (v >= suff) return 55 + ((v - suff) / (ottimo - suff)) * 45;
            return ((v - critica) / (suff - critica)) * 55;
          } else {
            if (v <= ottimo)  return 100;
            if (v >= critica) return 0;
            if (v <= suff) return 55 + ((suff - v) / (suff - ottimo)) * 45;
            return ((critica - v) / (critica - suff)) * 55;
          }
        };

        const kpiScores = pesiList
          .filter(p => p.peso > 0)
          .map(p => {
            const valore = latestKpi[p.kpi_area]?.[p.kpi_key]?.valore ?? null;
            const score = valore !== null
              ? Math.round(Math.min(100, Math.max(0,
                  calcScore(valore, p.soglia_ottimo, p.soglia_suff, p.soglia_critica, p.inverso)
                )))
              : null;
            const contributo = score !== null ? (p.peso * score) / 100 : null;
            return { peso: p.peso, score, contributo };
          });

        const disponibili = kpiScores.filter(k => k.score !== null);
        if (disponibili.length > 0) {
          const sommaContributi = disponibili.reduce((s, k) => s + (k.contributo ?? 0), 0);
          const sommaPesi       = disponibili.reduce((s, k) => s + k.peso, 0);
          if (sommaPesi > 0) {
            setScoreBancabilita(Math.round((sommaContributi / sommaPesi) * 100));
          }
        }
      }
    }

    // ── Score Reputazione ─────────────────────────────────────────────────────
    const { data: rep } = await supabase
      .from('reputational_analyses')
      .select('score_globale')
      .eq('practice_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rep?.score_globale != null) {
      setScoreReputazione(rep.score_globale);
    }
  };

  // ── 3. AI MATCHING BANCHE ────────────────────────────────────────────────
  interface KpiDetail {
    label: string;
    pass: boolean | null;
    actual: number | null;
    min: number | null;
    max: number | null;
  }
  interface BancaMatch {
    bankId: string;
    bankName: string;
    score: number;
    passCount: number;
    failCount: number;
    ndCount: number;
    details: KpiDetail[];
  }
  interface MatchingResult {
    banche: BancaMatch[];
    matching: BancaMatch[];
    suggerimento_ai?: string;
    analisi_societa?: string;
  }
  const [matchingResult, setMatchingResult] = useState<MatchingResult | null>(null);
  const [loadingMatching, setLoadingMatching] = useState(false);

  const runMatching = async () => {
    if (!id) return;
    setLoadingMatching(true);
    try {
      const result = await invokeAiMatching({ practice_id: id! });
      if (result.error) { toast.error('Errore matching: ' + result.error.message); return; }
      setMatchingResult(result.data as unknown as MatchingResult);
    } catch (e) {
      toast.error('Errore: ' + String(e));
    } finally {
      setLoadingMatching(false);
    }
  };

  // ── 4. SCADENZARIO DOCUMENTI ─────────────────────────────────────────────
  interface DocDeadline {
    id: string;
    practice_id: string;
    documento: string;
    data_scadenza: string;
    note?: string;
    notificato?: boolean;
  }
  const [deadlines, setDeadlines] = useState<DocDeadline[]>([]);
  const [newDeadlineDoc, setNewDeadlineDoc] = useState('');
  const [newDeadlineDate, setNewDeadlineDate] = useState('');
  const [newDeadlineNote, setNewDeadlineNote] = useState('');
  const [savingDeadline, setSavingDeadline] = useState(false);

  // ── 5. GENERA DOCUMENTO ───────────────────────────────────────────────────
  interface ContentTemplate {
    id: string;
    nome: string;
    categoria: string;
    contenuto: string;
    variabili: string[];
  }
  const [docTemplates, setDocTemplates]         = useState<ContentTemplate[]>([]);
  const [loadingDocTemplates, setLoadingDocTemplates] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId]   = useState('');
  const [generatedText, setGeneratedText]       = useState('');
  const [loadingTemplate, setLoadingTemplate]   = useState(false);

  const loadDocTemplates = async () => {
    setLoadingDocTemplates(true);
    const { data, error } = await supabase
      .from('document_templates')
      .select('id, nome, categoria, contenuto, variabili')
      .eq('attivo', true)
      .order('categoria');
    if (error) {
      console.error('Errore template:', error);
      toast.error('Errore caricamento template');
    }
    setDocTemplates((data ?? []) as ContentTemplate[]);
    setLoadingDocTemplates(false);
  };

  /** Sostituisce le variabili note con i dati reali della pratica */
  function compileTemplate(contenuto: string): string {
    const clientData = (practice as Practice & {
      clients?: { ragione_sociale?: string; indirizzo?: string };
      assigned_agent?: { nome?: string; email: string };
    });
    const ragioneSociale   = clientData.clients?.ragione_sociale ?? '';
    const numeroPratica    = practice?.numero_pratica ?? '';
    const importoRichiesto = practice?.importo_richiesto
      ? practice.importo_richiesto.toLocaleString('it-IT') : '';
    const agenteNome = clientData.assigned_agent?.nome
      || clientData.assigned_agent?.email || '';
    const dataOggi   = new Date().toLocaleDateString('it-IT');
    const indirizzo  = clientData.clients?.indirizzo ?? '';
    // Estrai città dall'indirizzo (ultimo segmento dopo virgola o spazio, euristica)
    const citta = (() => {
      if (!indirizzo) return '';
      const parts = indirizzo.split(',');
      const last = parts[parts.length - 1].trim();
      // Rimuovi eventuale CAP (5 cifre) iniziale
      return last.replace(/^\d{5}\s*/, '').trim();
    })();
    // Estrai codice ATECO: usa campo diretto se presente, altrimenti lo cerca nell'indirizzo visura
    const codiceAteco = practice?.codice_ateco ?? (() => {
      const m = indirizzo.match(/(?:ATECO|Codice)[^\d]*(\d{2}[.-]\d{2}(?:[.-]\d{1,2})?)/i);
      return m?.[1] ?? '';
    })();

    const map: Record<string, string> = {
      ragione_sociale:   ragioneSociale,
      numero_pratica:    numeroPratica,
      importo_richiesto: importoRichiesto,
      agente_nome:       agenteNome,
      data:              dataOggi,
      citta:             citta,
      codice_ateco:      codiceAteco,
    };

    return contenuto.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
      return map[varName] !== undefined ? map[varName] : `{{${varName}}}`;
    });
  }

  const handleLoadTemplate = async () => {
    if (!selectedTemplateId) return;
    setLoadingTemplate(true);
    const { data, error } = await supabase
      .from('document_templates')
      .select('contenuto')
      .eq('id', selectedTemplateId)
      .single();
    setLoadingTemplate(false);
    if (error || !data) { toast.error('Errore caricamento template'); return; }
    setGeneratedText(compileTemplate(data.contenuto));
  };

  const handleExportPdf = () => {
    if (!generatedText.trim()) { toast.error('Genera prima il documento'); return; }
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 20;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const contentW = pageW - margin * 2;

    // Intestazione
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 64, 175); // blu Credifile
    doc.text('CREDIFILE', margin, margin);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text('Consulenza Finanziaria Professionale', margin, margin + 6);

    // Linea separatrice
    doc.setDrawColor(200);
    doc.line(margin, margin + 10, pageW - margin, margin + 10);

    // Numero pratica e data
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Pratica: ${practice?.numero_pratica ?? ''}`, margin, margin + 16);
    doc.text(`Data: ${new Date().toLocaleDateString('it-IT')}`, pageW - margin, margin + 16, { align: 'right' });

    // Testo documento
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30);
    const lines = doc.splitTextToSize(generatedText, contentW);
    let y = margin + 24;
    for (const line of lines) {
      if (y > pageH - margin - 15) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 6;
    }

    // Footer
    const footerY = pageH - 10;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.setDrawColor(200);
    doc.line(margin, footerY - 4, pageW - margin, footerY - 4);
    doc.text(`Pratica n. ${practice?.numero_pratica ?? ''} — Generato il ${new Date().toLocaleDateString('it-IT')}`, margin, footerY);
    doc.text('Credifile', pageW - margin, footerY, { align: 'right' });

    doc.save(`documento_${practice?.numero_pratica ?? 'pratica'}.pdf`);
    toast.success('PDF esportato');
  };

  const handleCopyText = () => {
    if (!generatedText.trim()) { toast.error('Genera prima il documento'); return; }
    navigator.clipboard.writeText(generatedText);
    toast.success('Testo copiato negli appunti');
  };

  const loadDeadlines = async () => {
    if (!id) return;
    const { data } = await supabase
      .from('document_deadlines')
      .select('*')
      .eq('practice_id', id)
      .order('data_scadenza', { ascending: true });
    setDeadlines(data ?? []);
  };

  const addDeadline = async () => {
    if (!newDeadlineDoc.trim() || !newDeadlineDate) {
      toast.error('Inserisci nome documento e data scadenza');
      return;
    }
    setSavingDeadline(true);
    const { error } = await supabase.from('document_deadlines').insert({
      practice_id: id,
      documento: newDeadlineDoc.trim(),
      data_scadenza: newDeadlineDate,
      note: newDeadlineNote.trim() || null,
    });
    setSavingDeadline(false);
    if (error) { toast.error('Errore: ' + error.message); return; }
    toast.success('Scadenza aggiunta');
    setNewDeadlineDoc('');
    setNewDeadlineDate('');
    setNewDeadlineNote('');
    loadDeadlines();
  };

  const deleteDeadline = async (deadlineId: string) => {
    if (!confirm('Eliminare questa scadenza?')) return;
    const { error } = await supabase.from('document_deadlines').delete().eq('id', deadlineId);
    if (error) { toast.error('Errore: ' + error.message); return; }
    toast.success('Scadenza eliminata');
    loadDeadlines();
  };

  const getDeadlineBadge = (dataScadenza: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const scad = new Date(dataScadenza);
    scad.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((scad.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { label: 'Scaduto', color: 'bg-red-100 text-red-700 border-red-200' };
    if (diffDays <= 7) return { label: `< 7 giorni`, color: 'bg-orange-100 text-orange-700 border-orange-200' };
    return { label: 'OK', color: 'bg-green-100 text-green-700 border-green-200' };
  };

  // Invia email richiesta documenti (senza rigenerare il codice)
  const sendDocumentRequest = async () => {
    if (!practice || !accessCode) return;
    const client = (practice as Practice & { clients?: { email: string } }).clients;
    if (!client?.email) { toast.error('Il cliente non ha un email'); return; }
    setSendingEmail(true);
    try {
      // Aggiorna sempre email_cliente al valore attuale del cliente.
      const { error: accessError } = await supabase.from('practice_access_codes')
        .update({ email_cliente: client.email.trim().toLowerCase() })
        .eq('id', accessCode.id);
      if (accessError) throw accessError;

      const [{ data: profile }, { data: docs, error: docsError }, { data: questions, error: questionsError }] = await Promise.all([
        supabase.from('admin_profiles').select('nome').eq('id', user?.id ?? '').maybeSingle(),
        supabase
          .from('practice_documents')
          .select('nome, integration_request_id')
          .eq('practice_id', practice.id)
          .in('tipo', ['standard', 'integrazione'])
          .in('status', ['richiesto', 'rifiutato'])
          .order('created_at'),
        supabase
          .from('practice_client_questions')
          .select('domanda, integration_request_id')
          .eq('practice_id', practice.id)
          .eq('stato', 'richiesta')
          .order('created_at'),
      ]);
      if (docsError) throw docsError;
      if (questionsError) throw questionsError;

      const docNames = (docs ?? []).map((document: { nome: string }) => document.nome);
      const questionTexts = (questions ?? []).map((question: { domanda: string }) => question.domanda);
      if (docNames.length === 0 && questionTexts.length === 0) {
        toast.info('Non ci sono documenti mancanti o domande senza risposta da inviare');
        return;
      }

      const consultantName = profile?.nome ?? user?.email ?? 'Il tuo consulente';
      const link = `https://credifile-eosin.vercel.app/#/accesso?p=${practice.id}`;
      const { data: emailData, error: emailError } = await supabase.functions.invoke('send-client-email', {
        body: {
          to: client.email,
          consultant_name: consultantName,
          documents: docNames,
          questions: questionTexts,
          link,
          code: accessCode.codice,
          practice_number: practice.numero_pratica,
          company_name: (practice as Practice & { clients?: { ragione_sociale: string } }).clients?.ragione_sociale ?? undefined,
          subject_override: `Richiesta documentale — ${(practice as Practice & { clients?: { ragione_sociale: string } }).clients?.ragione_sociale ?? practice.numero_pratica}`,
          // La copia e le risposte del cliente devono arrivare all'agente assegnato.
          cc: getAssignedAgentEmail(practice),
          reply_to: getAssignedAgentEmail(practice),
        },
      });
      if (emailError || emailData?.success === false) {
        const msg = emailData?.error ? JSON.stringify(emailData.error) : emailError?.message ?? 'Errore sconosciuto';
        throw new Error(msg);
      }

      const integrationRequestIds = Array.from(new Set(
        [...(docs ?? []), ...(questions ?? [])]
          .map(item => item.integration_request_id as string | null)
          .filter((requestId): requestId is string => Boolean(requestId))
      ));
      if (integrationRequestIds.length > 0) {
        await supabase
          .from('practice_integration_requests')
          .update({ sent_at: new Date().toISOString() })
          .in('id', integrationRequestIds);
      }

      await supabase.from('practice_activity_log').insert({
        practice_id: practice.id,
        action: 'richiesta_documentale_cliente_inviata',
        actor_id: user?.id ?? null,
        actor_nome: consultantName,
        actor_ruolo: 'admin',
        metadata: {
          documenti: docNames,
          domande: questionTexts,
          destinatario: client.email,
          integration_request_ids: integrationRequestIds,
        },
      });

      toast.success(
        `Email inviata a ${client.email}: ${docNames.length} documenti e ${questionTexts.length} domande`
      );
    } catch (error) {
      toast.error('Errore invio email: ' + String(error));
    } finally {
      setSendingEmail(false);
    }
  };

  // ── Notifica Banche ──────────────────────────────────────────────────────
  const sendNotificaBanche = async () => {
    if (!practice) return;
    setSendingNotif(true);
    try {
      const { data, error } = await supabase.functions.invoke('notifica-banche-nuova-pratica', {
        body: { practice_id: practice.id },
      });
      if (error) {
        toast.error('Errore invio notifica: ' + error.message);
        return;
      }
      const sent: number = data?.sent ?? data?.count ?? 0;
      toast.success(`Notifica inviata a ${sent} banche`);
      // Log attività
      await supabase.from('practice_activity_log').insert({
        practice_id: practice.id,
        action: 'notifica_banche_inviata',
        actor_nome: user?.email ?? 'Admin',
        actor_ruolo: 'admin',
        metadata: { sent },
      });
      loadActivityLogs();
    } catch (e) {
      toast.error('Errore: ' + String(e));
    } finally {
      setSendingNotif(false);
    }
  };

  const load = useCallback(async () => {
    if (!id) return;
    const [p, docs, l, ac, questions, clientBanks, integrations] = await Promise.all([
      supabase.from('practices').select('*, clients(*), banks(*), assigned_agent:admin_profiles!practices_assigned_to_fkey(id,nome,email), segnalatore:admin_profiles!practices_segnalatore_id_fkey(id,nome,email)').eq('id', id).single(),
      supabase.from('practice_documents').select('*, uploaded_files(*)').eq('practice_id', id).order('created_at'),
      supabase.from('practice_status_log').select('*').eq('practice_id', id).order('created_at', { ascending: false }),
      supabase.from('practice_access_codes').select('*').eq('practice_id', id).maybeSingle(),
      supabase.from('practice_client_questions').select('*').eq('practice_id', id).order('created_at'),
      supabase.from('practice_client_banks').select('*').eq('practice_id', id).order('ordinamento'),
      supabase.from('practice_integration_requests').select('*').eq('practice_id', id).order('requested_at'),
    ]);
    setPractice(p.data as Practice);
    // Carica segreteria di competenza (solo super_admin)
    if (isSuperAdmin && (p.data as Practice & { assigned_to?: string })?.assigned_to) {
      const agentId = (p.data as Practice & { assigned_to?: string }).assigned_to!;
      supabase
        .from('segreteria_agent_assignments')
        .select('segreteria:admin_profiles!segreteria_agent_assignments_segreteria_user_id_fkey(nome,email)')
        .eq('agent_user_id', agentId)
        .limit(1)
        .then(({ data: sData }) => {
          const raw = (sData as unknown as Array<{ agent_user_id: string; segreteria: Array<{ nome?: string; email?: string }> }>);
          const first = raw?.[0]?.segreteria?.[0] ?? null;
          setSegreteriaDiCompetenza(first as { nome?: string; email: string } | null);
        });
    }
    setDocuments(docs.data as PracticeDocument[] ?? []);
    setLogs(l.data ?? []);
    setAccessCode(ac.data);
    setClientQuestions((questions.data ?? []) as ClientQuestion[]);
    setIntegrationCycles((integrations.data ?? []) as PracticeIntegrationRequest[]);
    setClientBankPositions((clientBanks.data ?? []) as ClientBankPosition[]);
    // Carica finanziamenti
    const { data: fin } = await supabase.from('client_financing').select('*').eq('practice_id', id).order('ordinamento');
    setFinancing((fin ?? []).map(r => ({
      id: r.id,
      tipologia: r.tipologia ?? '',
      banca_finanziaria: r.banca_finanziaria ?? '',
      importo_iniziale: r.importo_iniziale != null ? String(r.importo_iniziale) : '',
      rata: r.rata != null ? String(r.rata) : '',
      durata_mesi: r.durata_mesi != null ? String(r.durata_mesi) : '',
      debito_residuo: r.debito_residuo != null ? String(r.debito_residuo) : '',
      note: r.note ?? '',
      accordato: r.accordato != null ? String(r.accordato) : undefined,
      accordato_operativo: r.accordato_operativo != null ? String(r.accordato_operativo) : undefined,
      utilizzato: r.utilizzato != null ? String(r.utilizzato) : undefined,
      saldo_medio: r.saldo_medio != null ? String(r.saldo_medio) : undefined,
      tipo_garanzia: r.tipo_garanzia ?? undefined,
      stato_rapporto: r.stato_rapporto ?? undefined,
      data_riferimento: r.data_riferimento ?? undefined,
      fonte: r.fonte ?? 'manuale',
    })));
    const { data: pb } = await supabase.from('practice_banks').select('*, banks(nome,email,email_invio_banca)').eq('practice_id', id).order('created_at');
    setPracticeBanks(pb ?? []);
    setLoading(false);
  }, [id, isSuperAdmin]);

  useEffect(() => {
    load();
    supabase.from('banks').select('*').eq('attiva', true).then(r => setBanks(r.data ?? []));
  }, [load]);

  // Carica in anteprima la checklist della banca selezionata.
  useEffect(() => {
    if (!addingBank) {
      setAddingBankRequirements([]);
      return;
    }
    supabase
      .from('bank_document_requirements')
      .select('*')
      .eq('bank_id', addingBank)
      .order('ordine')
      .then(({ data }) => setAddingBankRequirements((data ?? []) as BankDocumentRequirement[]));
  }, [addingBank]);

  // Carica dati aggiuntivi dopo load principale
  useEffect(() => {
    if (!id) return;
    loadActivityLogs();
    loadScores();
    loadDeadlines();
    loadDocTemplates();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Carica agenti filtrati per ruolo — dipende dall'auth che può arrivare dopo il mount
  useEffect(() => {
    if (isSuperAdmin) {
      supabase.from('admin_profiles').select('id,nome,email').in('ruolo', ['agente', 'super_admin']).order('nome')
        .then(r => setAgentsForReassign(r.data ?? []));
    } else if (isSegreteria && user?.id) {
      supabase.from('segreteria_agent_assignments').select('agent_user_id').eq('segreteria_user_id', user.id)
        .then(async ({ data: assignments }) => {
          const ids = (assignments ?? []).map((a: { agent_user_id: string }) => a.agent_user_id);
          if (ids.length > 0) {
            const { data } = await supabase.from('admin_profiles').select('id,nome,email').in('id', ids).order('nome');
            setAgentsForReassign(data ?? []);
          } else {
            setAgentsForReassign([]);
          }
        });
    }
  }, [isSuperAdmin, isSegreteria, user?.id]);

  // ── Salva dati cliente e dati economici della pratica ────────────────────────
  const handleSaveClientData = async () => {
    if (!practice || !client) return;
    const ragioneSociale = clientEditForm.ragione_sociale.trim();
    const email = clientEditForm.email.trim();
    if (!ragioneSociale || !email) {
      toast.error('Ragione sociale ed email sono obbligatorie');
      return;
    }

    const capitaleSociale = parseItalianAmount(clientEditForm.capitale_sociale);
    const importoRichiesto = parseItalianAmount(clientEditForm.importo_richiesto);
    if (clientEditForm.capitale_sociale.trim() && capitaleSociale === null) {
      toast.error('Il capitale sociale non è un importo valido');
      return;
    }
    if (clientEditForm.importo_richiesto.trim() && importoRichiesto === null) {
      toast.error('L’importo richiesto non è valido');
      return;
    }

    setSavingClientEdit(true);
    try {
      const nullable = (value: string) => value.trim() || null;
      const clientPayload = {
        ragione_sociale: ragioneSociale,
        piva: nullable(clientEditForm.piva),
        codice_fiscale: nullable(clientEditForm.codice_fiscale),
        email,
        telefono: nullable(clientEditForm.telefono),
        indirizzo: nullable(clientEditForm.indirizzo),
        provincia: nullable(clientEditForm.provincia.toUpperCase()),
        data_costituzione: nullable(clientEditForm.data_costituzione),
        forma_giuridica: nullable(clientEditForm.forma_giuridica),
        capitale_sociale: capitaleSociale,
        capitale_sociale_versato: nullable(clientEditForm.capitale_sociale_versato),
        codice_ateco: nullable(clientEditForm.codice_ateco.toUpperCase()),
        ateco_descrizione: nullable(clientEditForm.ateco_descrizione),
        soci: clientEditForm.soci.length > 0 ? clientEditForm.soci : null,
        amministratori: clientEditForm.amministratori.length > 0 ? clientEditForm.amministratori : null,
      };
      const practicePayload = {
        codice_ateco: nullable(clientEditForm.codice_ateco.toUpperCase()),
        importo_richiesto: importoRichiesto,
        motivazione: nullable(clientEditForm.motivazione),
        tipologia_azienda: clientEditForm.tipologia_azienda,
        regime_contabile: clientEditForm.regime_contabile || null,
      };

      const [clientResult, practiceResult] = await Promise.all([
        supabase.from('clients').update(clientPayload).eq('id', practice.client_id),
        supabase.from('practices').update(practicePayload).eq('id', practice.id),
      ]);
      if (clientResult.error) throw clientResult.error;
      if (practiceResult.error) throw practiceResult.error;

      if (email.toLowerCase() !== client.email.toLowerCase()) {
        const { data: clientPractices, error: clientPracticesError } = await supabase
          .from('practices')
          .select('id')
          .eq('client_id', practice.client_id);
        if (clientPracticesError) throw clientPracticesError;
        const practiceIds = (clientPractices ?? []).map((item: { id: string }) => item.id);
        if (practiceIds.length > 0) {
          const { error: accessCodeError } = await supabase
            .from('practice_access_codes')
            .update({ email_cliente: email.toLowerCase() })
            .in('practice_id', practiceIds);
          if (accessCodeError) throw accessCodeError;
        }
      }

      toast.success('Dati cliente e pratica aggiornati');
      setShowClientEdit(false);
      load();
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingClientEdit(false);
    }
  };

  // ── Riassegna pratica — auto-save on selection ──────────────────────────────
  const handleReassignSelect = async (value: string) => {
    if (!practice) return;
    setReassignTo(value);
    const val = value === 'nessuno' ? null : value;
    setSavingReassign(true);
    try {
      const { error } = await supabase.from('practices').update({ assigned_to: val }).eq('id', practice.id);
      if (error) throw error;
      toast.success('Pratica riassegnata');
      setShowReassign(false);
      setReassignTo('');
      load();
    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingReassign(false);
    }
  };

  // ── Importa Centrale Rischi PDF ─────────────────────────────────────────────
  const handleCRFile = async (file: File) => {
    if (file.type !== 'application/pdf') { toast.error('Seleziona un PDF'); return; }
    setCrParsing(true);
    try {
      const text = await extractPdfText(file);
      const { data_riferimento, righe } = parseCentraleRischi(text);
      if (!righe.length) {
        toast.error('Nessun finanziamento trovato nella Centrale Rischi');
        return;
      }
      setCrDate(data_riferimento);
      setCrPreview(righe);
    } catch (e) {
      toast.error('Errore lettura PDF: ' + String(e));
    } finally {
      setCrParsing(false);
      if (crFileRef.current) crFileRef.current.value = '';
    }
  };

  const confirmCRImport = async () => {
    if (!crPreview || !id) return;
    setCrImporting(true);
    try {
      const rows = crPreview.map((riga, i): FinRow => ({
        id: crypto.randomUUID(),
        tipologia:         categoriaToTipologia(riga.categoria),
        banca_finanziaria: riga.banca,
        importo_iniziale:  String(riga.accordato),
        rata:              '',
        durata_mesi:       '',
        debito_residuo:    String(riga.utilizzato),
        note:              `CR ${riga.data_riferimento}${riga.tipo_garanzia ? ' | ' + riga.tipo_garanzia : ''}`,
        accordato:         String(riga.accordato),
        accordato_operativo: String(riga.accordato_operativo),
        utilizzato:        String(riga.utilizzato),
        saldo_medio:       String(riga.saldo_medio),
        tipo_garanzia:     riga.tipo_garanzia,
        stato_rapporto:    riga.stato_rapporto,
        data_riferimento:  riga.data_riferimento,
        fonte:             'centrale_rischi',
        _new: true, _dirty: true,
      }));
      setFinancing(prev => [...prev, ...rows]);
      setCrPreview(null);
      toast.success(`Importati ${rows.length} finanziamenti dalla Centrale Rischi. Clicca "Salva finanziamenti" per confermare.`);
    } finally {
      setCrImporting(false);
    }
  };

  // Genera codice accesso cliente + invia email
  const generateAccessCode = async () => {
    if (!practice) return;
    const client = (practice as Practice & { clients?: { email: string } }).clients;
    if (!client?.email) { toast.error('Il cliente non ha un email'); return; }

    const codice = Math.random().toString(36).substring(2, 8).toUpperCase();
    const scadenza = new Date();
    scadenza.setDate(scadenza.getDate() + 30);

    if (accessCode) {
      await supabase.from('practice_access_codes').update({ codice, email_cliente: client.email, scadenza: scadenza.toISOString() }).eq('id', accessCode.id);
    } else {
      await supabase.from('practice_access_codes').insert({
        practice_id: practice.id, codice, email_cliente: client.email, scadenza: scadenza.toISOString(),
      });
    }
    await load();
    toast.success('Codice accesso generato!');

    // Recupera nome consulente
    const { data: profile } = await supabase.from('admin_profiles').select('nome').eq('id', user?.id ?? '').maybeSingle();
    const consultantName = profile?.nome ?? user?.email ?? 'Il tuo consulente';

    // Costruisci link
    const link = `https://credifile-eosin.vercel.app/#/accesso?p=${practice.id}`;

    // Lista documenti richiesti
    const { data: docs } = await supabase.from('practice_documents').select('nome').eq('practice_id', practice.id);
    const docNames = (docs ?? []).map((d: { nome: string }) => d.nome);

    // Invia email via edge function
    const { data: emailData2, error: emailError2 } = await supabase.functions.invoke('send-client-email', {
      body: {
        to: client.email,
        consultant_name: consultantName,
        documents: docNames,
        link,
        code: codice,
        practice_number: practice.numero_pratica,
        company_name: (practice as Practice & { clients?: { ragione_sociale: string } }).clients?.ragione_sociale ?? undefined,
        // La copia e le risposte del cliente devono arrivare all'agente assegnato.
        cc: getAssignedAgentEmail(practice),
        reply_to: getAssignedAgentEmail(practice),
      },
    });
    if (emailError2 || emailData2?.success === false) {
      const msg = emailData2?.error ? JSON.stringify(emailData2.error) : emailError2?.message ?? 'Errore sconosciuto';
      toast.warning('Codice generato ma email non inviata: ' + msg);
    } else {
      toast.success(`Email inviata a ${client.email}!`);
    }
  };

  // Propaga un documento (stesso storage_path) a tutte le altre pratiche della stessa società
  const propagaDocumentoAltrePratiche = async (
    docId: string,
    storagePath: string,
    nomeFile: string,
    mimeType: string,
    dimensione: number,
  ) => {
    if (!practice?.client_id || !id) return;
    const docSorgente = documents.find(d => d.id === docId);
    if (!docSorgente) return;
    // Gli approfondimenti appartengono a uno specifico ciclo (e, se presente,
    // a una specifica banca): non devono essere copiati su altre pratiche.
    if (docSorgente.tipo === 'integrazione') return;

    const { data: praticheSibling } = await supabase
      .from('practices')
      .select('id')
      .eq('client_id', practice.client_id)
      .neq('id', id);

    if (!praticheSibling?.length) return;

    let propagati = 0;
    for (const pratica of praticheSibling) {
      // Cerca practice_document con lo stesso nome nella pratica sibling
      const { data: docSibling } = await supabase
        .from('practice_documents')
        .select('id, status')
        .eq('practice_id', pratica.id)
        .eq('nome', docSorgente.nome)
        .maybeSingle();

      let targetDocId: string;
      if (docSibling) {
        targetDocId = docSibling.id;
        if (docSibling.status !== 'caricato') {
          await supabase
            .from('practice_documents')
            .update({ status: 'caricato', uploaded_at: new Date().toISOString() })
            .eq('id', targetDocId);
        }
      } else {
        // Crea un nuovo practice_document nella pratica sibling
        const { data: nuovoDoc } = await supabase
          .from('practice_documents')
          .insert({
            practice_id: pratica.id,
            nome: docSorgente.nome,
            tipo: docSorgente.tipo,
            obbligatorio: docSorgente.obbligatorio,
            status: 'caricato',
            uploaded_at: new Date().toISOString(),
            template_id: docSorgente.template_id ?? null,
          })
          .select('id')
          .single();
        if (!nuovoDoc) continue;
        targetDocId = nuovoDoc.id;
      }

      // Evita duplicati: non inserire se esiste già un file con lo stesso storage_path
      const { data: esistente } = await supabase
        .from('uploaded_files')
        .select('id')
        .eq('practice_id', pratica.id)
        .eq('storage_path', storagePath)
        .maybeSingle();

      if (!esistente) {
        await supabase.from('uploaded_files').insert({
          practice_document_id: targetDocId,
          practice_id: pratica.id,
          nome_file: nomeFile,
          storage_path: storagePath,
          mime_type: mimeType,
          dimensione: dimensione,
          uploaded_by: 'admin',
        });
        propagati++;
      }
    }

    if (propagati > 0) {
      const praticheLabel = propagati === 1 ? 'pratica' : 'pratiche';
      toast.info(`📋 "${nomeFile}" propagato a ${propagati} altra ${praticheLabel} della stessa società`);
    }
  };

  // Upload documento da admin (per conto del cliente) — supporta selezione multipla
  const handleAdminUpload = async (docId: string, files: FileList | File[]) => {
    if (!id) return;
    const fileArray = Array.from(files);
    const oversized = fileArray.filter(f => f.size > 30 * 1024 * 1024);
    if (oversized.length > 0) oversized.forEach(f => toast.error(`"${f.name}" troppo grande. Max 30 MB.`));
    const validFiles = fileArray.filter(f => f.size <= 30 * 1024 * 1024);
    if (validFiles.length === 0) return;
    setUploadingAdminDoc(docId);
    let uploadedCount = 0;
    try {
      for (const file of validFiles) {
        const result = await uploadPracticeFile({
          practiceId: id,
          practiceDocumentId: docId,
          file,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          uploadedBy: 'admin',
        });

        if (result.error || !result.path) {
          toast.error(`Errore caricamento "${file.name}": ${result.error?.message ?? 'errore sconosciuto'}`);
          continue;
        }

        uploadedCount++;
        await propagaDocumentoAltrePratiche(docId, result.path, result.nomefile_originale, file.type, file.size);
      }

      if (uploadedCount > 0) {
        await supabase.from('practice_documents').update({ status: 'caricato', uploaded_at: new Date().toISOString() }).eq('id', docId);
        toast.success(uploadedCount === 1 ? `File caricato con successo` : `${uploadedCount} file caricati con successo`);
        load();
      }
    } finally {
      setUploadingAdminDoc(null);
    }
  };

  // Upload documento da Dropbox (Chooser)
  const handleDropboxChoose = (docId: string) => {
    if (!window.Dropbox) { toast.error('Dropbox non disponibile'); return; }
    window.Dropbox.choose({
      linkType: 'direct',
      multiselect: true,
      extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'],
      success: async (files) => {
        if (!files.length || !id) return;
        const oversized = files.filter(f => f.bytes > 30 * 1024 * 1024);
        if (oversized.length > 0) oversized.forEach(f => toast.error(`"${f.name}" troppo grande (max 30 MB)`));
        const validFiles = files.filter(f => f.bytes <= 30 * 1024 * 1024);
        if (validFiles.length === 0) return;
        setUploadingAdminDoc(docId);
        try {
          let uploadedCount = 0;
          for (const dbFile of validFiles) {
            const { link, name, bytes } = dbFile;
            const res = await fetch(link);
            if (!res.ok) throw new Error(`Download Dropbox fallito per "${name}"`);
            const blob = await res.blob();
            const file = new File([blob], name, { type: blob.type });
            const result = await uploadPracticeFile({
              practiceId: id,
              practiceDocumentId: docId,
              file,
              fileName: name,
              mimeType: blob.type,
              size: bytes,
              uploadedBy: 'admin',
            });

            if (result.error || !result.path) {
              throw new Error(`Errore caricamento "${name}": ${result.error?.message ?? 'errore sconosciuto'}`);
            }

            uploadedCount++;
            await propagaDocumentoAltrePratiche(docId, result.path, result.nomefile_originale, blob.type, bytes);
          }
          if (uploadedCount > 0) {
            await supabase.from('practice_documents').update({ status: 'caricato', uploaded_at: new Date().toISOString() }).eq('id', docId);
            toast.success(uploadedCount === 1 ? `"${validFiles[0].name}" importato da Dropbox` : `${uploadedCount} file importati da Dropbox`);
            load();
          }
        } catch (e) {
          toast.error('Errore importazione da Dropbox: ' + (e instanceof Error ? e.message : String(e)));
        } finally {
          setUploadingAdminDoc(null);
        }
      },
    });
  };

  const copyLink = () => {
    const url = `https://credifile-eosin.vercel.app/#/accesso?p=${id}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copiato negli appunti');
  };

  const copyCode = () => {
    if (accessCode) { navigator.clipboard.writeText(accessCode.codice); toast.success('Codice copiato'); }
  };

  // Cambio stato pratica
  const handleStatusChange = async () => {
    if (!practice || !newStatus) return;
    setSaving(true);
    const updatePayload: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'declinata' && noteDeclino.trim()) {
      updatePayload.note_declino = noteDeclino.trim();
    }
    await supabase.from('practices').update(updatePayload).eq('id', practice.id);
    await supabase.from('practice_status_log').insert({
      practice_id: practice.id, old_status: practice.status, new_status: newStatus,
      note: (newStatus === 'declinata' && noteDeclino.trim()) ? noteDeclino.trim() : (statusNote || null),
      created_by: 'admin',
    });
    // Log attività timeline
    await supabase.from('practice_activity_log').insert({
      practice_id: practice.id,
      action: `Stato cambiato: ${practice.status} → ${newStatus}`,
      actor_nome: user?.email ?? 'Admin',
      actor_ruolo: 'admin',
      metadata: { old_status: practice.status, new_status: newStatus },
    });
    toast.success('Stato aggiornato');
    // WhatsApp automatico al cliente se ha il telefono
    inviaWhatsAppAuto(
      client?.telefono,
      `Gentile ${client?.ragione_sociale ?? 'Cliente'},\n\nla sua pratica n° ${practice.numero_pratica} è passata allo stato: *${STATUS_LABELS[newStatus as keyof typeof STATUS_LABELS] ?? newStatus}*.\n\nPer informazioni contatti il suo consulente.`
    );
    setSaving(false);
    setShowStatusChange(false);
    setStatusNote('');
    setNoteDeclino('');
    load();
  };

  const handlePracticeBankStatusChange = async (
    practiceBank: (typeof practiceBanks)[number],
    newBankStatus: PracticeBankStatus,
  ) => {
    if (!id || practiceBank.status === newBankStatus) return;

    setUpdatingBankStatusId(practiceBank.id);
    try {
      const changedAt = new Date().toISOString();
      const updatePayload: Record<string, unknown> = {
        status: newBankStatus,
        status_updated_by: user?.id ?? null,
      };

      if (newBankStatus === 'inviata' && !practiceBank.data_invio) {
        updatePayload.data_invio = changedAt;
      }

      const { error } = await supabase
        .from('practice_banks')
        .update(updatePayload)
        .eq('id', practiceBank.id)
        .eq('practice_id', id);

      if (error) throw error;

      const bankName = practiceBank.banks?.nome ?? 'Banca';
      await supabase.from('practice_activity_log').insert({
        practice_id: id,
        action: `Stato ${bankName}: ${PRACTICE_BANK_STATUS_LABELS[practiceBank.status]} → ${PRACTICE_BANK_STATUS_LABELS[newBankStatus]}`,
        actor_id: user?.id ?? null,
        actor_nome: user?.email ?? 'Admin',
        actor_ruolo: 'admin',
        metadata: {
          practice_bank_id: practiceBank.id,
          bank_id: practiceBank.bank_id,
          banca: bankName,
          old_status: practiceBank.status,
          new_status: newBankStatus,
        },
      });

      setPracticeBanks(current => current.map(item => (
        item.id === practiceBank.id
          ? {
              ...item,
              status: newBankStatus,
              status_updated_at: changedAt,
              data_invio: newBankStatus === 'inviata' && !item.data_invio ? changedAt : item.data_invio,
            }
          : item
      )));
      toast.success(`Stato presso ${bankName} aggiornato`);
    } catch (error) {
      toast.error(`Errore aggiornamento stato banca: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUpdatingBankStatusId(null);
    }
  };

  // Approva/rifiuta documento
  const approveDoc = async (docId: string) => {
    await supabase.from('practice_documents').update({ status: 'approvato' }).eq('id', docId);
    toast.success('Documento approvato');
    load();
  };

  const rejectDoc = async () => {
    if (!showRejectDoc) return;
    await supabase.from('practice_documents').update({ status: 'rifiutato', note_rifiuto: rejectNote }).eq('id', showRejectDoc);
    toast.success('Documento rifiutato — il cliente verrà informato');
    setShowRejectDoc(null);
    setRejectNote('');
    load();
  };

  // Elimina solo il file caricato (non il campo documento)
  const handleDeleteFile = async (
    fileId: string, storagePath: string, nomeFile: string,
    docId: string, totalFiles: number
  ) => {
    if (!confirm(`Eliminare il file "${nomeFile}"?\nIl campo documento rimarrà presente. L'operazione è irreversibile.`)) return;
    // Rimuovi da storage
    await supabase.storage.from('practice-files').remove([storagePath]);
    // Rimuovi record uploaded_files
    const { error } = await supabase.from('uploaded_files').delete().eq('id', fileId);
    if (error) { toast.error('Errore: ' + error.message); return; }
    // Se era l'ultimo file, rimetti lo stato del documento a "richiesto"
    if (totalFiles <= 1) {
      await supabase.from('practice_documents').update({ status: 'richiesto' }).eq('id', docId);
    }
    toast.success(`File "${nomeFile}" eliminato`);
    load();
  };

  // Elimina documento: campo + tutti i file (operazione completa)
  const handleDeleteDoc = async (docId: string, docNome: string, files: { storage_path: string }[]) => {
    if (!confirm(`Eliminare il campo documento "${docNome}"?\nVerranno rimossi anche tutti i file caricati. L'operazione è irreversibile.`)) return;
    if (files.length > 0) {
      await supabase.storage.from('practice-files').remove(files.map(f => f.storage_path));
    }
    const { error } = await supabase.from('practice_documents').delete().eq('id', docId);
    if (error) { toast.error('Errore: ' + error.message); return; }
    toast.success(`Documento "${docNome}" eliminato`);
    load();
  };

  // Aggiunta doc manuale
  const handleAddDoc = async () => {
    if (!newDocName.trim()) { toast.error('Inserisci il nome del documento'); return; }
    setSaving(true);
    await supabase.from('practice_documents').insert({
      practice_id: id, nome: newDocName, descrizione: newDocDesc, tipo: 'standard',
      obbligatorio: true, status: 'richiesto',
    });
    toast.success('Documento aggiunto');
    setSaving(false);
    setShowAddDoc(false);
    setNewDocName(''); setNewDocDesc('');
    load();
  };

  // Aggiunta integrazione
  const handleAddIntegration = async () => {
    const requestedDocuments = integrationRequests
      .map(request => ({
        nome: request.nome.trim(),
        descrizione: request.descrizione.trim(),
      }))
      .filter(request => request.nome.length > 0);
    const requestedQuestions = integrationQuestions
      .map(question => question.trim())
      .filter(question => question.length > 0);

    if (requestedDocuments.length === 0 && requestedQuestions.length === 0) {
      toast.error('Inserisci almeno un documento o una domanda');
      return;
    }

    setSaving(true);
    let integrationRequestId: string | null = null;
    try {
      const originStatus = normalizePrimaryStatus(practice?.status ?? 'raccolta_documenti');
      const selectedPracticeBank = integrationPracticeBankId === 'none'
        ? null
        : practiceBanks.find(candidate => candidate.id === integrationPracticeBankId) ?? null;
      const { data: integrationRequest, error: integrationRequestError } = await supabase
        .from('practice_integration_requests')
        .insert({
          practice_id: id,
          practice_bank_id: selectedPracticeBank?.id ?? null,
          origin_status: originStatus,
          status: 'open',
          note: selectedPracticeBank
            ? `Approfondimento richiesto da ${selectedPracticeBank.banks?.nome}: ${requestedDocuments.length} documenti e ${requestedQuestions.length} risposte`
            : `Richiesti ${requestedDocuments.length} documenti e ${requestedQuestions.length} risposte`,
          created_by: user?.id ?? null,
        })
        .select('id')
        .single();
      if (integrationRequestError || !integrationRequest?.id) {
        throw integrationRequestError ?? new Error('Ciclo di integrazione non creato');
      }
      integrationRequestId = integrationRequest.id;

      if (requestedDocuments.length > 0) {
        const { error: documentsError } = await supabase
          .from('practice_documents')
          .insert(requestedDocuments.map(request => ({
            practice_id: id,
            integration_request_id: integrationRequestId,
            nome: request.nome,
            descrizione: request.descrizione || null,
            tipo: 'integrazione',
            obbligatorio: true,
            status: 'richiesto',
          })));
        if (documentsError) throw documentsError;
      }

      if (requestedQuestions.length > 0) {
        const { error: questionsError } = await supabase
          .from('practice_client_questions')
          .insert(requestedQuestions.map(question => ({
            practice_id: id,
            integration_request_id: integrationRequestId,
            domanda: question,
            stato: 'richiesta',
            created_by: user?.id ?? null,
          })));
        if (questionsError) throw questionsError;
      }

      const documentNames = requestedDocuments.map(request => request.nome);
      const totalRequests = documentNames.length + requestedQuestions.length;

      await supabase.from('practice_activity_log').insert({
        practice_id: id,
        action: 'richiesta_documentale_preparata',
        actor_id: user?.id ?? null,
        actor_nome: user?.email ?? 'Admin',
        actor_ruolo: 'admin',
        metadata: {
          documenti: documentNames,
          domande: requestedQuestions,
          integration_request_id: integrationRequestId,
          fase_pratica: originStatus,
          practice_bank_id: selectedPracticeBank?.id ?? null,
          bank_id: selectedPracticeBank?.bank_id ?? null,
          banca_richiedente: selectedPracticeBank?.banks?.nome ?? null,
        },
      });

      toast.success(
        `${totalRequests} ${totalRequests === 1 ? 'elemento aggiunto' : 'elementi aggiunti'}${selectedPracticeBank ? ` per ${selectedPracticeBank.banks?.nome}` : ''} senza modificare la fase “${STATUS_LABELS[originStatus]}”. Ora usa “Invia Richiesta Documenti”.`
      );
      setShowIntegration(false);
      setIntegrationRequests([{ nome: '', descrizione: '' }]);
      setIntegrationQuestions(['']);
      setIntegrationPracticeBankId('none');
      await load();
    } catch (error) {
      if (integrationRequestId) {
        await supabase
          .from('practice_integration_requests')
          .delete()
          .eq('id', integrationRequestId);
      }
      toast.error('Errore nella richiesta documentale: ' + String(error));
    } finally {
      setSaving(false);
    }
  };

  const downloadFile = async (path: string, name: string) => {
    const { data } = await supabase.storage.from('practice-files').createSignedUrl(path, 60);
    if (data?.signedUrl) {
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = name;
      a.click();
      // Audit log in background
      supabase.from('download_logs').insert({
        user_id: user?.id ?? null,
        practice_id: id ?? null,
        file_path: path,
        file_name: name,
      }).then(() => {/* silent */});
    }
  };

  if (loading) return (
    <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
  );
  if (!practice) return <div className="text-center py-20 text-muted-foreground">Pratica non trovata</div>;

  const client = (practice as Practice & { clients?: Client }).clients;
  const bank = (practice as Practice & { banks?: { nome: string } }).banks;
  const assignedAgent = (practice as Practice & { assigned_agent?: {id:string;nome?:string;email:string} }).assigned_agent;
  const docsStandard = documents.filter(d => d.tipo === 'standard');
  const docsBanca = documents.filter(d => d.tipo === 'banca');
  const docsIntegrazione = documents.filter(d => d.tipo === 'integrazione');
  const integrationCycleById = new Map(integrationCycles.map(cycle => [cycle.id, cycle]));
  const openIntegrationCycles = integrationCycles.filter(cycle => cycle.status === 'open');
  const bankIntegrationCycles = integrationCycles.filter(cycle => Boolean(cycle.practice_bank_id));
  const completedDocs = documents.filter(d => d.status === 'caricato' || d.status === 'approvato').length;
  const isFinPromoter = (candidate?: { nome?: string; codice?: string } | null) =>
    Boolean(candidate && (/finpromoter/i.test(candidate.nome ?? '') || /finpro/i.test(candidate.codice ?? '')));
  const overrideTipologia = practice.tipologia_azienda && practice.tipologia_azienda !== 'auto'
    ? practice.tipologia_azienda
    : null;
  const baseChecklistProfile = classifyFinPromoterCompany(
    [client?.forma_giuridica, client?.ragione_sociale].filter(Boolean).join(' '),
    practice.regime_contabile as RegimeContabile,
    overrideTipologia as FinPromoterCompanyType | null,
  );
  const checklistProfile = {
    ...baseChecklistProfile,
    condizioni: {
      ...baseChecklistProfile.condizioni,
      ...(practice.checklist_condizioni ?? {}),
    },
  };
  const applicableAddingBankRequirements = addingBankRequirements.filter(requirement =>
    requirementApplies(requirement, checklistProfile)
  );
  const selectedAddingBank = banks.find(candidate => candidate.id === addingBank);
  const finPromoterChecklistVisible = isFinPromoter(selectedAddingBank)
    || practiceBanks.some(item => /finpromoter/i.test(item.banks?.nome ?? ''));
  const updateChecklistProfile = async (patch: {
    tipologia_azienda?: Practice['tipologia_azienda'];
    regime_contabile?: Practice['regime_contabile'];
    checklist_condizioni?: Practice['checklist_condizioni'];
  }) => {
    const { error } = await supabase.from('practices').update(patch).eq('id', practice.id);
    if (error) {
      toast.error('Errore aggiornamento checklist: ' + error.message);
      return false;
    }
    setPractice(prev => prev ? { ...prev, ...patch } : prev);
    return true;
  };
  const updateChecklistCondition = async (
    key: keyof NonNullable<Practice['checklist_condizioni']>,
    value: boolean,
  ) => {
    await updateChecklistProfile({
      checklist_condizioni: { ...(practice.checklist_condizioni ?? {}), [key]: value },
    });
  };
  const handleAssignBank = async () => {
    if (!addingBank || !id) return;
    const selectedBank = banks.find(candidate => candidate.id === addingBank);
    if (!selectedBank) return;
    const selectedIsFinPromoter = isFinPromoter(selectedBank);
    const needsRegime = checklistProfile.tipo === 'societa_persone' || checklistProfile.tipo === 'impresa_individuale';
    if (selectedIsFinPromoter && needsRegime && !checklistProfile.regime) {
      toast.error('Seleziona prima il regime contabile nella sezione checklist FinPromoter.');
      return;
    }

    const { error } = await supabase.from('practice_banks').insert({ practice_id: id, bank_id: addingBank, status: 'assegnata' });
    if (error) { toast.error('Errore: ' + error.message); return; }
    const applicable = selectedIsFinPromoter
      ? applicableAddingBankRequirements
      : addingBankRequirements;
    if (applicable.length > 0) {
      const existingNames = new Set(documents.map(document => document.nome.trim().toLowerCase()));
      const rows = applicable
        .filter(requirement => !existingNames.has(requirement.nome.trim().toLowerCase()))
        .map(requirement => ({
          practice_id: id,
          bank_requirement_id: requirement.id,
          nome: requirement.nome,
          descrizione: requirement.descrizione,
          tipo: 'banca' as const,
          obbligatorio: requirement.obbligatorio,
          status: 'richiesto' as const,
        }));
      if (rows.length > 0) {
        const { error: docsError } = await supabase.from('practice_documents').insert(rows);
        if (docsError) {
          toast.error('Banca assegnata, ma checklist non caricata: ' + docsError.message);
        }
      }
    }
    toast.success('Banca assegnata' + (applicable.length ? ` — ${applicable.length} documenti applicabili` : ''));
    setAddingBank('');
    await load();
  };

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" className="mt-0.5" onClick={() => navigate('/admin/pratiche')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-foreground">{client?.ragione_sociale}</h1>
            <code className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded font-mono">{practice.numero_pratica}</code>
            <Badge className={STATUS_COLORS[practice.status]}>{STATUS_LABELS[practice.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Creata il {new Date(practice.created_at).toLocaleDateString('it-IT')}
            {bank && ` · ${bank.nome}`}{assignedAgent && ` · 👤 ${assignedAgent.nome || assignedAgent.email}`}
          </p>
          {isSuperAdmin && (assignedAgent || segreteriaDiCompetenza) && (
            <div className="flex items-center gap-4 mt-1.5 text-xs">
              {assignedAgent && (
                <span className="flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2 py-0.5">
                  <span>👤</span>
                  <span className="font-medium">Caricata da:</span>
                  <span>{assignedAgent.nome || assignedAgent.email}</span>
                </span>
              )}
              {segreteriaDiCompetenza && (
                <span className="flex items-center gap-1 bg-purple-50 text-purple-700 border border-purple-200 rounded-full px-2 py-0.5">
                  <span>🏢</span>
                  <span className="font-medium">Segreteria:</span>
                  <span>{segreteriaDiCompetenza.nome || segreteriaDiCompetenza.email}</span>
                </span>
              )}
            </div>
          )}
          {practice.status === 'declinata' && (practice as Practice & { note_declino?: string }).note_declino && (
            <div className="mt-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 max-w-xl">
              <span className="shrink-0 mt-0.5">🚫</span>
              <span><span className="font-semibold">Motivo declino:</span> {(practice as Practice & { note_declino?: string }).note_declino}</span>
            </div>
          )}
        </div>
        {canApprove && practice.bank_id && (
          <Button variant="outline" size="sm" className="gap-1.5 bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={() => { setBankNote(''); setShowSendBankDialog(practice.bank_id ?? null); }}>
            ✉️ Invia alla Banca
          </Button>
        )}
        {/* Agente su pratica in bozza: pulsante per sottomettere alla segreteria */}
        {isAgente && practice.status === 'bozza' && (
          <Button
            size="sm"
            className="gap-1.5 bg-green-600 hover:bg-green-700"
            onClick={async () => {
              if (!confirm('Inviare la pratica alla segreteria?\nLo stato cambierà in "Raccolta Documenti" e sarà visibile alla segreteria.')) return;
              const { error } = await supabase.from('practices').update({ status: 'raccolta_documenti' }).eq('id', practice.id);
              if (error) { toast.error('Errore: ' + error.message); return; }
              await supabase.from('practice_status_log').insert({
                practice_id: practice.id, old_status: 'bozza', new_status: 'raccolta_documenti',
                note: 'Pratica inviata alla segreteria dall\'agente', created_by: 'agente',
              });
              toast.success('Pratica inviata alla segreteria!');
              load();
            }}
          >
            <Send className="w-3.5 h-3.5" /> Invia alla Segreteria
          </Button>
        )}
        {canApprove && (
          <Button variant="outline" size="sm" onClick={() => { setNewStatus(practice.status); setShowStatusChange(true); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Cambia fase generale
          </Button>
        )}
        {(isSuperAdmin || isSegreteria) && practice.status === 'raccolta_documenti' && (
          <Button
            variant="outline" size="sm"
            className="gap-1.5 text-indigo-700 border-indigo-300 hover:bg-indigo-50"
            onClick={sendNotificaBanche}
            disabled={sendingNotif}
          >
            {sendingNotif
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Invio notifica…</>
              : <><Mail className="w-3.5 h-3.5" /> Notifica Banche</>
            }
          </Button>
        )}
        {!isAgente && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setReassignTo(practice.assigned_to ?? ''); setShowReassign(true); }}>
            👤 Riassegna Agente
          </Button>
        )}
        {canEdit && (
          <Button
            variant="ghost" size="sm"
            className="text-destructive hover:bg-destructive/10 shrink-0"
            onClick={async () => {
              if (!confirm(`Eliminare la pratica "${practice.numero_pratica}"?\nSaranno eliminati tutti i documenti associati. L'operazione è irreversibile.`)) return;
              const { error } = await supabase.from('practices').delete().eq('id', practice.id);
              if (error) { toast.error('Errore eliminazione: ' + error.message); return; }
              toast.success('Pratica eliminata');
              navigate('/admin/pratiche');
            }}
            title="Elimina pratica"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Info cliente */}
        <div className="space-y-4">
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><User className="w-4 h-4 text-primary" />Dati Cliente</span>
                {!isSegnalatore && (
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                    title="Modifica tutti i dati cliente e della richiesta"
                    onClick={() => {
                      setClientEditForm({
                        ragione_sociale: client?.ragione_sociale ?? '',
                        piva: client?.piva ?? '',
                        codice_fiscale: client?.codice_fiscale ?? '',
                        email: client?.email ?? '',
                        telefono: client?.telefono ?? '',
                        indirizzo: client?.indirizzo ?? '',
                        provincia: client?.provincia ?? '',
                        data_costituzione: client?.data_costituzione ?? '',
                        forma_giuridica: client?.forma_giuridica ?? '',
                        capitale_sociale: client?.capitale_sociale != null ? String(client.capitale_sociale) : '',
                        capitale_sociale_versato: client?.capitale_sociale_versato ?? '',
                        codice_ateco: practice.codice_ateco ?? client?.codice_ateco ?? '',
                        ateco_descrizione: client?.ateco_descrizione ?? '',
                        importo_richiesto: practice.importo_richiesto != null ? String(practice.importo_richiesto) : '',
                        motivazione: practice.motivazione ?? '',
                        soci: client?.soci ?? [],
                        amministratori: client?.amministratori ?? [],
                        tipologia_azienda: practice.tipologia_azienda ?? 'auto',
                        regime_contabile: practice.regime_contabile ?? '',
                      });
                      setShowClientEdit(true);
                    }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><p className="text-muted-foreground text-xs">Ragione Sociale</p><p className="font-medium">{client?.ragione_sociale}</p></div>
              <div><p className="text-muted-foreground text-xs">Email</p><p>{client?.email}</p></div>
              {client?.piva && <div><p className="text-muted-foreground text-xs">P.IVA</p><p className="font-mono">{client.piva}</p></div>}
              {client?.telefono && <div><p className="text-muted-foreground text-xs">Telefono</p>
                <div className="flex items-center gap-2">
                  <p>{client.telefono}</p>
                </div>
              </div>}
              {/* Bottone WhatsApp — sempre visibile, disabilitato se manca il telefono */}
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  className={`h-7 text-xs gap-1.5 px-2.5 w-full justify-center mt-1 ${client?.telefono ? 'text-emerald-600 border-emerald-300 hover:bg-emerald-50' : 'text-muted-foreground border-dashed'}`}
                  onClick={() => client?.telefono ? sendWhatsApp(client.telefono) : toast.error('Aggiungi il numero di telefono nella scheda cliente per usare WhatsApp')}
                  disabled={sendingWA}
                  title={client?.telefono ? `Invia WhatsApp a ${client.telefono}` : 'Nessun numero di telefono — modifica la scheda cliente'}
                >
                  <Phone className="w-3 h-3" />
                  {sendingWA ? 'Invio...' : client?.telefono ? 'Invia WhatsApp' : 'WhatsApp (n° mancante)'}
                </Button>
              </div>
              {bank && <div><p className="text-muted-foreground text-xs">Banca</p><p className="flex items-center gap-1"><Building2 className="w-3 h-3" />{bank.nome}</p></div>}
              {practice.importo_richiesto != null && <div><p className="text-muted-foreground text-xs">Importo</p><p className="flex items-center gap-1 font-semibold"><Euro className="w-3 h-3" />{practice.importo_richiesto.toLocaleString('it-IT')}</p></div>}
              <div>
                <p className="text-muted-foreground text-xs">Codice ATECO</p>
                <p className="text-sm font-mono font-semibold">{practice.codice_ateco ?? client?.codice_ateco ?? '—'}</p>
              </div>
              {practice.motivazione && <div><p className="text-muted-foreground text-xs">Motivazione Richiesta</p><p className="text-sm mt-0.5 bg-muted/50 rounded p-2 leading-relaxed">{practice.motivazione}</p></div>}
            </CardContent>
          </Card>

          {/* Segnalatore — visibile a super_admin, segreteria e agente */}
          {(() => {
            const seg = (practice as Practice & { segnalatore?: { id: string; nome?: string; email: string } }).segnalatore;
            if (!seg || isSegnalatore) return null;
            return (
              <Card className="border-orange-200 bg-orange-50/40">
                <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2 text-orange-700">👤 Segnalatore</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <p className="font-medium">{seg.nome || '—'}</p>
                  <p className="text-muted-foreground text-xs">{seg.email}</p>
                </CardContent>
              </Card>
            );
          })()}

          {/* Avanzamento documenti */}
          <Card className="border-border">
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-primary" />Avanzamento</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-2xl font-bold text-foreground">{completedDocs}</span>
                <span className="text-muted-foreground text-sm mb-0.5">/ {documents.length} documenti</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${documents.length > 0 ? (completedDocs / documents.length) * 100 : 0}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {documents.length > 0 ? Math.round((completedDocs / documents.length) * 100) : 0}% completato
              </p>
            </CardContent>
          </Card>

          {/* ── Score Rischio Complessivo ── */}
          {(scoreBancabilita !== null || scoreReputazione !== null) && (() => {
            // Calcolo pesato solo sui valori disponibili (non usa valori fantoccio)
            const hasB = scoreBancabilita !== null;
            const hasR = scoreReputazione !== null;
            const pesoB = hasB ? 0.6 : 0;
            const pesoR = hasR ? 0.4 : 0;
            const totPeso = pesoB + pesoR;
            const scoreComplessivo = totPeso > 0
              ? Math.round(((hasB ? scoreBancabilita! * pesoB : 0) + (hasR ? scoreReputazione! * pesoR : 0)) / totPeso)
              : 0;
            // Barre: mostra il valore reale, 0 se assente
            const barB = hasB ? scoreBancabilita! : 0;
            const barR = hasR ? scoreReputazione! : 0;
            const gaugeColor = scoreComplessivo >= 70 ? '#22c55e' : scoreComplessivo >= 40 ? '#f59e0b' : '#ef4444';
            const gaugeBg = scoreComplessivo >= 70 ? 'bg-green-50 border-green-200' : scoreComplessivo >= 40 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
            const labelColor = scoreComplessivo >= 70 ? 'text-green-700' : scoreComplessivo >= 40 ? 'text-amber-700' : 'text-red-700';
            // SVG gauge semicircolare
            const r = 40; const cx = 56; const cy = 56;
            const startAngle = -180; const endAngle = 0;
            const toRad = (deg: number) => (deg * Math.PI) / 180;
            const arcX = (deg: number) => cx + r * Math.cos(toRad(deg));
            const arcY = (deg: number) => cy + r * Math.sin(toRad(deg));
            const fillAngle = startAngle + (scoreComplessivo / 100) * (endAngle - startAngle);
            return (
              <Card className={`border ${gaugeBg}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span className="text-base">🎯</span> Score Rischio Complessivo
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* SVG Gauge */}
                  <div className="flex flex-col items-center">
                    <svg width="112" height="64" viewBox="0 0 112 64">
                      {/* Track */}
                      <path
                        d={`M ${arcX(startAngle)} ${arcY(startAngle)} A ${r} ${r} 0 0 1 ${arcX(endAngle)} ${arcY(endAngle)}`}
                        fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round"
                      />
                      {/* Fill */}
                      {scoreComplessivo > 0 && (
                        <path
                          d={`M ${arcX(startAngle)} ${arcY(startAngle)} A ${r} ${r} 0 ${scoreComplessivo >= 50 ? 1 : 0} 1 ${arcX(fillAngle)} ${arcY(fillAngle)}`}
                          fill="none" stroke={gaugeColor} strokeWidth="10" strokeLinecap="round"
                        />
                      )}
                      <text x={cx} y={cy - 4} textAnchor="middle" className="font-bold" fontSize="18" fontWeight="bold" fill={gaugeColor}>
                        {scoreComplessivo}
                      </text>
                      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill="#6b7280">/ 100</text>
                    </svg>
                    <p className={`text-sm font-semibold ${labelColor}`}>
                      {scoreComplessivo >= 70 ? '✅ Basso Rischio' : scoreComplessivo >= 40 ? '⚠️ Rischio Medio' : '🚨 Alto Rischio'}
                    </p>
                  </div>
                  {/* Dettaglio componenti */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Bancabilità <span className="text-[10px]">(60%)</span></span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${barB}%` }} />
                        </div>
                        <span className="font-semibold w-8 text-right">{scoreBancabilita ?? '—'}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Reputazione <span className="text-[10px]">(40%)</span></span>
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-purple-500 transition-all" style={{ width: `${barR}%` }} />
                        </div>
                        <span className="font-semibold w-8 text-right">{scoreReputazione ?? '—'}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Link cliente — solo agente */}
          {(isAgente || isSuperAdmin || isSegreteria) && (
          <Card className="border-border">
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" />Portale Cliente</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {accessCode ? (
                <>
                  <div className="bg-muted rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Codice Accesso</span>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={copyCode}>
                        <Copy className="w-3 h-3" /> Copia
                      </Button>
                    </div>
                    <code className="text-lg font-bold font-mono text-foreground tracking-widest">{accessCode.codice}</code>
                    <p className="text-xs text-muted-foreground">Email: {accessCode.email_cliente}</p>
                    {accessCode.last_access && <p className="text-xs text-muted-foreground">Ultimo accesso: {new Date(accessCode.last_access).toLocaleDateString('it-IT')}</p>}
                  </div>
                  <div className={`rounded-lg border p-3 ${
                    accessCode.privacy_consent_accepted_at
                      ? 'border-green-200 bg-green-50 text-green-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}>
                    <div className="flex items-start gap-2">
                      {accessCode.privacy_consent_accepted_at
                        ? <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      }
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">
                          {accessCode.privacy_consent_accepted_at
                            ? 'Privacy accettata'
                            : 'Privacy non ancora accettata'
                          }
                        </p>
                        {accessCode.privacy_consent_accepted_at && (
                          <>
                            <p className="text-xs mt-0.5">
                              {new Date(accessCode.privacy_consent_accepted_at).toLocaleString('it-IT')}
                            </p>
                            {accessCode.privacy_consent_version && (
                              <p className="text-[11px] mt-0.5 opacity-80">
                                Versione: {accessCode.privacy_consent_version}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={copyLink}>
                      <Copy className="w-3 h-3" /> Copia Link
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={generateAccessCode}>
                      <RefreshCw className="w-3 h-3" /> Rigenera
                    </Button>
                  </div>
                  <Button
                    className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                    size="sm"
                    onClick={sendDocumentRequest}
                    disabled={sendingEmail}
                  >
                    {sendingEmail
                      ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Invio in corso…</>
                      : <><Mail className="w-3.5 h-3.5" /> Invia Richiesta Documenti</>
                    }
                  </Button>
                </>
              ) : (
                <Button className="w-full gap-2" size="sm" onClick={generateAccessCode}>
                  <Link2 className="w-3.5 h-3.5" /> Genera Link Cliente
                </Button>
              )}
            </CardContent>
          </Card>
          )} {/* fine isAgente portale cliente */}
        </div>

        {/* Documenti + Log */}
        <div className="lg:col-span-2 space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="documenti">Documenti ({documents.length})</TabsTrigger>
              <TabsTrigger value="banche">Banche {practiceBanks.length > 0 ? `(${practiceBanks.length})` : ''}</TabsTrigger>
              <TabsTrigger value="finanziamenti">Finanziamenti {financing.length > 0 ? `(${financing.length})` : ''}</TabsTrigger>
              <TabsTrigger value="analisi">Analisi Finanziaria</TabsTrigger>
              <TabsTrigger value="bancabilita">Bancabilità</TabsTrigger>
              <TabsTrigger value="reputazione">Reputazione</TabsTrigger>
              {(isSuperAdmin || isSegreteria || isAgente) && (
                <TabsTrigger value="aml">🛡️ AML</TabsTrigger>
              )}
              <TabsTrigger value="banche-ai">🤖 Banche AI</TabsTrigger>
              <TabsTrigger value="scadenze">📅 Scadenze {deadlines.length > 0 ? `(${deadlines.length})` : ''}</TabsTrigger>
              <TabsTrigger value="genera-doc" onClick={loadDocTemplates}>📝 Genera Doc</TabsTrigger>
              <TabsTrigger value="relazione">📄 Relazione</TabsTrigger>
              <TabsTrigger value="timeline" onClick={loadActivityLogs}>📋 Timeline</TabsTrigger>
              <TabsTrigger value="log">Storico Stati</TabsTrigger>
              <TabsTrigger value="note" onClick={loadNotes}>💬 Note {notes.length > 0 ? `(${notes.length})` : ''}</TabsTrigger>
              <TabsTrigger value="task" onClick={loadPracticeTasks}>✅ Task {practiceTasks.filter(t=>t.stato!=='completata').length > 0 ? `(${practiceTasks.filter(t=>t.stato!=='completata').length})` : ''}</TabsTrigger>
              <TabsTrigger value="email-log" onClick={loadEmailLog}>📨 Storico</TabsTrigger>
              <TabsTrigger value="checklist" onClick={loadChecklist}>📋 Checklist {checklistItems.length > 0 ? `(${checklistItems.filter(i=>i.completata).length}/${checklistItems.length})` : ''}</TabsTrigger>
              <TabsTrigger value="estratto-conto">📊 Estratto Conto</TabsTrigger>
            </TabsList>

            <TabsContent value="documenti" className="space-y-3 mt-3">
              {/* Actions */}
              {(canEdit || canApprove) && (
              <div className="flex gap-2 flex-wrap">
                {canEdit && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAddDoc(true)}>
                  <Plus className="w-3.5 h-3.5" /> Aggiungi Documento
                </Button>
                )}
                {canEdit && accessCode && documents.some(d => d.status === 'richiesto' || d.status === 'rifiutato') && (
                <Button size="sm" variant="outline"
                  className="gap-1.5 text-orange-700 border-orange-300 hover:bg-orange-50"
                  onClick={() => setShowSollecita(true)}>
                  <BellRing className="w-3.5 h-3.5" /> Sollecita Cliente
                </Button>
                )}
                {(canEdit || canApprove) && (
                <Button size="sm" variant="outline" className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => setShowIntegration(true)}>
                  <AlertCircle className="w-3.5 h-3.5" /> Prepara Richiesta
                </Button>
                )}
                {openIntegrationCycles.length > 0 && (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                    {openIntegrationCycles.length} {openIntegrationCycles.length === 1 ? 'integrazione aperta' : 'integrazioni aperte'}
                  </Badge>
                )}
              </div>
              )}

              {bankIntegrationCycles.length > 0 && (
                <Card className="border-indigo-200 bg-indigo-50/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Landmark className="w-4 h-4 text-indigo-600" />
                      Approfondimenti richiesti dalle banche
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Ogni invio contiene soltanto i file e le risposte collegati alla richiesta della banca indicata.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {bankIntegrationCycles.map(cycle => {
                      const practiceBank = practiceBanks.find(candidate => candidate.id === cycle.practice_bank_id);
                      const cycleDocuments = documents.filter(document => document.integration_request_id === cycle.id);
                      const cycleQuestions = clientQuestions.filter(question => question.integration_request_id === cycle.id);
                      const cycleFiles = cycleDocuments.flatMap(document => (
                        (document as PracticeDocument & { uploaded_files?: { id: string; nome_file: string }[] }).uploaded_files ?? []
                      ));
                      const answeredQuestions = cycleQuestions.filter(question => question.stato === 'risposta' && question.risposta?.trim());
                      const missingDocuments = cycleDocuments.filter(document => document.status === 'richiesto' || document.status === 'rifiutato').length;
                      const missingAnswers = cycleQuestions.filter(question => question.stato === 'richiesta').length;
                      const bankEmail = practiceBank?.banks?.email_invio_banca || practiceBank?.banks?.email;
                      const hasDeliverableContent = cycleFiles.length > 0 || answeredQuestions.length > 0;
                      const isSending = sendingIntegrationId === cycle.id;

                      return (
                        <div key={cycle.id} className="rounded-lg border border-indigo-100 bg-white p-3">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-slate-800">
                                  {practiceBank?.banks?.nome ?? 'Banca non più assegnata'}
                                </p>
                                <Badge variant="outline" className="text-xs border-indigo-200 text-indigo-700">
                                  {STATUS_LABELS[cycle.origin_status as PracticeStatus] ?? cycle.origin_status}
                                </Badge>
                                {cycle.bank_sent_at && (
                                  <Badge className="text-xs bg-green-100 text-green-700 border-green-200">
                                    Inviato {new Date(cycle.bank_sent_at).toLocaleDateString('it-IT')}
                                    {(cycle.bank_delivery_count ?? 0) > 1 ? ` · ${cycle.bank_delivery_count} invii` : ''}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {cycleFiles.length} {cycleFiles.length === 1 ? 'file pronto' : 'file pronti'}
                                {' · '}
                                {answeredQuestions.length} {answeredQuestions.length === 1 ? 'risposta pronta' : 'risposte pronte'}
                                {(missingDocuments + missingAnswers) > 0 && (
                                  <> · <span className="text-amber-700">{missingDocuments + missingAnswers} elementi ancora da integrare</span></>
                                )}
                              </p>
                              {!bankEmail && (
                                <p className="text-xs text-red-600 mt-1">
                                  Email banca non configurata.
                                </p>
                              )}
                            </div>
                            {(canEdit || canApprove) && (
                              <Button
                                size="sm"
                                className="gap-1.5 bg-indigo-600 hover:bg-indigo-700"
                                disabled={isSending || !practiceBank || !bankEmail || !hasDeliverableContent}
                                title={!hasDeliverableContent
                                  ? 'Carica almeno un documento o acquisisci una risposta prima dell’invio'
                                  : `Invia soltanto gli approfondimenti a ${practiceBank?.banks?.nome ?? 'questa banca'}`}
                                onClick={async () => {
                                  if (!practiceBank || !bankEmail || !hasDeliverableContent) return;
                                  if (!confirm(
                                    `Inviare a ${practiceBank.banks?.nome} ${cycleFiles.length} file e ${answeredQuestions.length} risposte collegati a questo approfondimento?\n\nLa fase della banca non verrà modificata.`
                                  )) return;

                                  setSendingIntegrationId(cycle.id);
                                  try {
                                    const { data, error } = await invokeSendToBank({
                                      practice_id: practice!.id,
                                      bank_id: practiceBank.bank_id,
                                      integration_request_id: cycle.id,
                                      note: cycle.note ?? null,
                                    });
                                    if (error || !data?.success) {
                                      throw new Error(error?.message ?? String(data?.error ?? 'Invio non riuscito'));
                                    }
                                    toast.success(
                                      `Approfondimenti inviati a ${data.sent_to}: ${data.docs_sent ?? 0} file e ${data.answers_sent ?? 0} risposte`
                                    );
                                    await load();
                                    loadEmailLog();
                                  } catch (error) {
                                    toast.error('Errore invio approfondimenti: ' + (error instanceof Error ? error.message : String(error)));
                                  } finally {
                                    setSendingIntegrationId(null);
                                  }
                                }}
                              >
                                {isSending
                                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Invio…</>
                                  : <><Send className="w-3.5 h-3.5" /> Invia approfondimenti</>}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Documenti per tipo */}
              {[
                { label: 'Documenti Standard', docs: docsStandard, color: 'text-blue-600' },
                { label: 'Documenti Banca', docs: docsBanca, color: 'text-purple-600' },
                { label: 'Integrazioni', docs: docsIntegrazione, color: 'text-amber-600' },
              ].filter(g => g.docs.length > 0).map(group => (
                <div key={group.label}>
                  <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${group.color}`}>{group.label}</p>
                  <div className="space-y-2">
                    {group.docs.map(doc => {
                      const files = (doc as PracticeDocument & { uploaded_files?: { id: string; nome_file: string; storage_path: string }[] }).uploaded_files ?? [];
                      return (
                        <Card key={doc.id} className="border-border">
                          <CardContent className="py-3 px-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-foreground">{doc.nome}</p>
                                  {doc.obbligatorio && <span className="text-xs text-red-500">*</span>}
                                  <Badge className={`text-xs ${DOC_STATUS_COLORS[doc.status]}`}>{DOC_STATUS_LABELS[doc.status]}</Badge>
                                  {doc.integration_request_id && integrationCycleById.get(doc.integration_request_id) && (
                                    <Badge variant="outline" className="text-xs border-amber-200 text-amber-700">
                                      Richiesta durante {STATUS_LABELS[
                                        integrationCycleById.get(doc.integration_request_id)!.origin_status as PracticeStatus
                                      ] ?? integrationCycleById.get(doc.integration_request_id)!.origin_status}
                                      {integrationCycleById.get(doc.integration_request_id)!.practice_bank_id
                                        ? ` · ${practiceBanks.find(candidate => (
                                            candidate.id === integrationCycleById.get(doc.integration_request_id)!.practice_bank_id
                                          ))?.banks?.nome ?? 'Banca'}`
                                        : ''}
                                    </Badge>
                                  )}
                                </div>
                                {doc.descrizione && <p className="text-xs text-muted-foreground mt-0.5">{doc.descrizione}</p>}
                                {doc.note_rifiuto && <p className="text-xs text-red-600 mt-1 bg-red-50 px-2 py-1 rounded">Motivo rifiuto: {doc.note_rifiuto}</p>}
                                {files.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {files.map(f => (
                                      <div key={f.id} className="flex items-center gap-1">
                                        <button
                                          className="flex items-center gap-2 text-xs text-primary hover:underline flex-1 min-w-0 text-left"
                                          onClick={() => downloadFile(f.storage_path, f.nome_file)}
                                        >
                                          <Download className="w-3 h-3 shrink-0" />
                                          <span className="truncate">{f.nome_file}</span>
                                        </button>
                                        {canEdit && (
                                          <button
                                            className="ml-1 shrink-0 text-destructive/50 hover:text-destructive transition-colors"
                                            title="Elimina questo file"
                                            onClick={() => handleDeleteFile(f.id, f.storage_path, f.nome_file, doc.id, files.length)}
                                          >
                                            <XCircle className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {doc.status === 'caricato' && canApprove && (
                                <div className="flex gap-1 shrink-0">
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600 hover:bg-green-50" onClick={() => approveDoc(doc.id)}>
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:bg-red-50" onClick={() => setShowRejectDoc(doc.id)}>
                                    <XCircle className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                              {canEdit && (
                                <div className="shrink-0 flex gap-1">
                                  <input type="file" multiple className="hidden"
                                    ref={el => { adminFileRefs.current[doc.id] = el; }}
                                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                                    onChange={e => { const fs = e.target.files; if (fs && fs.length > 0) handleAdminUpload(doc.id, fs); e.target.value = ''; }}
                                  />
                                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs"
                                    disabled={uploadingAdminDoc === doc.id}
                                    onClick={() => adminFileRefs.current[doc.id]?.click()}
                                    title="Carica per il cliente"
                                  >
                                    {uploadingAdminDoc === doc.id
                                      ? <span className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                                      : <><Upload className="w-3 h-3" /> Upload</>}
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                                    disabled={uploadingAdminDoc === doc.id}
                                    onClick={() => handleDropboxChoose(doc.id)}
                                    title="Importa da Dropbox"
                                  >
                                    📦 Dropbox
                                  </Button>
                                  <Button size="sm" variant="ghost"
                                    className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                                    title="Elimina documento e file"
                                    onClick={() => handleDeleteDoc(doc.id, doc.nome, files)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))}

              {clientQuestions.length > 0 && (
                <Card className="border-blue-200 bg-blue-50/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-blue-600" />
                      Domande al cliente ({clientQuestions.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {clientQuestions.map((question, index) => (
                      <div key={question.id} className="rounded-lg border border-blue-100 bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium">{index + 1}. {question.domanda}</p>
                          <Badge className={question.stato === 'risposta'
                            ? 'bg-green-100 text-green-700 border-green-200 text-xs shrink-0'
                            : 'bg-amber-100 text-amber-700 border-amber-200 text-xs shrink-0'
                          }>
                            {question.stato === 'risposta' ? 'Risposta' : 'In attesa'}
                          </Badge>
                          {question.integration_request_id && integrationCycleById.get(question.integration_request_id) && (
                            <Badge variant="outline" className="text-xs shrink-0 border-amber-200 text-amber-700">
                              {STATUS_LABELS[
                                integrationCycleById.get(question.integration_request_id)!.origin_status as PracticeStatus
                              ] ?? integrationCycleById.get(question.integration_request_id)!.origin_status}
                            </Badge>
                          )}
                        </div>
                        {question.risposta && (
                          <div className="mt-2 rounded-md bg-slate-50 border border-slate-200 px-3 py-2">
                            <p className="text-xs font-semibold text-muted-foreground mb-1">Risposta del cliente</p>
                            <p className="text-sm whitespace-pre-wrap">{question.risposta}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {clientBankPositions.length > 0 && (
                <Card className="border-indigo-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-indigo-600" />
                      Situazione banche dichiarata dal cliente ({clientBankPositions.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {clientBankPositions.map((position, index) => (
                        <div key={position.id} className="rounded-lg border border-border p-3">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-sm font-semibold">{index + 1}. {position.banca}</p>
                            {position.tipo_rapporto && <Badge variant="outline">{position.tipo_rapporto}</Badge>}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                            <div><span className="text-muted-foreground">Accordato:</span> <strong>{position.accordato != null ? `€ ${position.accordato.toLocaleString('it-IT')}` : '—'}</strong></div>
                            <div><span className="text-muted-foreground">Utilizzato:</span> <strong>{position.utilizzato != null ? `€ ${position.utilizzato.toLocaleString('it-IT')}` : '—'}</strong></div>
                            <div><span className="text-muted-foreground">Saldo:</span> <strong>{position.saldo != null ? `€ ${position.saldo.toLocaleString('it-IT')}` : '—'}</strong></div>
                          </div>
                          {position.note && <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap">{position.note}</p>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {documents.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Nessun documento richiesto
                </div>
              )}
            </TabsContent>

            <TabsContent value="banche" className="mt-3 space-y-3">
              {/* Banner informativo per agente/segnalatore */}
              {(isAgente || isSegnalatore) && (
                <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
                  <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>L'assegnazione e l'invio alle banche è gestita dalla <strong>segreteria</strong>. Di seguito puoi vedere a quale banca è stata assegnata questa pratica.</span>
                </div>
              )}
              {finPromoterChecklistVisible && (
                <Card className="border-indigo-200 bg-indigo-50/40">
                  <CardContent className="p-4 space-y-3">
                    <div>
                      <p className="text-sm font-semibold text-indigo-900">Checklist FinPromoter</p>
                      <p className="text-xs text-indigo-800/80 mt-0.5">
                        Tipologia rilevata: <strong>{checklistProfile.tipo === 'societa_capitali' ? 'società di capitali' : checklistProfile.tipo === 'societa_persone' ? 'società di persone' : checklistProfile.tipo === 'impresa_individuale' ? 'impresa individuale' : checklistProfile.tipo === 'cooperativa' ? 'società cooperativa' : 'da specificare'}</strong>.
                        {' '}I documenti condizionati vengono aggiunti solo se applicabili.
                      </p>
                    </div>
                    {(checklistProfile.tipo === 'societa_persone' || checklistProfile.tipo === 'impresa_individuale' || checklistProfile.tipo === 'sconosciuta') && (
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-indigo-900 whitespace-nowrap">Regime contabile</Label>
                        <Select
                          value={practice.regime_contabile ?? 'non_impostato'}
                          onValueChange={value => updateChecklistProfile({ regime_contabile: value === 'non_impostato' ? null : value as RegimeContabile })}
                        >
                          <SelectTrigger className="h-8 text-xs bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="non_impostato">Da specificare</SelectItem>
                            <SelectItem value="ordinaria">Contabilità ordinaria</SelectItem>
                            <SelectItem value="semplificata">Contabilità semplificata</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="grid sm:grid-cols-2 gap-2 text-xs">
                      {([
                        ['gruppo', 'Imprese collegate/associate'],
                        ['investimento', 'Pratica con investimento'],
                        ['garante', 'Presenza di garanti'],
                        ['mediazione', 'Presentata da mediatore'],
                        ['ammissione_socio', 'Ammissione a socio FinPromoter'],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-indigo-900">
                          <input
                            type="checkbox"
                            checked={Boolean(checklistProfile.condizioni[key])}
                            onChange={event => updateChecklistCondition(key, event.target.checked)}
                            className="rounded border-indigo-300"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    {addingBank && isFinPromoter(selectedAddingBank) && (
                      <div className="border-t border-indigo-200 pt-3">
                        <p className="text-xs font-semibold text-indigo-900 mb-1">
                          Documenti che verranno richiesti ({applicableAddingBankRequirements.length})
                        </p>
                        <ul className="space-y-0.5 text-xs text-indigo-900/80 list-disc pl-4 max-h-40 overflow-auto">
                          {applicableAddingBankRequirements.map(requirement => <li key={requirement.id}>{requirement.nome}</li>)}
                        </ul>
                        {applicableAddingBankRequirements.length === 0 && (
                          <p className="text-xs text-indigo-800/70">Configura i requisiti della banca nella pagina Banche.</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              {/* Assegna nuova banca — solo canApprove */}
              {canApprove && (
                <div className="flex gap-2">
                  <Select value={addingBank} onValueChange={setAddingBank}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Seleziona banca da assegnare..." /></SelectTrigger>
                    <SelectContent>
                      {banks.filter(b => !practiceBanks.some(pb => pb.bank_id === b.id)).map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button disabled={!addingBank} onClick={async () => {
                    await handleAssignBank();
                  }}>Assegna</Button>
                </div>
              )}

              {practiceBanks.length === 0 ? (
                <Card><CardContent className="py-10 text-center text-muted-foreground text-sm">
                  Nessuna banca assegnata. La segreteria assegna le banche dopo la raccolta dei documenti standard.
                </CardContent></Card>
              ) : (
                <div className="space-y-3">
                  {practiceBanks.map(pb => {
                    const bankEmail = pb.banks?.email_invio_banca || pb.banks?.email;
                    return (
                      <Card key={pb.id} className="border-border">
                        <CardContent className="py-3 px-4">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div>
                              <p className="font-semibold text-foreground">{pb.banks?.nome}</p>
                              <p className="text-xs text-muted-foreground">{bankEmail || 'Email non configurata'}</p>
                              {pb.data_invio && <p className="text-xs text-green-600 mt-0.5">✅ Inviata il {new Date(pb.data_invio).toLocaleDateString('it-IT')}</p>}
                              {pb.status_updated_at && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Stato aggiornato il {new Date(pb.status_updated_at).toLocaleString('it-IT')}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2 items-center">
                              {canApprove ? (
                                <div className="flex items-center gap-2">
                                  {updatingBankStatusId === pb.id && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                                  <Select
                                    value={pb.status}
                                    onValueChange={value => handlePracticeBankStatusChange(pb, value as PracticeBankStatus)}
                                    disabled={updatingBankStatusId === pb.id}
                                  >
                                    <SelectTrigger
                                      className={`h-8 min-w-[170px] text-xs font-medium border ${practiceBankStatusClass(pb.status)}`}
                                      aria-label={`Stato presso ${pb.banks?.nome}`}
                                    >
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {PRACTICE_BANK_STATUS_OPTIONS.map(option => (
                                        <SelectItem key={option.value} value={option.value}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              ) : (
                                <span className={`text-xs px-2 py-1 rounded-full border font-medium ${practiceBankStatusClass(pb.status)}`}>
                                  {PRACTICE_BANK_STATUS_LABELS[pb.status] ?? pb.status}
                                </span>
                              )}
                              {canApprove && (
                                bankEmail ? (
                                  <Button size="sm" variant="outline" className="gap-1.5 text-blue-700 border-blue-300 hover:bg-blue-50"
                                    onClick={() => { setBankNote(''); setShowSendBankDialog(pb.id); }}>
                                    ✉️ Invia
                                  </Button>
                                ) : (
                                  <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 cursor-help"
                                    title="Configura l'email di invio in Gestione Banche">
                                    ⚠️ Email mancante
                                  </span>
                                )
                              )}
                              {canApprove && (
                                <Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10 h-8 w-8 p-0"
                                  onClick={async () => {
                                    if (!confirm(`Rimuovere ${pb.banks?.nome} dalla pratica?`)) return;
                                    await supabase.from('practice_banks').delete().eq('id', pb.id);
                                    toast.success('Banca rimossa'); load();
                                  }}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Dialog invia a banca specifica */}
              {showSendBankDialog && (() => {
                const pb = practiceBanks.find(p => p.id === showSendBankDialog);
                if (!pb) return null;
                const bankEmail = pb.banks?.email_invio_banca || pb.banks?.email;
                return (
                  <Dialog open={true} onOpenChange={() => setShowSendBankDialog(null)}>
                    <DialogContent className="max-w-md">
                      <DialogHeader><DialogTitle>✉️ Invia a {pb.banks?.nome}</DialogTitle></DialogHeader>
                      <div className="space-y-3 py-2">
                        <p className="text-sm text-muted-foreground">Destinatario: <strong>{bankEmail}</strong></p>
                        <Textarea placeholder="Note per la banca (opzionale)..." rows={3} value={bankNote} onChange={e => setBankNote(e.target.value)} />
                        <div className="rounded-lg border border-purple-100 bg-purple-50 p-3 text-sm text-purple-800">
                          <span className="font-semibold">📄 Relazione commerciale:</span> Prima di inviare alla banca, puoi{' '}
                          <button
                            type="button"
                            onClick={() => { setShowSendBankDialog(null); setActiveTab('relazione'); }}
                            className="underline font-medium"
                          >
                            generare la relazione commerciale
                          </button>{' '}
                          nel tab dedicato.
                        </div>
                        <p className="text-xs text-muted-foreground">Verranno inviati i link firmati (7gg) a tutti i documenti. Lo stato sarà aggiornato.</p>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSendBankDialog(null)}>Annulla</Button>
                        <Button className="bg-blue-600 hover:bg-blue-700 gap-2" disabled={sendingBankId === pb.id}
                          onClick={async () => {
                            setSendingBankId(pb.id);
                            const { data, error } = await invokeSendToBank({ practice_id: practice!.id, bank_id: pb.bank_id, note: bankNote || null });
                            setSendingBankId(null);
                            if (error || !data?.success) { toast.error('Errore: ' + (error?.message ?? data?.error)); return; }
                            toast.success(`Pratica inviata a ${data.sent_to}!`);
                            setShowSendBankDialog(null); load();
                          }}>
                          {sendingBankId === pb.id ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>Invio...</> : '✉️ Invia'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                );
              })()}
            </TabsContent>

            <TabsContent value="finanziamenti" className="mt-3 space-y-3">
              {/* Header con pulsanti (solo canEdit) */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm text-muted-foreground">
                  {canEdit
                    ? 'Aggiungi manualmente o importa dalla Centrale Rischi.'
                    : 'Situazione finanziamenti in essere del cliente (sola lettura).'}
                </p>
                {canEdit && (
                  <div className="flex gap-2 flex-wrap">
                    {/* Carica Centrale Rischi */}
                    <label className="cursor-pointer">
                      <Button asChild size="sm" variant="outline" className="gap-1.5 pointer-events-none border-blue-300 text-blue-700 hover:bg-blue-50">
                        <span>
                          {crParsing
                            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Lettura CR…</>
                            : <><Upload className="w-3.5 h-3.5" />Carica Centrale Rischi</>}
                        </span>
                      </Button>
                      <input ref={crFileRef} type="file" accept="application/pdf" className="hidden"
                        disabled={crParsing}
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleCRFile(f); }} />
                    </label>
                    {/* Aggiungi manuale */}
                    <Button size="sm" variant="outline" className="gap-1.5"
                      onClick={() => setFinancing(prev => [...prev, {
                        id: crypto.randomUUID(), tipologia: '', banca_finanziaria: '',
                        importo_iniziale: '', rata: '', durata_mesi: '', debito_residuo: '', note: '',
                        fonte: 'manuale', _new: true, _dirty: true,
                      }])}>
                      <PlusCircle className="w-3.5 h-3.5" /> Aggiungi
                    </Button>
                  </div>
                )}
              </div>

              {financing.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground text-sm">
                    {canEdit
                      ? 'Nessun finanziamento. Clicca "Aggiungi finanziamento" per iniziare.'
                      : 'Nessun finanziamento inserito.'}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {financing.map((f, idx) => (
                    <Card key={f.id} className={`border ${f._dirty ? 'border-amber-300 bg-amber-50/30' : 'border-border'}`}>
                      <CardContent className="py-3 px-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                              Finanziamento {idx + 1}
                            </span>
                            {f.fonte === 'centrale_rischi' && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">
                                CR {f.data_riferimento}
                              </span>
                            )}
                          </div>
                          {canEdit && (
                            <Button size="sm" variant="ghost"
                              className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                              onClick={async () => {
                                if (!f._new && !confirm('Eliminare questo finanziamento?')) return;
                                if (!f._new) await supabase.from('client_financing').delete().eq('id', f.id);
                                setFinancing(prev => prev.filter((_, i) => i !== idx));
                              }}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          {/* Tipologia */}
                          <div className="col-span-2 sm:col-span-1">
                            <label className="text-xs text-muted-foreground font-medium mb-1 block">Tipologia *</label>
                            {canEdit ? (
                              <Select value={f.tipologia}
                                onValueChange={v => setFinancing(prev => prev.map((r, i) => i === idx ? { ...r, tipologia: v, _dirty: true } : r))}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                                <SelectContent>
                                  {TIPOLOGIE_FIN.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            ) : (
                              <p className="text-sm font-medium">{f.tipologia || '—'}</p>
                            )}
                          </div>

                          {/* Banca / Finanziaria */}
                          <div className="col-span-2 sm:col-span-1">
                            <label className="text-xs text-muted-foreground font-medium mb-1 block">Banca / Finanziaria</label>
                            {canEdit ? (
                              <Input className="h-8 text-sm" placeholder="es. Intesa Sanpaolo"
                                value={f.banca_finanziaria}
                                onChange={e => setFinancing(prev => prev.map((r, i) => i === idx ? { ...r, banca_finanziaria: e.target.value, _dirty: true } : r))} />
                            ) : (
                              <p className="text-sm">{f.banca_finanziaria || '—'}</p>
                            )}
                          </div>

                          {/* Importo iniziale */}
                          <div>
                            <label className="text-xs text-muted-foreground font-medium mb-1 block">Importo iniziale (€)</label>
                            {canEdit ? (
                              <Input className="h-8 text-sm" type="number" placeholder="0,00"
                                value={f.importo_iniziale}
                                onChange={e => setFinancing(prev => prev.map((r, i) => i === idx ? { ...r, importo_iniziale: e.target.value, _dirty: true } : r))} />
                            ) : (
                              <p className="text-sm">{f.importo_iniziale ? `€ ${parseFloat(f.importo_iniziale).toLocaleString('it-IT', { minimumFractionDigits: 2 })}` : '—'}</p>
                            )}
                          </div>

                          {/* Rata mensile */}
                          <div>
                            <label className="text-xs text-muted-foreground font-medium mb-1 block">Rata mensile (€)</label>
                            {canEdit ? (
                              <Input className="h-8 text-sm" type="number" placeholder="0,00"
                                value={f.rata}
                                onChange={e => setFinancing(prev => prev.map((r, i) => i === idx ? { ...r, rata: e.target.value, _dirty: true } : r))} />
                            ) : (
                              <p className="text-sm">{f.rata ? `€ ${parseFloat(f.rata).toLocaleString('it-IT', { minimumFractionDigits: 2 })}` : '—'}</p>
                            )}
                          </div>

                          {/* Durata */}
                          <div>
                            <label className="text-xs text-muted-foreground font-medium mb-1 block">Durata (mesi)</label>
                            {canEdit ? (
                              <Input className="h-8 text-sm" type="number" placeholder="es. 120"
                                value={f.durata_mesi}
                                onChange={e => setFinancing(prev => prev.map((r, i) => i === idx ? { ...r, durata_mesi: e.target.value, _dirty: true } : r))} />
                            ) : (
                              <p className="text-sm">{f.durata_mesi ? `${f.durata_mesi} mesi` : '—'}</p>
                            )}
                          </div>

                          {/* Debito residuo */}
                          <div>
                            <label className="text-xs text-muted-foreground font-medium mb-1 block">Debito residuo (€)</label>
                            {canEdit ? (
                              <Input className="h-8 text-sm" type="number" placeholder="0,00"
                                value={f.debito_residuo}
                                onChange={e => setFinancing(prev => prev.map((r, i) => i === idx ? { ...r, debito_residuo: e.target.value, _dirty: true } : r))} />
                            ) : (
                              <p className="text-sm font-semibold">{f.debito_residuo ? `€ ${parseFloat(f.debito_residuo).toLocaleString('it-IT', { minimumFractionDigits: 2 })}` : '—'}</p>
                            )}
                          </div>

                          {/* Note */}
                          <div className="col-span-2">
                            <label className="text-xs text-muted-foreground font-medium mb-1 block">Note</label>
                            {canEdit ? (
                              <Input className="h-8 text-sm" placeholder="Note aggiuntive..."
                                value={f.note}
                                onChange={e => setFinancing(prev => prev.map((r, i) => i === idx ? { ...r, note: e.target.value, _dirty: true } : r))} />
                            ) : (
                              <p className="text-sm text-muted-foreground">{f.note || '—'}</p>
                            )}
                          </div>
                        </div>

                        {/* Dati Centrale Rischi — solo se importata da CR */}
                        {f.fonte === 'centrale_rischi' && (
                          <div className="mt-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs">
                            <p className="font-semibold text-blue-700 mb-1.5 flex items-center gap-1">
                              <FileText className="w-3 h-3" /> Dati Centrale Rischi
                            </p>
                            <div className="grid grid-cols-4 gap-x-4 gap-y-1 text-blue-900">
                              <div><span className="text-blue-500">Accordato</span><br />
                                <strong>€ {f.accordato ? parseFloat(f.accordato).toLocaleString('it-IT') : '—'}</strong>
                              </div>
                              <div><span className="text-blue-500">Acc. Operativo</span><br />
                                <strong>€ {f.accordato_operativo ? parseFloat(f.accordato_operativo).toLocaleString('it-IT') : '—'}</strong>
                              </div>
                              <div><span className="text-blue-500">Utilizzato</span><br />
                                <strong>€ {f.utilizzato ? parseFloat(f.utilizzato).toLocaleString('it-IT') : '—'}</strong>
                              </div>
                              <div><span className="text-blue-500">Saldo Medio</span><br />
                                <strong>€ {f.saldo_medio ? parseFloat(f.saldo_medio).toLocaleString('it-IT') : '—'}</strong>
                              </div>
                              {f.tipo_garanzia && (
                                <div className="col-span-2 mt-0.5"><span className="text-blue-500">Garanzia</span><br />{f.tipo_garanzia}</div>
                              )}
                              {f.stato_rapporto && (
                                <div className="col-span-2 mt-0.5"><span className="text-blue-500">Stato</span><br />{f.stato_rapporto}</div>
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}

                  {/* Totali */}
                  <div className="flex gap-6 px-4 py-3 rounded-xl bg-blue-50 border border-blue-200 text-sm">
                    <div>
                      <span className="text-xs text-blue-600 font-medium uppercase">Tot. rate mensili</span>
                      <p className="font-bold text-blue-800">
                        € {financing.reduce((s, r) => s + (parseFloat(r.rata) || 0), 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-blue-600 font-medium uppercase">Tot. debito residuo</span>
                      <p className="font-bold text-blue-800">
                        € {financing.reduce((s, r) => s + (parseFloat(r.debito_residuo) || 0), 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {/* Pulsante salva (solo canEdit, solo se ci sono modifiche) */}
                  {canEdit && financing.some(r => r._dirty) && (
                    <Button className="w-full gap-2" disabled={savingFin}
                      onClick={async () => {
                        if (!id) return;
                        setSavingFin(true);
                        try {
                          for (let i = 0; i < financing.length; i++) {
                            const r = financing[i];
                            if (!r._dirty) continue;
                            const payload = {
                              practice_id: id,
                              tipologia: r.tipologia,
                              banca_finanziaria: r.banca_finanziaria || null,
                              importo_iniziale: parseFloat(r.importo_iniziale) || null,
                              rata: parseFloat(r.rata) || null,
                              durata_mesi: parseInt(r.durata_mesi) || null,
                              debito_residuo: parseFloat(r.debito_residuo) || null,
                              note: r.note || null,
                              ordinamento: i,
                              accordato: r.accordato ? parseFloat(r.accordato) : null,
                              accordato_operativo: r.accordato_operativo ? parseFloat(r.accordato_operativo) : null,
                              utilizzato: r.utilizzato ? parseFloat(r.utilizzato) : null,
                              saldo_medio: r.saldo_medio ? parseFloat(r.saldo_medio) : null,
                              tipo_garanzia: r.tipo_garanzia || null,
                              stato_rapporto: r.stato_rapporto || null,
                              data_riferimento: r.data_riferimento || null,
                              fonte: r.fonte || 'manuale',
                            };
                            if (r._new) {
                              const { data: ins } = await supabase.from('client_financing').insert(payload).select('id').single();
                              if (ins) setFinancing(prev => prev.map((row, idx) => idx === i ? { ...row, id: ins.id, _new: false, _dirty: false } : row));
                            } else {
                              await supabase.from('client_financing').update(payload).eq('id', r.id);
                              setFinancing(prev => prev.map((row, idx) => idx === i ? { ...row, _dirty: false } : row));
                            }
                          }
                          toast.success('Finanziamenti salvati!');
                        } catch {
                          toast.error('Errore nel salvataggio');
                        } finally {
                          setSavingFin(false);
                        }
                      }}>
                      <Save className="w-4 h-4" />
                      {savingFin ? 'Salvataggio...' : 'Salva finanziamenti'}
                    </Button>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="analisi" className="mt-3">
              {id && <AnalisiFinanziariaTab practiceId={id} />}
            </TabsContent>

            <TabsContent value="bancabilita" className="mt-3">
              {id && <BancabilitaTab practiceId={id} />}
            </TabsContent>

            <TabsContent value="reputazione" className="mt-3">
              {id && practice?.client_id && <ReputazioneTab practiceId={id} clientId={practice.client_id} />}
            </TabsContent>

            <TabsContent value="aml" className="mt-3">
              {id && <AmlReportTab practiceId={id} />}
            </TabsContent>

            <TabsContent value="log" className="mt-3">
              <div className="space-y-2">
                {logs.map(log => (
                  <div key={log.id} className="flex gap-3 items-start py-2">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {log.old_status && <Badge variant="outline" className="text-xs">{STATUS_LABELS[log.old_status as keyof typeof STATUS_LABELS] ?? log.old_status}</Badge>}
                        {log.old_status && <span className="text-xs text-muted-foreground">→</span>}
                        <Badge className={`text-xs ${STATUS_COLORS[log.new_status as keyof typeof STATUS_COLORS] ?? 'bg-muted text-muted-foreground'}`}>{STATUS_LABELS[log.new_status as keyof typeof STATUS_LABELS] ?? log.new_status}</Badge>
                      </div>
                      {log.note && <p className="text-xs text-muted-foreground mt-0.5">{log.note}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />{new Date(log.created_at).toLocaleString('it-IT')}
                      </p>
                    </div>
                  </div>
                ))}
                {logs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessun cambio di stato registrato</p>}
              </div>
            </TabsContent>

            {/* ── Tab Banche AI ── */}
            <TabsContent value="banche-ai" className="mt-3 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Compatibilità Banche (AI)</h3>
                  <p className="text-xs text-muted-foreground">Analisi automatica dei criteri di ogni banca rispetto ai KPI della pratica.</p>
                </div>
                <Button
                  size="sm"
                  className="gap-2 bg-blue-600 hover:bg-blue-700"
                  disabled={loadingMatching}
                  onClick={runMatching}
                >
                  {loadingMatching
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Analisi in corso…</>
                    : <><Building2 className="w-3.5 h-3.5" />Analizza Compatibilità Banche</>}
                </Button>
              </div>

              {!matchingResult && !loadingMatching && (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground text-sm">
                    <Building2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    Clicca "Analizza Compatibilità Banche" per avviare l'analisi AI.
                  </CardContent>
                </Card>
              )}

              {matchingResult && (() => {
                const bancheList = matchingResult.matching ?? matchingResult.banche ?? [];
                return (
                <div className="space-y-4">
                  {/* Analisi situazione societaria — sempre visibile */}
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-3 space-y-1">
                    <p className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5">
                      <span>📊</span> Analisi Situazione Societaria (AI)
                    </p>
                    <p className="text-sm text-indigo-900 leading-relaxed">
                      {matchingResult.analisi_societa
                        ? matchingResult.analisi_societa
                        : 'Analisi AI non disponibile — dati KPI insufficienti o bilancio non ancora caricato per questa pratica.'}
                    </p>
                  </div>
                  {/* Suggerimento operativo AI — sempre visibile */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 space-y-1">
                    <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
                      <span>🤖</span> Raccomandazione Operativa
                    </p>
                    <p className="text-sm text-blue-900 leading-relaxed">
                      {matchingResult.suggerimento_ai
                        ? matchingResult.suggerimento_ai
                        : 'Raccomandazione non disponibile — configurare i criteri KPI delle banche per ottenere suggerimenti personalizzati.'}
                    </p>
                  </div>
                  {/* Legenda */}
                  <div className="flex gap-4 text-xs text-muted-foreground px-1">
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-500 inline-block"/>≥70% Compatibile</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block"/>40-69% Parziale</span>
                    <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block"/>&lt;40% Non compatibile</span>
                  </div>
                  {bancheList.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">Nessuna banca con criteri configurati trovata.</p>
                  )}
                  {bancheList.map((banca, idx) => {
                    const sc = banca.score;
                    const barColor   = sc >= 70 ? 'bg-green-500'      : sc >= 40 ? 'bg-amber-500'      : 'bg-red-500';
                    const badgeColor = sc >= 70 ? 'bg-green-100 text-green-800 border-green-300' : sc >= 40 ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-red-100 text-red-800 border-red-300';
                    const cardBorder = sc >= 70 ? 'border-green-200'  : sc >= 40 ? 'border-amber-200'  : 'border-red-200';
                    const total = banca.passCount + banca.failCount + banca.ndCount;
                    const [open, setOpen] = [false, () => {}]; // placeholder — usiamo details nativo HTML
                    return (
                      <Card key={banca.bankId ?? idx} className={`border ${cardBorder}`}>
                        <CardContent className="py-3 px-4 space-y-3">
                          {/* Header: rank + nome + badge score */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <span className="w-6 h-6 rounded-full bg-muted text-xs font-bold flex items-center justify-center text-muted-foreground">
                                {idx + 1}
                              </span>
                              <Building2 className="w-4 h-4 text-muted-foreground" />
                              <p className="font-semibold text-sm">{banca.bankName ?? 'Banca sconosciuta'}</p>
                            </div>
                            <span className={`text-sm font-bold px-2.5 py-0.5 rounded-full border ${badgeColor}`}>
                              {sc}%
                            </span>
                          </div>
                          {/* Barra progresso */}
                          <div className="space-y-1">
                            <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${sc}%` }} />
                            </div>
                            <div className="flex justify-between text-[10px] text-muted-foreground">
                              <span>0%</span>
                              <span>Compatibilità KPI: {sc}% ({banca.passCount} su {total > 0 ? total : '?'} criteri)</span>
                              <span>100%</span>
                            </div>
                          </div>
                          {/* Contatori KPI */}
                          <div className="flex gap-3 text-xs">
                            <span className="flex items-center gap-1 text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5">
                              ✅ {banca.passCount} superati
                            </span>
                            <span className="flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5">
                              ❌ {banca.failCount} non superati
                            </span>
                            {banca.ndCount > 0 && (
                              <span className="flex items-center gap-1 text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-0.5">
                                — {banca.ndCount} N/D
                              </span>
                            )}
                          </div>
                          {/* Dettaglio criteri espandibile */}
                          {banca.details && banca.details.length > 0 && (
                            <details className="group">
                              <summary className="cursor-pointer text-xs text-primary underline decoration-dotted select-none list-none flex items-center gap-1">
                                <span className="group-open:hidden">▶ Mostra dettaglio criteri ({banca.details.length})</span>
                                <span className="hidden group-open:inline">▼ Nascondi criteri</span>
                              </summary>
                              <div className="mt-2 rounded-lg border border-border overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-muted/60">
                                      <th className="text-left px-2.5 py-1.5 font-semibold text-muted-foreground">Criterio</th>
                                      <th className="text-right px-2.5 py-1.5 font-semibold text-muted-foreground">Valore pratica</th>
                                      <th className="text-right px-2.5 py-1.5 font-semibold text-muted-foreground">Min richiesto</th>
                                      <th className="text-right px-2.5 py-1.5 font-semibold text-muted-foreground">Max richiesto</th>
                                      <th className="text-center px-2.5 py-1.5 font-semibold text-muted-foreground">Esito</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {banca.details.map((d, di) => (
                                      <tr key={di} className={di % 2 === 0 ? 'bg-white' : 'bg-muted/20'}>
                                        <td className="px-2.5 py-1.5 font-medium">{d.label}</td>
                                        <td className="px-2.5 py-1.5 text-right font-mono">
                                          {d.actual != null ? Number(d.actual).toFixed(2) : <span className="text-muted-foreground italic">N/D</span>}
                                        </td>
                                        <td className="px-2.5 py-1.5 text-right text-muted-foreground font-mono">
                                          {d.min != null ? d.min : '—'}
                                        </td>
                                        <td className="px-2.5 py-1.5 text-right text-muted-foreground font-mono">
                                          {d.max != null ? d.max : '—'}
                                        </td>
                                        <td className="px-2.5 py-1.5 text-center">
                                          {d.pass === true  && <span className="text-green-600 font-bold">✓</span>}
                                          {d.pass === false && <span className="text-red-600 font-bold">✗</span>}
                                          {d.pass === null  && <span className="text-slate-400">—</span>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          )}
                          {(!banca.details || banca.details.length === 0) && (
                            <p className="text-xs text-muted-foreground italic">Questa banca non ha criteri KPI configurati — compatibilità stimata al 70% di default.</p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
                );
              })()}
            </TabsContent>

            {/* ── Tab Scadenze ── */}
            <TabsContent value="scadenze" className="mt-3 space-y-4">
              {/* Form aggiunta scadenza */}
              {canEdit && (
                <Card className="border-border">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-primary" /> Aggiungi Scadenza
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2 sm:col-span-1 space-y-1.5">
                        <Label className="text-xs">Nome Documento *</Label>
                        <Input
                          placeholder="es. Visura camerale"
                          value={newDeadlineDoc}
                          onChange={e => setNewDeadlineDoc(e.target.value)}
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1 space-y-1.5">
                        <Label className="text-xs">Data Scadenza *</Label>
                        <Input
                          type="date"
                          value={newDeadlineDate}
                          onChange={e => setNewDeadlineDate(e.target.value)}
                        />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label className="text-xs">Note (opzionale)</Label>
                        <Input
                          placeholder="Note aggiuntive..."
                          value={newDeadlineNote}
                          onChange={e => setNewDeadlineNote(e.target.value)}
                        />
                      </div>
                    </div>
                    <Button size="sm" className="gap-1.5" disabled={savingDeadline} onClick={addDeadline}>
                      {savingDeadline ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      Aggiungi Scadenza
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Lista scadenze */}
              {deadlines.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-muted-foreground text-sm">
                    <Calendar className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Nessuna scadenza registrata
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {deadlines.map(dl => {
                    const badge = getDeadlineBadge(dl.data_scadenza);
                    return (
                      <Card key={dl.id} className="border-border">
                        <CardContent className="py-3 px-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium">{dl.documento}</p>
                                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${badge.color}`}>
                                  {badge.label}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(dl.data_scadenza).toLocaleDateString('it-IT')}
                              </p>
                              {dl.note && (
                                <p className="text-xs text-muted-foreground mt-0.5">{dl.note}</p>
                              )}
                            </div>
                            {canEdit && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 shrink-0"
                                onClick={() => deleteDeadline(dl.id)}
                                title="Elimina scadenza"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ── Tab Genera Documento ── */}
            <TabsContent value="genera-doc" className="mt-3 space-y-4">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Layout className="w-4 h-4 text-primary" /> Genera Documento da Template
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Scegli un template, caricalo con i dati della pratica, modifica il testo e scarica il PDF.
                </p>
              </div>

              {/* Selezione template */}
              <div className="flex gap-2 flex-wrap items-end">
                <div className="flex-1 min-w-[200px] space-y-1.5">
                  <Label className="text-xs">Template</Label>
                  <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                    <SelectTrigger>
                      <SelectValue placeholder={loadingDocTemplates ? 'Caricamento...' : 'Seleziona un template...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {docTemplates.length === 0 && (
                        <SelectItem value="__none__" disabled>
                          Nessun template disponibile — creane uno in "Template Documenti"
                        </SelectItem>
                      )}
                      {docTemplates.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  disabled={!selectedTemplateId || loadingTemplate}
                  onClick={handleLoadTemplate}
                  className="gap-2 shrink-0"
                >
                  {loadingTemplate
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Caricamento...</>
                    : <><FileText className="w-3.5 h-3.5" />Carica Template</>}
                </Button>
              </div>

              {/* Variabili usate */}
              {generatedText && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
                  <strong>Dati compilati automaticamente:</strong> ragione sociale, numero pratica, importo, agente, data, città, codice ATECO.
                  Le variabili non riconosciute restano nel formato <code className="bg-blue-100 px-1 rounded font-mono">{'{{variabile}}'}</code>.
                </div>
              )}

              {/* Textarea documento */}
              {generatedText !== '' || selectedTemplateId ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Testo documento (modificabile)</Label>
                  <Textarea
                    rows={16}
                    className="font-mono text-sm leading-relaxed"
                    placeholder="Il documento generato apparirà qui..."
                    value={generatedText}
                    onChange={e => setGeneratedText(e.target.value)}
                  />
                </div>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground text-sm">
                    <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    Seleziona un template e clicca "Carica Template" per generare il documento.
                    {docTemplates.length === 0 && (
                      <p className="mt-2 text-xs">
                        Nessun template disponibile.{' '}
                        <a href="#/admin/template-documenti" className="text-primary underline">
                          Crea il primo template →
                        </a>
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Azioni export */}
              {generatedText && (
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="default"
                    className="gap-2"
                    onClick={handleExportPdf}
                  >
                    <FileDown className="w-4 h-4" /> Esporta PDF
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={handleCopyText}
                  >
                    <ClipboardCopy className="w-4 h-4" /> Copia testo
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground text-xs ml-auto"
                    onClick={() => { setGeneratedText(''); setSelectedTemplateId(''); }}
                  >
                    Azzera
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── Tab Relazione Commerciale ── */}
            <TabsContent value="relazione" className="mt-3">
              {id && (
                <RelazioneTab
                  practiceId={id}
                  clientId={practice?.client_id ?? ''}
                  canEdit={canEdit}
                  role={isSuperAdmin ? 'super_admin' : isSegreteria ? 'segreteria' : isAgente ? 'agente' : isSegnalatore ? 'segnalatore' : ''}
                />
              )}
            </TabsContent>

            {/* ── Tab Timeline Attività ── */}
            <TabsContent value="timeline" className="mt-3">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Timeline Attività</h3>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadActivityLogs} disabled={loadingActivity}>
                  <RefreshCw className={`w-3 h-3 ${loadingActivity ? 'animate-spin' : ''}`} /> Aggiorna
                </Button>
              </div>

              {loadingActivity && (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {!loadingActivity && activityLogs.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Nessuna attività registrata per questa pratica
                </div>
              )}

              {!loadingActivity && activityLogs.length > 0 && (
                <div className="space-y-0">
                  {activityLogs.map((log, idx) => {
                    // Icona per tipo azione
                    const isStato = log.action.toLowerCase().includes('stato');
                    const isDoc = log.action.toLowerCase().includes('document') || log.action.toLowerCase().includes('caric');
                    const isNota = log.action.toLowerCase().includes('nota') || log.action.toLowerCase().includes('note');
                    const isBanca = log.action.toLowerCase().includes('banca');
                    const iconColor = isStato ? 'text-blue-600 bg-blue-100' : isDoc ? 'text-green-600 bg-green-100' : isNota ? 'text-purple-600 bg-purple-100' : isBanca ? 'text-amber-600 bg-amber-100' : 'text-muted-foreground bg-muted';
                    const Icon = isStato ? RefreshCw : isDoc ? FileText : isNota ? MessageSquare : isBanca ? Building2 : Clock;

                    return (
                      <div key={log.id} className="flex gap-3 relative">
                        {/* Linea verticale */}
                        {idx < activityLogs.length - 1 && (
                          <div className="absolute left-[18px] top-8 bottom-0 w-px bg-border" />
                        )}
                        {/* Icona */}
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 z-10 ${iconColor}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        {/* Contenuto */}
                        <div className="flex-1 pb-4 min-w-0">
                          <p className="text-sm font-medium text-foreground">{log.action}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {log.actor_nome && (
                              <span className="text-xs text-muted-foreground">{log.actor_nome}</span>
                            )}
                            {log.actor_ruolo && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground capitalize">{log.actor_ruolo}</span>
                            )}
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(log.created_at).toLocaleString('it-IT')}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>

            {/* ── Tab Note Interne ── */}
            <TabsContent value="note" className="mt-3 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><StickyNote className="w-4 h-4 text-purple-500"/>Note Interne</h3>
                <span className="text-xs text-muted-foreground">Visibili solo al team interno</span>
              </div>
              {/* Aggiungi nota */}
              <Card className="border-purple-100 bg-purple-50/30">
                <CardContent className="pt-3 pb-3 space-y-2">
                  <Textarea placeholder="Scrivi una nota interna..." value={newNoteText} onChange={e => setNewNoteText(e.target.value)} rows={3} className="resize-none text-sm" />
                  <Button size="sm" onClick={addNote} disabled={savingNote || !newNoteText.trim()} className="gap-1.5">
                    <Save className="w-3.5 h-3.5"/> {savingNote ? 'Salvataggio...' : 'Aggiungi Nota'}
                  </Button>
                </CardContent>
              </Card>
              {loadingNotes && <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>}
              {!loadingNotes && notes.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-20"/>Nessuna nota interna
                </div>
              )}
              {notes.map(note => (
                <div key={note.id} className={`rounded-lg border p-3 space-y-1.5 ${note.pinned ? 'border-amber-200 bg-amber-50' : 'border-border bg-card'}`}>
                  <p className="text-sm whitespace-pre-wrap">{note.testo}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {note.autore_nome && <span>👤 {note.autore_nome}</span>}
                      {note.autore_ruolo && <span className="capitalize bg-muted px-1.5 py-0.5 rounded-full">{note.autore_ruolo}</span>}
                      <span>{new Date(note.created_at).toLocaleString('it-IT', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => togglePinNote(note.id, note.pinned)} className="p-1 hover:bg-accent rounded" title={note.pinned ? 'Rimuovi pin' : 'Appunta'}>
                        <Pin className={`w-3.5 h-3.5 ${note.pinned ? 'text-amber-500' : 'text-muted-foreground'}`}/>
                      </button>
                      <button onClick={() => deleteNote(note.id)} className="p-1 hover:bg-red-50 rounded" title="Elimina">
                        <Trash2 className="w-3.5 h-3.5 text-red-400"/>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </TabsContent>

            {/* ── Tab Task ── */}
            <TabsContent value="task" className="mt-3 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><CheckSquare className="w-4 h-4 text-blue-500"/>Task</h3>
              </div>
              {/* Aggiungi task */}
              <Card className="border-blue-100 bg-blue-50/30">
                <CardContent className="pt-3 pb-3 space-y-2">
                  <Input placeholder="Titolo task..." value={newTaskTitolo} onChange={e => setNewTaskTitolo(e.target.value)} className="text-sm"/>
                  <div className="flex gap-2">
                    <Input type="date" value={newTaskScadenza} onChange={e => setNewTaskScadenza(e.target.value)} className="text-sm flex-1"/>
                    <Select value={newTaskPriorita} onValueChange={setNewTaskPriorita}>
                      <SelectTrigger className="w-28 text-sm"><SelectValue/></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alta">🔴 Alta</SelectItem>
                        <SelectItem value="media">🟡 Media</SelectItem>
                        <SelectItem value="bassa">🟢 Bassa</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" onClick={addTask} disabled={savingTask || !newTaskTitolo.trim()} className="gap-1.5">
                    <Plus className="w-3.5 h-3.5"/> {savingTask ? 'Salvataggio...' : 'Aggiungi Task'}
                  </Button>
                </CardContent>
              </Card>
              {loadingTasks && <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>}
              {!loadingTasks && practiceTasks.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-20"/>Nessun task per questa pratica
                </div>
              )}
              {practiceTasks.map(task => {
                const today = new Date().toISOString().split('T')[0];
                const isScaduto = task.scadenza && task.scadenza < today && task.stato !== 'completata';
                return (
                  <div key={task.id} className={`flex items-start gap-3 p-3 rounded-lg border ${isScaduto ? 'border-red-200 bg-red-50' : 'border-border'}`}>
                    <button onClick={() => updateTaskStato(task.id, task.stato === 'completata' ? 'aperta' : 'completata')}
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${task.stato === 'completata' ? 'bg-green-500 border-green-500' : 'border-border hover:border-primary'}`}>
                      {task.stato === 'completata' && <CheckCircle className="w-3 h-3 text-white"/>}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${task.stato === 'completata' ? 'line-through text-muted-foreground' : ''}`}>{task.titolo}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-muted-foreground">
                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${task.priorita === 'alta' ? 'bg-red-100 text-red-700' : task.priorita === 'media' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{task.priorita}</span>
                        {task.scadenza && <span className={isScaduto ? 'text-red-600 font-semibold' : ''}><Clock className="w-3 h-3 inline mr-0.5"/>{new Date(task.scadenza+'T00:00:00').toLocaleDateString('it-IT')}{isScaduto && ' ⚠'}</span>}
                        {task.assegnato_nome && <span>👤 {task.assegnato_nome}</span>}
                      </div>
                    </div>
                    <Badge className={`text-[10px] shrink-0 ${task.stato === 'completata' ? 'bg-green-100 text-green-800' : task.stato === 'in_corso' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>{task.stato.replace('_',' ')}</Badge>
                  </div>
                );
              })}
            </TabsContent>

            {/* ── Tab Storico Invii Banca ── */}
            <TabsContent value="email-log" className="mt-3 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><Mail className="w-4 h-4 text-blue-500"/>Storico Invii Banca</h3>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadEmailLog} disabled={loadingEmailLog}>
                  <RefreshCw className={`w-3 h-3 ${loadingEmailLog ? 'animate-spin' : ''}`}/> Aggiorna
                </Button>
              </div>
              {loadingEmailLog && <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>}
              {!loadingEmailLog && emailLogs.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Mail className="w-8 h-8 mx-auto mb-2 opacity-20"/>Nessun invio banca registrato per questa pratica
                </div>
              )}
              {!loadingEmailLog && emailLogs.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Data invio</th>
                        <th className="px-3 py-2 text-left font-medium">Banca</th>
                        <th className="px-3 py-2 text-left font-medium">Oggetto</th>
                        <th className="px-3 py-2 text-left font-medium">Stato</th>
                        <th className="px-3 py-2 text-left font-medium">Aperta il</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {emailLogs.map(log => {
                        const statusClass = log.stato === 'consegnata' ? 'bg-emerald-100 text-emerald-800'
                          : log.stato === 'aperta' ? 'bg-blue-100 text-blue-800'
                          : log.stato === 'cliccata' ? 'bg-indigo-100 text-indigo-800'
                          : log.stato === 'rimbalzata' || log.stato === 'spam' || log.stato === 'errore' ? 'bg-red-100 text-red-800'
                          : 'bg-amber-100 text-amber-800';
                        return (
                          <tr key={log.id} className="align-top">
                            <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                              {new Date(log.created_at).toLocaleString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                            </td>
                            <td className="px-3 py-2 min-w-[150px]">
                              <div className="font-medium text-foreground">{log.bank_nome ?? 'Banca'}</div>
                              {log.destinatari && <div className="text-[11px] text-muted-foreground">A: {log.destinatari.join(', ')}</div>}
                              {log.cc && log.cc.length > 0 && <div className="text-[11px] text-muted-foreground">CC: {log.cc.join(', ')}</div>}
                            </td>
                            <td className="px-3 py-2 min-w-[220px] text-xs text-muted-foreground">
                              {log.delivery_type === 'approfondimento' && (
                                <Badge variant="outline" className="mb-1 text-[10px] border-indigo-200 text-indigo-700">
                                  Approfondimento
                                </Badge>
                              )}
                              <div>{log.oggetto ?? '—'}</div>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <Badge className={`text-[10px] ${statusClass}`}>{log.stato}</Badge>
                              {log.delivered_at && <div className="mt-1 text-[11px] text-emerald-700">Consegnata: {new Date(log.delivered_at).toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</div>}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                              {log.opened_at ? new Date(log.opened_at).toLocaleString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            {/* ── CHECKLIST DOCUMENTALE ──────────────────────────────────── */}
            <TabsContent value="checklist" className="mt-3 space-y-3">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold flex items-center gap-1.5"><ListChecks className="w-4 h-4 text-blue-500"/>Checklist Documentale</h3>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={loadChecklist} disabled={loadingChecklist}>
                  <RefreshCw className={`w-3 h-3 ${loadingChecklist ? 'animate-spin' : ''}`}/> Aggiorna
                </Button>
              </div>

              {/* Applica template */}
              {checklistTemplates.length > 0 && (
                <div className="flex gap-2 items-center p-3 bg-muted/30 rounded-lg">
                  <select className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs" value={selectedTplId} onChange={e => setSelectedTplId(e.target.value)}>
                    <option value="">— Seleziona template da applicare —</option>
                    {checklistTemplates.map(t => <option key={t.id} value={t.id}>{t.nome}{t.tipo_pratica ? ` (${t.tipo_pratica})` : ''}</option>)}
                  </select>
                  <Button size="sm" className="h-8 text-xs gap-1.5" onClick={applyTemplate} disabled={!selectedTplId}>
                    <Plus className="w-3 h-3"/> Applica
                  </Button>
                </div>
              )}

              {/* Riepilogo completamento */}
              {checklistItems.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                  <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div className="h-1.5 rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${(checklistItems.filter(i=>i.completata).length / checklistItems.length) * 100}%` }} />
                  </div>
                  <span className="shrink-0 font-medium">{checklistItems.filter(i=>i.completata).length}/{checklistItems.length} completati</span>
                </div>
              )}

              {/* Lista voci */}
              {loadingChecklist && <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"/></div>}
              {!loadingChecklist && checklistItems.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <ListChecks className="w-8 h-8 mx-auto mb-2 opacity-20"/>Nessuna voce — applica un template o aggiunge voci manualmente
                </div>
              )}
              {checklistItems.map(item => (
                <div key={item.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${item.completata ? 'bg-emerald-50/50 border-emerald-200' : 'border-border'}`}>
                  <button onClick={() => toggleChecklistItem(item.id, item.completata)} className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${item.completata ? 'bg-emerald-500 border-emerald-500' : 'border-muted-foreground/40 hover:border-primary'}`}>
                    {item.completata && <CheckCircle className="w-3 h-3 text-white"/>}
                  </button>
                  <span className={`flex-1 text-sm ${item.completata ? 'line-through text-muted-foreground' : ''}`}>{item.nome}</span>
                  {item.obbligatorio && <Badge className="text-[10px] bg-red-100 text-red-700 shrink-0">Obbl.</Badge>}
                  <button onClick={() => deleteChecklistItem(item.id)} className="p-1 hover:bg-red-50 rounded text-red-400 shrink-0">
                    <Trash2 className="w-3 h-3"/>
                  </button>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="estratto-conto" className="mt-3">
              <EstrattoConto practiceId={practice.id} />
            </TabsContent>

          </Tabs>
        </div>
      </div>
      {/* Dialog riassegna agente */}
      <Dialog open={showReassign} onOpenChange={(open) => { if (!savingReassign) { setShowReassign(open); if (!open) setReassignTo(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>👤 Riassegna Pratica</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {isSegreteria && agentsForReassign.length === 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3">
                Nessun agente associato al tuo profilo. Contatta il super admin per aggiungere agenti.
              </p>
            )}
            {isSegreteria && agentsForReassign.length > 0 && (
              <p className="text-xs text-muted-foreground">Puoi assegnare la pratica solo ai tuoi agenti.</p>
            )}
            {isSuperAdmin && (
              <p className="text-xs text-muted-foreground">Seleziona l'utente a cui assegnare questa pratica. Il salvataggio avviene automaticamente.</p>
            )}
            <Select value={reassignTo} onValueChange={handleReassignSelect} disabled={savingReassign}>
              <SelectTrigger>
                {savingReassign
                  ? <span className="flex items-center gap-2 text-muted-foreground"><span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin inline-block" />Salvataggio…</span>
                  : <SelectValue placeholder="Seleziona utente…" />
                }
              </SelectTrigger>
              <SelectContent>
                {isSuperAdmin && <SelectItem value="nessuno">— Rimuovi assegnazione —</SelectItem>}
                {agentsForReassign.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.nome || a.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowReassign(false); setReassignTo(''); }} disabled={savingReassign}>Annulla</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog modifica dati cliente e pratica */}
      <Dialog open={showClientEdit} onOpenChange={v => { if (!savingClientEdit) setShowClientEdit(v); }}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-4 h-4 text-primary" />
              Modifica dati cliente e richiesta
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dati societari</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Ragione Sociale *</Label>
                  <Input value={clientEditForm.ragione_sociale}
                    onChange={e => setClientEditForm(f => ({ ...f, ragione_sociale: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label>P.IVA</Label>
                  <Input value={clientEditForm.piva}
                    onChange={e => setClientEditForm(f => ({ ...f, piva: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label>Codice Fiscale</Label>
                  <Input value={clientEditForm.codice_fiscale}
                    onChange={e => setClientEditForm(f => ({ ...f, codice_fiscale: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />Email *</Label>
                  <Input type="email" placeholder="info@azienda.it" value={clientEditForm.email}
                    onChange={e => setClientEditForm(f => ({ ...f, email: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />Telefono</Label>
                  <Input placeholder="+39 02 1234567" value={clientEditForm.telefono}
                    onChange={e => setClientEditForm(f => ({ ...f, telefono: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Indirizzo sede</Label>
                  <Input value={clientEditForm.indirizzo}
                    onChange={e => setClientEditForm(f => ({ ...f, indirizzo: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label>Provincia</Label>
                  <Input maxLength={5} placeholder="MI" value={clientEditForm.provincia}
                    onChange={e => setClientEditForm(f => ({ ...f, provincia: e.target.value.toUpperCase() }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label>Data costituzione</Label>
                  <Input placeholder="gg/mm/aaaa" value={clientEditForm.data_costituzione}
                    onChange={e => setClientEditForm(f => ({ ...f, data_costituzione: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label>Forma giuridica</Label>
                  <Input placeholder="S.r.l." value={clientEditForm.forma_giuridica}
                    onChange={e => setClientEditForm(f => ({ ...f, forma_giuridica: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label>Capitale sociale (€)</Label>
                  <Input inputMode="decimal" placeholder="10.000,00" value={clientEditForm.capitale_sociale}
                    onChange={e => setClientEditForm(f => ({ ...f, capitale_sociale: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label>Capitale sociale versato (€)</Label>
                  <Input inputMode="decimal" placeholder="10.000,00" value={clientEditForm.capitale_sociale_versato}
                    onChange={e => setClientEditForm(f => ({ ...f, capitale_sociale_versato: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tipologia azienda per checklist</Label>
                  <Select
                    value={clientEditForm.tipologia_azienda}
                    onValueChange={value => setClientEditForm(f => ({ ...f, tipologia_azienda: value as ClientEditForm['tipologia_azienda'] }))}
                    disabled={savingClientEdit}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Rileva dalla forma giuridica</SelectItem>
                      <SelectItem value="societa_capitali">Società di capitali</SelectItem>
                      <SelectItem value="societa_persone">Società di persone</SelectItem>
                      <SelectItem value="impresa_individuale">Impresa individuale</SelectItem>
                      <SelectItem value="cooperativa">Società cooperativa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(clientEditForm.tipologia_azienda === 'societa_persone' || clientEditForm.tipologia_azienda === 'impresa_individuale' || clientEditForm.tipologia_azienda === 'auto') && (
                  <div className="space-y-1.5">
                    <Label>Regime contabile</Label>
                    <Select
                      value={clientEditForm.regime_contabile || 'non_impostato'}
                      onValueChange={value => setClientEditForm(f => ({ ...f, regime_contabile: value === 'non_impostato' ? '' : value as 'ordinaria' | 'semplificata' }))}
                      disabled={savingClientEdit}
                    >
                      <SelectTrigger><SelectValue placeholder="Seleziona regime" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="non_impostato">Da specificare</SelectItem>
                        <SelectItem value="ordinaria">Contabilità ordinaria</SelectItem>
                        <SelectItem value="semplificata">Contabilità semplificata</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </section>

            <section className="space-y-3 border-t border-border pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">ATECO e richiesta</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Codice ATECO</Label>
                  <Input className="font-mono" placeholder="47.11" value={clientEditForm.codice_ateco}
                    onChange={e => setClientEditForm(f => ({ ...f, codice_ateco: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="space-y-1.5">
                  <Label>Importo richiesto (€)</Label>
                  <Input inputMode="decimal" placeholder="150.000,00" value={clientEditForm.importo_richiesto}
                    onChange={e => setClientEditForm(f => ({ ...f, importo_richiesto: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Descrizione ATECO</Label>
                  <Input value={clientEditForm.ateco_descrizione}
                    onChange={e => setClientEditForm(f => ({ ...f, ateco_descrizione: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label>Motivazione della richiesta</Label>
                  <Textarea value={clientEditForm.motivazione}
                    onChange={e => setClientEditForm(f => ({ ...f, motivazione: e.target.value }))}
                    disabled={savingClientEdit} />
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Soci / titolari ({clientEditForm.soci.length})
                </p>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                  onClick={() => setClientEditForm(f => ({
                    ...f,
                    soci: [...f.soci, { nome: '', codice_fiscale: '', valore: '', percentuale: '' }],
                  }))}
                  disabled={savingClientEdit}>
                  <Plus className="w-3 h-3" /> Aggiungi
                </Button>
              </div>
              {clientEditForm.soci.length === 0 ? (
                <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3 text-center">Nessun socio inserito.</p>
              ) : clientEditForm.soci.map((socio, index) => (
                <div key={index} className="grid sm:grid-cols-2 gap-2 rounded-lg border border-border p-3">
                  <Input placeholder="Nome / denominazione" value={socio.nome}
                    onChange={e => setClientEditForm(f => ({ ...f, soci: f.soci.map((item, i) => i === index ? { ...item, nome: e.target.value } : item) }))}
                    disabled={savingClientEdit} />
                  <Input className="font-mono" placeholder="Codice fiscale" value={socio.codice_fiscale}
                    onChange={e => setClientEditForm(f => ({ ...f, soci: f.soci.map((item, i) => i === index ? { ...item, codice_fiscale: e.target.value } : item) }))}
                    disabled={savingClientEdit} />
                  <Input placeholder="Valore quota" value={socio.valore}
                    onChange={e => setClientEditForm(f => ({ ...f, soci: f.soci.map((item, i) => i === index ? { ...item, valore: e.target.value } : item) }))}
                    disabled={savingClientEdit} />
                  <div className="flex gap-2">
                    <Input placeholder="Percentuale" value={socio.percentuale}
                      onChange={e => setClientEditForm(f => ({ ...f, soci: f.soci.map((item, i) => i === index ? { ...item, percentuale: e.target.value } : item) }))}
                      disabled={savingClientEdit} />
                    <Button type="button" variant="ghost" size="sm" className="shrink-0 text-destructive"
                      onClick={() => setClientEditForm(f => ({ ...f, soci: f.soci.filter((_, i) => i !== index) }))}
                      disabled={savingClientEdit} aria-label="Rimuovi socio">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </section>

            <section className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Amministratori ({clientEditForm.amministratori.length})
                </p>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                  onClick={() => setClientEditForm(f => ({
                    ...f,
                    amministratori: [...f.amministratori, { nome: '', carica: '', codice_fiscale: '' }],
                  }))}
                  disabled={savingClientEdit}>
                  <Plus className="w-3 h-3" /> Aggiungi
                </Button>
              </div>
              {clientEditForm.amministratori.length === 0 ? (
                <p className="text-xs text-muted-foreground border border-dashed rounded-md p-3 text-center">Nessun amministratore inserito.</p>
              ) : clientEditForm.amministratori.map((amministratore, index) => (
                <div key={index} className="grid sm:grid-cols-2 gap-2 rounded-lg border border-border p-3">
                  <Input placeholder="Nome" value={amministratore.nome}
                    onChange={e => setClientEditForm(f => ({ ...f, amministratori: f.amministratori.map((item, i) => i === index ? { ...item, nome: e.target.value } : item) }))}
                    disabled={savingClientEdit} />
                  <Input placeholder="Carica" value={amministratore.carica}
                    onChange={e => setClientEditForm(f => ({ ...f, amministratori: f.amministratori.map((item, i) => i === index ? { ...item, carica: e.target.value } : item) }))}
                    disabled={savingClientEdit} />
                  <Input className="sm:col-span-2 font-mono" placeholder="Codice fiscale" value={amministratore.codice_fiscale ?? ''}
                    onChange={e => setClientEditForm(f => ({ ...f, amministratori: f.amministratori.map((item, i) => i === index ? { ...item, codice_fiscale: e.target.value } : item) }))}
                    disabled={savingClientEdit} />
                  <Button type="button" variant="ghost" size="sm" className="sm:col-span-2 justify-self-end text-destructive"
                    onClick={() => setClientEditForm(f => ({ ...f, amministratori: f.amministratori.filter((_, i) => i !== index) }))}
                    disabled={savingClientEdit}>
                    <Trash2 className="w-4 h-4 mr-1.5" /> Rimuovi
                  </Button>
                </div>
              ))}
            </section>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClientEdit(false)} disabled={savingClientEdit}>Annulla</Button>
            <Button onClick={handleSaveClientData} disabled={savingClientEdit || !clientEditForm.ragione_sociale.trim() || !clientEditForm.email.trim()}>
              {savingClientEdit ? 'Salvataggio…' : 'Salva modifiche'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cambio stato */}
      <Dialog open={showStatusChange} onOpenChange={(open) => { setShowStatusChange(open); if (!open) { setNoteDeclino(''); setStatusNote(''); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cambia fase generale della pratica</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
              Questa modifica riguarda la fase complessiva della pratica. Gli stati delle singole banche si modificano separatamente nel tab Banche.
            </div>
            <div className="space-y-2">
              <Label>Nuova fase generale</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIMARY_STATUS_OPTIONS.map(status => (
                    <SelectItem key={status} value={status}>{STATUS_LABELS[status]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {newStatus === 'declinata' ? (
              <div className="space-y-2">
                <Label>Motivo del declino *</Label>
                <Textarea
                  placeholder="Inserisci il motivo del declino (verrà registrato nella pratica)..."
                  rows={4}
                  value={noteDeclino}
                  onChange={e => setNoteDeclino(e.target.value)}
                  className="border-red-200 focus:ring-red-400"
                />
                <p className="text-xs text-muted-foreground">Le note di declino vengono salvate nella pratica e visibili agli agenti.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Note (opzionale)</Label>
                <Textarea placeholder="Aggiungi una nota per questo cambio di stato..." rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowStatusChange(false); setNoteDeclino(''); setStatusNote(''); }}>Annulla</Button>
            <Button
              onClick={handleStatusChange}
              disabled={saving || (newStatus === 'declinata' && !noteDeclino.trim())}
              className={newStatus === 'declinata' ? 'bg-red-600 hover:bg-red-700' : ''}>
              {saving ? 'Salvataggio...' : newStatus === 'declinata' ? 'Declina Pratica' : 'Conferma'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog aggiungi doc */}
      <Dialog open={showAddDoc} onOpenChange={setShowAddDoc}>
        <DialogContent>
          <DialogHeader><DialogTitle>Aggiungi Documento Richiesto</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome Documento *</Label>
              <Input placeholder="es. Dichiarazione dei redditi 2023" value={newDocName} onChange={e => setNewDocName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Descrizione (opzionale)</Label>
              <Textarea placeholder="Istruzioni per il cliente..." rows={2} value={newDocDesc} onChange={e => setNewDocDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDoc(false)}>Annulla</Button>
            <Button onClick={handleAddDoc} disabled={saving}>Aggiungi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog integrazione */}
      <Dialog
        open={showIntegration}
        onOpenChange={open => {
          setShowIntegration(open);
          if (!open) setIntegrationPracticeBankId('none');
        }}
      >
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Prepara richiesta documentale</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Aggiungi più documenti e domande in una sola volta. Il cliente riceverà l'elenco completo solo quando userai il pulsante verde “Invia Richiesta Documenti”.
          </p>
          <div className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
            <Label htmlFor="integration-bank">Banca che ha richiesto l’approfondimento</Label>
            <Select value={integrationPracticeBankId} onValueChange={setIntegrationPracticeBankId}>
              <SelectTrigger id="integration-bank" className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nessuna banca — richiesta interna del consulente</SelectItem>
                {practiceBanks.map(practiceBank => (
                  <SelectItem key={practiceBank.id} value={practiceBank.id}>
                    {practiceBank.banks?.nome} · {PRACTICE_BANK_STATUS_LABELS[practiceBank.status] ?? practiceBank.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Se scegli una banca, i documenti caricati per questa richiesta potranno essere inoltrati soltanto a quella banca con il pulsante “Invia approfondimenti”.
            </p>
          </div>
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            La richiesta sarà collegata alla fase <strong>{STATUS_LABELS[
              normalizePrimaryStatus(practice?.status ?? 'raccolta_documenti')
            ]}</strong>. La fase principale della pratica non verrà modificata.
          </div>

          <div className="space-y-6 py-2">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Documenti da integrare</p>
                  <p className="text-xs text-muted-foreground">Ogni voce diventerà un caricamento separato nel Portale Cliente.</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setIntegrationRequests(prev => [...prev, { nome: '', descrizione: '' }])}
                >
                  <Plus className="w-3.5 h-3.5" /> Aggiungi
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setIntegrationRequests(prev => (
                    prev.some(request => request.nome.trim().toLocaleLowerCase('it-IT') === 'finanziamenti in essere')
                      ? prev
                      : [...prev.filter(request => request.nome.trim() || request.descrizione.trim()), {
                        nome: 'Finanziamenti in essere',
                        descrizione: 'Compilare la tabella con tutti i finanziamenti attivi.',
                      }]
                  ))}
                >
                  + Finanziamenti in essere
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setIntegrationRequests(prev => (
                    prev.some(request => request.nome.trim().toLocaleLowerCase('it-IT') === 'situazione banche')
                      ? prev
                      : [...prev.filter(request => request.nome.trim() || request.descrizione.trim()), {
                        nome: 'Situazione banche',
                        descrizione: 'Compilare la tabella con i rapporti bancari in essere.',
                      }]
                  ))}
                >
                  + Situazione banche
                </Button>
              </div>

              <div className="space-y-3">
                {integrationRequests.map((request, index) => (
                  <div key={index} className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <Label>Documento {index + 1}</Label>
                      {integrationRequests.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          onClick={() => setIntegrationRequests(prev => prev.filter((_, rowIndex) => rowIndex !== index))}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Rimuovi
                        </Button>
                      )}
                    </div>
                    <Input
                      placeholder="es. Contratto di finanziamento"
                      value={request.nome}
                      onChange={event => setIntegrationRequests(prev => prev.map((row, rowIndex) => (
                        rowIndex === index ? { ...row, nome: event.target.value } : row
                      )))}
                    />
                    <Textarea
                      placeholder="Descrizione o istruzioni per il cliente (opzionale)"
                      rows={2}
                      value={request.descrizione}
                      onChange={event => setIntegrationRequests(prev => prev.map((row, rowIndex) => (
                        rowIndex === index ? { ...row, descrizione: event.target.value } : row
                      )))}
                    />
                  </div>
                ))}
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Domande al cliente</p>
                  <p className="text-xs text-muted-foreground">Il cliente troverà una casella di risposta separata per ogni domanda.</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => setIntegrationQuestions(prev => [...prev, ''])}
                >
                  <Plus className="w-3.5 h-3.5" /> Aggiungi
                </Button>
              </div>

              <div className="space-y-3">
                {integrationQuestions.map((question, index) => (
                  <div key={index} className="rounded-lg border border-border p-3 bg-muted/20">
                    <div className="flex items-center justify-between mb-2">
                      <Label>Domanda {index + 1}</Label>
                      {integrationQuestions.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          onClick={() => setIntegrationQuestions(prev => prev.filter((_, rowIndex) => rowIndex !== index))}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Rimuovi
                        </Button>
                      )}
                    </div>
                    <Textarea
                      placeholder="es. A quale finalità sarà destinato il finanziamento richiesto?"
                      rows={2}
                      value={question}
                      onChange={event => setIntegrationQuestions(prev => prev.map((row, rowIndex) => (
                        rowIndex === index ? event.target.value : row
                      )))}
                    />
                  </div>
                ))}
              </div>
            </section>

            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Dopo il salvataggio, premi “Invia Richiesta Documenti” nel riquadro Portale Cliente per spedire una sola email con tutti gli elementi ancora mancanti.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIntegration(false)}>Annulla</Button>
            <Button onClick={handleAddIntegration} disabled={saving} className="bg-amber-600 hover:bg-amber-700">
              {saving ? 'Salvataggio...' : 'Aggiungi alla richiesta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Dialog sollecita cliente */}
      {showSollecita && (() => {
        const docMancanti = documents.filter(d => d.status === 'richiesto');
        const docRifiutati = documents.filter(d => d.status === 'rifiutato');
        return (
          <Dialog open={true} onOpenChange={() => setShowSollecita(false)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-orange-600" /> Sollecita Cliente
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-2 text-sm">
                <p className="text-muted-foreground">
                  Verrà inviata un'email a <strong>{(practice as Practice & { clients?: { email: string } }).clients?.email}</strong> con il riepilogo dei documenti da caricare.
                </p>
                {docMancanti.length > 0 && (
                  <div>
                    <p className="font-semibold text-amber-700 mb-1">📋 Da caricare ({docMancanti.length})</p>
                    <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
                      {docMancanti.map(d => <li key={d.id}>{d.nome}</li>)}
                    </ul>
                  </div>
                )}
                {docRifiutati.length > 0 && (
                  <div>
                    <p className="font-semibold text-red-700 mb-1">❌ Da ricaricare ({docRifiutati.length})</p>
                    <ul className="space-y-1">
                      {docRifiutati.map(d => (
                        <li key={d.id} className="bg-red-50 rounded px-2 py-1">
                          <span className="font-medium">{d.nome}</span>
                          {d.note_rifiuto && <span className="block text-xs text-red-600">Motivo: {d.note_rifiuto}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowSollecita(false)}>Annulla</Button>
                <Button
                  className="bg-orange-600 hover:bg-orange-700 gap-2"
                  disabled={sollecitando}
                  onClick={async () => {
                    setSollecitando(true);
                    const { data, error } = await supabase.functions.invoke('sollecita-cliente', {
                      body: { practice_id: practice!.id },
                    });
                    setSollecitando(false);
                    if (error || !data?.success) {
                      toast.error('Errore: ' + (error?.message ?? data?.error));
                      return;
                    }
                    toast.success(`Sollecito inviato a ${data.sent_to} (${data.mancanti} mancanti, ${data.rifiutati} rifiutati)`);
                    setShowSollecita(false);
                  }}>
                  {sollecitando
                    ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Invio...</>
                    : <><BellRing className="w-4 h-4" />Invia Sollecito</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Dialog rifiuto documento */}
      <Dialog open={!!showRejectDoc} onOpenChange={() => setShowRejectDoc(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rifiuta Documento</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Motivo del rifiuto *</Label>
            <Textarea placeholder="Spiega al cliente cosa non va e cosa deve caricare..." rows={3} value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDoc(null)}>Annulla</Button>
            <Button variant="destructive" onClick={rejectDoc}>Rifiuta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog preview Centrale Rischi ── */}
      <Dialog open={!!crPreview} onOpenChange={v => { if (!v) setCrPreview(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600" />
              Centrale Rischi — {crDate}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Trovati <strong>{crPreview?.length ?? 0} finanziamenti</strong> nella sezione "Crediti per cassa".
            Verifica i dati e clicca <strong>Importa</strong> per aggiungerli alla pratica.
          </p>
          <div className="rounded-md border border-border overflow-hidden text-xs">
            <table className="w-full">
              <thead className="bg-muted/60">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Banca</th>
                  <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Categoria</th>
                  <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Accordato</th>
                  <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Acc. Op.</th>
                  <th className="text-right px-2 py-1.5 font-medium text-muted-foreground">Utilizzato</th>
                  <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Garanzia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(crPreview ?? []).map((r, i) => (
                  <tr key={i} className="bg-background hover:bg-muted/20">
                    <td className="px-2 py-1.5 font-medium max-w-[180px] truncate" title={r.banca}>{r.banca}</td>
                    <td className="px-2 py-1.5 text-blue-700">{r.categoria}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.accordato.toLocaleString('it-IT')}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{r.accordato_operativo.toLocaleString('it-IT')}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold">{r.utilizzato.toLocaleString('it-IT')}</td>
                    <td className="px-2 py-1.5 text-muted-foreground max-w-[140px] truncate" title={r.tipo_garanzia}>{r.tipo_garanzia || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
            ⚠ I finanziamenti importati vengono aggiunti a quelli esistenti. Dopo l'importazione clicca <strong>"Salva finanziamenti"</strong>.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCrPreview(null)}>Annulla</Button>
            <Button onClick={confirmCRImport} disabled={crImporting} className="gap-2">
              {crImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Importa {crPreview?.length ?? 0} finanziamenti
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
