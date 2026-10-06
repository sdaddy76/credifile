// @section: segnalazioni-ricevute
// Pannello super_admin / segreteria per gestire le segnalazioni pubbliche ricevute.
// Permette di assegnare ogni segnalazione a un agente.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { buildAppUrl } from '@/lib/appUrl';
import { sanitizeFileName } from '@/lib/uploadFile';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { formatRomeDateTime } from '@/lib/dateTime';
import { Inbox, RefreshCw, User, Building2, Phone, Mail, FileText, CheckCircle2, Clock, AlertCircle, AlertTriangle, Trash2, Link2, Loader2, Pencil, Save, X, Upload } from 'lucide-react';

// ── Tipi ──────────────────────────────────────────────────────────────────────
interface Segnalazione {
  id: string;
  ragione_sociale: string;
  nome_referente?: string | null;
  email_referente?: string | null;
  telefono?: string | null;
  note?: string | null;
  stato: string;
  agente_id?: string | null;
  note_interne?: string | null;
  created_at: string;
  file_urls?: { nome: string; url?: string; path?: string; mime_type?: string | null; dimensione?: number | null }[] | null;
  practice_id?: string | null;
  numero_pratica?: string | null;
  piva?: string | null;
  tipo_richiesta?: string | null;
  segnalatore_id?: string | null;
  financing_amount?: number | null;
  financing_type?: string | null;
  financing_request?: string | null;
  disclaimer_pagamento_accettato_at?: string | null;
  privacy_consent_accepted_at?: string | null;
  agente?: { nome: string; nome_cognome: string } | null;
  segnalatore?: { nome?: string | null; email?: string | null } | null;
}

interface Agente {
  id: string;
  nome: string;
  nome_cognome?: string | null;
  email?: string | null;
  ruolo: string;
}

interface SegnalazioneEditForm {
  ragione_sociale: string;
  piva: string;
  nome_referente: string;
  email_referente: string;
  telefono: string;
  note: string;
  note_interne: string;
  financing_amount: string;
  financing_type: string;
  financing_request: string;
}

const STATO_COLOR: Record<string, string> = {
  nuova:       'bg-orange-100 text-orange-800',
  assegnata:   'bg-blue-100 text-blue-800',
  lavorazione: 'bg-purple-100 text-purple-800',
  chiusa:      'bg-green-100 text-green-800',
  annullata:   'bg-gray-100 text-gray-600',
};

export default function SegnalazioniRicevutePage() {
  const navigate = useNavigate();
  const { isSuperAdmin, isSegreteria, isAgente, user } = useAuth();
  const [segnalazioni, setSegnalazioni] = useState<Segnalazione[]>([]);
  const [agenti, setAgenti]             = useState<Agente[]>([]);
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState('');
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [filtroStato, setFiltroStato]   = useState('nuova');
  const [assigning, setAssigning]       = useState<string | null>(null);
  const [startingEvaluation, setStartingEvaluation] = useState<string | null>(null);
  const [noteInterne, setNoteInterne]   = useState<Record<string, string>>({});
  const [selectedAgente, setSelectedAgente] = useState<Record<string, string>>({});
  const [editingSegnalazioneId, setEditingSegnalazioneId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<SegnalazioneEditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploadingDocuments, setUploadingDocuments] = useState<string | null>(null);

  const apriDocumento = async (file: { nome: string; url?: string; path?: string }) => {
    if (file.path) {
      const popup = window.open('', '_blank', 'noopener,noreferrer');
      const { data, error } = await supabase.storage
        .from('practice-files')
        .createSignedUrl(file.path, 300);
      if (error || !data?.signedUrl) {
        popup?.close();
        toast.error('Impossibile aprire il documento: ' + (error?.message ?? 'link non disponibile'));
        return;
      }
      if (popup) popup.location.href = data.signedUrl;
      else window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (file.url) window.open(file.url, '_blank', 'noopener,noreferrer');
  };

  // Carica lista agenti per assegnazione
  const loadAgenti = async () => {
    const { data } = await supabase
      .from('admin_profiles')
      .select('id, nome, nome_cognome, email, ruolo')
      .eq('ruolo', 'agente')
      .order('nome');
    setAgenti((data ?? []) as Agente[]);
  };

  // Carica segnalazioni
  const load = async () => {
    setLoading(true);
    setLoadError('');
    // Non incorporare la relazione agente nella query principale: in alcuni
    // ambienti PostgREST il nome della FK non viene esposto come relazione e
    // la query fallisce interamente, nascondendo anche le segnalazioni senza
    // agente (come una nuova valutazione pubblica).
    let q = supabase
      .from('segnalazioni_pubbliche')
      .select('*')
      .order('created_at', { ascending: false });
    if (filtroStato && filtroStato !== 'tutte') q = q.eq('stato', filtroStato);
    if (isAgente && user?.id) {
      // L'agente vede soltanto le segnalazioni assegnate a lui. Quelle ancora
      // prive di agente restano nel presidio esclusivo del Super Admin.
      q = q.eq('agente_id', user.id);
    } else if (isSegreteria && user?.id) {
      // La segreteria vede soltanto le segnalazioni assegnate ai propri
      // agenti; non deve vedere quelle non ancora associate a un agente.
      const { data: assignments, error: assignmentsError } = await supabase
        .from('segreteria_agent_assignments')
        .select('agent_user_id')
        .eq('segreteria_user_id', user.id);
      if (assignmentsError) {
        setLoadError(assignmentsError.message);
        toast.error('Errore caricamento agenti della segreteria: ' + assignmentsError.message);
        setSegnalazioni([]);
        setLoading(false);
        return;
      }
      const agentIds = (assignments ?? []).map(
        (assignment: { agent_user_id: string }) => assignment.agent_user_id
      );
      if (agentIds.length === 0) {
        setSegnalazioni([]);
        setLoading(false);
        return;
      }
      q = q.in('agente_id', agentIds);
    } else if (!isSuperAdmin) {
      setSegnalazioni([]);
      setLoading(false);
      return;
    }
    const { data, error } = await q.limit(100);
    if (error) {
      setLoadError(error.message);
      toast.error('Errore caricamento segnalazioni: ' + error.message);
    }
    const rows = (data ?? []) as Segnalazione[];
    const agentIds = [...new Set(rows.map(row => row.agente_id).filter(Boolean))] as string[];
    if (agentIds.length > 0) {
      const { data: agentRows, error: agentsError } = await supabase
        .from('admin_profiles')
        .select('id,nome,nome_cognome,ruolo')
        .in('id', agentIds);
      if (!agentsError) {
        const agentById = new Map((agentRows ?? []).map(agent => [agent.id, agent]));
        rows.forEach(row => {
          if (row.agente_id) row.agente = agentById.get(row.agente_id) as Segnalazione['agente'] ?? null;
        });
      }
    }
    const segnalatoreIds = [...new Set(rows.map(row => row.segnalatore_id).filter(Boolean))] as string[];
    if (segnalatoreIds.length > 0) {
      const { data: segnalatoreRows, error: segnalatoriError } = await supabase
        .from('admin_profiles')
        .select('id,nome,email')
        .in('id', segnalatoreIds);
      if (!segnalatoriError) {
        const segnalatoreById = new Map((segnalatoreRows ?? []).map(profile => [profile.id, profile]));
        rows.forEach(row => {
          if (row.segnalatore_id) {
            row.segnalatore = segnalatoreById.get(row.segnalatore_id) as Segnalazione['segnalatore'] ?? null;
          }
        });
      }
    }
    const practiceIds = [...new Set(rows.map(row => row.practice_id).filter(Boolean))] as string[];
    if (practiceIds.length > 0) {
      const { data: practices } = await supabase
        .from('practices')
        .select('id, numero_pratica')
        .in('id', practiceIds);
      const numberById = new Map(
        (practices ?? []).map(practice => [practice.id, practice.numero_pratica])
      );
      rows.forEach(row => {
        if (row.practice_id) row.numero_pratica = numberById.get(row.practice_id) ?? null;
      });
    }
    setSegnalazioni(rows);
    const { count } = await supabase
      .from('segnalazioni_pubbliche')
      .select('id', { count: 'exact', head: true })
      .eq('tipo_richiesta', 'richiesta_su_pratica_esistente')
      .in('stato', ['nuova', 'assegnata', 'lavorazione']);
    setDuplicateCount(count ?? 0);
    setLoading(false);
  };

  useEffect(() => { loadAgenti(); }, []);
  useEffect(() => { load(); }, [filtroStato, isAgente, isSegreteria, isSuperAdmin, user?.id]);

  // Assegna segnalazione a un agente
  const assegna = async (seg: Segnalazione) => {
    const agenteId = selectedAgente[seg.id];
    if (!agenteId) { toast.error('Seleziona un agente'); return; }
    setAssigning(seg.id);
    const { error } = await supabase
      .from('segnalazioni_pubbliche')
      .update({
        agente_id:    agenteId,
        stato:        'assegnata',
        note_interne: noteInterne[seg.id] ?? seg.note_interne ?? null,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', seg.id);
    if (error) { toast.error('Errore assegnazione: ' + error.message); }
    else {
      if (seg.practice_id) {
        const { error: practiceError } = await supabase
          .from('practices')
          .update({ assigned_to: agenteId, updated_at: new Date().toISOString() })
          .eq('id', seg.practice_id);
        if (practiceError) {
          toast.error('Segnalazione assegnata, ma aggiornamento pratica non riuscito: ' + practiceError.message);
        }
      }

      const { error: notificationError } = await supabase.from('notifications').insert({
        user_id: agenteId,
        tipo: seg.tipo_richiesta === 'ricerca_banca' ? 'ricerca_banca_assegnata' : 'segnalazione_assegnata',
        titolo: seg.tipo_richiesta === 'ricerca_banca'
          ? 'Richiesta di ricerca banca assegnata'
          : 'Nuova segnalazione assegnata',
        testo: `${seg.ragione_sociale}${seg.practice_id ? ` — pratica ${seg.practice_id.slice(0, 8)}` : ''} è stata assegnata a te.`,
        link: seg.practice_id ? `/admin/pratiche/${seg.practice_id}` : '/admin/segnalazioni-ricevute',
        practice_id: seg.practice_id ?? null,
      });
      if (notificationError) {
        console.warn('Notifica agente non registrata:', notificationError.message);
      }
      toast.success('Segnalazione assegnata!');
      await load();
    }
    setAssigning(null);
  };

  // Aggiorna stato
  const cambiaStato = async (id: string, stato: string) => {
    await supabase.from('segnalazioni_pubbliche').update({ stato, updated_at: new Date().toISOString() }).eq('id', id);
    setSegnalazioni(prev => prev.map(s => s.id === id ? { ...s, stato } : s));
  };

  const apriEditor = (seg: Segnalazione) => {
    setEditingSegnalazioneId(seg.id);
    setEditForm({
      ragione_sociale: seg.ragione_sociale ?? '',
      piva: seg.piva ?? '',
      nome_referente: seg.nome_referente ?? '',
      email_referente: seg.email_referente ?? '',
      telefono: seg.telefono ?? '',
      note: seg.note ?? '',
      note_interne: seg.note_interne ?? '',
      financing_amount: seg.financing_amount != null ? String(seg.financing_amount) : '',
      financing_type: seg.financing_type ?? '',
      financing_request: seg.financing_request ?? '',
    });
  };

  const chiudiEditor = () => {
    if (savingEdit) return;
    setEditingSegnalazioneId(null);
    setEditForm(null);
  };

  const aggiornaCampoEdit = <K extends keyof SegnalazioneEditForm>(campo: K, valore: SegnalazioneEditForm[K]) => {
    setEditForm(prev => prev ? { ...prev, [campo]: valore } : prev);
  };

  const salvaModificheSegnalazione = async (seg: Segnalazione) => {
    if (!editForm) return;
    if (!editForm.ragione_sociale.trim()) {
      toast.error('La ragione sociale è obbligatoria.');
      return;
    }
    setSavingEdit(true);
    const importo = editForm.financing_amount.trim() === ''
      ? null
      : Number(editForm.financing_amount.replace(/\./g, '').replace(',', '.'));
    if (importo !== null && (!Number.isFinite(importo) || importo < 0)) {
      toast.error('Inserisci un importo richiesto valido.');
      setSavingEdit(false);
      return;
    }
    const payload = {
      ragione_sociale: editForm.ragione_sociale.trim(),
      piva: editForm.piva.replace(/\D/g, '') || null,
      nome_referente: editForm.nome_referente.trim() || null,
      email_referente: editForm.email_referente.trim().toLowerCase() || null,
      telefono: editForm.telefono.trim() || null,
      note: editForm.note.trim() || null,
      note_interne: editForm.note_interne.trim() || null,
      financing_amount: importo,
      financing_type: editForm.financing_type.trim() || null,
      financing_request: editForm.financing_request.trim() || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('segnalazioni_pubbliche')
      .update(payload)
      .eq('id', seg.id);
    if (error) {
      toast.error('Errore salvataggio segnalazione: ' + error.message);
      setSavingEdit(false);
      return;
    }
    setSegnalazioni(prev => prev.map(item => item.id === seg.id
      ? { ...item, ...payload, piva: payload.piva, financing_amount: payload.financing_amount }
      : item
    ));
    toast.success('Segnalazione aggiornata.');
    setSavingEdit(false);
    chiudiEditor();
  };

  const caricaDocumentiSegnalazione = async (seg: Segnalazione, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selectedFiles = Array.from(files);
    const tooLarge = selectedFiles.find(file => file.size > 30 * 1024 * 1024);
    if (tooLarge) {
      toast.error(`Il file "${tooLarge.name}" supera il limite di 30 MB.`);
      return;
    }
    setUploadingDocuments(seg.id);
    const uploadedPaths: string[] = [];
    try {
      const newFiles: NonNullable<Segnalazione['file_urls']> = [];
      for (const [index, file] of selectedFiles.entries()) {
        const path = `segnalazioni/admin/${seg.id}/${Date.now()}_${index}_${sanitizeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from('practice-files')
          .upload(path, file, { upsert: false, cacheControl: '3600' });
        if (uploadError) throw new Error(`Upload "${file.name}" non riuscito: ${uploadError.message}`);
        uploadedPaths.push(path);
        const { data: signedData, error: signedError } = await supabase.storage
          .from('practice-files')
          .createSignedUrl(path, 315360000);
        if (signedError || !signedData?.signedUrl) {
          throw new Error(`Impossibile creare il link del documento "${file.name}".`);
        }
        newFiles.push({
          nome: file.name,
          url: signedData.signedUrl,
          path,
          mime_type: file.type || null,
          dimensione: file.size,
        });
      }

      const { data: current, error: currentError } = await supabase
        .from('segnalazioni_pubbliche')
        .select('file_urls')
        .eq('id', seg.id)
        .single();
      if (currentError) throw currentError;
      const existingFiles = Array.isArray(current?.file_urls) ? current.file_urls : (seg.file_urls ?? []);
      const mergedFiles = [...existingFiles, ...newFiles];
      const { error: updateError } = await supabase
        .from('segnalazioni_pubbliche')
        .update({ file_urls: mergedFiles, updated_at: new Date().toISOString() })
        .eq('id', seg.id);
      if (updateError) throw updateError;

      setSegnalazioni(prev => prev.map(item => item.id === seg.id
        ? { ...item, file_urls: mergedFiles }
        : item
      ));
      toast.success(`${newFiles.length} document${newFiles.length === 1 ? 'o' : 'i'} aggiunt${newFiles.length === 1 ? 'o' : 'i'} alla segnalazione.`);
    } catch (error) {
      if (uploadedPaths.length > 0) {
        await supabase.storage.from('practice-files').remove(uploadedPaths);
      }
      toast.error(`Impossibile aggiungere i documenti: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUploadingDocuments(null);
    }
  };

  // Trasforma una richiesta pubblica di valutazione in una pratica operativa.
  // La visura già ricevuta resta nello stesso bucket e viene collegata alla
  // nuova pratica senza duplicare il file.
  const avviaValutazione = async (seg: Segnalazione) => {
    if (seg.practice_id) {
      navigate(`/admin/pratiche/${seg.practice_id}`);
      return;
    }
    let email = (seg.email_referente?.trim() || seg.segnalatore?.email?.trim() || '').toLowerCase();
    if (!email && !isSuperAdmin) {
      toast.error('La segnalazione non contiene un’email cliente né un’email del segnalatore. Il trasferimento senza email è riservato al Super Admin.');
      return;
    }

    setStartingEvaluation(seg.id);
    let createdClientId: string | null = null;
    try {
      const piva = seg.piva?.replace(/\D/g, '') || null;
      let client: { id: string; ragione_sociale: string; email: string; telefono?: string | null } | null = null;

      if (piva) {
        const { data: existingClients, error: clientLookupError } = await supabase
          .from('clients')
          .select('id,ragione_sociale,email,telefono')
          .eq('piva', piva)
          .order('created_at', { ascending: true })
          .limit(1);
        if (clientLookupError) throw clientLookupError;
        client = (existingClients?.[0] ?? null) as typeof client;
        if (!email && client?.email?.trim()) {
          email = client.email.trim().toLowerCase();
        }
      }

      if (!client) {
        const { data: insertedClient, error: clientError } = await supabase
          .from('clients')
          .insert({
            ragione_sociale: seg.ragione_sociale.trim(),
            piva,
            email: email || '',
            telefono: seg.telefono?.trim() || null,
          })
          .select('id,ragione_sociale,email,telefono')
          .single();
        if (clientError) throw clientError;
        client = insertedClient as typeof client;
        createdClientId = insertedClient.id;
      }

      const activeStatuses = [
        'bozza',
        'raccolta_documenti',
        'inviata_banca',
        'integrazioni_richieste',
        'istruttoria',
        'in_delibera',
        'deliberata',
        'completata',
      ];
      const { data: activePractices, error: activePracticeError } = await supabase
        .from('practices')
        .select('id,numero_pratica,status')
        .eq('client_id', client.id)
        .in('status', activeStatuses)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (activePracticeError) throw activePracticeError;

      if (activePractices?.[0]) {
        const existing = activePractices[0];
        await supabase.from('segnalazioni_pubbliche').update({
          practice_id: existing.id,
          stato: 'lavorazione',
          updated_at: new Date().toISOString(),
        }).eq('id', seg.id);
        toast.info(`La P.IVA è già collegata alla pratica ${existing.numero_pratica}.`);
        navigate(`/admin/pratiche/${existing.id}`);
        return;
      }

      const year = new Date().getFullYear();
      const numeroPratica = `PRA-${year}-${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const consultantNameResult = await supabase
        .from('admin_profiles')
        .select('nome,email')
        .eq('id', user?.id ?? '')
        .maybeSingle();
      const consultantName = consultantNameResult.data?.nome || consultantNameResult.data?.email || user?.email || 'Credifile';

      const { data: practice, error: practiceError } = await supabase
        .from('practices')
        .insert({
          client_id: client.id,
          numero_pratica: numeroPratica,
          status: 'raccolta_documenti',
          note_admin: `Valutazione autonoma avviata dalla richiesta pubblica ${seg.id}.`,
          importo_richiesto: seg.financing_amount ?? null,
          motivazione: [
            seg.financing_type ? `Prodotto richiesto: ${seg.financing_type}` : null,
            seg.financing_request || null,
          ].filter(Boolean).join('\n\n') || null,
          created_by: user?.id ?? null,
          assigned_to: seg.agente_id ?? null,
          segnalatore_id: seg.segnalatore_id ?? null,
        })
        .select('id,numero_pratica,status')
        .single();
      if (practiceError) throw practiceError;

      const { data: templates, error: templatesError } = await supabase
        .from('document_templates')
        .select('id,nome,descrizione,obbligatorio,ordine')
        .eq('obbligatorio', true)
        .order('ordine');
      if (templatesError) throw templatesError;

      const templateRows = (templates ?? []).map(template => ({
        practice_id: practice.id,
        template_id: template.id,
        nome: template.nome,
        descrizione: template.descrizione,
        tipo: 'standard',
        obbligatorio: true,
        status: 'richiesto',
      }));
      const { data: practiceDocuments, error: documentsError } = templateRows.length > 0
        ? await supabase.from('practice_documents').insert(templateRows).select('id,nome,status')
        : { data: [], error: null };
      if (documentsError) throw documentsError;

      const normalizeName = (value: string) => value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLocaleLowerCase('it-IT');
      const receivedFiles = (seg.file_urls ?? []).filter(file => Boolean(file.path));
      if (receivedFiles.length > 0) {
        const unmatchedFiles = [...receivedFiles];
        const matchedRows: { file: NonNullable<Segnalazione['file_urls']>[number]; document: { id: string; nome: string } }[] = [];
        for (const document of practiceDocuments ?? []) {
          const documentName = normalizeName(document.nome);
          const fileIndex = unmatchedFiles.findIndex(file => {
            const fileName = normalizeName(file.nome);
            return fileName.includes(documentName) || documentName.includes(fileName);
          });
          if (fileIndex < 0) continue;
          const [file] = unmatchedFiles.splice(fileIndex, 1);
          matchedRows.push({ file, document });
        }

        if (matchedRows.length > 0) {
          const uploadedAt = new Date().toISOString();
          const { error: statusError } = await supabase
            .from('practice_documents')
            .update({
              status: 'caricato',
              uploaded_at: uploadedAt,
              note_rifiuto: null,
            })
            .in('id', matchedRows.map(row => row.document.id));
          if (statusError) throw statusError;

          const { error: filesError } = await supabase.from('uploaded_files').insert(
            matchedRows.map(({ file, document }) => ({
              practice_document_id: document.id,
              practice_id: practice.id,
              nome_file: file.nome,
              storage_path: file.path,
              mime_type: file.mime_type ?? null,
              dimensione: file.dimensione ?? null,
              uploaded_by: 'segnalatore',
            }))
          );
          if (filesError) throw filesError;
        }

        // Gli eventuali allegati non riconducibili a un documento standard
        // restano conservati come documenti liberi già caricati.
        const extraFiles = unmatchedFiles;
        if (extraFiles.length > 0) {
          const { data: extraDocs, error: extraDocsError } = await supabase
            .from('practice_documents')
            .insert(extraFiles.map(file => ({
              practice_id: practice.id,
              nome: file.nome,
              descrizione: 'Documento ricevuto con la richiesta pubblica.',
              tipo: 'integrazione',
              obbligatorio: false,
              status: 'caricato',
              uploaded_at: new Date().toISOString(),
            })))
            .select('id,nome');
          if (extraDocsError) throw extraDocsError;
          const extraFileRows = extraFiles.map((file, index) => ({
            practice_document_id: extraDocs?.[index]?.id ?? null,
            practice_id: practice.id,
            nome_file: file.nome,
            storage_path: file.path,
            mime_type: file.mime_type ?? null,
            dimensione: file.dimensione ?? null,
            uploaded_by: 'segnalatore',
          }));
          const { error: extraFilesError } = await supabase.from('uploaded_files').insert(extraFileRows);
          if (extraFilesError) throw extraFilesError;
        }
      }

      await supabase.from('practice_status_log').insert({
        practice_id: practice.id,
        new_status: 'raccolta_documenti',
        note: 'Valutazione autonoma avviata dalla richiesta pubblica.',
        created_by: user?.id ?? null,
      });

      let access: { id: string; codice: string } | null = null;
      if (email) {
        const accessCode = `CF${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30);
        const { data: accessData, error: accessError } = await supabase
          .from('practice_access_codes')
          .insert({
            practice_id: practice.id,
            codice: accessCode,
            email_cliente: email,
            scadenza: expiry.toISOString(),
          })
          .select('id,codice')
          .single();
        if (accessError) throw accessError;
        access = accessData as { id: string; codice: string };
      }

      const receivedDocumentNames = receivedFiles.map(file => normalizeName(file.nome));
      const pendingDocuments = (practiceDocuments ?? [])
        .filter(document => !receivedDocumentNames.some(fileName =>
          fileName.includes(normalizeName(document.nome)) || normalizeName(document.nome).includes(fileName)
        ))
        .map(document => document.nome);
      let agentEmail: string | null = null;
      if (seg.agente_id) {
        const { data: agent } = await supabase
          .from('admin_profiles')
          .select('email')
          .eq('id', seg.agente_id)
          .maybeSingle();
        agentEmail = agent?.email ?? null;
      }

      if (email) {
        const { data: emailData, error: emailError } = await supabase.functions.invoke('send-client-email', {
          body: {
            to: email,
            consultant_name: consultantName,
            documents: pendingDocuments,
            questions: [],
            link: buildAppUrl(`/accesso?p=${practice.id}`),
            code: access?.codice ?? '',
            practice_number: practice.numero_pratica,
            company_name: seg.ragione_sociale,
            subject_override: `Valutazione di bancabilità avviata — ${seg.ragione_sociale}`,
            cc: agentEmail,
            reply_to: agentEmail,
          },
        });
        if (emailError || emailData?.success === false) {
          const message = emailData?.error
            ? JSON.stringify(emailData.error)
            : emailError?.message ?? 'email non inviata';
          toast.warning(`Pratica ${practice.numero_pratica} creata, ma l'email non è stata inviata: ${message}`);
        } else {
          toast.success(`Valutazione avviata: ${practice.numero_pratica}. Link inviato a ${email}.`);
        }
      } else {
        toast.success(`Segnalazione trasferita nella pratica ${practice.numero_pratica}. Email cliente non presente: il link non è stato inviato.`);
      }

      const { error: requestUpdateError } = await supabase
        .from('segnalazioni_pubbliche')
        .update({
          practice_id: practice.id,
          stato: 'lavorazione',
          email_referente: seg.email_referente?.trim() ? seg.email_referente.trim().toLowerCase() : (email || null),
          updated_at: new Date().toISOString(),
        })
        .eq('id', seg.id);
      if (requestUpdateError) throw requestUpdateError;

      setSegnalazioni(prev => prev.map(item => item.id === seg.id
        ? {
          ...item,
          practice_id: practice.id,
          numero_pratica: practice.numero_pratica,
          stato: 'lavorazione',
          email_referente: item.email_referente?.trim() ? item.email_referente : (email || null),
        }
        : item
      ));
      navigate(`/admin/pratiche/${practice.id}`);
    } catch (error) {
      if (createdClientId) {
        await supabase.from('clients').delete().eq('id', createdClientId);
      }
      toast.error(`Impossibile avviare la valutazione: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setStartingEvaluation(null);
    }
  };

  // Elimina segnalazione (solo super admin)
  const elimina = async (id: string, ragioneSociale: string) => {
    if (!window.confirm(`Eliminare definitivamente la segnalazione di "${ragioneSociale}"?`)) return;
    const { error } = await supabase.from('segnalazioni_pubbliche').delete().eq('id', id);
    if (error) { toast.error('Errore eliminazione: ' + error.message); return; }
    toast.success('Segnalazione eliminata');
    setSegnalazioni(prev => prev.filter(s => s.id !== id));
  };

  if (!isSuperAdmin && !isSegreteria && !isAgente) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <AlertCircle className="w-10 h-10 mb-3 opacity-30" />
        <p>Accesso non consentito</p>
      </div>
    );
  }

  const counts = {
    nuova:       segnalazioni.filter(s => s.stato === 'nuova').length,
    assegnata:   segnalazioni.filter(s => s.stato === 'assegnata').length,
    lavorazione: segnalazioni.filter(s => s.stato === 'lavorazione').length,
    chiusa:      segnalazioni.filter(s => s.stato === 'chiusa').length,
    tutte:       segnalazioni.length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="w-6 h-6 text-orange-500" /> Segnalazioni Ricevute
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Segnalazioni inviate dal modulo pubblico o dai segnalatori — assegna e avvia la lavorazione
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Aggiorna
        </Button>
      </div>

      {isSuperAdmin && duplicateCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">
              Attenzione: {duplicateCount} {duplicateCount === 1 ? 'richiesta ha' : 'richieste hanno'} una P.IVA già associata a una pratica in lavorazione.
            </p>
            <p className="mt-0.5 text-amber-800">
              Verifica la pratica esistente prima di creare nuove pratiche o richiedere nuovamente i documenti.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-300 text-amber-900 hover:bg-amber-100"
            onClick={() => setFiltroStato('tutte')}
          >
            Vedi elenco
          </Button>
        </div>
      )}

      {loadError && (
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="font-semibold">Le segnalazioni non possono essere caricate</p>
            <p className="mt-0.5 break-words">{loadError}</p>
            <p className="mt-1 text-xs">Controlla la sessione e riprova con “Aggiorna”.</p>
          </div>
        </div>
      )}

      {/* Filtri stato */}
      <div className="flex gap-1 flex-wrap">
        {(['nuova','assegnata','lavorazione','chiusa','tutte'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFiltroStato(s)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
              filtroStato === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            {s === 'nuova' ? '🟠 Nuove' : s === 'assegnata' ? '🔵 Assegnate' : s === 'lavorazione' ? '🟣 In lavorazione' : s === 'chiusa' ? '🟢 Chiuse' : 'Tutte'}
            {counts[s] > 0 && <span className="ml-1.5 opacity-70">({counts[s]})</span>}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : segnalazioni.length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-muted/20">
          <Inbox className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-20" />
          <p className="text-sm text-muted-foreground">
            Nessuna segnalazione {filtroStato !== 'tutte' ? `con stato "${filtroStato}"` : ''}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Il link pubblico è: <code className="bg-muted px-1 rounded">/richiedi-valutazione</code>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {segnalazioni.map(seg => (
            <Card key={seg.id} className={`border ${
              seg.tipo_richiesta === 'richiesta_su_pratica_esistente'
                ? 'border-amber-400 bg-amber-50/40'
                : seg.stato === 'nuova'
                  ? 'border-orange-200 bg-orange-50/30'
                  : ''
            }`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col gap-3">
                  {/* Riga superiore */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Building2 className="w-4 h-4 text-orange-500 shrink-0" />
                        <span className="font-semibold text-sm">{seg.ragione_sociale}</span>
                        {seg.tipo_richiesta === 'ricerca_banca' && (
                          <Badge className="text-[10px] bg-teal-100 text-teal-800 border-teal-200">
                            Ricerca banca · Report autonomo
                          </Badge>
                        )}
                        {seg.tipo_richiesta === 'report_autonomo' && (
                          <Badge className="text-[10px] bg-cyan-100 text-cyan-800 border-cyan-200">
                            Richiesta valutazione · Impresa
                          </Badge>
                        )}
                        {seg.tipo_richiesta === 'segnalazione_segnalatore' && (
                          <Badge className="text-[10px] bg-orange-100 text-orange-800 border-orange-200">
                            Inviata da Segnalatore
                          </Badge>
                        )}
                        {seg.tipo_richiesta === 'richiesta_su_pratica_esistente' && (
                          <Badge className="text-[10px] bg-amber-100 text-amber-800 border-amber-200">
                            P.IVA già in lavorazione
                          </Badge>
                        )}
                        <Badge className={`text-[10px] ${STATO_COLOR[seg.stato] ?? 'bg-gray-100'}`}>
                          {seg.stato}
                        </Badge>
                        {seg.agente && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <User className="w-3 h-3" /> {seg.agente.nome_cognome || seg.agente.nome || 'Agente'}
                          </span>
                        )}
                        {isSuperAdmin && !seg.agente_id && (
                          <Badge className="text-[10px] bg-red-100 text-red-800 border-red-200">
                            Solo Super Admin · non assegnata
                          </Badge>
                        )}
                      </div>
                      {seg.practice_id && (
                        <p className="text-xs text-teal-700 mt-1">
                          Pratica collegata:{' '}
                          <code className="font-mono">{seg.numero_pratica ?? `${seg.practice_id.slice(0, 8)}…`}</code>
                        </p>
                      )}
                      {seg.piva && (
                        <p className="text-xs text-muted-foreground mt-1">
                          P.IVA: <code className="font-mono">{seg.piva}</code>
                        </p>
                      )}
                      {seg.segnalatore && (
                        <p className="text-xs text-orange-700 mt-1 flex items-center gap-1">
                          <User className="w-3 h-3" />
                          <span className="font-medium">Segnalatore:</span>
                          <span>{seg.segnalatore.nome || seg.segnalatore.email}</span>
                          {seg.segnalatore.nome && (
                            <span className="text-muted-foreground">· {seg.segnalatore.email}</span>
                          )}
                        </p>
                      )}
                      {seg.disclaimer_pagamento_accettato_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Disclaimer servizio a pagamento accettato il{' '}
                          {formatRomeDateTime(seg.disclaimer_pagamento_accettato_at)}
                        </p>
                      )}
                      {seg.privacy_consent_accepted_at && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Privacy e trasmissione documenti autorizzate il{' '}
                          {formatRomeDateTime(seg.privacy_consent_accepted_at)}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {seg.nome_referente && <span className="flex items-center gap-1"><User className="w-3 h-3" />{seg.nome_referente}</span>}
                        {seg.telefono && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{seg.telefono}</span>}
                        {seg.email_referente && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{seg.email_referente}</span>}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatRomeDateTime(seg.created_at, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {seg.note && (
                        <p className="text-xs text-muted-foreground mt-1.5 max-w-xl bg-muted/50 rounded px-2 py-1 flex gap-1">
                          <FileText className="w-3 h-3 shrink-0 mt-0.5" />
                          {seg.note}
                        </p>
                      )}
                      {(seg.financing_amount || seg.financing_type || seg.financing_request) && (
                        <div className="mt-2 max-w-xl rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-950">
                          <p className="font-semibold">Richiesta finanziaria</p>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                            {seg.financing_amount != null && (
                              <span>Importo: <strong>€ {Number(seg.financing_amount).toLocaleString('it-IT', { minimumFractionDigits: 2 })}</strong></span>
                            )}
                            {seg.financing_type && <span>Prodotto: <strong>{seg.financing_type}</strong></span>}
                          </div>
                          {seg.financing_request && <p className="mt-1 whitespace-pre-wrap">{seg.financing_request}</p>}
                        </div>
                      )}
                      {/* Documenti allegati */}
                      {seg.file_urls && seg.file_urls.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {seg.file_urls.map((f, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => apriDocumento(f)}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors max-w-[220px]"
                            >
                              <FileText className="w-3 h-3 shrink-0" />
                              <span className="truncate">{f.nome}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Cambio stato rapido */}
                    <div className="flex items-center gap-1 shrink-0">
                      {['report_autonomo', 'segnalazione_segnalatore'].includes(seg.tipo_richiesta ?? '') && !seg.practice_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 border-teal-300 text-xs text-teal-700 hover:bg-teal-50"
                          onClick={() => avviaValutazione(seg)}
                          disabled={startingEvaluation === seg.id}
                        >
                          {startingEvaluation === seg.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Link2 className="h-3.5 w-3.5" />}
                          {startingEvaluation === seg.id ? 'Avvio…' : 'Avvia valutazione'}
                        </Button>
                      )}
                      {seg.stato !== 'lavorazione' && seg.stato !== 'chiusa' && (
                        <button onClick={() => cambiaStato(seg.id, 'lavorazione')} className="text-xs px-2 py-1 rounded border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors">
                          In lavorazione
                        </button>
                      )}
                      {seg.stato !== 'chiusa' && (
                        <button onClick={() => cambiaStato(seg.id, 'chiusa')} className="p-1.5 rounded hover:bg-accent transition-colors" title="Chiudi">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        </button>
                      )}
                      {isSuperAdmin && (
                        <>
                          <button
                            onClick={() => editingSegnalazioneId === seg.id ? chiudiEditor() : apriEditor(seg)}
                            className="p-1.5 rounded hover:bg-blue-50 transition-colors text-blue-600"
                            title={editingSegnalazioneId === seg.id ? 'Chiudi modifica' : 'Modifica segnalazione'}
                          >
                            {editingSegnalazioneId === seg.id ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                          </button>
                          <button onClick={() => elimina(seg.id, seg.ragione_sociale)} className="p-1.5 rounded hover:bg-red-50 transition-colors text-red-500" title="Elimina segnalazione">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isSuperAdmin && editingSegnalazioneId === seg.id && editForm && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-blue-950">Modifica segnalazione</p>
                          <p className="text-xs text-blue-800/80">Correggi i dati prima di avviare la valutazione. Gli allegati già presenti non vengono rimossi.</p>
                        </div>
                        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={chiudiEditor} disabled={savingEdit}>
                          <X className="h-3.5 w-3.5" /> Annulla
                        </Button>
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Ragione sociale
                          <Input value={editForm.ragione_sociale} onChange={e => aggiornaCampoEdit('ragione_sociale', e.target.value)} className="mt-1 h-8 text-xs" />
                        </label>
                        <label className="text-xs font-medium text-muted-foreground">
                          Partita IVA
                          <Input value={editForm.piva} onChange={e => aggiornaCampoEdit('piva', e.target.value)} className="mt-1 h-8 text-xs" inputMode="numeric" />
                        </label>
                        <label className="text-xs font-medium text-muted-foreground">
                          Referente
                          <Input value={editForm.nome_referente} onChange={e => aggiornaCampoEdit('nome_referente', e.target.value)} className="mt-1 h-8 text-xs" />
                        </label>
                        <label className="text-xs font-medium text-muted-foreground">
                          Email cliente
                          <Input value={editForm.email_referente} onChange={e => aggiornaCampoEdit('email_referente', e.target.value)} className="mt-1 h-8 text-xs" type="email" />
                        </label>
                        <label className="text-xs font-medium text-muted-foreground">
                          Telefono
                          <Input value={editForm.telefono} onChange={e => aggiornaCampoEdit('telefono', e.target.value)} className="mt-1 h-8 text-xs" type="tel" />
                        </label>
                        <label className="text-xs font-medium text-muted-foreground">
                          Importo richiesto
                          <Input value={editForm.financing_amount} onChange={e => aggiornaCampoEdit('financing_amount', e.target.value)} className="mt-1 h-8 text-xs" inputMode="decimal" placeholder="es. 150000" />
                        </label>
                        <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                          Tipologia prodotto
                          <Input value={editForm.financing_type} onChange={e => aggiornaCampoEdit('financing_type', e.target.value)} className="mt-1 h-8 text-xs" placeholder="Finanziamento, mutuo, leasing…" />
                        </label>
                      </div>
                      <label className="block text-xs font-medium text-muted-foreground">
                        Richiesta e motivazione finanziaria
                        <Textarea value={editForm.financing_request} onChange={e => aggiornaCampoEdit('financing_request', e.target.value)} className="mt-1 text-xs" rows={3} placeholder="Descrizione della finalità e della natura dell'operazione…" />
                      </label>
                      <label className="block text-xs font-medium text-muted-foreground">
                        Note della segnalazione
                        <Textarea value={editForm.note} onChange={e => aggiornaCampoEdit('note', e.target.value)} className="mt-1 text-xs" rows={2} />
                      </label>
                      <label className="block text-xs font-medium text-muted-foreground">
                        Note interne
                        <Textarea value={editForm.note_interne} onChange={e => aggiornaCampoEdit('note_interne', e.target.value)} className="mt-1 text-xs" rows={2} placeholder="Visibili solo agli operatori…" />
                      </label>
                      <div className="flex items-center justify-between gap-3 flex-wrap border-t border-blue-200 pt-3">
                        <div>
                          <p className="text-xs font-medium text-blue-950">Aggiungi documenti</p>
                          <p className="text-[11px] text-blue-800/80">Puoi selezionare più file. Quelli già caricati restano disponibili.</p>
                        </div>
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
                          {uploadingDocuments === seg.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Upload className="h-3.5 w-3.5" />}
                          {uploadingDocuments === seg.id ? 'Caricamento…' : 'Carica documenti'}
                          <input
                            type="file"
                            multiple
                            className="sr-only"
                            disabled={uploadingDocuments === seg.id}
                            onChange={event => {
                              void caricaDocumentiSegnalazione(seg, event.target.files);
                              event.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                      <div className="flex justify-end">
                        <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void salvaModificheSegnalazione(seg)} disabled={savingEdit}>
                          {savingEdit
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Save className="h-3.5 w-3.5" />}
                          {savingEdit ? 'Salvataggio…' : 'Salva modifiche'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Sezione assegnazione (visibile solo se non chiusa/annullata) */}
                  {seg.stato !== 'chiusa' && seg.stato !== 'annullata' && (
                    <div className="flex items-end gap-2 flex-wrap border-t pt-3">
                      <div className="flex-1 min-w-[160px]">
                        <label className="text-xs text-muted-foreground mb-1 block">Assegna ad agente</label>
                        <Select
                          value={selectedAgente[seg.id] ?? (seg.agente_id ?? '')}
                          onValueChange={v => setSelectedAgente(prev => ({ ...prev, [seg.id]: v }))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Seleziona agente…" />
                          </SelectTrigger>
                          <SelectContent>
                            {agenti.map(a => (
                              <SelectItem key={a.id} value={a.id} className="text-xs">
                                {a.nome_cognome || a.nome || a.email || 'Agente senza nome'}
                                {a.email && a.email !== (a.nome_cognome || a.nome) ? ` · ${a.email}` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <label className="text-xs text-muted-foreground mb-1 block">Note interne (opzionale)</label>
                        <Textarea
                          value={noteInterne[seg.id] ?? (seg.note_interne ?? '')}
                          onChange={e => setNoteInterne(prev => ({ ...prev, [seg.id]: e.target.value }))}
                          rows={1}
                          placeholder="Aggiungi note interne…"
                          className="text-xs h-8 resize-none py-1.5"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => assegna(seg)}
                        disabled={assigning === seg.id || !selectedAgente[seg.id]}
                        className="gap-1.5 h-8 text-xs shrink-0"
                      >
                        {assigning === seg.id
                          ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Salvo…</>
                          : <><User className="w-3 h-3" /> Assegna</>
                        }
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
