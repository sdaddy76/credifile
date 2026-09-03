import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { uploadPracticeFile } from '@/lib/uploadFile';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  FileText, Upload, CheckCircle2, Clock, AlertCircle,
  LogOut, PlusCircle, Trash2, Save, FileDown, Loader2,
  Check, MessageSquare, Building2, ShieldCheck, LockKeyhole,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  STATUS_LABELS, STATUS_COLORS,
  type Practice, type PracticeDocument, type PracticeStatusLog, type PracticeStatus,
} from '@/lib/types';

interface ClientSession {
  practiceId: string;
  codice: string;
  email: string;
}

const PRIVACY_CONSENT_VERSION = '2026-09-03-v1';
const PRIVACY_CONSENT_TEXT = `Dichiaro di aver preso visione dell'informativa privacy relativa alla pratica e, in qualità di interessato e/o legale rappresentante della società, autorizzo il consulente o intermediario incaricato a raccogliere, trattare e trasmettere alle banche e agli intermediari finanziari coinvolti nella valutazione della pratica i documenti e le informazioni personali, societarie, economiche e finanziarie da me caricati, esclusivamente per l'istruttoria, la valutazione e l'eventuale perfezionamento della richiesta di finanziamento. Dichiaro inoltre di essere autorizzato a comunicare eventuali dati di terzi contenuti nei documenti. Sono informato che l'autorizzazione può essere revocata per i trattamenti basati sul consenso, senza pregiudicare la liceità dei trattamenti già effettuati, contattando il consulente che gestisce la pratica.`;

const isFinancingRequestDocument = (doc: PracticeDocument) => {
  const normalizedName = doc.nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('it-IT');

  return normalizedName.includes('finanziament')
    && (
      normalizedName.includes('essere')
      || normalizedName.includes('attiv')
      || normalizedName.includes('situazione')
    );
};

const isBankSituationRequestDocument = (doc: PracticeDocument) => {
  const normalizedName = doc.nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('it-IT');

  return normalizedName.includes('situazione')
    && normalizedName.includes('banc');
};

export default function ClientPortalPage() {
  const { practiceId } = useParams<{ practiceId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<ClientSession | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [documents, setDocuments] = useState<PracticeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [privacyConsentRecordId, setPrivacyConsentRecordId] = useState<string | null>(null);
  const [privacyConsentAcceptedAt, setPrivacyConsentAcceptedAt] = useState<string | null>(null);
  const [privacyConsentChecked, setPrivacyConsentChecked] = useState(false);
  const [savingPrivacyConsent, setSavingPrivacyConsent] = useState(false);

  // ── Storico stati pratica ────────────────────────────────────────────────
  const [statusLogs, setStatusLogs] = useState<PracticeStatusLog[]>([]);

  // ── Upload autonomo (free-form, non legato a un practice_document) ────────
  const [uploadingFreeDoc, setUploadingFreeDoc] = useState(false);
  const freeUploadRef = useRef<HTMLInputElement | null>(null);

  // ── Moduli banca ─────────────────────────────────────────────────────────
  interface BankModulo { id: string; bank_id: string; nome: string; descrizione: string | null; file_path: string }
  interface CompilatoRecord { id: string; modulo_id: string; file_path: string; uploaded_at: string }
  const [bankModuli,   setBankModuli]   = useState<BankModulo[]>([]);
  const [compilati,    setCompilati]    = useState<CompilatoRecord[]>([]);
  const [uploadingMod, setUploadingMod] = useState<string | null>(null);

  // ── Finanziamenti in essere ──
  interface Financing {
    id?: string;
    tipologia: string;
    banca_finanziaria: string;
    importo_iniziale: string;
    rata: string;
    durata_mesi: string;
    debito_residuo: string;
    note: string;
    _dirty?: boolean;
    _new?: boolean;
  }
  const [financing, setFinancing] = useState<Financing[]>([]);
  const [savingFin, setSavingFin] = useState(false);

  // ── Domande dell'agente ──────────────────────────────────────────────────
  interface ClientQuestion {
    id: string;
    domanda: string;
    risposta: string | null;
    stato: 'richiesta' | 'risposta';
    answered_at: string | null;
  }
  const [clientQuestions, setClientQuestions] = useState<ClientQuestion[]>([]);
  const [savingQuestionId, setSavingQuestionId] = useState<string | null>(null);

  // ── Situazione banche ────────────────────────────────────────────────────
  interface ClientBankPosition {
    id?: string;
    banca: string;
    tipo_rapporto: string;
    accordato: string;
    utilizzato: string;
    saldo: string;
    note: string;
    _dirty?: boolean;
    _new?: boolean;
  }
  const [clientBanks, setClientBanks] = useState<ClientBankPosition[]>([]);
  const [savingClientBanks, setSavingClientBanks] = useState(false);

  const BANK_RELATIONSHIP_TYPES = [
    'Conto corrente',
    'Fido / apertura di credito',
    'Anticipo fatture / SBF',
    'Mutuo',
    'Leasing',
    'Prestito',
    'Carta di credito',
    'Altro',
  ];

  const TIPOLOGIE = [
    'Mutuo ipotecario', 'Prestito personale', 'Cessione del quinto',
    'Leasing auto', 'Leasing strumentale', 'Apertura di credito',
    'Fido bancario', 'Carta di credito revolving', 'Altro',
  ];

  const loadFinancing = async () => {
    if (!practiceId) return;
    const { data } = await supabase
      .from('client_financing')
      .select('*')
      .eq('practice_id', practiceId)
      .order('ordinamento');
    setFinancing((data ?? []).map(r => ({
      id: r.id,
      tipologia: r.tipologia ?? '',
      banca_finanziaria: r.banca_finanziaria ?? '',
      importo_iniziale: r.importo_iniziale?.toString() ?? '',
      rata: r.rata?.toString() ?? '',
      durata_mesi: r.durata_mesi?.toString() ?? '',
      debito_residuo: r.debito_residuo?.toString() ?? '',
      note: r.note ?? '',
    })));
  };

  const updateQuestionAnswer = (questionId: string, value: string) => {
    setClientQuestions(prev => prev.map(question => (
      question.id === questionId ? { ...question, risposta: value } : question
    )));
  };

  const saveQuestionAnswer = async (question: ClientQuestion) => {
    if (!privacyConsentAcceptedAt) {
      toast.error('Accetta prima l’autorizzazione privacy');
      return;
    }
    const answer = question.risposta?.trim() ?? '';
    if (!answer) {
      toast.error('Inserisci una risposta prima di salvare');
      return;
    }
    setSavingQuestionId(question.id);
    try {
      const { error } = await supabase
        .from('practice_client_questions')
        .update({
          risposta: answer,
          stato: 'risposta',
          answered_at: new Date().toISOString(),
        })
        .eq('id', question.id)
        .eq('practice_id', practiceId);
      if (error) throw error;
      setClientQuestions(prev => prev.map(item => (
        item.id === question.id ? { ...item, risposta: answer, stato: 'risposta' } : item
      )));
      toast.success('Risposta salvata');
    } catch (error) {
      toast.error('Errore salvataggio risposta: ' + String(error));
    } finally {
      setSavingQuestionId(null);
    }
  };

  const updateClientBank = (index: number, field: keyof ClientBankPosition, value: string) => {
    setClientBanks(prev => prev.map((row, rowIndex) => (
      rowIndex === index ? { ...row, [field]: value, _dirty: true } : row
    )));
  };

  const addClientBank = () => {
    setClientBanks(prev => [...prev, {
      banca: '',
      tipo_rapporto: '',
      accordato: '',
      utilizzato: '',
      saldo: '',
      note: '',
      _new: true,
      _dirty: true,
    }]);
  };

  const removeClientBank = async (index: number) => {
    const row = clientBanks[index];
    try {
      if (row.id) {
        const { error } = await supabase
          .from('practice_client_banks')
          .delete()
          .eq('id', row.id)
          .eq('practice_id', practiceId);
        if (error) throw error;
      }
      setClientBanks(prev => prev.filter((_, rowIndex) => rowIndex !== index));
      toast.success('Rapporto bancario eliminato');
    } catch (error) {
      toast.error('Errore eliminazione: ' + String(error));
    }
  };

  const saveClientBankSituation = async () => {
    if (!practiceId) return;
    if (!privacyConsentAcceptedAt) {
      toast.error('Accetta prima l’autorizzazione privacy');
      return;
    }
    const incompleteRow = clientBanks.find(row => !row.banca.trim());
    if (incompleteRow) {
      toast.error('Indica il nome della banca in ogni riga');
      return;
    }

    setSavingClientBanks(true);
    try {
      for (let index = 0; index < clientBanks.length; index++) {
        const row = clientBanks[index];
        if (!row._dirty) continue;
        const payload = {
          practice_id: practiceId,
          banca: row.banca.trim(),
          tipo_rapporto: row.tipo_rapporto || null,
          accordato: row.accordato ? parseFloat(row.accordato) : null,
          utilizzato: row.utilizzato ? parseFloat(row.utilizzato) : null,
          saldo: row.saldo ? parseFloat(row.saldo) : null,
          note: row.note.trim() || null,
          ordinamento: index,
        };
        if (row.id) {
          const { error } = await supabase
            .from('practice_client_banks')
            .update(payload)
            .eq('id', row.id)
            .eq('practice_id', practiceId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('practice_client_banks').insert(payload);
          if (error) throw error;
        }
      }

      const pendingBankDocumentIds = documents
        .filter(isBankSituationRequestDocument)
        .filter(doc => doc.status === 'richiesto' || doc.status === 'rifiutato')
        .map(doc => doc.id);

      if (pendingBankDocumentIds.length > 0) {
        const { error } = await supabase
          .from('practice_documents')
          .update({
            status: 'caricato',
            uploaded_at: new Date().toISOString(),
            note_rifiuto: null,
          })
          .in('id', pendingBankDocumentIds);
        if (error) throw error;
      }

      await load();
      toast.success(
        clientBanks.length > 0
          ? 'Situazione banche salvata'
          : 'Assenza di rapporti bancari confermata'
      );
    } catch (error) {
      toast.error('Errore salvataggio situazione banche: ' + String(error));
    } finally {
      setSavingClientBanks(false);
    }
  };

  const updateFinRow = (idx: number, field: keyof Financing, val: string) => {
    setFinancing(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val, _dirty: true } : r));
  };

  const addFinRow = () => {
    setFinancing(prev => [...prev, {
      tipologia: '', banca_finanziaria: '', importo_iniziale: '', rata: '', durata_mesi: '', debito_residuo: '', note: '', _new: true, _dirty: true,
    }]);
  };

  const removeFinRow = async (idx: number) => {
    const row = financing[idx];
    if (row.id) {
      await supabase.from('client_financing').delete().eq('id', row.id);
    }
    setFinancing(prev => prev.filter((_, i) => i !== idx));
    toast.success('Riga eliminata');
  };

  const saveFinancing = async () => {
    if (!practiceId) return;
    if (!privacyConsentAcceptedAt) {
      toast.error('Accetta prima l’autorizzazione privacy');
      return;
    }
    setSavingFin(true);
    try {
      for (let i = 0; i < financing.length; i++) {
        const r = financing[i];
        if (!r._dirty) continue;
        const payload = {
          practice_id: practiceId,
          tipologia: r.tipologia,
          banca_finanziaria: r.banca_finanziaria || null,
          importo_iniziale: r.importo_iniziale ? parseFloat(r.importo_iniziale) : null,
          rata: r.rata ? parseFloat(r.rata) : null,
          durata_mesi: r.durata_mesi ? parseInt(r.durata_mesi) : null,
          debito_residuo: r.debito_residuo ? parseFloat(r.debito_residuo) : null,
          note: r.note || null,
          ordinamento: i,
        };
        if (r.id) {
          const { error } = await supabase.from('client_financing').update(payload).eq('id', r.id);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.from('client_financing').insert(payload).select('id').single();
          if (error) throw error;
          if (data?.id) {
            setFinancing(prev => prev.map((row, idx) => idx === i ? { ...row, id: data.id, _new: false, _dirty: false } : row));
          }
        }
      }

      const pendingFinancingDocumentIds = documents
        .filter(isFinancingRequestDocument)
        .filter(doc => doc.status === 'richiesto' || doc.status === 'rifiutato')
        .map(doc => doc.id);

      if (pendingFinancingDocumentIds.length > 0) {
        const { error } = await supabase
          .from('practice_documents')
          .update({
            status: 'caricato',
            uploaded_at: new Date().toISOString(),
            note_rifiuto: null,
          })
          .in('id', pendingFinancingDocumentIds);
        if (error) throw error;
      }

      setFinancing(prev => prev.map(r => ({ ...r, _dirty: false, _new: false })));
      await load();
      toast.success(
        financing.length > 0
          ? 'Finanziamenti salvati!'
          : 'Assenza di finanziamenti confermata!'
      );
    } catch (e) { toast.error('Errore salvataggio: ' + String(e)); }
    setSavingFin(false);
  };

  // Verifica sessione
  useEffect(() => {
    const raw = sessionStorage.getItem('docflow_client');
    if (!raw) { navigate('/accesso'); return; }
    const s: ClientSession = JSON.parse(raw);
    if (s.practiceId !== practiceId) { navigate('/accesso'); return; }
    setSession(s);
  }, [practiceId, navigate]);

  const load = async () => {
    if (!practiceId || !session) return;
    const [p, docs, pbRes, logsRes, questionsRes, clientBanksRes, accessRes] = await Promise.all([
      supabase.from('practices').select('*, clients(ragione_sociale,email), banks(nome)').eq('id', practiceId).single(),
      supabase.from('practice_documents').select('*, uploaded_files(*)').eq('practice_id', practiceId).order('tipo').order('created_at'),
      supabase.from('practice_banks').select('bank_id').eq('practice_id', practiceId),
      supabase.from('practice_status_log').select('*').eq('practice_id', practiceId).order('created_at', { ascending: true }),
      supabase.from('practice_client_questions').select('*').eq('practice_id', practiceId).order('created_at'),
      supabase.from('practice_client_banks').select('*').eq('practice_id', practiceId).order('ordinamento'),
      supabase
        .from('practice_access_codes')
        .select('id, privacy_consent_accepted_at, privacy_consent_version')
        .eq('practice_id', practiceId)
        .eq('codice', session.codice)
        .eq('email_cliente', session.email)
        .maybeSingle(),
    ]);
    setPractice(p.data as Practice);
    setDocuments((docs.data ?? []) as PracticeDocument[]);
    setStatusLogs((logsRes.data ?? []) as PracticeStatusLog[]);
    setClientQuestions((questionsRes.data ?? []) as ClientQuestion[]);
    setClientBanks((clientBanksRes.data ?? []).map(row => ({
      id: row.id,
      banca: row.banca ?? '',
      tipo_rapporto: row.tipo_rapporto ?? '',
      accordato: row.accordato != null ? String(row.accordato) : '',
      utilizzato: row.utilizzato != null ? String(row.utilizzato) : '',
      saldo: row.saldo != null ? String(row.saldo) : '',
      note: row.note ?? '',
      _dirty: false,
      _new: false,
    })));
    setPrivacyConsentRecordId(accessRes.data?.id ?? null);
    setPrivacyConsentAcceptedAt(
      accessRes.data?.privacy_consent_version === PRIVACY_CONSENT_VERSION
        ? accessRes.data?.privacy_consent_accepted_at ?? null
        : null
    );
    const bankIds = (pbRes.data ?? []).map((r: { bank_id: string }) => r.bank_id);
    if (bankIds.length > 0) {
      const [modRes, compRes] = await Promise.all([
        supabase.from('bank_moduli').select('*').in('bank_id', bankIds),
        supabase.from('practice_moduli_compilati').select('*').eq('practice_id', practiceId),
      ]);
      setBankModuli((modRes.data ?? []) as BankModulo[]);
      setCompilati((compRes.data ?? []) as CompilatoRecord[]);
    }
    setLoading(false);
    loadFinancing();
  };

  const downloadModuloTemplate = async (filePath: string, nome: string) => {
    const { data } = await supabase.storage.from('bank-moduli').createSignedUrl(filePath, 300);
    if (!data?.signedUrl) { toast.error('Impossibile scaricare il template'); return; }
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = nome; a.click();
  };

  const uploadCompilatoClient = async (moduloId: string, file: File) => {
    if (!practiceId) return;
    if (!privacyConsentAcceptedAt) {
      toast.error('Accetta prima l’autorizzazione privacy');
      return;
    }
    setUploadingMod(moduloId);
    const ext  = file.name.split('.').pop() ?? 'pdf';
    const path = `${practiceId}/${moduloId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('practice-files').upload(path, file, { upsert: false });
    if (upErr) { toast.error('Errore upload: ' + upErr.message); setUploadingMod(null); return; }
    await supabase.from('practice_moduli_compilati').insert({
      practice_id: practiceId, modulo_id: moduloId, file_path: path, uploaded_by: null,
    });
    toast.success('Modulo caricato con successo!');
    setUploadingMod(null);
    load();
  };

  useEffect(() => { if (session) load(); }, [session]);

  const handleFileUpload = async (docId: string, file: File) => {
    if (!practiceId) return;
    if (!privacyConsentAcceptedAt) {
      toast.error('Accetta prima l’autorizzazione privacy');
      return;
    }
    setUploadingDoc(docId);

    try {
      const result = await uploadPracticeFile({
        practiceId,
        practiceDocumentId: docId,
        file,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        uploadedBy: 'cliente',
      });

      if (result.error || !result.path) {
        toast.error(`Errore caricamento "${file.name}": ${result.error?.message ?? 'errore sconosciuto'}`);
        return;
      }

      // Aggiorna stato documento
      await supabase.from('practice_documents').update({
        status: 'caricato',
        uploaded_at: new Date().toISOString(),
      }).eq('id', docId);

      toast.success(`"${file.name}" caricato con successo!`);
      load();
    } finally {
      setUploadingDoc(null);
    }
  };

  const handleFileSelect = (docId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 30 * 1024 * 1024) { toast.error('File troppo grande. Massimo 30 MB.'); return; }
      handleFileUpload(docId, file);
    }
    e.target.value = '';
  };

  const handleLogout = () => {
    sessionStorage.removeItem('docflow_client');
    navigate('/accesso');
  };

  // ── Upload documento libero (non legato a practice_document) ─────────────
  const handleFreeDocUpload = async (file: File) => {
    if (!practiceId) return;
    if (!privacyConsentAcceptedAt) {
      toast.error('Accetta prima l’autorizzazione privacy');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      toast.error('File troppo grande. Massimo 30 MB.');
      return;
    }
    setUploadingFreeDoc(true);
    try {
      const result = await uploadPracticeFile({
        practiceId,
        file,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        uploadedBy: 'cliente',
        prefix: 'cliente',
      });

      if (result.error || !result.path) {
        throw result.error ?? new Error('errore sconosciuto');
      }

      toast.success(`"${file.name}" caricato con successo!`);
      load();
    } catch (e) {
      toast.error('Errore caricamento: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setUploadingFreeDoc(false);
    }
  };

  const acceptPrivacyConsent = async () => {
    if (!privacyConsentRecordId || !session || !privacyConsentChecked) {
      toast.error('Seleziona la casella di autorizzazione per continuare');
      return;
    }

    setSavingPrivacyConsent(true);
    const acceptedAt = new Date().toISOString();
    try {
      const { data, error } = await supabase
        .from('practice_access_codes')
        .update({
          privacy_consent_accepted_at: acceptedAt,
          privacy_consent_version: PRIVACY_CONSENT_VERSION,
          privacy_consent_text: PRIVACY_CONSENT_TEXT,
          privacy_consent_email: session.email,
          privacy_consent_user_agent: navigator.userAgent,
        })
        .eq('id', privacyConsentRecordId)
        .eq('practice_id', session.practiceId)
        .eq('codice', session.codice)
        .eq('email_cliente', session.email)
        .select('id')
        .single();
      if (error) throw error;
      if (!data?.id) throw new Error('Codice di accesso non trovato');

      setPrivacyConsentAcceptedAt(acceptedAt);
      setPrivacyConsentChecked(false);
      toast.success('Autorizzazione registrata. Ora puoi caricare i documenti.');
    } catch (error) {
      toast.error('Errore durante il salvataggio dell’autorizzazione: ' + String(error));
    } finally {
      setSavingPrivacyConsent(false);
    }
  };

  if (loading || !session) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Caricamento pratica...</p>
      </div>
    </div>
  );

  if (!practice) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Pratica non trovata.</p>
    </div>
  );

  const client = (practice as Practice & { clients?: { ragione_sociale: string } }).clients;
  const bank = (practice as Practice & { banks?: { nome: string } }).banks;

  const totalDocs = documents.length;
  const completedDocs = documents.filter(d => d.status === 'caricato' || d.status === 'approvato').length;
  const progressPct = totalDocs > 0 ? Math.round((completedDocs / totalDocs) * 100) : 0;

  const financingRequestDocs = documents.filter(isFinancingRequestDocument);
  const bankSituationRequestDocs = documents.filter(isBankSituationRequestDocument);
  const uploadDocuments = documents.filter(doc => (
    !isFinancingRequestDocument(doc) && !isBankSituationRequestDocument(doc)
  ));
  const showFinancingSection = financingRequestDocs.length > 0;
  const financingRequestCompleted = showFinancingSection
    && financingRequestDocs.every(doc => doc.status === 'caricato' || doc.status === 'approvato');
  const showBankSituationSection = bankSituationRequestDocs.length > 0;
  const bankSituationCompleted = showBankSituationSection
    && bankSituationRequestDocs.every(doc => doc.status === 'caricato' || doc.status === 'approvato');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-foreground truncate">{client?.ragione_sociale}</p>
            <p className="text-xs text-muted-foreground font-mono">{practice.numero_pratica}</p>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={handleLogout}>
            <LogOut className="w-3.5 h-3.5" /> Esci
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Stato pratica */}
        <Card className="border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Stato Pratica</p>
                <Badge className={`mt-1 ${STATUS_COLORS[practice.status]}`}>
                  {STATUS_LABELS[practice.status]}
                </Badge>
              </div>
              {bank && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Banca</p>
                  <p className="text-sm font-medium text-foreground">{bank.nome}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Documenti caricati</span>
                <span className="font-semibold text-foreground">{completedDocs} / {totalDocs}</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <p className="text-xs text-muted-foreground text-right">{progressPct}% completato</p>
            </div>

            {practice.status === 'integrazioni_richieste' && (
              <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  <strong>Attenzione:</strong> La banca ha richiesto documenti aggiuntivi.
                  Scorri in basso per vedere cosa manca.
                </p>
              </div>
            )}

            {practice.status === 'approvata' && (
              <div className="mt-3 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <p className="text-sm text-green-800 font-medium">Pratica approvata! 🎉</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Stepper stati pratica ───────────────────────────────────────── */}
        {(() => {
          const STEPS: { key: PracticeStatus; label: string }[] = [
            { key: 'bozza',                  label: 'Bozza' },
            { key: 'raccolta_documenti',      label: 'Raccolta Documenti' },
            { key: 'inviata_banca',           label: 'Inviata Banca' },
            { key: 'integrazioni_richieste',  label: 'In Valutazione' },
            { key: 'approvata',               label: 'Approvata / Declinata' },
          ];

          const STATUS_MESSAGES: Partial<Record<PracticeStatus, string>> = {
            bozza:               '📝 La pratica è in fase di configurazione da parte del tuo agente.',
            raccolta_documenti:  '📂 Stiamo raccogliendo la documentazione necessaria. Carica i documenti richiesti qui sotto.',
            inviata_banca:       '🏦 La pratica è stata inviata alla banca. Attendiamo una risposta.',
            integrazioni_richieste: '🔍 La banca sta valutando la tua richiesta. Ti aggiorneremo appena disponibile.',
            approvata:           '✅ Complimenti! La tua pratica è stata approvata.',
            declinata:           '❌ Purtroppo la pratica è stata declinata. Contatta il tuo agente per ulteriori informazioni.',
          };

          // Trova l'indice dello stato corrente nell'array STEPS
          const currentKey = practice.status;
          const currentIdx = STEPS.findIndex(s => s.key === currentKey);
          // Se lo stato non è in STEPS (es. declinata/integrazioni) mostra l'ultimo step evidenziato
          const displayIdx = currentIdx === -1 ? STEPS.length - 1 : currentIdx;

          return (
            <Card className="border-border">
              <CardContent className="pt-5 pb-5">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">
                  Avanzamento Pratica
                </p>

                {/* Stepper orizzontale su md, verticale su mobile */}
                <div className="flex flex-col gap-0">
                  {STEPS.map((step, idx) => {
                    const log = statusLogs.find(l => l.new_status === step.key);
                    const isCurrent = idx === displayIdx;
                    const isPast    = idx < displayIdx;
                    const isFuture  = idx > displayIdx;

                    return (
                      <div key={step.key} className="flex items-start gap-3">
                        {/* Icona + linea verticale */}
                        <div className="flex flex-col items-center">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold transition-colors ${
                            isCurrent
                              ? 'bg-blue-600 text-white shadow-md'
                              : isPast
                              ? 'bg-green-500 text-white'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {isPast
                              ? <Check className="w-4 h-4" />
                              : <span>{idx + 1}</span>
                            }
                          </div>
                          {/* Connettore verticale (non sull'ultimo) */}
                          {idx < STEPS.length - 1 && (
                            <div className={`w-0.5 h-6 mt-0.5 ${isPast ? 'bg-green-400' : 'bg-border'}`} />
                          )}
                        </div>

                        {/* Testo */}
                        <div className="pb-4 flex-1 min-w-0">
                          <p className={`text-sm font-semibold leading-tight ${
                            isCurrent ? 'text-blue-700' : isPast ? 'text-green-700' : 'text-muted-foreground'
                          }`}>
                            {step.label}
                            {isCurrent && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                                Corrente
                              </span>
                            )}
                          </p>
                          {log?.created_at && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {new Date(log.created_at).toLocaleString('it-IT', {
                                day: '2-digit', month: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Messaggio contestuale */}
                {STATUS_MESSAGES[currentKey] && (
                  <div className={`mt-1 rounded-lg px-4 py-3 text-sm ${
                    currentKey === 'approvata'
                      ? 'bg-green-50 border border-green-200 text-green-800'
                      : currentKey === 'declinata'
                      ? 'bg-red-50 border border-red-200 text-red-800'
                      : currentKey === 'integrazioni_richieste'
                      ? 'bg-amber-50 border border-amber-200 text-amber-800'
                      : 'bg-blue-50 border border-blue-200 text-blue-800'
                  }`}>
                    {STATUS_MESSAGES[currentKey]}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Autorizzazione privacy obbligatoria */}
        <Card className={privacyConsentAcceptedAt
          ? 'border-green-200 bg-green-50/40'
          : 'border-amber-300 bg-amber-50/40 shadow-sm'
        }>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className={privacyConsentAcceptedAt ? 'w-5 h-5 text-green-600' : 'w-5 h-5 text-amber-600'} />
                Autorizzazione privacy e trasmissione documenti
              </CardTitle>
              <Badge className={privacyConsentAcceptedAt
                ? 'bg-green-100 text-green-700 border-green-200 text-xs shrink-0'
                : 'bg-amber-100 text-amber-700 border-amber-200 text-xs shrink-0'
              }>
                {privacyConsentAcceptedAt ? 'Accettata' : 'Obbligatoria'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pb-4 space-y-4">
            {privacyConsentAcceptedAt ? (
              <div className="flex items-start gap-2 text-sm text-green-800">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <p>
                  Autorizzazione registrata il{' '}
                  <strong>{new Date(privacyConsentAcceptedAt).toLocaleString('it-IT')}</strong>.
                  Puoi procedere con il caricamento e la compilazione dei documenti.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-amber-200 bg-white p-4">
                  <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-line">
                    {PRIVACY_CONSENT_TEXT}
                  </p>
                </div>

                <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-border bg-white p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border accent-blue-600"
                    checked={privacyConsentChecked}
                    onChange={event => setPrivacyConsentChecked(event.target.checked)}
                  />
                  <span className="text-sm font-medium leading-relaxed">
                    Ho letto e accetto l’autorizzazione sopra riportata e autorizzo la trasmissione
                    dei documenti personali e societari alle banche e agli intermediari coinvolti nella pratica.
                  </span>
                </label>

                <Button
                  className="w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={!privacyConsentChecked || savingPrivacyConsent || !privacyConsentRecordId}
                  onClick={acceptPrivacyConsent}
                >
                  {savingPrivacyConsent
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Registrazione in corso...</>
                    : <><ShieldCheck className="w-4 h-4" /> Accetta e abilita il caricamento</>
                  }
                </Button>

                <div className="flex items-start gap-2 text-xs text-amber-800">
                  <LockKeyhole className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <p>Finché non accetti, tutti i caricamenti e le compilazioni richieste rimangono bloccati.</p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <fieldset
          disabled={!privacyConsentAcceptedAt}
          className={`space-y-6 border-0 p-0 m-0 min-w-0 ${privacyConsentAcceptedAt ? '' : 'opacity-50'}`}
        >
        {/* Moduli banca da compilare */}
        {bankModuli.length > 0 && (
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Moduli da Compilare per la Banca
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Scarica ogni modulo, compilalo e caricalo firmato.
              </p>
            </CardHeader>
            <CardContent className="pb-4 space-y-3">
              {bankModuli.map(m => {
                const mComp = compilati.filter(c => c.modulo_id === m.id);
                return (
                  <div key={m.id} className="border border-border rounded-lg p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <FileText className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{m.nome}</p>
                        {m.descrizione && <p className="text-xs text-muted-foreground">{m.descrizione}</p>}
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1 shrink-0"
                        onClick={() => downloadModuloTemplate(m.file_path, m.nome)}>
                        <FileDown className="w-3 h-3" /> Scarica template
                      </Button>
                    </div>
                    {mComp.length > 0 && (
                      <div className="pl-6 space-y-1">
                        {mComp.map(c => (
                          <p key={c.id} className="text-xs text-green-700 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Caricato il {new Date(c.uploaded_at).toLocaleDateString('it-IT')}
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="pl-6">
                      <label className="flex items-center gap-1.5 cursor-pointer text-xs text-primary hover:underline w-fit">
                        {uploadingMod === m.id
                          ? <><Loader2 className="w-3 h-3 animate-spin" /> Caricamento in corso...</>
                          : <><Upload className="w-3 h-3" /> {mComp.length > 0 ? 'Carica nuova versione' : 'Carica modulo compilato'}</>
                        }
                        <input type="file" accept=".pdf,.doc,.docx,.odt" className="hidden"
                          disabled={uploadingMod === m.id}
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadCompilatoClient(m.id, f); e.target.value = ''; }} />
                      </label>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* Domande dell'agente */}
        {clientQuestions.length > 0 && (
          <Card className="border-blue-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-600" />
                Domande del tuo consulente
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Rispondi separatamente a ogni domanda e salva la risposta.
              </p>
            </CardHeader>
            <CardContent className="pb-4 space-y-4">
              {clientQuestions.map((question, index) => (
                <div key={question.id} className="rounded-xl border border-border p-3 space-y-2 bg-muted/20">
                  <div className="flex items-start justify-between gap-3">
                    <label htmlFor={`question-${question.id}`} className="text-sm font-medium">
                      {index + 1}. {question.domanda}
                    </label>
                    <Badge className={question.stato === 'risposta'
                      ? 'bg-green-100 text-green-700 border-green-200 text-xs shrink-0'
                      : 'bg-amber-100 text-amber-700 border-amber-200 text-xs shrink-0'
                    }>
                      {question.stato === 'risposta' ? 'Risposta salvata' : 'Da rispondere'}
                    </Badge>
                  </div>
                  <Textarea
                    id={`question-${question.id}`}
                    placeholder="Scrivi qui la tua risposta..."
                    rows={3}
                    value={question.risposta ?? ''}
                    onChange={event => updateQuestionAnswer(question.id, event.target.value)}
                  />
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={savingQuestionId === question.id || !(question.risposta?.trim())}
                    onClick={() => saveQuestionAnswer(question)}
                  >
                    {savingQuestionId === question.id
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvataggio...</>
                      : <><Save className="w-3.5 h-3.5" /> {question.stato === 'risposta' ? 'Aggiorna risposta' : 'Salva risposta'}</>
                    }
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Situazione banche — visibile solo se richiesta nella pratica */}
        {showBankSituationSection && (
          <Card className="border-indigo-200">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-indigo-600" />
                    Situazione banche
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Indica i rapporti bancari attivi e i relativi importi.
                  </p>
                </div>
                <Badge className={bankSituationCompleted
                  ? 'bg-green-100 text-green-700 border-green-200 text-xs shrink-0'
                  : 'bg-amber-100 text-amber-700 border-amber-200 text-xs shrink-0'
                }>
                  {bankSituationCompleted ? 'Completato' : 'Richiesto'}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pb-4 space-y-3">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={addClientBank}>
                <PlusCircle className="w-3.5 h-3.5" /> Aggiungi banca
              </Button>

              {clientBanks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border py-6 px-3 text-center">
                  <p className="text-sm text-muted-foreground">Nessun rapporto bancario inserito.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Se non hai rapporti bancari, puoi confermarlo con il pulsante in fondo.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {clientBanks.map((row, index) => (
                    <div key={row.id ?? `new-${index}`} className="rounded-xl border border-border p-3 space-y-3 bg-muted/20">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Rapporto {index + 1}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          onClick={() => removeClientBank(index)}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" /> Rimuovi
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-muted-foreground font-medium mb-1 block">Banca *</label>
                          <Input
                            placeholder="es. Intesa Sanpaolo"
                            value={row.banca}
                            onChange={event => updateClientBank(index, 'banca', event.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground font-medium mb-1 block">Tipo di rapporto</label>
                          <Select value={row.tipo_rapporto} onValueChange={value => updateClientBank(index, 'tipo_rapporto', value)}>
                            <SelectTrigger>
                              <SelectValue placeholder="Seleziona..." />
                            </SelectTrigger>
                            <SelectContent>
                              {BANK_RELATIONSHIP_TYPES.map(type => (
                                <SelectItem key={type} value={type}>{type}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="text-xs text-muted-foreground font-medium mb-1 block">Accordato (€)</label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0,00"
                            value={row.accordato}
                            onChange={event => updateClientBank(index, 'accordato', event.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground font-medium mb-1 block">Utilizzato (€)</label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0,00"
                            value={row.utilizzato}
                            onChange={event => updateClientBank(index, 'utilizzato', event.target.value)}
                          />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground font-medium mb-1 block">Saldo (€)</label>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0,00"
                            value={row.saldo}
                            onChange={event => updateClientBank(index, 'saldo', event.target.value)}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground font-medium mb-1 block">Note (opzionale)</label>
                        <Textarea
                          placeholder="Garanzie, scadenze, condizioni o altre informazioni utili..."
                          rows={2}
                          value={row.note}
                          onChange={event => updateClientBank(index, 'note', event.target.value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                className="w-full gap-2"
                onClick={saveClientBankSituation}
                disabled={savingClientBanks || (!clientBanks.some(row => row._dirty) && bankSituationCompleted)}
              >
                {savingClientBanks
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvataggio...</>
                  : <><Save className="w-4 h-4" /> {clientBanks.length > 0 ? 'Salva situazione banche' : 'Conferma nessun rapporto bancario'}</>
                }
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Finanziamenti in essere — visibile solo se richiesto nella pratica */}
        {showFinancingSection && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                💳 Finanziamenti in essere
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge className={financingRequestCompleted
                  ? 'bg-green-100 text-green-700 border-green-200 text-xs'
                  : 'bg-amber-100 text-amber-700 border-amber-200 text-xs'
                }>
                  {financingRequestCompleted ? 'Completato' : 'Richiesto'}
                </Badge>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={addFinRow}>
                  <PlusCircle className="w-3.5 h-3.5" /> Aggiungi
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Indica tutti i finanziamenti attivi (mutui, prestiti, leasing, fidi, ecc.)
            </p>
          </CardHeader>
          <CardContent className="pb-4 space-y-3">
            {financing.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <p className="text-sm">Nessun finanziamento in essere</p>
                <p className="text-xs mt-1">Se non hai finanziamenti attivi, lascia vuoto e premi Salva.</p>
                <Button size="sm" variant="outline" className="gap-1.5 mt-3" onClick={addFinRow}>
                  <PlusCircle className="w-3.5 h-3.5" /> Aggiungi finanziamento
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {financing.map((row, idx) => (
                  <div key={idx} className="border border-border rounded-xl p-3 space-y-3 relative bg-muted/20">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Finanziamento {idx + 1}</span>
                      <button
                        onClick={() => removeFinRow(idx)}
                        className="text-destructive hover:bg-destructive/10 rounded p-1"
                        title="Elimina riga"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Tipologia */}
                    <div>
                      <label className="text-xs text-muted-foreground font-medium mb-1 block">Tipologia *</label>
                      <Select value={row.tipologia} onValueChange={v => updateFinRow(idx, 'tipologia', v)}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Seleziona tipologia..." />
                        </SelectTrigger>
                        <SelectContent>
                          {TIPOLOGIE.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Banca / Finanziaria */}
                    <div>
                      <label className="text-xs text-muted-foreground font-medium mb-1 block">Banca / Finanziaria *</label>
                      <Input
                        placeholder="es. Banca Intesa, Findomestic, UniCredit..."
                        className="h-9 text-sm"
                        value={row.banca_finanziaria}
                        onChange={e => updateFinRow(idx, 'banca_finanziaria', e.target.value)}
                      />
                    </div>

                    {/* Importo iniziale + Rata */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground font-medium mb-1 block">Importo iniziale (€)</label>
                        <Input
                          type="number" min="0" step="0.01" placeholder="es. 150000"
                          className="h-9 text-sm"
                          value={row.importo_iniziale}
                          onChange={e => updateFinRow(idx, 'importo_iniziale', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground font-medium mb-1 block">Rata mensile (€)</label>
                        <Input
                          type="number" min="0" step="0.01" placeholder="es. 800"
                          className="h-9 text-sm"
                          value={row.rata}
                          onChange={e => updateFinRow(idx, 'rata', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Durata + Debito residuo */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground font-medium mb-1 block">Durata (mesi)</label>
                        <Input
                          type="number" min="1" step="1" placeholder="es. 240"
                          className="h-9 text-sm"
                          value={row.durata_mesi}
                          onChange={e => updateFinRow(idx, 'durata_mesi', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground font-medium mb-1 block">Debito residuo (€)</label>
                        <Input
                          type="number" min="0" step="0.01" placeholder="es. 95000"
                          className="h-9 text-sm"
                          value={row.debito_residuo}
                          onChange={e => updateFinRow(idx, 'debito_residuo', e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Note */}
                    <div>
                      <label className="text-xs text-muted-foreground font-medium mb-1 block">Note (opzionale)</label>
                      <Input
                        placeholder="es. Banca Intesa, scadenza 2031..."
                        className="h-9 text-sm"
                        value={row.note}
                        onChange={e => updateFinRow(idx, 'note', e.target.value)}
                      />
                    </div>
                  </div>
                ))}

                {/* Totali */}
                {financing.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                    <p className="text-xs font-bold text-blue-700 mb-2 uppercase tracking-wide">Riepilogo totali</p>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground text-xs">Rata mensile totale</span>
                        <p className="font-bold text-blue-800">
                          € {financing.reduce((s, r) => s + (parseFloat(r.rata) || 0), 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground text-xs">Debito residuo totale</span>
                        <p className="font-bold text-blue-800">
                          € {financing.reduce((s, r) => s + (parseFloat(r.debito_residuo) || 0), 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Salva */}
            <Button
              className="w-full gap-2 mt-2"
              onClick={saveFinancing}
              disabled={savingFin || (!financing.some(r => r._dirty) && financingRequestCompleted)}
            >
              {savingFin ? (
                <><span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" /> Salvataggio...</>
              ) : (
                <><Save className="w-4 h-4" /> {financing.length > 0 ? 'Salva Finanziamenti' : 'Conferma nessun finanziamento'}</>
              )}
            </Button>
          </CardContent>
        </Card>
        )}

        {/* ── Carica i tuoi Documenti ─────────────────────────────────────── */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" />
              Carica i tuoi Documenti
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Carica i file richiesti per ogni voce oppure aggiungi un documento libero.
            </p>
          </CardHeader>
          <CardContent className="pb-4 space-y-3">
            {documents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nessun documento richiesto al momento.
              </p>
            ) : uploadDocuments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nessun altro documento da caricare.
              </p>
            ) : (
              <div className="space-y-2">
                {uploadDocuments.map(doc => {
                  const isLoading = uploadingDoc === doc.id;
                  const isUploaded = doc.status === 'caricato' || doc.status === 'approvato';
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                    >
                      {/* Nome documento */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {doc.nome}
                          {doc.obbligatorio && (
                            <span className="ml-1 text-red-500 text-xs">*</span>
                          )}
                        </p>
                      </div>

                      {/* Badge stato */}
                      {isUploaded ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200 text-xs shrink-0">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Caricato
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs shrink-0">
                          <Clock className="w-3 h-3 mr-1" /> In attesa
                        </Badge>
                      )}

                      {/* Pulsante Carica */}
                      <div className="shrink-0">
                        <input
                          type="file"
                          ref={el => { fileInputRefs.current[`quick_${doc.id}`] = el; }}
                          className="hidden"
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                          onChange={e => handleFileSelect(doc.id, e)}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1"
                          disabled={isLoading}
                          onClick={() => fileInputRefs.current[`quick_${doc.id}`]?.click()}
                        >
                          {isLoading ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Carico...</>
                          ) : (
                            <><Upload className="w-3 h-3" /> Carica</>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Separatore */}
            <div className="border-t border-border pt-3 mt-1">
              <p className="text-xs text-muted-foreground mb-2">
                Hai altri documenti rilevanti? Caricali liberamente:
              </p>
              <input
                type="file"
                ref={freeUploadRef}
                className="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleFreeDocUpload(f);
                  e.target.value = '';
                }}
              />
              <Button
                variant="outline"
                className="w-full gap-2 border-dashed"
                disabled={uploadingFreeDoc}
                onClick={() => freeUploadRef.current?.click()}
              >
                {uploadingFreeDoc ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Caricamento in corso...</>
                ) : (
                  <><PlusCircle className="w-4 h-4" /> Carica documento libero</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-1">
                PDF, Word, Excel, immagini, ZIP — max 30 MB
              </p>
            </div>
          </CardContent>
        </Card>
        </fieldset>

        {/* Footer note */}
        <div className="text-center text-xs text-muted-foreground pb-4">
          <p>Per assistenza contatta il tuo agente finanziario.</p>
          <p className="mt-1">Codice pratica: <code className="font-mono bg-muted px-1 rounded">{practice.numero_pratica}</code></p>
        </div>
      </main>
    </div>
  );
}
