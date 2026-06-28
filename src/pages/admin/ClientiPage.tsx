import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Plus, Search, Users, Pencil, Trash2, Mail, Phone,
  FileText, Loader2, CheckCircle2, AlertCircle, Users2, Building2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Client, Socio, Amministratore } from '@/lib/types';
import { extractPdfText, parseVisuraCompleta, type VisuraResult } from '@/lib/parseVisura';

// ═══════════════════════════════════════════════════════════
//  TIPI VISURA
// ═══════════════════════════════════════════════════════════

type VisuraData = Omit<VisuraResult, 'qualita' | 'soci' | 'amministratori'> & {
  soci?: Socio[];
  amministratori?: Amministratore[];
};

interface ParseResult {
  data:     VisuraData;
  found:    string[];
  notFound: string[];
}

/** Costruisce il feedback trovati/non trovati */
function buildParseResult(d: VisuraData): ParseResult {
  const LABELS: Record<keyof VisuraData, string> = {
    ragione_sociale:   'Ragione Sociale',
    piva:              'P.IVA',
    codice_fiscale:    'Codice Fiscale',
    indirizzo:         'Sede Legale',
    email:             'Email',
    telefono:          'Telefono',
    codice_ateco:      'ATECO',
    data_costituzione: 'Data Costituzione',
    capitale_versato:  'Capitale Versato',
    forma_giuridica:   'Forma Giuridica',
    capitale_sociale:  'Capitale Sociale',
    ateco_descrizione: 'Descrizione ATECO',
    soci:              'Soci',
    amministratori:    'Amministratori',
  };
  const found: string[] = [], notFound: string[] = [];
  (Object.keys(LABELS) as (keyof VisuraData)[]).forEach(k => {
    const v = d[k];
    const present = Array.isArray(v) ? v.length > 0 : Boolean(v);
    (present ? found : notFound).push(LABELS[k]);
  });
  return { data: d, found, notFound };
}

// ═══════════════════════════════════════════════════════════
//  FORM STATE
// ═══════════════════════════════════════════════════════════

interface FormState {
  ragione_sociale:       string;
  piva:                  string;
  codice_fiscale:        string;
  email:                 string;
  telefono:              string;
  indirizzo:             string;
  data_costituzione:     string;
  capitale_versato:      string;
  soci:                  Socio[];
  amministratori:        Amministratore[];
}

const EMPTY: FormState = {
  ragione_sociale: '', piva: '', codice_fiscale: '', email: '',
  telefono: '', indirizzo: '', data_costituzione: '', capitale_versato: '',
  soci: [], amministratori: [],
};

// ═══════════════════════════════════════════════════════════
//  COMPONENTE
// ═══════════════════════════════════════════════════════════

export default function ClientiPage() {
  const { user, loading: authLoading, isSegnalatore, isAgente, isSegreteria } = useAuth();
  const [clients,     setClients]     = useState<Client[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [showForm,    setShowForm]    = useState(false);
  const [editing,     setEditing]     = useState<Client | null>(null);
  const [form,        setForm]        = useState<FormState>(EMPTY);
  const [saving,      setSaving]      = useState(false);
  const [parsing,     setParsing]     = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sezione documenti per segnalatore
  const [segOpenClientId, setSegOpenClientId] = useState<string | null>(null);
  const [segPracticeId, setSegPracticeId]     = useState<string | null>(null);
  const [segDocs, setSegDocs]                 = useState<{id:string;nome:string;status:string}[]>([]);
  const [segUploading, setSegUploading]       = useState<string | null>(null);
  const fileSegRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function load() {
    if (!user?.id) return;
    if (isSegnalatore) {
      const { data: pratt } = await supabase.from('practices').select('client_id').eq('segnalatore_id', user.id);
      const ids = [...new Set((pratt ?? []).map((p: {client_id:string}) => p.client_id).filter(Boolean))];
      if (ids.length === 0) { setClients([]); setLoading(false); return; }
      const { data } = await supabase.from('clients').select('*').in('id', ids).order('ragione_sociale');
      setClients(data ?? []);
    } else if (isAgente) {
      // Agente: vede i clienti con pratiche assegnate a lui + i clienti da lui creati direttamente
      const { data: pratt } = await supabase.from('practices').select('client_id').eq('assigned_to', user.id);
      const practiceIds = (pratt ?? []).map((p: {client_id:string}) => p.client_id).filter(Boolean);
      const { data: myClients } = await supabase.from('clients').select('id').eq('created_by', user.id);
      const myIds = (myClients ?? []).map((c: {id:string}) => c.id);
      const ids = [...new Set([...practiceIds, ...myIds])];
      if (ids.length === 0) { setClients([]); setLoading(false); return; }
      const { data } = await supabase.from('clients').select('*').in('id', ids).order('ragione_sociale');
      setClients(data ?? []);
    } else if (isSegreteria) {
      // Segreteria: vede solo i clienti con pratiche assegnate ai suoi agenti
      const { data: assignments } = await supabase.from('segreteria_agent_assignments').select('agent_user_id').eq('segreteria_user_id', user.id);
      const agentIds = (assignments ?? []).map((a: {agent_user_id:string}) => a.agent_user_id);
      if (agentIds.length === 0) { setClients([]); setLoading(false); return; }
      const { data: pratt } = await supabase.from('practices').select('client_id').in('assigned_to', agentIds);
      const ids = [...new Set((pratt ?? []).map((p: {client_id:string}) => p.client_id).filter(Boolean))];
      if (ids.length === 0) { setClients([]); setLoading(false); return; }
      const { data } = await supabase.from('clients').select('*').in('id', ids).order('ragione_sociale');
      setClients(data ?? []);
    } else {
      const { data, error } = await supabase.from('clients').select('*').order('ragione_sociale');
      if (error) toast.error('Errore caricamento clienti: ' + error.message);
      setClients(data ?? []);
    }
    setLoading(false);
  }

  async function openSegDocs(clientId: string) {
    if (!user?.id) return;
    setSegOpenClientId(clientId);
    setSegDocs([]); setSegPracticeId(null);
    const { data } = await supabase.from('practices').select('id').eq('client_id', clientId).eq('segnalatore_id', user.id).limit(1).maybeSingle();
    if (!data?.id) { toast.error('Nessuna pratica trovata'); return; }
    setSegPracticeId(data.id);
    const { data: docs } = await supabase.from('practice_documents').select('id,nome,status').eq('practice_id', data.id).order('created_at');
    setSegDocs((docs ?? []) as {id:string;nome:string;status:string}[]);
  }

  async function handleSegUpload(docId: string, file: File) {
    if (!segPracticeId || !user?.id) return;
    setSegUploading(docId);
    const ext = file.name.split('.').pop();
    const path = `${segPracticeId}/${docId}/${Date.now()}.${ext}`;
    try { await supabase.storage.from('practice-files').upload(path, file, { upsert: false }); } catch (_) { /* ok */ }
    await supabase.from('uploaded_files').insert({ practice_id: segPracticeId, doc_id: docId, nome_file: file.name, storage_path: path, uploaded_by: user.id });
    await supabase.from('practice_documents').update({ status: 'caricato', uploaded_at: new Date().toISOString() }).eq('id', docId);
    setSegUploading(null);
    toast.success('Documento caricato!');
    const { data: docs } = await supabase.from('practice_documents').select('id,nome,status').eq('practice_id', segPracticeId!).order('created_at');
    setSegDocs((docs ?? []) as {id:string;nome:string;status:string}[]);
  }

  useEffect(() => { if (!authLoading && user?.id) load(); }, [authLoading, user?.id, isSegnalatore, isAgente, isSegreteria]);

  const toForm = (c: Client): FormState => ({
    ragione_sociale:   c.ragione_sociale,
    piva:              c.piva             ?? '',
    codice_fiscale:    c.codice_fiscale   ?? '',
    email:             c.email,
    telefono:          c.telefono         ?? '',
    indirizzo:         c.indirizzo        ?? '',
    data_costituzione: c.data_costituzione ?? '',
    capitale_versato:  c.capitale_sociale_versato ?? '',
    soci:              c.soci             ?? [],
    amministratori:    c.amministratori   ?? [],
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY); setParseResult(null); setShowForm(true); };
  const openEdit   = (c: Client) => { setEditing(c); setForm(toForm(c)); setParseResult(null); setShowForm(true); };

  // ── Import visura ─────────────────────────────────────────────────────────
  const handleVisuraFile = async (file: File) => {
    if (file.type !== 'application/pdf') { toast.error('Seleziona un file PDF'); return; }
    setParsing(true); setParseResult(null);
    try {
      const text   = await extractPdfText(await file.arrayBuffer());
      const parsedCompleta = parseVisuraCompleta(text);
      const parsed: VisuraData = {
        ...parsedCompleta,
        soci: parsedCompleta.soci.length > 0 ? parsedCompleta.soci : undefined,
        amministratori: parsedCompleta.amministratori.length > 0 ? parsedCompleta.amministratori : undefined,
      };
      const result = buildParseResult(parsed);
      // Pre-compila solo i campi testo vuoti (non sovrascrive dati esistenti)
      setForm(prev => ({
        ragione_sociale:   prev.ragione_sociale   || parsed.ragione_sociale   || '',
        piva:              prev.piva              || parsed.piva              || '',
        codice_fiscale:    prev.codice_fiscale    || parsed.codice_fiscale    || '',
        email:             prev.email             || parsed.email             || '',
        telefono:          prev.telefono          || parsed.telefono          || '',
        indirizzo:         prev.indirizzo         || parsed.indirizzo         || '',
        data_costituzione: prev.data_costituzione || parsed.data_costituzione || '',
        capitale_versato:  prev.capitale_versato  || parsed.capitale_versato  || '',
        // Soci e amministratori si aggiornano sempre da visura
        soci:              parsed.soci           ?? prev.soci,
        amministratori:    parsed.amministratori ?? prev.amministratori,
      }));
      setParseResult(result);
      toast.success(`Estratti: ${result.found.join(', ')}`);
    } catch (e) {
      toast.error('Errore lettura PDF: ' + String(e));
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Salva cliente ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.ragione_sociale.trim() || !form.email.trim()) {
      toast.error('Ragione sociale ed email obbligatori'); return;
    }
    if (!user?.id) { toast.error('Sessione non valida. Ricarica la pagina.'); return; }
    setSaving(true);
    const payload = {
      ragione_sociale:         form.ragione_sociale.trim(),
      piva:                    form.piva             || null,
      codice_fiscale:          form.codice_fiscale   || null,
      email:                   form.email.trim(),
      telefono:                form.telefono         || null,
      indirizzo:               form.indirizzo        || null,
      data_costituzione:       form.data_costituzione || null,
      capitale_sociale_versato: form.capitale_versato || null,
      soci:                    form.soci.length           > 0 ? form.soci           : null,
      amministratori:          form.amministratori.length > 0 ? form.amministratori : null,
    };
    if (editing) {
      const { error } = await supabase.from('clients').update(payload).eq('id', editing.id);
      if (error) { toast.error('Errore aggiornamento: ' + error.message); setSaving(false); return; }
      if (payload.email !== editing.email) {
        const { data: practices } = await supabase.from('practices').select('id').eq('client_id', editing.id);
        if (practices?.length) {
          await supabase.from('practice_access_codes')
            .update({ email_cliente: payload.email.toLowerCase() })
            .in('practice_id', practices.map((p: { id: string }) => p.id));
        }
      }
      toast.success('Cliente aggiornato');
    } else {
      const { error } = await supabase.from('clients').insert({ ...payload, created_by: user.id });
      if (error) { toast.error('Errore creazione: ' + error.message); setSaving(false); return; }
      toast.success('Cliente creato');
    }
    setSaving(false); setShowForm(false); load();
  };

  const handleDelete = async (id: string, nome: string) => {
    if (!confirm(`Eliminare il cliente "${nome}"? Saranno eliminate anche le pratiche associate.`)) return;
    await supabase.from('clients').delete().eq('id', id);
    toast.success('Cliente eliminato'); load();
  };

  const filtered = clients.filter(c =>
    c.ragione_sociale.toLowerCase().includes(search.toLowerCase()) ||
    (c.piva ?? '').includes(search) ||
    (c.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Intestazione */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clienti</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isSegnalatore ? 'Clienti delle tue pratiche' : `${clients.length} clienti registrati`}
          </p>
        </div>
        {!isSegnalatore && <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nuovo Cliente</Button>}
      </div>

      {/* Ricerca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Cerca per nome, P.IVA, email…" className="pl-9"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-muted-foreground">Nessun cliente trovato</p>
          <Button variant="outline" className="mt-4" onClick={openCreate}>Aggiungi il primo cliente</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <Card key={c.id} className="border-border hover:border-primary/30 transition-colors">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">{c.ragione_sociale.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{c.ragione_sociale}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      {c.piva && <span className="font-mono">P.IVA: {c.piva}</span>}
                      <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>
                      {c.telefono && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.telefono}</span>}
                      {c.soci && c.soci.length > 0 && (
                        <span className="flex items-center gap-1 text-blue-600">
                          <Users2 className="w-3 h-3" />{c.soci.length} soc.
                        </span>
                      )}
                      {c.amministratori && c.amministratori.length > 0 && (
                        <span className="flex items-center gap-1 text-violet-600">
                          <Building2 className="w-3 h-3" />Amm.: {c.amministratori.map(a => a.nome).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {isSegnalatore ? (
                      <Button variant="outline" size="sm" className="text-xs gap-1 h-8 px-2 text-orange-700 border-orange-300 hover:bg-orange-50"
                        onClick={() => openSegDocs(c.id)}>
                        <FileText className="w-3.5 h-3.5" /> Documenti
                      </Button>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(c.id, c.ragione_sociale)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog nuovo/modifica cliente */}
      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setParseResult(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica Cliente' : 'Nuovo Cliente'}</DialogTitle>
          </DialogHeader>

          {/* ── Riquadro Import Visura ── */}
          <div className="bg-muted/40 rounded-lg px-4 py-3 border border-dashed border-border space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Importa da Visura Camerale
              </p>
              <label className="cursor-pointer">
                <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1.5 pointer-events-none">
                  <span>
                    {parsing
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Lettura PDF…</>
                      : <><FileText className="w-3 h-3" />Carica visura PDF</>}
                  </span>
                </Button>
                <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                  disabled={parsing}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleVisuraFile(f); }} />
              </label>
            </div>

            {parseResult && (
              <div className="space-y-1">
                {parseResult.found.length > 0 && (
                  <div className="flex items-start gap-1.5 text-xs text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span><strong>Trovati:</strong> {parseResult.found.join(' · ')}</span>
                  </div>
                )}
                {parseResult.notFound.length > 0 && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span><strong>Non trovati:</strong> {parseResult.notFound.join(' · ')}</span>
                  </div>
                )}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              Funziona su visure camerali ufficiali del Registro Imprese (PDF digitale, non scansioni).
            </p>
          </div>

          {/* ── Campi base ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Ragione Sociale *</Label>
              <Input placeholder="Es. Mario Rossi S.r.l." value={form.ragione_sociale}
                onChange={e => setForm(f => ({ ...f, ragione_sociale: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>P.IVA</Label>
              <Input placeholder="12345678901" value={form.piva}
                onChange={e => setForm(f => ({ ...f, piva: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Codice Fiscale</Label>
              <Input placeholder="RSSMRA80…" value={form.codice_fiscale}
                onChange={e => setForm(f => ({ ...f, codice_fiscale: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" placeholder="info@azienda.it" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefono</Label>
              <Input placeholder="+39 02 1234567" value={form.telefono}
                onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Indirizzo Sede</Label>
              <Input placeholder="Via Roma 1, 20100 Milano" value={form.indirizzo}
                onChange={e => setForm(f => ({ ...f, indirizzo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Data Costituzione</Label>
              <Input placeholder="gg/mm/aaaa" value={form.data_costituzione}
                onChange={e => setForm(f => ({ ...f, data_costituzione: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Capitale Sociale Versato (€)</Label>
              <Input placeholder="10.000,00" value={form.capitale_versato}
                onChange={e => setForm(f => ({ ...f, capitale_versato: e.target.value }))} />
            </div>
          </div>

          {/* ── Soci / Titolari — sempre visibile, editabile ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Users2 className="w-3.5 h-3.5 text-blue-500" />
                Soci / Titolari {form.soci.length > 0 && `(${form.soci.length})`}
              </p>
              <Button
                type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                onClick={() => setForm(f => ({ ...f, soci: [...f.soci, { nome: '', codice_fiscale: '', valore: '', percentuale: '' }] }))}
              >
                <Plus className="w-3 h-3" /> Aggiungi
              </Button>
            </div>
            {form.soci.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded-md border-border">
                Nessun socio. Carica la visura o aggiungi manualmente.
              </p>
            ) : (
              <div className="space-y-1.5">
                {form.soci.length > 0 && (
                  <div className="flex gap-1.5 px-0.5">
                    <span className="text-[10px] text-muted-foreground flex-[2] px-1">Nome / Denominazione</span>
                    <span className="text-[10px] text-muted-foreground flex-[1.5] px-1">Cod. Fiscale</span>
                    <span className="text-[10px] text-muted-foreground flex-1 px-1">Valore €</span>
                    <span className="text-[10px] text-muted-foreground w-16 shrink-0 px-1">%</span>
                    <span className="w-7 shrink-0" />
                  </div>
                )}
                {form.soci.map((s, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <Input
                      placeholder="Nome / Denominazione"
                      value={s.nome}
                      className="h-7 text-xs flex-[2]"
                      onChange={e => setForm(f => ({ ...f, soci: f.soci.map((x, j) => j === i ? { ...x, nome: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="Cod. Fiscale"
                      value={s.codice_fiscale}
                      className="h-7 text-xs flex-[1.5] font-mono"
                      onChange={e => setForm(f => ({ ...f, soci: f.soci.map((x, j) => j === i ? { ...x, codice_fiscale: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="Valore"
                      value={s.valore}
                      className="h-7 text-xs flex-1"
                      onChange={e => setForm(f => ({ ...f, soci: f.soci.map((x, j) => j === i ? { ...x, valore: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="%"
                      value={s.percentuale}
                      className="h-7 text-xs w-16 shrink-0"
                      onChange={e => setForm(f => ({ ...f, soci: f.soci.map((x, j) => j === i ? { ...x, percentuale: e.target.value } : x) }))}
                    />
                    <Button
                      type="button" variant="ghost" size="sm"
                      className="h-7 w-7 p-0 shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => setForm(f => ({ ...f, soci: f.soci.filter((_, j) => j !== i) }))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Organi Sociali / Amministratori — sempre visibile, editabile ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-violet-500" />
                Organi Sociali / Amministratori {form.amministratori.length > 0 && `(${form.amministratori.length})`}
              </p>
              <Button
                type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                onClick={() => setForm(f => ({ ...f, amministratori: [...f.amministratori, { nome: '', carica: '', codice_fiscale: '' }] }))}
              >
                <Plus className="w-3 h-3" /> Aggiungi
              </Button>
            </div>
            {form.amministratori.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded-md border-border">
                Nessun amministratore. Carica la visura o aggiungi manualmente.
              </p>
            ) : (
              <div className="space-y-1.5">
                {form.amministratori.length > 0 && (
                  <div className="flex gap-1.5 px-0.5">
                    <span className="text-[10px] text-muted-foreground flex-[2] px-1">Nome</span>
                    <span className="text-[10px] text-muted-foreground flex-[1.5] px-1">Carica</span>
                    <span className="text-[10px] text-muted-foreground flex-[1.5] px-1">Cod. Fiscale</span>
                    <span className="w-7 shrink-0" />
                  </div>
                )}
                {form.amministratori.map((a, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <Input
                      placeholder="Nome"
                      value={a.nome}
                      className="h-7 text-xs flex-[2]"
                      onChange={e => setForm(f => ({ ...f, amministratori: f.amministratori.map((x, j) => j === i ? { ...x, nome: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="Carica (es. Amm. Unico)"
                      value={a.carica}
                      className="h-7 text-xs flex-[1.5]"
                      onChange={e => setForm(f => ({ ...f, amministratori: f.amministratori.map((x, j) => j === i ? { ...x, carica: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="Cod. Fiscale"
                      value={a.codice_fiscale ?? ''}
                      className="h-7 text-xs flex-[1.5] font-mono"
                      onChange={e => setForm(f => ({ ...f, amministratori: f.amministratori.map((x, j) => j === i ? { ...x, codice_fiscale: e.target.value } : x) }))}
                    />
                    <Button
                      type="button" variant="ghost" size="sm"
                      className="h-7 w-7 p-0 shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => setForm(f => ({ ...f, amministratori: f.amministratori.filter((_, j) => j !== i) }))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Salvo…' : editing ? 'Salva Modifiche' : 'Crea Cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog documenti segnalatore */}
      <Dialog open={!!segOpenClientId} onOpenChange={v => { if (!v) { setSegOpenClientId(null); setSegDocs([]); setSegPracticeId(null); } }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>📄 Documenti Pratica</DialogTitle></DialogHeader>
          {segDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {segPracticeId === null ? 'Caricamento...' : 'Nessun documento richiesto per questa pratica.'}
            </p>
          ) : (
            <div className="space-y-2 py-2">
              {segDocs.map(doc => {
                const done = doc.status === 'caricato' || doc.status === 'approvato';
                return (
                  <div key={doc.id} className={`flex items-center justify-between p-2.5 rounded-lg border text-sm ${done ? 'bg-green-50 border-green-200' : 'bg-muted/40 border-border'}`}>
                    <div className="flex items-center gap-2">
                      {done
                        ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        : <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />}
                      <span className={done ? 'text-green-800 font-medium' : 'font-medium'}>{doc.nome}</span>
                    </div>
                    {!done && (
                      <>
                        <input type="file" className="hidden" ref={el => { fileSegRefs.current[doc.id] = el; }}
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleSegUpload(doc.id, f); e.target.value = ''; }} />
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                          disabled={segUploading === doc.id}
                          onClick={() => fileSegRefs.current[doc.id]?.click()}>
                          {segUploading === doc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                          {segUploading === doc.id ? 'Upload...' : 'Carica'}
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSegOpenClientId(null); setSegDocs([]); setSegPracticeId(null); }}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
