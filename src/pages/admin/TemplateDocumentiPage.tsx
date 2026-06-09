import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Pencil, Trash2, Eye, Layout, FileText } from 'lucide-react';
import { toast } from 'sonner';

// ─── Tipi ────────────────────────────────────────────────────────────────────

type Categoria =
  | 'lettera_presentazione'
  | 'richiesta_documenti'
  | 'comunicazione_banca'
  | 'altro';

interface ContentTemplate {
  id: string;
  nome: string;
  categoria: Categoria;
  contenuto: string;
  variabili: string[];
  attivo: boolean;
  creato_da: string | null;
  created_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORIE: { value: Categoria; label: string; color: string }[] = [
  { value: 'lettera_presentazione', label: 'Lettera di Presentazione', color: 'bg-blue-100 text-blue-800' },
  { value: 'richiesta_documenti',   label: 'Richiesta Documenti',      color: 'bg-amber-100 text-amber-800' },
  { value: 'comunicazione_banca',   label: 'Comunicazione Banca',      color: 'bg-purple-100 text-purple-800' },
  { value: 'altro',                 label: 'Altro',                    color: 'bg-gray-100 text-gray-700' },
];

function getCategoriaInfo(cat: Categoria) {
  return CATEGORIE.find(c => c.value === cat) ?? CATEGORIE[3];
}

/** Estrae le variabili {{nome}} dal contenuto */
function extractVars(testo: string): string[] {
  const re = /\{\{(\w+)\}\}/g;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(testo)) !== null) found.add(m[1]);
  return Array.from(found);
}

/** Compila il template con valori placeholder per l'anteprima */
function compilaAnteprima(contenuto: string, variabili: string[]): string {
  let out = contenuto;
  for (const v of variabili) {
    const placeholder = `[${v.replace(/_/g, ' ').toUpperCase()}]`;
    out = out.split(`{{${v}}}`).join(placeholder);
  }
  return out;
}

// ─── Form iniziale ────────────────────────────────────────────────────────────

const emptyForm = {
  nome: '',
  categoria: 'lettera_presentazione' as Categoria,
  contenuto: '',
};

// ─── Componente principale ───────────────────────────────────────────────────

export default function TemplateDocumentiPage() {
  const { user } = useAuth();

  const [templates, setTemplates]       = useState<ContentTemplate[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showForm, setShowForm]         = useState(false);
  const [editing, setEditing]           = useState<ContentTemplate | null>(null);
  const [form, setForm]                 = useState(emptyForm);
  const [saving, setSaving]             = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<ContentTemplate | null>(null);

  // ── Variabili auto-rilevate ──────────────────────────────────────────────
  const varsRilevate = extractVars(form.contenuto);

  // ── Fetch ────────────────────────────────────────────────────────────────
  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('document_templates')
      .select('*')
      .eq('attivo', true)
      .order('categoria');
    if (error) toast.error('Errore caricamento: ' + error.message);
    setTemplates((data ?? []) as ContentTemplate[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // ── Apri form ────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (t: ContentTemplate) => {
    setEditing(t);
    setForm({ nome: t.nome, categoria: t.categoria, contenuto: t.contenuto });
    setShowForm(true);
  };

  // ── Salva ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.nome.trim())     { toast.error('Nome obbligatorio'); return; }
    if (!form.contenuto.trim()) { toast.error('Contenuto obbligatorio'); return; }

    setSaving(true);
    const payload = {
      nome:       form.nome.trim(),
      categoria:  form.categoria,
      contenuto:  form.contenuto,
      variabili:  extractVars(form.contenuto),
      attivo:     true,
      creato_da:  user?.id ?? null,
    };

    if (editing) {
      const { error } = await supabase
        .from('document_templates')
        .update(payload)
        .eq('id', editing.id);
      if (error) { toast.error('Errore: ' + error.message); setSaving(false); return; }
      toast.success('Template aggiornato');
    } else {
      const { error } = await supabase
        .from('document_templates')
        .insert(payload);
      if (error) { toast.error('Errore: ' + error.message); setSaving(false); return; }
      toast.success('Template creato');
    }

    setSaving(false);
    setShowForm(false);
    load();
  };

  // ── Soft delete ──────────────────────────────────────────────────────────
  const handleDelete = async (t: ContentTemplate) => {
    if (!confirm(`Eliminare il template "${t.nome}"?`)) return;
    const { error } = await supabase
      .from('document_templates')
      .update({ attivo: false })
      .eq('id', t.id);
    if (error) { toast.error('Errore: ' + error.message); return; }
    toast.success('Template eliminato');
    load();
  };

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layout className="w-6 h-6 text-primary" /> Template Documenti
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Crea e gestisci i modelli di testo con variabili dinamiche per lettere e comunicazioni
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="w-4 h-4" /> Nuovo Template
        </Button>
      </div>

      {/* ── Info box ── */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="py-3 px-4 text-sm text-blue-800">
          <strong>Suggerimento:</strong> Usa la sintassi{' '}
          <code className="bg-blue-100 px-1 rounded font-mono">{'{{nome_variabile}}'}</code>{' '}
          nel testo per inserire segnaposto dinamici (es.{' '}
          <code className="bg-blue-100 px-1 rounded font-mono">{'{{ragione_sociale}}'}</code>,{' '}
          <code className="bg-blue-100 px-1 rounded font-mono">{'{{importo_richiesto}}'}</code>).
          Le variabili vengono sostituite automaticamente quando si genera un documento dalla pratica.
        </CardContent>
      </Card>

      {/* ── Lista template ── */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
            <p className="text-muted-foreground">Nessun template configurato</p>
            <Button variant="outline" className="mt-4" onClick={openCreate}>
              Crea il primo template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {templates.map(t => {
            const catInfo = getCategoriaInfo(t.categoria);
            return (
              <Card key={t.id} className="border-border hover:border-primary/30 transition-colors">
                <CardContent className="py-3 px-4">
                  <div className="flex items-start gap-3">
                    {/* Icona */}
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <FileText className="w-4 h-4 text-primary" />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground">{t.nome}</p>
                        <Badge className={`text-xs ${catInfo.color}`}>{catInfo.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {t.contenuto}
                      </p>
                      {t.variabili && t.variabili.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {t.variabili.map(v => (
                            <code key={v} className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono text-muted-foreground">
                              {`{{${v}}}`}
                            </code>
                          ))}
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground/60 mt-1.5">
                        {t.variabili?.length ?? 0} variabil{(t.variabili?.length ?? 0) === 1 ? 'e' : 'i'} ·{' '}
                        Creato il {new Date(t.created_at).toLocaleDateString('it-IT')}
                      </p>
                    </div>

                    {/* Azioni */}
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        title="Anteprima"
                        onClick={() => setPreviewTemplate(t)}
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 w-8 p-0"
                        title="Modifica"
                        onClick={() => openEdit(t)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                        title="Elimina"
                        onClick={() => handleDelete(t)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Modale Creazione / Modifica ── */}
      <Dialog open={showForm} onOpenChange={open => { if (!open) setShowForm(false); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? '✏️ Modifica Template' : '✨ Nuovo Template'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Nome */}
            <div className="space-y-1.5">
              <Label>Nome Template *</Label>
              <Input
                placeholder="es. Lettera di presentazione pratica"
                value={form.nome}
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
              />
            </div>

            {/* Categoria */}
            <div className="space-y-1.5">
              <Label>Categoria *</Label>
              <Select
                value={form.categoria}
                onValueChange={v => setForm(f => ({ ...f, categoria: v as Categoria }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIE.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Contenuto */}
            <div className="space-y-1.5">
              <Label>Contenuto *</Label>
              <p className="text-xs text-muted-foreground">
                Usa <code className="bg-muted px-1 rounded font-mono">{'{{nome_variabile}}'}</code> per i segnaposto (es.{' '}
                <code className="bg-muted px-1 rounded font-mono">{'{{ragione_sociale}}'}</code>,{' '}
                <code className="bg-muted px-1 rounded font-mono">{'{{numero_pratica}}'}</code>)
              </p>
              <Textarea
                rows={10}
                placeholder={`Gentile {{ragione_sociale}},\n\nSiamo lieti di presentarvi la pratica n. {{numero_pratica}} relativa alla richiesta di finanziamento per un importo di € {{importo_richiesto}}.\n\n...`}
                value={form.contenuto}
                onChange={e => setForm(f => ({ ...f, contenuto: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>

            {/* Variabili auto-rilevate */}
            {varsRilevate.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Variabili rilevate automaticamente</Label>
                <div className="flex flex-wrap gap-1.5">
                  {varsRilevate.map(v => (
                    <span key={v} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-mono">
                      {`{{${v}}}`}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Salvo...' : editing ? 'Salva Modifiche' : 'Crea Template'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modale Anteprima ── */}
      <Dialog
        open={!!previewTemplate}
        onOpenChange={open => { if (!open) setPreviewTemplate(null); }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" /> Anteprima — {previewTemplate?.nome}
            </DialogTitle>
          </DialogHeader>

          {previewTemplate && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className={`text-xs ${getCategoriaInfo(previewTemplate.categoria).color}`}>
                  {getCategoriaInfo(previewTemplate.categoria).label}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {previewTemplate.variabili?.length ?? 0} variabil{(previewTemplate.variabili?.length ?? 0) === 1 ? 'e' : 'i'}
                </span>
              </div>

              {/* Testo compilato con placeholder visibili */}
              <div className="bg-muted/30 border border-border rounded-lg p-4 whitespace-pre-wrap text-sm leading-relaxed font-serif">
                {compilaAnteprima(previewTemplate.contenuto, previewTemplate.variabili ?? [])}
              </div>

              <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded px-3 py-2">
                ⚠ I valori in [MAIUSCOLO] sono segnaposto. Nella pratica verranno sostituiti con i dati reali del cliente.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewTemplate(null)}>Chiudi</Button>
            {previewTemplate && (
              <Button variant="ghost" onClick={() => { setPreviewTemplate(null); openEdit(previewTemplate); }}>
                <Pencil className="w-3.5 h-3.5 mr-1.5" /> Modifica
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
