import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Search, FolderOpen, Eye, Calendar, Euro, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { STATUS_LABELS, STATUS_COLORS, type Practice, type Client, type Bank } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';

export default function PratichePage() {
  const navigate = useNavigate();
  const { isAgente, isSuperAdmin, isSegreteria, canEdit, user } = useAuth();
  const [practices, setPractices] = useState<Practice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('tutti');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    client_id: '', bank_id: '', importo_richiesto: '', motivazione: '', note_admin: ''
  });

  async function load() {
    let query = supabase.from('practices').select('*, clients(ragione_sociale,email), banks(nome)');

    if (isAgente && user?.id) {
      // Agente: vede solo le proprie pratiche
      query = query.eq('created_by', user.id);
    } else if (isSegreteria && user?.id) {
      // Segreteria: vede le pratiche degli agenti assegnati
      const { data: assignments } = await supabase
        .from('segreteria_agent_assignments')
        .select('agent_user_id')
        .eq('segreteria_user_id', user.id);
      if (assignments && assignments.length > 0) {
        const agentIds = assignments.map((a: { agent_user_id: string }) => a.agent_user_id);
        query = query.in('created_by', agentIds);
      } else {
        // Nessun agente assegnato: mostra lista vuota
        setPractices([]);
        setLoading(false);
        return;
      }
    }
    // super_admin: nessun filtro, vede tutte

    const { data } = await query.order('created_at', { ascending: false });
    setPractices((data ?? []) as Practice[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    supabase.from('clients').select('*').order('ragione_sociale').then(r => setClients(r.data ?? []));
    supabase.from('banks').select('*').eq('attiva', true).order('nome').then(r => setBanks(r.data ?? []));
  }, []);

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

  const handleCreate = async () => {
    if (!form.client_id) { toast.error('Seleziona un cliente'); return; }
    setSaving(true);
    const numero_pratica = generateNumeroPratica();

    const { data: practice, error } = await supabase.from('practices').insert({
      client_id: form.client_id,
      bank_id: form.bank_id || null,
      numero_pratica,
      importo_richiesto: form.importo_richiesto ? Number(form.importo_richiesto) : null,
      motivazione: form.motivazione || null,
      note_admin: form.note_admin || null,
      status: 'bozza',
      created_by: user?.id ?? null,
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

    // Se c'è una banca, aggiungi i suoi documenti specifici
    if (form.bank_id) {
      const { data: bankReqs } = await supabase.from('bank_document_requirements')
        .select('*').eq('bank_id', form.bank_id);
      if (bankReqs && bankReqs.length > 0) {
        await supabase.from('practice_documents').insert(
          bankReqs.map(r => ({
            practice_id: practice.id,
            bank_requirement_id: r.id,
            nome: r.nome,
            descrizione: r.descrizione,
            tipo: 'banca',
            obbligatorio: r.obbligatorio,
            status: 'richiesto',
          }))
        );
      }
    }

    // Log stato
    await supabase.from('practice_status_log').insert({
      practice_id: practice.id, new_status: 'bozza', created_by: 'admin',
    });

    toast.success(`Pratica ${numero_pratica} creata con successo`);
    setSaving(false);
    setShowCreate(false);
    setForm({ client_id: '', bank_id: '', importo_richiesto: '', motivazione: '', note_admin: '' });
    load();
    navigate(`/admin/pratiche/${practice.id}`);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pratiche</h1>
          <p className="text-muted-foreground text-sm mt-1">{practices.length} pratiche totali</p>
        </div>
        {canEdit && (
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Nuova Pratica
          </Button>
        )}
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
      ) : (
        <div className="space-y-2">
          {filtered.map(p => {
            const client = (p as Practice & { clients?: { ragione_sociale: string; email: string } }).clients;
            const bank = (p as Practice & { banks?: { nome: string } }).banks;
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
                        {bank && <span>🏦 {bank.nome}</span>}
                        {p.importo_richiesto && <span className="flex items-center gap-1"><Euro className="w-3 h-3" />{p.importo_richiesto.toLocaleString('it-IT')}</span>}
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{new Date(p.created_at).toLocaleDateString('it-IT')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs ${STATUS_COLORS[p.status]}`}>{STATUS_LABELS[p.status]}</Badge>
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
              <Label>Banca (opzionale)</Label>
              <Select value={form.bank_id} onValueChange={v => setForm(f => ({ ...f, bank_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleziona banca..." /></SelectTrigger>
                <SelectContent>
                  {banks.map(b => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Annulla</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? 'Creazione...' : 'Crea Pratica'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
