import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { invokeSendToBank } from '@/lib/sendToBank';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Search, FolderOpen, Eye, Calendar, Euro, Trash2, Building2, Send, CheckCircle2, Clock, LayoutList, Columns, Download, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { STATUS_LABELS, STATUS_COLORS, type Practice, type Client, type Bank } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';

export default function PratichePage() {
  const navigate = useNavigate();
  const { isAgente, isSuperAdmin, isSegreteria, isSegnalatore, canEdit, user, loading: authLoading } = useAuth();
  const [practices, setPractices] = useState<Practice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('tutti');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    client_id: '', importo_richiesto: '', motivazione: '', note_admin: '', assigned_to: '', segnalatore_id: ''
  });
  const [agents, setAgents] = useState<{ id: string; nome?: string; email: string }[]>([]);
  const [segreteriaMap, setSegreteriaMap] = useState<Record<string, string>>({});
  const [segnalatori, setSegnalatori] = useState<{ id: string; nome?: string; email: string }[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [showAssignBank, setShowAssignBank] = useState<Practice | null>(null);
  const [assignBankId, setAssignBankId] = useState('');
  const [assignBankNote, setAssignBankNote] = useState('');
  const [sendBankEmail, setSendBankEmail] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [existingPracticeBanks, setExistingPracticeBanks] = useState<{id:string;bank_id:string;status:string;note?:string;data_invio?:string;banks:{nome:string;email?:string;email_invio_banca?:string}}[]>([]);
  const [loadingBankDialog, setLoadingBankDialog] = useState(false);
  const [sendingBankId, setSendingBankId] = useState<string|null>(null);
  const [removingBankId, setRemovingBankId] = useState<string|null>(null);
  const [allAssignedBankIds, setAllAssignedBankIds] = useState<string[]>([]);
  const [sendNoteFor, setSendNoteFor] = useState<Record<string,string>>({});
  const [showNoteFor, setShowNoteFor] = useState<Record<string,boolean>>({});
  const [viewMode, setViewMode] = useState<'lista' | 'kanban'>('lista');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // Duplicazione pratica (solo super_admin)
  const [showDuplica, setShowDuplica] = useState<Practice | null>(null);
  const [duplicaAgentId, setDuplicaAgentId] = useState('');
  const [duplicaNote, setDuplicaNote] = useState('');
  const [duplicaFile, setDuplicaFile] = useState(false);
  const [savingDuplica, setSavingDuplica] = useState(false);

  async function openBankDialog(practice: Practice) {
    setShowAssignBank(practice);
    setAssignBankId('');
    setAssignBankNote('');
    setSendBankEmail(false);
    setLoadingBankDialog(true);
    // Carica tutti i bank_id assegnati alla pratica (senza filtro created_by) per il dropdown
    const { data: allBanks } = await supabase
      .from('practice_banks')
      .select('bank_id')
      .eq('practice_id', practice.id);
    setAllAssignedBankIds((allBanks ?? []).map((r: { bank_id: string }) => r.bank_id));
    // Carica le banche visibili a questa segreteria (filtrate per created_by)
    let q = supabase
      .from('practice_banks')
      .select('*, banks(nome,email,email_invio_banca)')
      .eq('practice_id', practice.id);
    // Segreteria vede solo le proprie assegnazioni, super_admin vede tutte
    if (isSegreteria && user?.id) q = q.eq('created_by', user.id);
    const { data } = await q.order('created_at');
    setExistingPracticeBanks((data ?? []) as typeof existingPracticeBanks);
    setLoadingBankDialog(false);
  }

  function closeBankDialog() {
    setShowAssignBank(null);
    setAssignBankId('');
    setAssignBankNote('');
    setSendBankEmail(false);
    setExistingPracticeBanks([]);
    setAllAssignedBankIds([]);
    setSendNoteFor({});
    setShowNoteFor({});
  }

  async function handleSendExisting(bankId: string) {
    if (!showAssignBank) return;
    setSendingBankId(bankId);
    const { data, error } = await invokeSendToBank({
      practice_id: showAssignBank.id, bank_id: bankId, note: sendNoteFor[bankId] || null,
    });
    if (error || data?.error) {
      toast.error('Errore invio: ' + (error?.message ?? data?.error));
    } else {
      toast.success(`Email inviata alla banca (${data?.docs_sent ?? 0} documenti allegati)`);
      // Aggiorna stato locale
      setExistingPracticeBanks(prev =>
        prev.map(pb => pb.bank_id === bankId ? { ...pb, status: 'inviata', data_invio: new Date().toISOString() } : pb)
      );
    }
    setSendingBankId(null);
  }

  async function handleRemoveBank(pbId: string, bankNome: string) {
    if (!confirm(`Rimuovere l'assegnazione a "${bankNome}" da questa pratica?`)) return;
    setRemovingBankId(pbId);
    const { error } = await supabase.from('practice_banks').delete().eq('id', pbId);
    if (error) {
      toast.error('Errore rimozione: ' + error.message);
    } else {
      toast.success(`Banca "${bankNome}" rimossa dalla pratica`);
      setExistingPracticeBanks(prev => prev.filter(pb => pb.id !== pbId));
      setAllAssignedBankIds(prev => prev.filter(id => {
        const removed = existingPracticeBanks.find(pb => pb.id === pbId);
        return id !== removed?.bank_id;
      }));
    }
    setRemovingBankId(null);
  }


  async function load() {
    let query = supabase.from('practices').select('*, clients(ragione_sociale,email), assigned_agent:admin_profiles!practices_assigned_to_fkey(id,nome,email), segnalatore:admin_profiles!practices_segnalatore_id_fkey(id,nome,email)');

    if (isAgente && user?.id) {
      // Agente: vede SOLO le pratiche assegnate a lui
      query = query.eq('assigned_to', user.id);
    } else if (isSegreteria && user?.id) {
      // Segreteria: vede le pratiche degli agenti assegnati
      const { data: assignments } = await supabase
        .from('segreteria_agent_assignments')
        .select('agent_user_id')
        .eq('segreteria_user_id', user.id);
      if (assignments && assignments.length > 0) {
        const agentIds = assignments.map((a: { agent_user_id: string }) => a.agent_user_id);
        query = query.in('assigned_to', agentIds);
      } else {
        setPractices([]);
        setLoading(false);
        return;
      }
    } else if (isSegnalatore && user?.id) {
      // Segnalatore: vede solo le pratiche dove è assegnato come segnalatore
      query = query.eq('segnalatore_id', user.id);
    }
    // super_admin: nessun filtro, vede tutte

    const { data } = await query.order('created_at', { ascending: false });
    setPractices((data ?? []) as Practice[]);
    setLoading(false);
  }

  useEffect(() => {
    if (authLoading) return;
    load();
    supabase.from('clients').select('*').order('ragione_sociale').then(r => setClients(r.data ?? []));
    supabase.from('admin_profiles').select('id,nome,email').eq('ruolo', 'agente').order('nome')
      .then(r => setAgents(r.data ?? []));
    supabase.from('banks').select('*').order('nome')
      .then(r => setBanks(r.data ?? []));
    // Carica segnalatori: agente vede i propri, admin/segreteria vede tutti
    if (user?.id && isAgente) {
      supabase.from('agent_segnalatori')
        .select('segnalatore:segnalatore_id(id,nome,email)')
        .eq('agent_id', user.id)
        .then(r => setSegnalatori((r.data ?? []).map((x: { segnalatore: { id: string; nome?: string; email: string }[] }) => x.segnalatore[0]).filter(Boolean)));
    } else if (isSuperAdmin || isSegreteria) {
      supabase.from('admin_profiles').select('id,nome,email').eq('ruolo','segnalatore').order('nome')
        .then(r => setSegnalatori(r.data ?? []));
    }
    // Mappa agente → segreteria per super_admin
    if (isSuperAdmin) {
      supabase
        .from('segreteria_agent_assignments')
        .select('agent_user_id, segreteria:admin_profiles!segreteria_agent_assignments_segreteria_user_id_fkey(nome,email)')
        .then(({ data: sData }) => {
          const map: Record<string, string> = {};
          (sData as unknown as Array<{ agent_user_id: string; segreteria: Array<{ nome?: string; email?: string }> }>)
            ?.forEach((row) => {
              const seg = row.segreteria?.[0];
              if (seg) {
                map[row.agent_user_id] = seg.nome || seg.email || '';
              }
            });
          setSegreteriaMap(map);
        });
    }
  }, [authLoading, isAgente, isSegreteria, isSuperAdmin, isSegnalatore, user?.id]);

  const filtered = practices.filter(p => {
    const rs = (p as Practice & { clients?: { ragione_sociale: string } }).clients?.ragione_sociale ?? '';
    const matchSearch = rs.toLowerCase().includes(search.toLowerCase()) ||
      p.numero_pratica.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'tutti' || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const generateNumeroPratica = () => {
    const y = new Date().getFullYear();
    const n = String(Math.floor(Math.random() * 9000) + 1000);
    return `PRA-${y}-${n}`;
  };

  const handleDeletePractice = async (e: React.MouseEvent, id: string, numero: string) => {
    e.stopPropagation();
    if (!confirm(`Eliminare la pratica "${numero}"? L'operazione è irreversibile.`)) return;
    const { error } = await supabase.from('practices').delete().eq('id', id);
    if (error) { toast.error('Errore eliminazione: ' + error.message); return; }
    toast.success(`Pratica ${numero} eliminata`);
    load();
  };

  const handleDuplica = async () => {
    if (!showDuplica) return;
    setSavingDuplica(true);
    const numero_pratica = generateNumeroPratica();
    const { data: newPractice, error } = await supabase.from('practices').insert({
      client_id:        showDuplica.client_id,
      numero_pratica,
      importo_richiesto: showDuplica.importo_richiesto ?? null,
      motivazione:      showDuplica.motivazione ?? null,
      codice_ateco:     showDuplica.codice_ateco ?? null,
      segnalatore_id:   showDuplica.segnalatore_id ?? null,
      note_admin:       duplicaNote || null,
      status:           'bozza',
      created_by:       user?.id ?? null,
      assigned_to:      duplicaAgentId || null,
    }).select().single();

    if (error || !newPractice) {
      toast.error('Errore nella duplicazione: ' + (error?.message ?? 'sconosciuto'));
      setSavingDuplica(false);
      return;
    }

    // Documenti: copia SEMPRE tutti i documenti dall'originale (standard + personalizzati)
    // Se duplicaFile=true, include anche gli uploaded_files per copiare i file fisici
    const selectFields = duplicaFile
      ? 'id, template_id, bank_requirement_id, nome, descrizione, tipo, obbligatorio, uploaded_files(id, nome_file, storage_path, mime_type, dimensione)'
      : 'id, template_id, bank_requirement_id, nome, descrizione, tipo, obbligatorio';
    const { data: origDocs } = await supabase
      .from('practice_documents')
      .select(selectFields)
      .eq('practice_id', showDuplica.id);

    type OrigDoc = { id: string; template_id: string | null; bank_requirement_id: string | null; nome: string; descrizione?: string; tipo: string; obbligatorio: boolean; uploaded_files?: { id: string; nome_file: string; storage_path: string; mime_type: string; dimensione: number }[] };
    if (origDocs && origDocs.length > 0) {
      const typedDocs = origDocs as unknown as OrigDoc[];
      for (const d of typedDocs) {
        const { data: newDoc } = await supabase.from('practice_documents').insert({
          practice_id:         newPractice.id,
          template_id:         d.template_id,
          bank_requirement_id: d.bank_requirement_id,
          nome:                d.nome,
          descrizione:         d.descrizione,
          tipo:                d.tipo,
          obbligatorio:        d.obbligatorio,
          status:              'richiesto',
        }).select('id').single();

        if (!newDoc) continue;

        if (duplicaFile && d.uploaded_files && d.uploaded_files.length > 0) {
          let fileCopied = false;
          for (const f of d.uploaded_files) {
            const newPath = `${newPractice.id}/${newDoc.id}/${Date.now()}_${f.nome_file}`;
            const { error: copyErr } = await supabase.storage
              .from('practice-files').copy(f.storage_path, newPath);
            if (!copyErr) {
              await supabase.from('uploaded_files').insert({
                practice_document_id: newDoc.id,
                practice_id:          newPractice.id,
                nome_file:            f.nome_file,
                storage_path:         newPath,
                mime_type:            f.mime_type,
                dimensione:           f.dimensione,
                uploaded_by:          'admin',
              });
              fileCopied = true;
            }
          }
          if (fileCopied) {
            await supabase.from('practice_documents')
              .update({ status: 'caricato', uploaded_at: new Date().toISOString() })
              .eq('id', newDoc.id);
          }
        }
      }
    } else {
      // Fallback: nessun documento nell'originale — usa i template standard obbligatori
      const { data: templates } = await supabase
        .from('document_templates').select('*').eq('obbligatorio', true);
      if (templates && templates.length > 0) {
        await supabase.from('practice_documents').insert(
          templates.map((t: { id: string; nome: string; descrizione?: string }) => ({
            practice_id: newPractice.id, template_id: t.id, nome: t.nome,
            descrizione: t.descrizione, tipo: 'standard', obbligatorio: true, status: 'richiesto',
          }))
        );
      }
    }

    // Copia finanziamenti dalla pratica originale
    const { data: origFin } = await supabase
      .from('client_financing')
      .select('tipologia, banca_finanziaria, importo_iniziale, rata, durata_mesi, debito_residuo, note, ordinamento, accordato, accordato_operativo, utilizzato, saldo_medio, tipo_garanzia, stato_rapporto, data_riferimento, fonte')
      .eq('practice_id', showDuplica.id)
      .order('ordinamento');
    if (origFin && origFin.length > 0) {
      await supabase.from('client_financing').insert(
        origFin.map((f) => ({ ...f, practice_id: newPractice.id }))
      );
    }

    // Log stato iniziale
    await supabase.from('practice_status_log').insert({
      practice_id: newPractice.id, new_status: 'bozza', created_by: 'admin',
    });

    toast.success(`Pratica ${numero_pratica} creata come duplicato di ${showDuplica.numero_pratica}`);
    setSavingDuplica(false);
    setShowDuplica(null);
    setDuplicaAgentId('');
    setDuplicaNote('');
    setDuplicaFile(false);
    load();
    navigate(`/admin/pratiche/${newPractice.id}`);
  };

  const handleCreate = async () => {
    if (!form.client_id) { toast.error('Seleziona un cliente'); return; }
    setSaving(true);
    const numero_pratica = generateNumeroPratica();

    const { data: practice, error } = await supabase.from('practices').insert({
      client_id: form.client_id,
      numero_pratica,
      importo_richiesto: form.importo_richiesto ? Number(form.importo_richiesto) : null,
      motivazione: form.motivazione || null,
      note_admin: form.note_admin || null,
      status: 'bozza',
      created_by: user?.id ?? null,
      assigned_to: form.assigned_to || null,
      segnalatore_id: form.segnalatore_id || null,
    }).select().single();

    if (error) { toast.error('Errore nella creazione'); setSaving(false); return; }

    // Crea i documenti standard per questa pratica
    const { data: templates } = await supabase.from('document_templates').select('*').eq('obbligatorio', true);
    if (templates && templates.length > 0) {
      await supabase.from('practice_documents').insert(
        templates.map(t => ({
          practice_id: practice.id,
          template_id: t.id,
          nome: t.nome,
          descrizione: t.descrizione,
          tipo: 'standard',
          obbligatorio: true,
          status: 'richiesto',
        }))
      );
    }


    // Log stato
    await supabase.from('practice_status_log').insert({
      practice_id: practice.id, new_status: 'bozza', created_by: 'admin',
    });

    toast.success(`Pratica ${numero_pratica} creata con successo`);
    setSaving(false);
    setShowCreate(false);
    setForm({ client_id: '', importo_richiesto: '', motivazione: '', note_admin: '', assigned_to: '', segnalatore_id: '' });
    load();
    navigate(`/admin/pratiche/${practice.id}`);
  };

  const handleAssignBank = async () => {
    if (!showAssignBank || !assignBankId) { toast.error('Seleziona una banca'); return; }
    setSavingBank(true);
    // Evita duplicati
    const { data: existing } = await supabase
      .from('practice_banks')
      .select('id')
      .eq('practice_id', showAssignBank.id)
      .eq('bank_id', assignBankId)
      .single();
    if (existing) {
      toast.error('Questa banca è già assegnata alla pratica');
      setSavingBank(false);
      return;
    }
    const { error } = await supabase.from('practice_banks').insert({
      practice_id: showAssignBank.id,
      bank_id: assignBankId,
      status: 'da_inviare',
      created_by: user?.id ?? null,
    });
    if (error) {
      setSavingBank(false);
      toast.error('Errore: ' + error.message);
      return;
    }
    // Invia email alla banca se richiesto
    if (sendBankEmail) {
      const { data: fnData, error: fnError } = await invokeSendToBank({
        practice_id: showAssignBank.id, bank_id: assignBankId, note: assignBankNote || null,
      });
      if (fnError || fnData?.error) {
        toast.warning('Banca assegnata ma errore invio email: ' + (fnError?.message ?? fnData?.error));
      } else {
        toast.success(`Banca assegnata e email inviata (${fnData?.docs_sent ?? 0} documenti)`);
      }
    } else {
      toast.success('Banca assegnata. Puoi inviare l\'email dalla sezione "Banche assegnate".');
    }
    setSavingBank(false);
    setAssignBankId('');
    setAssignBankNote('');
    setSendBankEmail(false);
    // Ricarica le banche nel dialog senza chiuderlo
    let rq = supabase.from('practice_banks')
      .select('*, banks(nome,email,email_invio_banca)')
      .eq('practice_id', showAssignBank.id);
    if (isSegreteria && user?.id) rq = rq.eq('created_by', user.id);
    const { data: refreshed } = await rq.order('created_at');
    setExistingPracticeBanks((refreshed ?? []) as typeof existingPracticeBanks);
    // Aggiorna anche la lista completa dei bank_id per il dropdown
    const { data: allBanksRefresh } = await supabase
      .from('practice_banks')
      .select('bank_id')
      .eq('practice_id', showAssignBank.id);
    setAllAssignedBankIds((allBanksRefresh ?? []).map((r: { bank_id: string }) => r.bank_id));
    load();
  };

  const handleExportCSV = () => {
    const headers = ['Numero Pratica', 'Cliente', 'Stato', 'Importo (€)', 'ATECO', 'Data Creazione', 'Banca Assegnata'];
    const rows = filtered.map(p => {
      const client = (p as Practice & { clients?: { ragione_sociale: string } }).clients;
      const bankName = (p as Practice & { banks?: { nome: string } }).banks?.nome ?? '';
      return [
        p.numero_pratica,
        client?.ragione_sociale ?? '',
        STATUS_LABELS[p.status] ?? p.status,
        p.importo_richiesto != null ? String(p.importo_richiesto) : '',
        p.codice_ateco ?? '',
        new Date(p.created_at).toLocaleDateString('it-IT'),
        bankName,
      ];
    });
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `credifile-pratiche-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Esportate ${filtered.length} pratiche`);
  };

  const handleKanbanDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (!draggedId || !canEdit) return;
    const practice = practices.find(p => p.id === draggedId);
    if (!practice || practice.status === newStatus) { setDraggedId(null); return; }
    const { error } = await supabase.from('practices').update({ status: newStatus }).eq('id', draggedId);
    if (error) { toast.error('Errore aggiornamento stato: ' + error.message); }
    else {
      setPractices(prev => prev.map(p => p.id === draggedId ? { ...p, status: newStatus as Practice['status'] } : p));
      toast.success(`Pratica spostata in "${STATUS_LABELS[newStatus as Practice['status']] ?? newStatus}"`);
    }
    setDraggedId(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pratiche</h1>
          <p className="text-muted-foreground text-sm mt-1">{practices.length} pratiche totali</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle Lista / Kanban */}
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode('lista')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${viewMode === 'lista' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              title="Vista lista"
            >
              <LayoutList className="w-4 h-4" /> Lista
            </button>
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors ${viewMode === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              title="Vista kanban"
            >
              <Columns className="w-4 h-4" /> Kanban
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-1.5" title="Esporta in CSV">
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          {canEdit && (
            <Button onClick={() => setShowCreate(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Nuova Pratica
            </Button>
          )}
        </div>
      </div>

      {/* Filtri */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Cerca per cliente o numero pratica..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-full sm:w-52">
            <SelectValue placeholder="Tutti gli stati" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tutti">Tutti gli stati</SelectItem>
            {Object.entries(STATUS_LABELS).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card className="border-border">
          <CardContent className="py-16 text-center">
            <FolderOpen className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground">Nessuna pratica trovata</p>
            <Button variant="outline" className="mt-4" onClick={() => setShowCreate(true)}>Crea la prima pratica</Button>
          </CardContent>
        </Card>
      ) : viewMode === 'kanban' ? (
        /* ── VISTA KANBAN ─────────────────────────────────────────── */
        (() => {
          const KANBAN_COLUMNS: { status: string; label: string; headerCls: string; dropBg: string }[] = [
            { status: 'bozza',                   label: 'Bozza',               headerCls: 'bg-slate-100 text-slate-700',   dropBg: 'bg-slate-50' },
            { status: 'raccolta_documenti',       label: 'Raccolta Documenti',  headerCls: 'bg-blue-100 text-blue-700',    dropBg: 'bg-blue-50/40' },
            { status: 'inviata_banca',            label: 'Inviata Banca',       headerCls: 'bg-purple-100 text-purple-700',dropBg: 'bg-purple-50/40' },
            { status: 'integrazioni_richieste',   label: 'Integrazioni',        headerCls: 'bg-amber-100 text-amber-700',  dropBg: 'bg-amber-50/40' },
            { status: 'completata',               label: 'Completata',          headerCls: 'bg-green-100 text-green-700',  dropBg: 'bg-green-50/40' },
            { status: 'approvata',                label: 'Approvata',           headerCls: 'bg-emerald-100 text-emerald-700', dropBg: 'bg-emerald-50/40' },
            { status: 'declinata',                label: 'Declinata',           headerCls: 'bg-red-100 text-red-700',      dropBg: 'bg-red-50/40' },
          ];
          return (
            <div className="overflow-x-auto pb-2">
              <div className="flex gap-3 min-w-max">
                {KANBAN_COLUMNS.map(col => {
                  const colPractices = filtered.filter(p => p.status === col.status);
                  return (
                    <div
                      key={col.status}
                      className={`flex flex-col w-60 rounded-xl border border-border ${col.dropBg} transition-colors`}
                      onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('ring-2', 'ring-primary/40'); }}
                      onDragLeave={e => { e.currentTarget.classList.remove('ring-2', 'ring-primary/40'); }}
                      onDrop={e => { e.currentTarget.classList.remove('ring-2', 'ring-primary/40'); handleKanbanDrop(e, col.status); }}
                    >
                      {/* Intestazione colonna */}
                      <div className={`flex items-center justify-between px-3 py-2 rounded-t-xl ${col.headerCls}`}>
                        <span className="text-xs font-semibold">{col.label}</span>
                        <span className="text-xs font-bold opacity-70">{colPractices.length}</span>
                      </div>
                      {/* Cards */}
                      <div className="flex flex-col gap-2 p-2 min-h-[120px]">
                        {colPractices.map(p => {
                          const client = (p as Practice & { clients?: { ragione_sociale: string } }).clients;
                          return (
                            <div
                              key={p.id}
                              draggable={canEdit}
                              onDragStart={() => setDraggedId(p.id)}
                              onDragEnd={() => setDraggedId(null)}
                              onClick={() => navigate(`/admin/pratiche/${p.id}`)}
                              className={`bg-white border border-border rounded-lg p-2.5 cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all select-none ${draggedId === p.id ? 'opacity-50 ring-2 ring-primary' : ''}`}
                            >
                              <p className="text-xs font-semibold text-foreground leading-tight truncate">{client?.ragione_sociale ?? '—'}</p>
                              <code className="text-[10px] text-muted-foreground font-mono">{p.numero_pratica}</code>
                              {p.importo_richiesto != null && (
                                <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-0.5">
                                  <Euro className="w-2.5 h-2.5" />{p.importo_richiesto.toLocaleString('it-IT')}
                                </p>
                              )}
                            </div>
                          );
                        })}
                        {colPractices.length === 0 && (
                          <p className="text-[11px] text-muted-foreground text-center py-4 opacity-50">Nessuna pratica</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()
      ) : (
        /* ── VISTA LISTA ──────────────────────────────────────────── */
        <div className="space-y-2">
          {filtered.map(p => {
            const client = (p as Practice & { clients?: { ragione_sociale: string; email: string } }).clients;
            const assignedAgent = (p as Practice & { assigned_agent?: { id: string; nome?: string; email: string } }).assigned_agent;
            const createdByAgent = agents.find(a => a.id === (p as Practice & { created_by?: string }).created_by) ?? null;
            const segnalatorePratica = (p as Practice & { segnalatore?: { id: string; nome?: string; email: string } }).segnalatore;
            return (
              <Card key={p.id} className="border-border hover:border-primary/30 transition-colors cursor-pointer" onClick={() => navigate(`/admin/pratiche/${p.id}`)}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground">{client?.ragione_sociale ?? '—'}</p>
                        <code className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{p.numero_pratica}</code>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {/* 1. Segreteria di competenza (solo super_admin) */}
                        {isSuperAdmin && assignedAgent?.id && segreteriaMap[assignedAgent.id] && (
                          <span className="flex items-center gap-1 text-purple-600 font-medium">
                            🏢 {segreteriaMap[assignedAgent.id]}
                          </span>
                        )}
                        {/* 2. Agente assegnato */}
                        {assignedAgent && !isAgente && (
                          <span className="flex items-center gap-1">
                            👤 {assignedAgent.nome || assignedAgent.email}
                          </span>
                        )}
                        {(isSuperAdmin || isSegreteria) && segnalatorePratica && (
                          <span className="flex items-center gap-1 text-orange-600">
                            <span className="font-medium">Segnalatore:</span> {segnalatorePratica.nome || segnalatorePratica.email}
                          </span>
                        )}
                        {p.importo_richiesto && <span className="flex items-center gap-1"><Euro className="w-3 h-3" />{p.importo_richiesto.toLocaleString('it-IT')}</span>}
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(p.created_at).toLocaleDateString('it-IT')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${STATUS_COLORS[p.status]}`}>{STATUS_LABELS[p.status]}</Badge>
                      {(isSuperAdmin || isSegreteria) && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0 text-primary hover:bg-primary/10"
                          title="Assegna banca"
                          onClick={e => { e.stopPropagation(); openBankDialog(p); }}
                        >
                          <Building2 className="w-4 h-4" />
                        </Button>
                      )}
                      {isSuperAdmin && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0 text-amber-600 hover:bg-amber-50"
                          title="Duplica pratica e assegna ad altro agente"
                          onClick={e => { e.stopPropagation(); setShowDuplica(p); setDuplicaAgentId(''); setDuplicaNote(''); setDuplicaFile(false); }}
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <Eye className="w-4 h-4" />
                      </Button>
                      {canEdit && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                          onClick={e => handleDeletePractice(e, p.id, p.numero_pratica)}
                          title="Elimina pratica"
                        >
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

      {/* Dialog crea pratica */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nuova Pratica</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select value={form.client_id} onValueChange={v => setForm(f => ({ ...f, client_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleziona cliente..." /></SelectTrigger>
                <SelectContent>
                  {clients.map(c => <SelectItem key={c.id} value={c.id}>{c.ragione_sociale}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
              <div className="space-y-2">
              <Label>Importo Richiesto (€)</Label>
              <Input type="number" placeholder="es. 150000" value={form.importo_richiesto} onChange={e => setForm(f => ({ ...f, importo_richiesto: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Note interne</Label>
              <Textarea placeholder="Note per uso interno..." rows={2} value={form.note_admin} onChange={e => setForm(f => ({ ...f, note_admin: e.target.value }))} />
            </div>
            {!isAgente && agents.length > 0 && (
              <div className="space-y-2">
                <Label>Assegna ad Agente</Label>
                <Select value={form.assigned_to} onValueChange={v => setForm(f => ({ ...f, assigned_to: v === 'nessuno' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Seleziona agente (opzionale)..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nessuno">— Nessuna assegnazione —</SelectItem>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.nome || a.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">L'agente potrà vedere e gestire questa pratica.</p>
              </div>
            )}
            {!isSegnalatore && segnalatori.length > 0 && (
              <div className="space-y-2">
                <Label>Segnalatore</Label>
                <Select value={form.segnalatore_id} onValueChange={v => setForm(f => ({ ...f, segnalatore_id: v === 'nessuno' ? '' : v }))}>
                  <SelectTrigger><SelectValue placeholder="Seleziona segnalatore (opzionale)..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nessuno">— Nessun segnalatore —</SelectItem>
                    {segnalatori.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.nome || s.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Il segnalatore riceverà copia delle comunicazioni.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Annulla</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? 'Creazione...' : 'Crea Pratica'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog gestione banche pratica */}
      <Dialog open={!!showAssignBank} onOpenChange={(open) => { if (!open) closeBankDialog(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" /> Gestione Banche
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-1">
            {/* Info pratica */}
            {showAssignBank && (
              <div className="bg-muted/50 rounded-lg px-4 py-2 text-sm">
                <p className="font-semibold">
                  {(showAssignBank as Practice & { clients?: { ragione_sociale: string } }).clients?.ragione_sociale ?? '—'}
                </p>
                <p className="text-xs text-muted-foreground font-mono">{showAssignBank.numero_pratica}</p>
              </div>
            )}

            {/* Banche già assegnate */}
            <div>
              <p className="text-sm font-semibold text-foreground mb-2">Banche assegnate</p>
              {loadingBankDialog ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Caricamento...
                </div>
              ) : existingPracticeBanks.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-1">Nessuna banca ancora assegnata.</p>
              ) : (
                <div className="space-y-3">
                  {existingPracticeBanks.map(pb => (
                    <div key={pb.id} className="border border-border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {pb.status === 'inviata'
                            ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                            : <Clock className="w-4 h-4 text-amber-500 shrink-0" />}
                          <span className="font-medium text-sm">{pb.banks?.nome}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pb.status === 'inviata' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {pb.status === 'inviata' ? 'Inviata' : 'Da inviare'}
                          </span>
                          <button
                            type="button"
                            title="Rimuovi banca dalla pratica"
                            disabled={removingBankId === pb.id}
                            onClick={() => handleRemoveBank(pb.id, pb.banks?.nome ?? 'questa banca')}
                            className="text-destructive/60 hover:text-destructive p-0.5 rounded disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {pb.status === 'inviata' && pb.data_invio && (
                        <p className="text-xs text-muted-foreground">
                          Inviata il {new Date(pb.data_invio).toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
                        </p>
                      )}
                      {/* Bottone invia + nota collassabile */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={pb.status === 'inviata' ? 'outline' : 'default'}
                            className="gap-1.5 flex-1"
                            disabled={sendingBankId === pb.bank_id}
                            onClick={() => handleSendExisting(pb.bank_id)}
                          >
                            <Send className="w-3.5 h-3.5" />
                            {sendingBankId === pb.bank_id
                              ? 'Invio in corso...'
                              : pb.status === 'inviata'
                                ? 'Reinvia documenti'
                                : 'Invia documenti alla banca'}
                          </Button>
                          <button
                            type="button"
                            className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                            onClick={() => setShowNoteFor(prev => ({ ...prev, [pb.bank_id]: !prev[pb.bank_id] }))}
                          >
                            {showNoteFor[pb.bank_id] ? 'Nascondi nota' : '+ Aggiungi nota'}
                          </button>
                        </div>
                        {showNoteFor[pb.bank_id] && (
                          <Textarea
                            placeholder="Note per l'invio (opzionale)..."
                            rows={2}
                            className="text-xs"
                            value={sendNoteFor[pb.bank_id] ?? ''}
                            onChange={e => setSendNoteFor(prev => ({ ...prev, [pb.bank_id]: e.target.value }))}
                            autoFocus
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Separatore */}
            <div className="border-t border-border" />

            {/* Aggiungi nuova banca */}
            <div className="space-y-3">
              <p className="text-sm font-semibold text-foreground">Aggiungi nuova banca</p>
              <div className="space-y-2">
                <Label>Banca *</Label>
                <Select value={assignBankId} onValueChange={setAssignBankId}>
                  <SelectTrigger><SelectValue placeholder="Seleziona banca..." /></SelectTrigger>
                  <SelectContent>
                    {banks
                      .filter(b => !allAssignedBankIds.includes(b.id))
                      .map(b => (
                        <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Note per la banca (opzionale)</Label>
                <Textarea
                  placeholder="Eventuali note da allegare all'invio..."
                  rows={2}
                  value={assignBankNote}
                  onChange={e => setAssignBankNote(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="sendBankEmailCheck"
                  checked={sendBankEmail}
                  onChange={e => setSendBankEmail(e.target.checked)}
                  className="h-4 w-4 accent-primary cursor-pointer"
                />
                <label htmlFor="sendBankEmailCheck" className="text-sm cursor-pointer select-none">
                  Invia subito email alla banca con i documenti disponibili
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBankDialog}>Chiudi</Button>
            <Button onClick={handleAssignBank} disabled={savingBank || !assignBankId}>
              {savingBank ? 'Salvataggio...' : sendBankEmail ? 'Assegna e Invia Email' : 'Assegna Banca'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog duplicazione pratica — solo super_admin */}
      <Dialog open={!!showDuplica} onOpenChange={(open) => { if (!open) { setShowDuplica(null); setDuplicaAgentId(''); setDuplicaNote(''); setDuplicaFile(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="w-5 h-5 text-amber-600" /> Duplica Pratica
            </DialogTitle>
          </DialogHeader>
          {showDuplica && (
            <div className="space-y-4 py-2">
              {/* Info pratica originale */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm space-y-1">
                <p className="text-xs text-amber-700 font-semibold uppercase tracking-wide">Pratica originale</p>
                <p className="font-semibold text-foreground">
                  {(showDuplica as Practice & { clients?: { ragione_sociale: string } }).clients?.ragione_sociale ?? '—'}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <code className="font-mono bg-white border rounded px-1">{showDuplica.numero_pratica}</code>
                  <Badge className={`text-[10px] ${STATUS_COLORS[showDuplica.status]}`}>{STATUS_LABELS[showDuplica.status]}</Badge>
                  {showDuplica.importo_richiesto && (
                    <span>€ {Number(showDuplica.importo_richiesto).toLocaleString('it-IT')}</span>
                  )}
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Verrà creata una nuova pratica in stato <strong>Bozza</strong> con gli stessi dati (cliente, importo, motivazione, ATECO, segnalatore) e i documenti standard obbligatori.
              </p>

              {/* Selezione agente */}
              <div className="space-y-2">
                <Label>Assegna a Agente <span className="text-muted-foreground font-normal">(opzionale)</span></Label>
                <Select value={duplicaAgentId} onValueChange={v => setDuplicaAgentId(v === 'nessuno' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Seleziona agente..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nessuno">— Nessuna assegnazione —</SelectItem>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.nome || a.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Note interne per il duplicato */}
              <div className="space-y-2">
                <Label>Note interne per il duplicato <span className="text-muted-foreground font-normal">(opzionale)</span></Label>
                <Textarea
                  placeholder="es. Pratica duplicata per secondo istituto..."
                  rows={2}
                  value={duplicaNote}
                  onChange={e => setDuplicaNote(e.target.value)}
                />
              </div>

              {/* Checkbox copia file */}
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <input
                  type="checkbox"
                  id="duplicaFileCheck"
                  checked={duplicaFile}
                  onChange={e => setDuplicaFile(e.target.checked)}
                  className="h-4 w-4 mt-0.5 accent-blue-600 cursor-pointer"
                />
                <div>
                  <label htmlFor="duplicaFileCheck" className="text-sm font-medium cursor-pointer select-none text-blue-800">
                    Includi anche i file già caricati
                  </label>
                  <p className="text-xs text-blue-700 mt-0.5">
                    {duplicaFile
                      ? 'I file verranno copiati in Storage e contrassegnati come "caricati". Può richiedere qualche secondo.'
                      : 'I documenti verranno copiati con stato "Richiesto" — i file dovranno essere ricaricati.'}
                  </p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowDuplica(null); setDuplicaAgentId(''); setDuplicaNote(''); setDuplicaFile(false); }}>
              Annulla
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 gap-2"
              onClick={handleDuplica}
              disabled={savingDuplica}
            >
              <Copy className="w-4 h-4" />
              {savingDuplica ? 'Duplicazione...' : 'Duplica Pratica'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
