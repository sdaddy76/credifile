import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Plus, FileText, Pencil, Trash2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import type { DocumentTemplate } from '@/lib/types';

const empty = { nome: '', descrizione: '', obbligatorio: true };

export default function DocumentiTemplatePage() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DocumentTemplate | null>(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase.from('document_templates').select('*').order('ordine');
    setTemplates(data ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowForm(true); };
  const openEdit = (t: DocumentTemplate) => {
    setEditing(t);
    setForm({ nome: t.nome, descrizione: t.descrizione ?? '', obbligatorio: t.obbligatorio });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nome.trim()) { toast.error('Nome obbligatorio'); return; }
    setSaving(true);
    const payload = { nome: form.nome, descrizione: form.descrizione || null, obbligatorio: form.obbligatorio, ordine: editing?.ordine ?? templates.length };
    if (editing) {
      await supabase.from('document_templates').update(payload).eq('id', editing.id);
      toast.success('Documento aggiornato');
    } else {
      await supabase.from('document_templates').insert(payload);
      toast.success('Documento aggiunto');
    }
    setSaving(false); setShowForm(false); load();
  };

  const handleDelete = async (id: string, nome: string) => {
    if (!confirm(`Rimuovere il template "${nome}" dai documenti standard?`)) return;
    await supabase.from('document_templates').delete().eq('id', id);
    toast.success('Template rimosso');
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Documenti Standard</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Questi documenti vengono richiesti automaticamente ad ogni nuova pratica
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Aggiungi Documento</Button>
      </div>

      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="py-3 px-4 text-sm text-amber-800">
          <strong>Nota:</strong> I documenti qui configurati vengono aggiunti automaticamente a ogni nuova pratica creata.
          I documenti specifici per banca si configurano nella sezione <strong>Banche</strong>.
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-2">
          {templates.map((t, idx) => (
            <Card key={t.id} className="border-border hover:border-primary/30 transition-colors">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                    <GripVertical className="w-4 h-4 opacity-40" />
                    <span className="text-xs font-mono w-5 text-center">{idx + 1}</span>
                  </div>
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground">{t.nome}</p>
                      {t.obbligatorio && (
                        <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-medium">Obbligatorio</span>
                      )}
                    </div>
                    {t.descrizione && <p className="text-xs text-muted-foreground mt-0.5">{t.descrizione}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(t)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(t.id, t.nome)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {templates.length === 0 && (
            <Card><CardContent className="py-16 text-center">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
              <p className="text-muted-foreground">Nessun documento standard configurato</p>
              <Button variant="outline" className="mt-4" onClick={openCreate}>Aggiungi il primo documento</Button>
            </CardContent></Card>
          )}
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? 'Modifica Documento' : 'Nuovo Documento Standard'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome Documento *</Label>
              <Input placeholder="es. Visura Camerale Aggiornata" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Descrizione / Istruzioni per il cliente</Label>
              <Input placeholder="es. Visura non anteriore a 3 mesi" value={form.descrizione} onChange={e => setForm(f => ({ ...f, descrizione: e.target.value }))} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={form.obbligatorio} onCheckedChange={v => setForm(f => ({ ...f, obbligatorio: v }))} />
              <div>
                <Label>Documento obbligatorio</Label>
                <p className="text-xs text-muted-foreground">Se spento, il cliente potrà saltarlo</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvo...' : (editing ? 'Salva' : 'Aggiungi')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
