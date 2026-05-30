import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Search, Users, Pencil, Trash2, Mail, Phone } from 'lucide-react';
import { toast } from 'sonner';
import type { Client } from '@/lib/types';

const empty = { ragione_sociale: '', piva: '', codice_fiscale: '', email: '', telefono: '', indirizzo: '' };

export default function ClientiPage() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase.from('clients').select('*').order('ragione_sociale');
    setClients(data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowForm(true); };
  const openEdit = (c: Client) => {
    setEditing(c);
    setForm({ ragione_sociale: c.ragione_sociale, piva: c.piva ?? '', codice_fiscale: c.codice_fiscale ?? '', email: c.email, telefono: c.telefono ?? '', indirizzo: c.indirizzo ?? '' });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.ragione_sociale.trim() || !form.email.trim()) { toast.error('Ragione sociale ed email obbligatori'); return; }
    setSaving(true);
    const payload = { ...form, piva: form.piva || null, codice_fiscale: form.codice_fiscale || null, telefono: form.telefono || null, indirizzo: form.indirizzo || null };
    if (editing) {
      await supabase.from('clients').update(payload).eq('id', editing.id);
      toast.success('Cliente aggiornato');
    } else {
      await supabase.from('clients').insert({ ...payload, created_by: user?.id });
      toast.success('Cliente creato');
    }
    setSaving(false); setShowForm(false); load();
  };

  const handleDelete = async (id: string, nome: string) => {
    if (!confirm(`Eliminare il cliente "${nome}"? Saranno eliminate anche le pratiche associate.`)) return;
    await supabase.from('clients').delete().eq('id', id);
    toast.success('Cliente eliminato');
    load();
  };

  const filtered = clients.filter(c =>
    c.ragione_sociale.toLowerCase().includes(search.toLowerCase()) ||
    (c.piva ?? '').includes(search) || (c.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clienti</h1>
          <p className="text-muted-foreground text-sm mt-1">{clients.length} clienti registrati</p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nuovo Cliente</Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Cerca per nome, P.IVA, email..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
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
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(c.id, c.ragione_sociale)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? 'Modifica Cliente' : 'Nuovo Cliente'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-2">
              <Label>Ragione Sociale *</Label>
              <Input placeholder="Es. Mario Rossi S.r.l." value={form.ragione_sociale} onChange={e => setForm(f => ({ ...f, ragione_sociale: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>P.IVA</Label>
              <Input placeholder="12345678901" value={form.piva} onChange={e => setForm(f => ({ ...f, piva: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Codice Fiscale</Label>
              <Input placeholder="RSSMRA80..." value={form.codice_fiscale} onChange={e => setForm(f => ({ ...f, codice_fiscale: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Email *</Label>
              <Input type="email" placeholder="info@azienda.it" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Telefono</Label>
              <Input placeholder="+39 02 1234567" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Indirizzo</Label>
              <Input placeholder="Via Roma 1, Milano" value={form.indirizzo} onChange={e => setForm(f => ({ ...f, indirizzo: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvo...' : (editing ? 'Salva' : 'Crea')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
