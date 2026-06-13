import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, ChevronDown, ChevronUp, Save, ClipboardList, CheckSquare, GripVertical } from 'lucide-react';
import { toast } from 'sonner';

interface ChecklistItem { id?: string; nome: string; descrizione?: string; obbligatorio: boolean; ordine: number; }
interface ChecklistTemplate { id: string; nome: string; tipo_pratica?: string; descrizione?: string; attivo: boolean; items: ChecklistItem[]; }

const TIPI_PRATICA = [
  { value: '', label: '— Generico (tutti i tipi) —' },
  { value: 'mutuo', label: 'Mutuo' },
  { value: 'leasing', label: 'Leasing' },
  { value: 'fido', label: 'Fido/Apertura credito' },
  { value: 'prestito', label: 'Prestito personale' },
  { value: 'finanziamento', label: 'Finanziamento aziendale' },
  { value: 'anticipo_fatture', label: 'Anticipo fatture' },
  { value: 'factoring', label: 'Factoring' },
];

export default function ChecklistTemplatePage() {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // New template form
  const [newNome, setNewNome] = useState('');
  const [newTipo, setNewTipo] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: tpls } = await supabase.from('checklist_templates').select('*').order('nome');
    if (!tpls) { setLoading(false); return; }
    const ids = tpls.map(t => t.id);
    const { data: items } = ids.length > 0
      ? await supabase.from('checklist_template_items').select('*').in('template_id', ids).order('ordine')
      : { data: [] as { id: string; template_id: string; nome: string; obbligatorio: boolean; ordine: number }[] };
    setTemplates(tpls.map(t => ({
      ...t,
      items: (items ?? []).filter((i: { template_id: string }) => i.template_id === t.id),
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const createTemplate = async () => {
    if (!newNome.trim()) { toast.error('Inserisci il nome'); return; }
    setSaving(true);
    const { data, error } = await supabase.from('checklist_templates').insert({ nome: newNome.trim(), tipo_pratica: newTipo || null, descrizione: newDesc.trim() || null }).select().single();
    setSaving(false);
    if (error) { toast.error('Errore: ' + error.message); return; }
    toast.success('Template creato');
    setNewNome(''); setNewTipo(''); setNewDesc('');
    setExpanded(data.id);
    load();
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Eliminare questo template? Tutte le checklist basate su di esso rimarranno invariate.')) return;
    await supabase.from('checklist_templates').delete().eq('id', id);
    setTemplates(prev => prev.filter(t => t.id !== id));
    toast.success('Template eliminato');
  };

  const toggleAttivo = async (id: string, attivo: boolean) => {
    await supabase.from('checklist_templates').update({ attivo: !attivo }).eq('id', id);
    setTemplates(prev => prev.map(t => t.id === id ? { ...t, attivo: !attivo } : t));
  };

  const addItem = async (templateId: string) => {
    const nome = prompt('Nome voce checklist:');
    if (!nome?.trim()) return;
    const obbligatorio = confirm('Voce obbligatoria?');
    const template = templates.find(t => t.id === templateId);
    const ordine = (template?.items.length ?? 0) + 1;
    const { data, error } = await supabase.from('checklist_template_items').insert({ template_id: templateId, nome: nome.trim(), obbligatorio, ordine }).select().single();
    if (error) { toast.error('Errore'); return; }
    setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, items: [...t.items, data] } : t));
    toast.success('Voce aggiunta');
  };

  const deleteItem = async (templateId: string, itemId: string) => {
    await supabase.from('checklist_template_items').delete().eq('id', itemId);
    setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, items: t.items.filter(i => i.id !== itemId) } : t));
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><ClipboardList className="w-6 h-6" /> Template Checklist</h1>
        <p className="text-muted-foreground text-sm mt-1">Crea template di checklist da applicare alle pratiche per tipo di finanziamento</p>
      </div>

      {/* Crea nuovo template */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3"><CardTitle className="text-sm">Crea Nuovo Template</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nome template *</Label>
              <Input placeholder="Es. Checklist Mutuo Standard" value={newNome} onChange={e => setNewNome(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo pratica</Label>
              <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={newTipo} onChange={e => setNewTipo(e.target.value)}>
                {TIPI_PRATICA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Descrizione (opzionale)</Label>
            <Input placeholder="Breve descrizione del template..." value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          </div>
          <Button onClick={createTemplate} disabled={saving} className="gap-1.5">
            <Plus className="w-4 h-4" /> {saving ? 'Creazione...' : 'Crea Template'}
          </Button>
        </CardContent>
      </Card>

      {/* Lista template */}
      {loading ? (
        <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <CheckSquare className="w-10 h-10 mx-auto mb-3 opacity-20" />Nessun template creato
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map(tpl => (
            <Card key={tpl.id} className={!tpl.attivo ? 'opacity-60' : ''}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <button onClick={() => setExpanded(expanded === tpl.id ? null : tpl.id)} className="p-1 hover:bg-accent rounded">
                      {expanded === tpl.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{tpl.nome}</p>
                      <div className="flex gap-2 mt-0.5">
                        {tpl.tipo_pratica && <Badge className="text-[10px] bg-blue-100 text-blue-800">{tpl.tipo_pratica}</Badge>}
                        <Badge className={`text-[10px] ${tpl.attivo ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{tpl.attivo ? 'Attivo' : 'Inattivo'}</Badge>
                        <span className="text-[10px] text-muted-foreground">{tpl.items.length} voci</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => toggleAttivo(tpl.id, tpl.attivo)}>
                      {tpl.attivo ? 'Disattiva' : 'Attiva'}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => deleteTemplate(tpl.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {expanded === tpl.id && (
                <CardContent className="pt-0">
                  {tpl.descrizione && <p className="text-xs text-muted-foreground mb-3">{tpl.descrizione}</p>}
                  <div className="space-y-1.5 mb-3">
                    {tpl.items.length === 0 && <p className="text-xs text-muted-foreground py-2 text-center">Nessuna voce — aggiungine una</p>}
                    {tpl.items.map((item, idx) => (
                      <div key={item.id ?? idx} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 text-sm">
                        <GripVertical className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="flex-1">{item.nome}</span>
                        {item.obbligatorio && <Badge className="text-[10px] bg-red-100 text-red-700">Obbl.</Badge>}
                        <button onClick={() => item.id && deleteItem(tpl.id, item.id)} className="p-1 hover:bg-red-50 rounded text-red-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5 w-full" onClick={() => addItem(tpl.id)}>
                    <Plus className="w-3.5 h-3.5" /> Aggiungi Voce
                  </Button>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
