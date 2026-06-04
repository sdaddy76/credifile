import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
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
import {
  ArrowLeft, Copy, Plus, Link2, CheckCircle, XCircle,
  FileText, Clock, Download, Upload, RefreshCw, Building2, User, Euro, AlertCircle, Mail, Trash2,
  PlusCircle, Save, BellRing, Loader2
} from 'lucide-react';
import { toast } from 'sonner';
import * as pdfjs from 'pdfjs-dist';
import { parseCentraleRischi, categoriaToTipologia, type CRRiga } from '@/lib/parseCentraleRischi';

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
  type Bank, type PracticeAccessCode
} from '@/lib/types';

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
  const [practiceBanks, setPracticeBanks] = useState<{id:string;bank_id:string;status:string;note?:string;data_invio?:string;banks:{nome:string;email?:string;email_invio_banca?:string}}[]>([]);
  const [addingBank, setAddingBank] = useState('');
  const [sendingBankId, setSendingBankId] = useState<string|null>(null);
  const [bankNote, setBankNote] = useState('');
  const [showSendBankDialog, setShowSendBankDialog] = useState<string|null>(null);
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
  const [newDocName, setNewDocName] = useState('');
  const [newDocDesc, setNewDocDesc] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [integrationName, setIntegrationName] = useState('');
  const [integrationDesc, setIntegrationDesc] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showSollecita, setShowSollecita] = useState(false);
  const [sollecitando, setSollecitando] = useState(false);

  // Invia email richiesta documenti (senza rigenerare il codice)
  const sendDocumentRequest = async () => {
    if (!practice || !accessCode) return;
    const client = (practice as Practice & { clients?: { email: string } }).clients;
    if (!client?.email) { toast.error('Il cliente non ha un email'); return; }
    setSendingEmail(true);

    // Aggiorna sempre email_cliente al valore attuale del cliente
    await supabase.from('practice_access_codes')
      .update({ email_cliente: client.email.trim().toLowerCase() })
      .eq('id', accessCode.id);

    const { data: profile } = await supabase.from('admin_profiles').select('nome').eq('id', user?.id ?? '').maybeSingle();
    const consultantName = profile?.nome ?? user?.email ?? 'Il tuo consulente';
    const link = `https://credifile-eosin.vercel.app/#/accesso?p=${practice.id}`;
    const { data: docs } = await supabase.from('practice_documents').select('nome').eq('practice_id', practice.id);
    const docNames = (docs ?? []).map((d: { nome: string }) => d.nome);
    const { data: emailData, error: emailError } = await supabase.functions.invoke('send-client-email', {
      body: {
        to: client.email,
        consultant_name: consultantName,
        documents: docNames,
        link,
        code: accessCode.codice,
        practice_number: practice.numero_pratica,
        company_name: (practice as Practice & { clients?: { ragione_sociale: string } }).clients?.ragione_sociale ?? undefined,
        cc: (practice as Practice & { segnalatore?: { email: string } }).segnalatore?.email ?? undefined,
      },
    });
    setSendingEmail(false);
    if (emailError || emailData?.success === false) {
      const msg = emailData?.error ? JSON.stringify(emailData.error) : emailError?.message ?? 'Errore sconosciuto';
      toast.error('Errore invio email: ' + msg);
    } else {
      toast.success(`Email inviata a ${client.email}!`);
    }
  };

  const load = useCallback(async () => {
    if (!id) return;
    const [p, docs, l, ac] = await Promise.all([
      supabase.from('practices').select('*, clients(*), banks(*), assigned_agent:admin_profiles!practices_assigned_to_fkey(id,nome,email), segnalatore:admin_profiles!practices_segnalatore_id_fkey(id,nome,email)').eq('id', id).single(),
      supabase.from('practice_documents').select('*, uploaded_files(*)').eq('practice_id', id).order('created_at'),
      supabase.from('practice_status_log').select('*').eq('practice_id', id).order('created_at', { ascending: false }),
      supabase.from('practice_access_codes').select('*').eq('practice_id', id).maybeSingle(),
    ]);
    setPractice(p.data as Practice);
    setDocuments(docs.data as PracticeDocument[] ?? []);
    setLogs(l.data ?? []);
    setAccessCode(ac.data);
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
  }, [id]);

  useEffect(() => {
    load();
    supabase.from('banks').select('*').eq('attiva', true).then(r => setBanks(r.data ?? []));
    supabase.from('admin_profiles').select('id,nome,email').eq('ruolo', 'agente').order('nome').then(r => setAgentsForReassign(r.data ?? []));
  }, [load]);

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
      },
    });
    if (emailError2 || emailData2?.success === false) {
      const msg = emailData2?.error ? JSON.stringify(emailData2.error) : emailError2?.message ?? 'Errore sconosciuto';
      toast.warning('Codice generato ma email non inviata: ' + msg);
    } else {
      toast.success(`Email inviata a ${client.email}!`);
    }
  };

  // Upload documento da admin (per conto del cliente)
  const handleAdminUpload = async (docId: string, file: File) => {
    if (!id) return;
    if (file.size > 30 * 1024 * 1024) { toast.error('File troppo grande. Max 30 MB.'); return; }
    setUploadingAdminDoc(docId);
    const path = `${id}/${docId}/${Date.now()}_${file.name}`;
    try { await supabase.storage.from('practice-files').upload(path, file, { upsert: false }); } catch (_e) { /* ignora errori storage */ }
    await supabase.from('uploaded_files').insert({
      practice_document_id: docId, practice_id: id,
      nome_file: file.name, storage_path: path,
      mime_type: file.type, dimensione: file.size, uploaded_by: 'admin',
    });
    await supabase.from('practice_documents').update({ status: 'caricato', uploaded_at: new Date().toISOString() }).eq('id', docId);
    toast.success(`"${file.name}" caricato con successo`);
    setUploadingAdminDoc(null);
    load();
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
    await supabase.from('practices').update({ status: newStatus }).eq('id', practice.id);
    await supabase.from('practice_status_log').insert({
      practice_id: practice.id, old_status: practice.status, new_status: newStatus,
      note: statusNote || null, created_by: 'admin',
    });
    toast.success('Stato aggiornato');
    setSaving(false);
    setShowStatusChange(false);
    setStatusNote('');
    load();
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
    if (!integrationName.trim()) { toast.error('Inserisci il nome del documento'); return; }
    setSaving(true);
    await supabase.from('practice_documents').insert({
      practice_id: id, nome: integrationName, descrizione: integrationDesc,
      tipo: 'integrazione', obbligatorio: true, status: 'richiesto',
    });
    // Aggiorna stato pratica
    await supabase.from('practices').update({ status: 'integrazioni_richieste' }).eq('id', id);
    await supabase.from('practice_status_log').insert({
      practice_id: id, old_status: practice?.status, new_status: 'integrazioni_richieste',
      note: `Richiesta integrazione: ${integrationName}`, created_by: 'admin',
    });
    toast.success('Integrazione richiesta — stato pratica aggiornato');
    setSaving(false);
    setShowIntegration(false);
    setIntegrationName(''); setIntegrationDesc('');
    load();
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

  const client = (practice as Practice & { clients?: { ragione_sociale: string; email: string; piva?: string; telefono?: string } }).clients;
  const bank = (practice as Practice & { banks?: { nome: string } }).banks;
  const assignedAgent = (practice as Practice & { assigned_agent?: {id:string;nome?:string;email:string} }).assigned_agent;
  const docsStandard = documents.filter(d => d.tipo === 'standard');
  const docsBanca = documents.filter(d => d.tipo === 'banca');
  const docsIntegrazione = documents.filter(d => d.tipo === 'integrazione');
  const completedDocs = documents.filter(d => d.status === 'caricato' || d.status === 'approvato').length;

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
        </div>
        {canApprove && practice.bank_id && (
          <Button variant="outline" size="sm" className="gap-1.5 bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100" onClick={() => { setBankNote(''); setShowSendBankDialog(practice.bank_id ?? null); }}>
            ✉️ Invia alla Banca
          </Button>
        )}
        {canApprove && (
          <Button variant="outline" size="sm" onClick={() => { setNewStatus(practice.status); setShowStatusChange(true); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Cambia Stato
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
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><User className="w-4 h-4 text-primary" />Dati Cliente</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><p className="text-muted-foreground text-xs">Ragione Sociale</p><p className="font-medium">{client?.ragione_sociale}</p></div>
              <div><p className="text-muted-foreground text-xs">Email</p><p>{client?.email}</p></div>
              {client?.piva && <div><p className="text-muted-foreground text-xs">P.IVA</p><p className="font-mono">{client.piva}</p></div>}
              {client?.telefono && <div><p className="text-muted-foreground text-xs">Telefono</p><p>{client.telefono}</p></div>}
              {bank && <div><p className="text-muted-foreground text-xs">Banca</p><p className="flex items-center gap-1"><Building2 className="w-3 h-3" />{bank.nome}</p></div>}
              {practice.importo_richiesto && <div><p className="text-muted-foreground text-xs">Importo</p><p className="flex items-center gap-1 font-semibold"><Euro className="w-3 h-3" />{practice.importo_richiesto.toLocaleString('it-IT')}</p></div>}
              <div>
                <p className="text-muted-foreground text-xs">Codice ATECO</p>
                <input
                  className="text-sm font-mono font-semibold bg-transparent border-b border-dashed border-muted-foreground/30 focus:border-primary focus:outline-none w-28 py-0.5"
                  defaultValue={practice.codice_ateco ?? ''}
                  placeholder="es. 47.11"
                  onBlur={async e => {
                    const val = e.target.value.trim().toUpperCase();
                    await supabase.from('practices').update({ codice_ateco: val || null }).eq('id', practice.id);
                  }}
                />
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

          {/* Link cliente — solo agente */}
          {isAgente && (
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
          <Tabs defaultValue="documenti">
            <TabsList>
              <TabsTrigger value="documenti">Documenti ({documents.length})</TabsTrigger>
              <TabsTrigger value="banche">Banche {practiceBanks.length > 0 ? `(${practiceBanks.length})` : ''}</TabsTrigger>
              <TabsTrigger value="finanziamenti">Finanziamenti {financing.length > 0 ? `(${financing.length})` : ''}</TabsTrigger>
              <TabsTrigger value="scheda">Scheda Rischio</TabsTrigger>
              <TabsTrigger value="analisi">Analisi Finanziaria</TabsTrigger>
              <TabsTrigger value="bancabilita">Bancabilità</TabsTrigger>
              <TabsTrigger value="reputazione">Reputazione</TabsTrigger>
              <TabsTrigger value="log">Storico Stati</TabsTrigger>
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
                {canApprove && (
                <Button size="sm" variant="outline" className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => setShowIntegration(true)}>
                  <AlertCircle className="w-3.5 h-3.5" /> Richiedi Integrazione
                </Button>
                )}
              </div>
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
                                  <input type="file" className="hidden"
                                    ref={el => { adminFileRefs.current[doc.id] = el; }}
                                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                                    onChange={e => { const f = e.target.files?.[0]; if (f) handleAdminUpload(doc.id, f); e.target.value = ''; }}
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

              {documents.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Nessun documento richiesto
                </div>
              )}
            </TabsContent>

            <TabsContent value="banche" className="mt-3 space-y-3">
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
                    if (!addingBank || !id) return;
                    // Inserisci in practice_banks
                    const { error } = await supabase.from('practice_banks').insert({ practice_id: id, bank_id: addingBank, status: 'assegnata' });
                    if (error) { toast.error('Errore: ' + error.message); return; }
                    // Crea documenti specifici banca
                    const { data: bankReqs } = await supabase.from('bank_document_requirements').select('*').eq('bank_id', addingBank);
                    if (bankReqs && bankReqs.length > 0) {
                      await supabase.from('practice_documents').insert(bankReqs.map(r => ({
                        practice_id: id, bank_requirement_id: r.id, nome: r.nome,
                        descrizione: r.descrizione, tipo: 'banca', obbligatorio: r.obbligatorio, status: 'richiesto',
                      })));
                    }
                    toast.success('Banca assegnata' + (bankReqs?.length ? ` — ${bankReqs.length} documenti aggiunti` : ''));
                    setAddingBank(''); load();
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
                            </div>
                            <div className="flex gap-2 items-center">
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${pb.status === 'inviata' ? 'bg-blue-100 text-blue-700' : pb.status === 'deliberata' ? 'bg-green-100 text-green-700' : pb.status === 'rifiutata' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {pb.status === 'assegnata' ? '🕐 Assegnata' : pb.status === 'inviata' ? '📤 Inviata' : pb.status === 'deliberata' ? '✅ Deliberata' : pb.status === 'rifiutata' ? '❌ Rifiutata' : pb.status}
                              </span>
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
                        <p className="text-xs text-muted-foreground">Verranno inviati i link firmati (7gg) a tutti i documenti. Lo stato sarà aggiornato.</p>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShowSendBankDialog(null)}>Annulla</Button>
                        <Button className="bg-blue-600 hover:bg-blue-700 gap-2" disabled={sendingBankId === pb.id}
                          onClick={async () => {
                            setSendingBankId(pb.id);
                            const { data, error } = await supabase.functions.invoke('send-to-bank', {
                              body: { practice_id: practice!.id, bank_id: pb.bank_id, note: bankNote || null }
                            });
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

            <TabsContent value="scheda" className="mt-3">
              <SchedaValutazioneRischio practiceId={id!} />
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
          </Tabs>
        </div>
      </div>
      {/* Dialog riassegna agente */}
      <Dialog open={showReassign} onOpenChange={setShowReassign}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>👤 Riassegna Pratica</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">Seleziona l'agente a cui assegnare questa pratica.</p>
            <Select value={reassignTo} onValueChange={setReassignTo}>
              <SelectTrigger><SelectValue placeholder="Seleziona agente..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nessuno">— Rimuovi assegnazione —</SelectItem>
                {agentsForReassign.map(a => (
                  <SelectItem key={a.id} value={a.id}>{a.nome || a.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReassign(false)}>Annulla</Button>
            <Button onClick={async () => {
              const val = reassignTo === 'nessuno' ? null : (reassignTo || null);
              const { error } = await supabase.from('practices').update({ assigned_to: val }).eq('id', practice!.id);
              if (error) { toast.error('Errore: ' + error.message); return; }
              toast.success('Pratica riassegnata');
              setShowReassign(false);
              load();
            }}>Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cambio stato */}
      <Dialog open={showStatusChange} onOpenChange={setShowStatusChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cambia Stato Pratica</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nuovo Stato</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Note (opzionale)</Label>
              <Textarea placeholder="Aggiungi una nota per questo cambio di stato..." rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStatusChange(false)}>Annulla</Button>
            <Button onClick={handleStatusChange} disabled={saving}>Conferma</Button>
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
      <Dialog open={showIntegration} onOpenChange={setShowIntegration}>
        <DialogContent>
          <DialogHeader><DialogTitle>Richiedi Integrazione Banca</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Il documento verrà aggiunto alla lista richieste e lo stato pratica diventerà "Integrazioni Richieste".</p>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome Documento *</Label>
              <Input placeholder="es. Piano di rientro finanziamenti" value={integrationName} onChange={e => setIntegrationName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Descrizione / Istruzioni</Label>
              <Textarea placeholder="Dettagli sulla richiesta..." rows={2} value={integrationDesc} onChange={e => setIntegrationDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIntegration(false)}>Annulla</Button>
            <Button onClick={handleAddIntegration} disabled={saving} className="bg-amber-600 hover:bg-amber-700">Richiedi Integrazione</Button>
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
