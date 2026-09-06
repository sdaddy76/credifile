import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Plus, Search, BookUser, Pencil, Trash2, UserPlus,
  TrendingUp, Users, PhoneCall, XCircle, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Tipi ────────────────────────────────────────────────────────────────────

type LeadStato = 'nuovo' | 'contattato' | 'pratica_aperta' | 'perso';

interface Lead {
  id: string;
  nome: string;
  cognome: string | null;
  email: string | null;
  telefono: string | null;
  azienda: string;
  ruolo_azienda: string | null;
  note: string | null;
  stato: LeadStato;
  importo_potenziale: number | null;
  agente_id: string | null;
  codice_ateco: string | null;
  citta: string | null;
  created_at: string;
  updated_at: string;
  admin_profiles?: { nome: string | null } | null;
}

interface AgentProfile {
  id: string;
  nome: string | null;
  email: string;
}

interface FormState {
  nome: string;
  cognome: string;
  email: string;
  telefono: string;
  azienda: string;
  ruolo_azienda: string;
  codice_ateco: string;
  citta: string;
  importo_potenziale: string;
  stato: LeadStato;
  agente_id: string;
  note: string;
}

// ─── Costanti ─────────────────────────────────────────────────────────────────

const EMPTY_FORM: FormState = {
  nome: '', cognome: '', email: '', telefono: '',
  azienda: '', ruolo_azienda: '', codice_ateco: '', citta: '',
  importo_potenziale: '', stato: 'nuovo', agente_id: '', note: '',
};

const STATO_LABELS: Record<LeadStato, string> = {
  nuovo:        'Nuovo',
  contattato:   'Contattato',
  pratica_aperta: 'Pratica Aperta',
  perso:        'Perso',
};

const STATO_BADGE: Record<LeadStato, string> = {
  nuovo:          'bg-slate-100 text-slate-700 border-slate-200',
  contattato:     'bg-blue-100 text-blue-700 border-blue-200',
  pratica_aperta: 'bg-green-100 text-green-700 border-green-200',
  perso:          'bg-red-100 text-red-700 border-red-200',
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function nomeAgente(ap: { nome: string | null } | null | undefined): string {
  if (!ap) return '—';
  return ap.nome || '—';
}

function formatEuro(val: number | null): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function RubricaPage() {
  const { user, role, loading: authLoading, isSuperAdmin, isSegreteria } = useAuth();
  const canSeeAllAgenti = isSuperAdmin || isSegreteria;

  const [leads,        setLeads]        = useState<Lead[]>([]);
  const [agents,       setAgents]       = useState<AgentProfile[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [search,       setSearch]       = useState('');
  const [filterStato,  setFilterStato]  = useState<string>('tutti');
  const [filterAgente, setFilterAgente] = useState<string>('tutti');

  // Dialog form
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState<Lead | null>(null);
  const [form,       setForm]       = useState<FormState>(EMPTY_FORM);
  const [saving,     setSaving]     = useState(false);

  // Conversione in corso
  const [converting, setConverting] = useState<string | null>(null);

  // ── Load dati ─────────────────────────────────────────────────────────────

  async function loadAgents() {
    const { data } = await supabase
      .from('admin_profiles')
      .select('id, nome, email')
      .eq('ruolo', 'agente')
      .order('nome');
    setAgents((data ?? []) as AgentProfile[]);
  }

  async function loadLeads() {
    if (!user?.id) return;
    let query = supabase
      .from('leads')
      .select('*, admin_profiles(nome)')
      .order('created_at', { ascending: false });

    // Gli agenti vedono solo i propri lead
    if (role === 'agente') {
      query = query.eq('agente_id', user.id);
    }

    const { data, error } = await query;
    if (error) toast.error('Errore caricamento lead: ' + error.message);
    setLeads((data ?? []) as Lead[]);
    setLoading(false);
  }

  useEffect(() => {
    if (!authLoading && user?.id) {
      loadAgents();
      loadLeads();
    }
  }, [authLoading, user?.id, role]);

  // ── KPI ───────────────────────────────────────────────────────────────────

  const totale     = leads.length;
  const contattati = leads.filter(l => l.stato === 'contattato').length;
  const convertiti = leads.filter(l => l.stato === 'pratica_aperta').length;
  const persi      = leads.filter(l => l.stato === 'perso').length;

  const pct = (n: number) => totale === 0 ? '0%' : `${Math.round((n / totale) * 100)}%`;

  // ── Filtro ────────────────────────────────────────────────────────────────

  const filtered = leads.filter(l => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      l.nome.toLowerCase().includes(q) ||
      (l.cognome ?? '').toLowerCase().includes(q) ||
      l.azienda.toLowerCase().includes(q) ||
      (l.email ?? '').toLowerCase().includes(q);

    const matchStato   = filterStato   === 'tutti' || l.stato === filterStato;
    const matchAgente  = filterAgente  === 'tutti' || l.agente_id === filterAgente;

    return matchSearch && matchStato && matchAgente;
  });

  // ── Form helpers ──────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, agente_id: role === 'agente' ? (user?.id ?? '') : '' });
    setShowForm(true);
  };

  const openEdit = (lead: Lead) => {
    setEditing(lead);
    setForm({
      nome:              lead.nome,
      cognome:           lead.cognome       ?? '',
      email:             lead.email         ?? '',
      telefono:          lead.telefono      ?? '',
      azienda:           lead.azienda,
      ruolo_azienda:     lead.ruolo_azienda ?? '',
      codice_ateco:      lead.codice_ateco  ?? '',
      citta:             lead.citta         ?? '',
      importo_potenziale: lead.importo_potenziale != null ? String(lead.importo_potenziale) : '',
      stato:             lead.stato,
      agente_id:         lead.agente_id     ?? '',
      note:              lead.note          ?? '',
    });
    setShowForm(true);
  };

  const setField = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  // ── Salvataggio ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.error('Il nome è obbligatorio'); return; }
    if (!form.azienda.trim()) { toast.error("L'azienda è obbligatoria"); return; }
    if (!user?.id) return;

    setSaving(true);
    const payload = {
      nome:               form.nome.trim(),
      cognome:            form.cognome.trim()        || null,
      email:              form.email.trim()          || null,
      telefono:           form.telefono.trim()       || null,
      azienda:            form.azienda.trim(),
      ruolo_azienda:      form.ruolo_azienda.trim()  || null,
      codice_ateco:       form.codice_ateco.trim()   || null,
      citta:              form.citta.trim()           || null,
      importo_potenziale: form.importo_potenziale ? Number(form.importo_potenziale) : null,
      stato:              form.stato,
      agente_id:          form.agente_id || (role === 'agente' ? user.id : null),
      note:               form.note.trim()           || null,
      updated_at:         new Date().toISOString(),
    };

    if (editing) {
      const { error } = await supabase.from('leads').update(payload).eq('id', editing.id);
      if (error) { toast.error('Errore aggiornamento: ' + error.message); setSaving(false); return; }
      toast.success('Lead aggiornato');
    } else {
      const { error } = await supabase.from('leads').insert({ ...payload, created_at: new Date().toISOString() });
      if (error) { toast.error('Errore creazione: ' + error.message); setSaving(false); return; }
      toast.success('Lead creato');
    }

    setSaving(false);
    setShowForm(false);
    loadLeads();
  };

  // ── Elimina ───────────────────────────────────────────────────────────────

  const handleDelete = async (lead: Lead) => {
    const label = `${lead.nome}${lead.cognome ? ' ' + lead.cognome : ''} (${lead.azienda})`;
    if (!confirm(`Eliminare il lead "${label}"?`)) return;
    const { error } = await supabase.from('leads').delete().eq('id', lead.id);
    if (error) { toast.error('Errore eliminazione: ' + error.message); return; }
    toast.success('Lead eliminato');
    loadLeads();
  };

  // ── Converti in Cliente ───────────────────────────────────────────────────

  const handleConvert = async (lead: Lead) => {
    if (!confirm(`Convertire "${lead.azienda}" in cliente? Verrà creato un record in Clienti e il lead passerà a "Pratica Aperta".`)) return;

    setConverting(lead.id);
    try {
      // 1. Crea il cliente
      const { error: clientErr } = await supabase.from('clients').insert({
        ragione_sociale: lead.azienda,
        email:           lead.email ?? `lead-${lead.id}@placeholder.it`,
        telefono:        lead.telefono   ?? null,
        indirizzo:       lead.citta      ?? null,
        codice_ateco:    lead.codice_ateco ?? null,
        created_by:      user?.id,
      });

      if (clientErr) {
        toast.error('Errore creazione cliente: ' + clientErr.message);
        setConverting(null);
        return;
      }

      // 2. Aggiorna lo stato del lead a pratica_aperta
      const { error: leadErr } = await supabase
        .from('leads')
        .update({ stato: 'pratica_aperta', updated_at: new Date().toISOString() })
        .eq('id', lead.id);

      if (leadErr) {
        toast.error('Cliente creato, ma errore aggiornamento lead: ' + leadErr.message);
        setConverting(null);
        return;
      }

      toast.success(`✅ "${lead.azienda}" convertita in cliente!`);
      // 3. Naviga alla lista clienti (HashRouter)
      window.location.assign('/admin/clienti');
    } catch (e) {
      toast.error('Errore inatteso: ' + String(e));
    } finally {
      setConverting(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BookUser className="w-6 h-6 text-primary" />
            Rubrica Lead
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {totale} lead totali
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" /> Aggiungi Lead
        </Button>
      </div>

      {/* ── KPI ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-slate-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Totale</p>
              <p className="text-xl font-bold">{totale}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
              <PhoneCall className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Contattati</p>
              <p className="text-xl font-bold">{pct(contattati)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Convertiti</p>
              <p className="text-xl font-bold">{pct(convertiti)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
              <XCircle className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Persi</p>
              <p className="text-xl font-bold">{pct(persi)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Barra filtri ── */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Cerca per nome o azienda…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <Select value={filterStato} onValueChange={setFilterStato}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Tutti gli stati" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tutti">Tutti gli stati</SelectItem>
            {(Object.keys(STATO_LABELS) as LeadStato[]).map(s => (
              <SelectItem key={s} value={s}>{STATO_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canSeeAllAgenti && (
          <Select value={filterAgente} onValueChange={setFilterAgente}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Tutti gli agenti" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tutti">Tutti gli agenti</SelectItem>
              {agents.map(a => (
                <SelectItem key={a.id} value={a.id}>
                  {a.nome || a.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ── Tabella ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BookUser className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
            <p className="text-muted-foreground">Nessun lead trovato</p>
            <Button variant="outline" className="mt-4" onClick={openCreate}>
              Aggiungi il primo lead
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Azienda</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Telefono</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Importo Pot.</TableHead>
                  {canSeeAllAgenti && <TableHead>Agente</TableHead>}
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(lead => (
                  <TableRow key={lead.id}>
                    <TableCell className="font-medium whitespace-nowrap">
                      {lead.nome}{lead.cognome ? ' ' + lead.cognome : ''}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div>{lead.azienda}</div>
                      {lead.citta && (
                        <div className="text-xs text-muted-foreground">{lead.citta}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {lead.email ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {lead.telefono ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs border ${STATO_BADGE[lead.stato]}`}>
                        {STATO_LABELS[lead.stato]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap font-mono text-sm">
                      {formatEuro(lead.importo_potenziale)}
                    </TableCell>
                    {canSeeAllAgenti && (
                      <TableCell className="text-sm whitespace-nowrap">
                        {nomeAgente(lead.admin_profiles)}
                      </TableCell>
                    )}
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(lead.created_at).toLocaleDateString('it-IT')}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Converti in cliente */}
                        {lead.stato !== 'pratica_aperta' && (
                          <Button
                            variant="ghost" size="sm"
                            className="h-8 w-8 p-0 text-green-600 hover:bg-green-50 hover:text-green-700"
                            title="Converti in Cliente"
                            disabled={converting === lead.id}
                            onClick={() => handleConvert(lead)}
                          >
                            {converting === lead.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <UserPlus className="w-3.5 h-3.5" />
                            }
                          </Button>
                        )}
                        {/* Modifica */}
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0"
                          title="Modifica"
                          onClick={() => openEdit(lead)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {/* Elimina */}
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                          title="Elimina"
                          onClick={() => handleDelete(lead)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Dialog Aggiungi / Modifica ── */}
      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica Lead' : 'Nuovo Lead'}</DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">

            {/* Nome */}
            <div className="space-y-1.5">
              <Label>Nome *</Label>
              <Input
                placeholder="Mario"
                value={form.nome}
                onChange={e => setField('nome', e.target.value)}
              />
            </div>

            {/* Cognome */}
            <div className="space-y-1.5">
              <Label>Cognome</Label>
              <Input
                placeholder="Rossi"
                value={form.cognome}
                onChange={e => setField('cognome', e.target.value)}
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="mario@esempio.it"
                value={form.email}
                onChange={e => setField('email', e.target.value)}
              />
            </div>

            {/* Telefono */}
            <div className="space-y-1.5">
              <Label>Telefono</Label>
              <Input
                placeholder="+39 333 1234567"
                value={form.telefono}
                onChange={e => setField('telefono', e.target.value)}
              />
            </div>

            {/* Azienda */}
            <div className="space-y-1.5">
              <Label>Azienda *</Label>
              <Input
                placeholder="Rossi S.r.l."
                value={form.azienda}
                onChange={e => setField('azienda', e.target.value)}
              />
            </div>

            {/* Ruolo */}
            <div className="space-y-1.5">
              <Label>Ruolo in Azienda</Label>
              <Input
                placeholder="Titolare / CFO…"
                value={form.ruolo_azienda}
                onChange={e => setField('ruolo_azienda', e.target.value)}
              />
            </div>

            {/* Codice ATECO */}
            <div className="space-y-1.5">
              <Label>Codice ATECO</Label>
              <Input
                placeholder="Es. 46.90"
                value={form.codice_ateco}
                onChange={e => setField('codice_ateco', e.target.value)}
              />
            </div>

            {/* Città */}
            <div className="space-y-1.5">
              <Label>Città</Label>
              <Input
                placeholder="Milano"
                value={form.citta}
                onChange={e => setField('citta', e.target.value)}
              />
            </div>

            {/* Importo potenziale */}
            <div className="space-y-1.5">
              <Label>Importo Potenziale (€)</Label>
              <Input
                type="number"
                min="0"
                placeholder="50000"
                value={form.importo_potenziale}
                onChange={e => setField('importo_potenziale', e.target.value)}
              />
            </div>

            {/* Stato */}
            <div className="space-y-1.5">
              <Label>Stato</Label>
              <Select value={form.stato} onValueChange={v => setField('stato', v as LeadStato)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATO_LABELS) as LeadStato[]).map(s => (
                    <SelectItem key={s} value={s}>{STATO_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Agente — visibile solo a super_admin e segreteria */}
            {canSeeAllAgenti && (
              <div className="col-span-2 space-y-1.5">
                <Label>Assegna ad Agente</Label>
                <Select
                  value={form.agente_id || '__none__'}
                  onValueChange={v => setField('agente_id', v === '__none__' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nessun agente" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Nessun agente —</SelectItem>
                    {agents.map(a => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.nome || a.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Note */}
            <div className="col-span-2 space-y-1.5">
              <Label>Note</Label>
              <Textarea
                placeholder="Note libere sul lead…"
                rows={3}
                value={form.note}
                onChange={e => setField('note', e.target.value)}
              />
            </div>

          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving
                ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Salvo…</>
                : editing ? 'Salva Modifiche' : 'Crea Lead'
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
