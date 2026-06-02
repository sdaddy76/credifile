import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Search, Users, Pencil, Trash2, Mail, Phone, FileText, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { Client } from '@/lib/types';
import * as pdfjs from 'pdfjs-dist';

// Worker PDF.js — usa il file bundlato dal pacchetto via Vite URL import
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// ── Estrae testo raw da un PDF ──────────────────────────────────────────────
async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf    = await pdfjs.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((it: { str: string }) => it.str).join(' '));
  }
  return pages.join('\n');
}

// ── Tipi campo estratto ─────────────────────────────────────────────────────
interface VisuraData {
  ragione_sociale?: string;
  piva?:            string;
  codice_fiscale?:  string;
  indirizzo?:       string;
  email?:           string;
  telefono?:        string;
  codice_ateco?:    string;
}

// ── Parser visura camerale italiana ────────────────────────────────────────
function parseVisura(text: string): VisuraData {
  const clean = text.replace(/\s+/g, ' ');
  const get   = (patterns: RegExp[]): string | undefined => {
    for (const re of patterns) {
      const m = clean.match(re);
      if (m?.[1]) return m[1].trim().replace(/\s{2,}/g, ' ');
    }
  };

  // P.IVA — 11 cifre precedute da etichetta
  const piva = get([
    /Partita\s*IVA\s*[:\-]?\s*(\d{11})/i,
    /P\.?\s*IVA\s*[:\-]?\s*(\d{11})/i,
    /Numero\s+REA[^0-9]*(\d{11})/i,          // fallback raro
  ]) ?? clean.match(/\b(\d{11})\b/)?.[1];    // fallback greedy

  // Codice Fiscale — 11 cifre o 16 alfanumerici
  const codice_fiscale = get([
    /Codice\s+[Ff]iscale\s*[:\-]?\s*([A-Z0-9]{11,16})/i,
    /C\.?\s*F\.?\s*[:\-]?\s*([A-Z0-9]{11,16})/i,
  ]);

  // Boundary comuni della visura camerale — il nome si ferma prima di questi
  const VISURA_BOUNDARY = /(?=\s+Data\s+atto|\s+Forma\s+giuridica|\s+Codice\s+[Ff]iscale|\s+Partita\s+IVA|\s+P\.?\s*IVA|\s+Sede\s+legale|\s+Numero\s+REA|\s+REA\s|\s+Registro\s+imprese|\s+Attivit)/i;

  // Ragione sociale / Denominazione — match non-greedy, si ferma al primo boundary
  const ragione_sociale = get([
    new RegExp(
      String.raw`(?:Denominazione|Ragione\s+[Ss]ociale)\s*[:\-]?\s*(.*?)` +
      VISURA_BOUNDARY.source,
      'i'
    ),
    // fallback se non trovato boundary — prende max 80 chars fino a cifra/data/newline
    /(?:Denominazione|Ragione\s+[Ss]ociale)\s*[:\-]?\s*([A-Z][^\d\n]{2,79}?(?:S\.?R\.?L\.?|S\.?P\.?A\.?|S\.?N\.?C\.?|S\.?A\.?S\.?|SRL|SPA|SNC|SAS|SS|Soc\.\s*Coop\.)\.?)/i,
  ]);

  // Sede legale
  const indirizzo = get([
    /Sede\s+legale\s*[:\-]?\s*([^\n\|]{5,120})/i,
    /Sede\s*[:\-]?\s*([^\n\|]{5,120})/i,
    /Indirizzo\s*[:\-]?\s*([^\n\|]{5,120})/i,
  ]);

  // Codice ATECO (es. 47.11, 62.01.09)
  const atecoMatch = clean.match(/\b(\d{2}\.\d{2}(?:\.\d{1,2})?)\b/);
  const codice_ateco = atecoMatch?.[1];

  // Email
  const emailMatch = clean.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/);
  const email = emailMatch?.[1];

  // Telefono (formato italiano)
  const telMatch = clean.match(/\b((?:\+39\s?|0039\s?)?(?:0\d{1,4}[\s\-]?\d{5,10}|3\d{2}[\s\-]?\d{6,7}))\b/);
  const telefono = telMatch?.[1]?.replace(/\s+/g, ' ').trim();

  return { ragione_sociale, piva, codice_fiscale, indirizzo, email, telefono, codice_ateco };
}

// ── Risultato parsing (per feedback all'utente) ─────────────────────────────
interface ParseResult { data: VisuraData; found: string[]; notFound: string[] }

function buildParseResult(d: VisuraData): ParseResult {
  const LABELS: Record<keyof VisuraData, string> = {
    ragione_sociale: 'Ragione Sociale', piva: 'P.IVA', codice_fiscale: 'Codice Fiscale',
    indirizzo: 'Sede', email: 'Email', telefono: 'Telefono', codice_ateco: 'ATECO',
  };
  const found: string[] = [], notFound: string[] = [];
  (Object.keys(LABELS) as (keyof VisuraData)[]).forEach(k => {
    (d[k] ? found : notFound).push(LABELS[k]);
  });
  return { data: d, found, notFound };
}

// ────────────────────────────────────────────────────────────────────────────

const empty = { ragione_sociale: '', piva: '', codice_fiscale: '', email: '', telefono: '', indirizzo: '' };

export default function ClientiPage() {
  const { user, loading: authLoading } = useAuth();
  const [clients,  setClients]  = useState<Client[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing,  setEditing]  = useState<Client | null>(null);
  const [form,     setForm]     = useState(empty);
  const [saving,   setSaving]   = useState(false);

  // Visura import
  const [parsing,      setParsing]      = useState(false);
  const [parseResult,  setParseResult]  = useState<ParseResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    const { data, error } = await supabase.from('clients').select('*').order('ragione_sociale');
    if (error) toast.error('Errore caricamento clienti: ' + error.message);
    setClients(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!authLoading && user?.id) load();
  }, [authLoading, user?.id]);

  const openCreate = () => { setEditing(null); setForm(empty); setParseResult(null); setShowForm(true); };
  const openEdit   = (c: Client) => {
    setEditing(c);
    setForm({ ragione_sociale: c.ragione_sociale, piva: c.piva ?? '', codice_fiscale: c.codice_fiscale ?? '', email: c.email, telefono: c.telefono ?? '', indirizzo: c.indirizzo ?? '' });
    setParseResult(null);
    setShowForm(true);
  };

  // ── Import visura ──────────────────────────────────────────────────────────
  const handleVisuraFile = async (file: File) => {
    if (!file || file.type !== 'application/pdf') { toast.error('Seleziona un file PDF'); return; }
    setParsing(true);
    setParseResult(null);
    try {
      const text   = await extractPdfText(file);
      const parsed = parseVisura(text);
      const result = buildParseResult(parsed);
      // Pre-compila il form con i dati trovati (non sovrascrive campi già compilati manualmente)
      setForm(prev => ({
        ragione_sociale: prev.ragione_sociale || parsed.ragione_sociale || '',
        piva:            prev.piva            || parsed.piva            || '',
        codice_fiscale:  prev.codice_fiscale  || parsed.codice_fiscale  || '',
        email:           prev.email           || parsed.email           || '',
        telefono:        prev.telefono        || parsed.telefono        || '',
        indirizzo:       prev.indirizzo       || parsed.indirizzo       || '',
      }));
      setParseResult(result);
      if (result.found.length > 0) toast.success(`Estratti: ${result.found.join(', ')}`);
      else toast.warning('Nessun campo riconosciuto nel PDF');
    } catch (e) {
      toast.error('Errore lettura PDF: ' + String(e));
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!form.ragione_sociale.trim() || !form.email.trim()) { toast.error('Ragione sociale ed email obbligatori'); return; }
    if (!user?.id) { toast.error('Sessione non valida. Ricarica la pagina.'); return; }
    setSaving(true);
    const payload = { ...form, piva: form.piva || null, codice_fiscale: form.codice_fiscale || null, telefono: form.telefono || null, indirizzo: form.indirizzo || null };
    if (editing) {
      const { error } = await supabase.from('clients').update(payload).eq('id', editing.id);
      if (error) { toast.error('Errore aggiornamento: ' + error.message); setSaving(false); return; }
      if (payload.email && payload.email !== editing.email) {
        const { data: practices } = await supabase.from('practices').select('id').eq('client_id', editing.id);
        if (practices && practices.length > 0) {
          const ids = practices.map((p: { id: string }) => p.id);
          await supabase.from('practice_access_codes').update({ email_cliente: payload.email.trim().toLowerCase() }).in('practice_id', ids);
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

      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setParseResult(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica Cliente' : 'Nuovo Cliente'}</DialogTitle>
          </DialogHeader>

          {/* ── Import visura ── */}
          <div className="bg-muted/40 rounded-lg px-4 py-3 border border-dashed border-border space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Importa dati da Visura Camerale
              </p>
              <label className="cursor-pointer">
                <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1.5 pointer-events-none">
                  <span>
                    {parsing
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Lettura PDF...</>
                      : <><FileText className="w-3 h-3" /> Carica visura PDF</>
                    }
                  </span>
                </Button>
                <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                  disabled={parsing}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleVisuraFile(f); }} />
              </label>
            </div>

            {/* Feedback parsing */}
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
                    <span><strong>Non trovati:</strong> {parseResult.notFound.join(' · ')} — compilali manualmente</span>
                  </div>
                )}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground">
              Funziona sulle visure camerali ufficiali del Registro Imprese (PDF digitale, non scansioni).
            </p>
          </div>

          {/* ── Form campi ── */}
          <div className="grid grid-cols-2 gap-4 pt-1">
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
