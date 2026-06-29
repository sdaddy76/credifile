import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as pdfjs from 'pdfjs-dist';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Plus, FileBarChart2, Users, LogOut, Settings, TrendingUp,
  RefreshCw, Trash2, Upload, FileText, CheckCircle, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// ── PDF text extractor ──────────────────────────────────────────────────────
async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const ct = await pg.getTextContent();
    pages.push(ct.items.map((it: unknown) => (it as { str?: string }).str ?? '').join(' '));
  }
  return pages.join('\n');
}

function isolaSezione(text: string, start: RegExp, end: RegExp): string {
  const si = text.search(start);
  if (si === -1) return '';
  const sub = text.substring(si);
  const ei  = sub.search(end);
  return ei !== -1 ? sub.substring(0, ei) : sub;
}

function cleanup(s: string): string {
  return s.trim().replace(/\s{2,}/g, ' ').replace(/[,|\/\\]+$/, '').trim();
}

// ── Parser visura camerale (estratto da ClientiPage) ───────────────────────
interface VisuraData {
  ragione_sociale?: string; piva?: string; codice_fiscale?: string;
  indirizzo?: string; email?: string; telefono?: string;
  codice_ateco?: string; data_costituzione?: string; capitale_versato?: string;
}

function parseVisura(text: string): VisuraData {
  const clean = text.replace(/[^\S\n]+/g, ' ').replace(/\n+/g, '\n');
  const flat  = clean.replace(/\n/g, ' ');

  const get = (patterns: RegExp[]): string | undefined => {
    for (const re of patterns) {
      const m = flat.match(re);
      if (m?.[1]?.trim()) return cleanup(m[1]);
    }
  };

  const B = String.raw`(?=\s+(?:Data\s+(?:atto|cost)|Forma\s+giuridica|Natura\s+giuridica|` +
            String.raw`Codice\s+[Ff]iscale|Partita\s+IVA|P\.?\s*IVA|Sede\s+legale|Indirizzo|` +
            String.raw`Numero\s+REA|REA\s|Registro\s+[Ii]mprese|Iscrizione|Stato\s+dell|` +
            String.raw`Capitale|Pec\b|PEC\b|Attivit|Oggetto\s+sociale|Sistema\s+di|` +
            String.raw`Durata\s+della|Poteri\b|Archivio\s+ufficiale))`;

  const LABEL_RS = String.raw`(?:Denominazione(?:\s*[\/eo]\s*[Rr]agione\s+[Ss]ociale)?|Ragione\s+[Ss]ociale)\s*[:\-]?\s*`;

  const ragione_sociale = (() => {
    const m1 = flat.match(new RegExp(LABEL_RS + String.raw`(.{2,}?)` + B, 'i'));
    if (m1?.[1]?.trim()) return cleanup(m1[1]);
    const m2 = flat.match(new RegExp(
      LABEL_RS + String.raw`([^\:]{2,80}?(?:S\.?\s*R\.?\s*L\.?|S\.?\s*P\.?\s*A\.?|S\.?\s*N\.?\s*C\.?|S\.?\s*A\.?\s*S\.?|SRL|SPA|SNC|SAS|S\.?\s*S\.?|Soc\.?\s*Coop\.?|ONLUS|ETS|APS|ODV|IMPRESA\s+INDIVIDUALE)\.?)`, 'i'
    ));
    if (m2?.[1]?.trim()) return cleanup(m2[1]);
    return undefined;
  })();

  const piva = get([
    /Partita\s*IVA\s*[:\-]?\s*(\d{11})/i,
    /P\.?\s*IVA\s*[:\-]?\s*(\d{11})/i,
  ]) ?? flat.match(/\b(\d{11})\b/)?.[1];

  const codice_fiscale_raw = get([
    /Codice\s+[Ff]iscale\s*[:\-]?\s*([A-Z0-9]{11,16})/i,
    /C\.?\s*F\.?\s*[:\-]?\s*([A-Z0-9]{11,16})/i,
  ]);
  const codice_fiscale = codice_fiscale_raw === piva ? undefined : codice_fiscale_raw;

  const ADDR_B = String.raw`(?=\s+(?:Partita\s+IVA|P\.?\s*IVA|Codice\s+[Ff]iscale|Pec\b|PEC\b|REA\s|Registro|Telefono|Tel\b|Email|Attivit|Stato\s+dell))`;
  const indirizzo = (() => {
    const m = flat.match(new RegExp(String.raw`Sede\s+legale\s*[:\-]?\s*(.{5,})` + ADDR_B, 'i'));
    if (m?.[1]?.trim()) return cleanup(m[1]);
    return get([
      /Sede\s+legale\s*[:\-]?\s*([^\:]{5,120})/i,
      /Indirizzo\s*[:\-]?\s*([^\:]{5,120})/i,
    ]);
  })();

  const atecoMatch = flat.match(
    /(?:Attivit[àa]\s+(?:prevalente|principale|esercitata)|codice\s+ATECO|ATECO)\s*[:\-]?\s*[^\d]*(\d{2}\.\d{2}(?:\.\d{1,2})?)/i
  ) ?? flat.match(/\bATECO\b[^\d]*(\d{2}\.\d{2}(?:\.\d{1,2})?)/i);
  const codice_ateco = atecoMatch?.[1];

  const email = flat.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/)?.[1];

  const telMatch = flat.match(
    /\b((?:\+39\s?|0039\s?)?(?:0\d{1,4}[\s\-]?\d{5,10}|3\d{2}[\s\-]?\d{6,7}))\b/
  );
  const telefono = telMatch?.[1]?.replace(/\s+/g, ' ').trim();

  const data_costituzione = get([
    /Data\s+atto\s+di\s+costituzione\s*[:\-]?\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i,
    /Data\s+cost(?:ituzione)?\s*[:\-]?\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i,
  ]);

  const capitale_versato = get([
    /[Cc]apitale\s+sociale\s+in\s+[Ee]uro\s+versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i,
    /[Cc]apitale\s+(?:sociale\s+)?(?:interamente\s+)?versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i,
    /[Cc]apitale\s+versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i,
  ]);

  return { ragione_sociale, piva, codice_fiscale, indirizzo, email, telefono, codice_ateco, data_costituzione, capitale_versato };
}

// ── Tipi ────────────────────────────────────────────────────────────────────
interface Client {
  id: string; ragione_sociale: string; partita_iva: string | null;
  codice_ateco: string | null; settore: string | null; email: string | null;
  created_at: string;
}
interface Report {
  id: string; client_id: string | null; client_name: string;
  anno_bilancio: number | null; indice_bancabilita: number | null; sent_at: string | null; created_at: string;
}
interface ConsentStatus {
  client_id: string;
  status: 'pending' | 'accepted' | 'declined';
}

function ratingInfo(score: number) {
  if (score >= 85) return { label: 'Eccellente', cls: 'bg-emerald-100 text-emerald-800' };
  if (score >= 70) return { label: 'Buono',      cls: 'bg-green-100 text-green-800' };
  if (score >= 55) return { label: 'Sufficiente',cls: 'bg-yellow-100 text-yellow-800' };
  if (score >= 40) return { label: 'Critico',    cls: 'bg-orange-100 text-orange-800' };
  return               { label: 'Non bancabile',cls: 'bg-red-100 text-red-800' };
}

const EMPTY_FORM = { ragione_sociale: '', partita_iva: '', codice_fiscale: '', email: '', codice_ateco: '', settore: '', telefono: '', indirizzo: '' };

// ── Componente principale ────────────────────────────────────────────────────
export default function ConsulenteDashboard() {
  const { user, profileNome, signOut } = useAuth();
  const navigate = useNavigate();
  const [clients,  setClients]  = useState<Client[]>([]);
  const [reports,  setReports]  = useState<Report[]>([]);
  const [consents, setConsents] = useState<ConsentStatus[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<'clienti' | 'report'>('clienti');

  // form nuovo cliente
  const [showForm,     setShowForm]     = useState(false);
  const [inputMode,    setInputMode]    = useState<'manuale' | 'visura'>('manuale');
  const [formData,     setFormData]     = useState({ ...EMPTY_FORM });
  const [savingClient, setSavingClient] = useState(false);

  // upload visura
  const visuraRef = useRef<HTMLInputElement>(null);
  const [parsingVisura,  setParsingVisura]  = useState(false);
  const [visuraFileName, setVisuraFileName] = useState('');
  const [visuraFound,    setVisuraFound]    = useState<string[]>([]);
  const [visuraNotFound, setVisuraNotFound] = useState<string[]>([]);
  const [visuraParsed,   setVisuraParsed]   = useState(false);
  const [visuraChars,    setVisuraChars]    = useState(0);   // caratteri estratti
  const [visuraError,    setVisuraError]    = useState('');  // messaggio errore estrazione

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: cl }, { data: rp }, { data: cs }] = await Promise.all([
      supabase.from('consulente_clients').select('*').eq('consulente_id', user.id).order('ragione_sociale'),
      supabase.from('consulente_reports').select('id,client_id,client_name,anno_bilancio,indice_bancabilita,sent_at,created_at').eq('consulente_id', user.id).order('created_at', { ascending: false }),
      supabase.from('consulente_cr_consents').select('client_id, status, created_at').eq('consulente_id', user.id).order('created_at', { ascending: false }),
    ]);
    setClients((cl ?? []) as Client[]);
    setReports((rp ?? []) as Report[]);

    // Per ogni client_id teniamo solo il consenso più recente
    const consentMap = new Map<string, ConsentStatus>();
    ((cs ?? []) as Array<{ client_id: string; status: string; created_at: string }>).forEach(c => {
      if (!consentMap.has(c.client_id)) {
        consentMap.set(c.client_id, { client_id: c.client_id, status: c.status as ConsentStatus['status'] });
      }
    });
    setConsents(Array.from(consentMap.values()));
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Parsing visura ─────────────────────────────────────────────────────────
  const handleVisuraFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) { toast.error('Carica un file PDF'); return; }
    setParsingVisura(true);
    setVisuraFileName(file.name);
    setVisuraParsed(false);
    setVisuraFound([]);
    setVisuraNotFound([]);
    setVisuraChars(0);
    setVisuraError('');
    try {
      const text = await extractPdfText(file);
      setVisuraChars(text.length);

      if (text.trim().length < 50) {
        // PDF scansionato o protetto — nessun testo estraibile
        setVisuraError('PDF scansionato o protetto: nessun testo estraibile. Compila i campi manualmente.');
        setVisuraParsed(true);
        return;
      }

      const parsed = parseVisura(text);

      const LABELS: Record<keyof VisuraData, string> = {
        ragione_sociale: 'Ragione Sociale', piva: 'P.IVA', codice_fiscale: 'Codice Fiscale',
        indirizzo: 'Sede Legale', email: 'Email', telefono: 'Telefono',
        codice_ateco: 'ATECO', data_costituzione: 'Data Costituzione', capitale_versato: 'Capitale',
      };
      const found: string[] = [], notFound: string[] = [];
      (Object.keys(LABELS) as (keyof VisuraData)[]).forEach(k => {
        (parsed[k] ? found : notFound).push(LABELS[k]);
      });
      setVisuraFound(found);
      setVisuraNotFound(notFound);

      if (found.length === 0) {
        setVisuraError(`Testo estratto (${text.length} caratteri) ma nessun campo riconosciuto. Formato visura non standard — compila manualmente.`);
      }

      // Pre-popola il form con i campi trovati
      setFormData(prev => ({
        ...prev,
        ragione_sociale: parsed.ragione_sociale ?? prev.ragione_sociale,
        partita_iva:     parsed.piva             ?? prev.partita_iva,
        codice_fiscale:  parsed.codice_fiscale   ?? prev.codice_fiscale,
        email:           parsed.email            ?? prev.email,
        telefono:        parsed.telefono         ?? prev.telefono,
        codice_ateco:    parsed.codice_ateco     ?? prev.codice_ateco,
        indirizzo:       parsed.indirizzo        ?? prev.indirizzo,
      }));

      if (found.length > 0) {
        toast.success(`Visura analizzata: ${found.length} campi estratti`);
      } else {
        toast.warning('Nessun campo estratto automaticamente — compila il form manualmente');
      }
    } catch (err) {
      console.error('Errore parsing visura:', err);
      setVisuraError(`Errore lettura PDF: ${String(err)}. Compila i campi manualmente.`);
      toast.error('Errore lettura PDF visura');
    } finally {
      setVisuraParsed(true); // mostra SEMPRE il form, anche in caso di errore
      setParsingVisura(false);
    }
  };

  // ── Salva cliente ──────────────────────────────────────────────────────────
  const saveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !formData.ragione_sociale.trim()) return;
    setSavingClient(true);
    const { error } = await supabase.from('consulente_clients').insert({
      ragione_sociale: formData.ragione_sociale,
      partita_iva:     formData.partita_iva    || null,
      codice_fiscale:  formData.codice_fiscale || null,
      email:           formData.email          || null,
      telefono:        formData.telefono       || null,
      codice_ateco:    formData.codice_ateco   || null,
      settore:         formData.settore        || null,
      indirizzo:       formData.indirizzo      || null,
      consulente_id:   user.id,
    });
    setSavingClient(false);
    if (error) { toast.error('Errore salvataggio cliente'); return; }
    toast.success('Cliente aggiunto');
    setShowForm(false);
    setFormData({ ...EMPTY_FORM });
    setInputMode('manuale');
    setVisuraParsed(false);
    setVisuraFileName('');
    load();
  };

  const deleteClient = async (id: string) => {
    if (!confirm('Eliminare questo cliente e tutti i suoi report?')) return;
    await supabase.from('consulente_clients').delete().eq('id', id);
    toast.success('Cliente eliminato');
    load();
  };

  const openForm = () => {
    setFormData({ ...EMPTY_FORM });
    setInputMode('manuale');
    setVisuraParsed(false);
    setVisuraFileName('');
    setVisuraFound([]);
    setVisuraNotFound([]);
    setVisuraChars(0);
    setVisuraError('');
    setShowForm(s => !s);
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50/40 to-slate-50">
      {/* Header */}
      <div className="bg-teal-700 text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">Credifile — Portale Consulente</h1>
            <p className="text-teal-200 text-xs">{profileNome || user?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={() => navigate('/consulente/profilo')}>
            <Settings className="w-4 h-4 mr-1" /> Profilo
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={async () => { await signOut(); navigate('/login'); }}>
            <LogOut className="w-4 h-4 mr-1" /> Esci
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: Users,        label: 'Clienti',        value: clients.length,                        color: 'text-teal-600 bg-teal-50' },
            { icon: FileBarChart2,label: 'Report generati', value: reports.length,                        color: 'text-blue-600 bg-blue-50' },
            { icon: TrendingUp,   label: 'Inviati',         value: reports.filter(r => r.sent_at).length, color: 'text-emerald-600 bg-emerald-50' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border p-4 flex items-center gap-3 shadow-sm">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-2xl font-black text-slate-800">{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {(['clienti', 'report'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize ${tab === t ? 'bg-white shadow text-teal-700' : 'text-slate-500 hover:text-slate-700'}`}>
              {t === 'clienti' ? `👤 Clienti (${clients.length})` : `📊 Report (${reports.length})`}
            </button>
          ))}
        </div>

        {/* ── Tab Clienti ── */}
        {tab === 'clienti' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-slate-700">I tuoi clienti</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Aggiorna</Button>
                <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={openForm}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Nuovo cliente
                </Button>
              </div>
            </div>

            {/* ── Form nuovo cliente ── */}
            {showForm && (
              <div className="bg-white border-2 border-teal-200 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-teal-700 text-sm">Aggiungi nuovo cliente</h3>
                  {/* Toggle modalità */}
                  <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => { setInputMode('manuale'); setVisuraParsed(false); setVisuraFileName(''); }}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1
                        ${inputMode === 'manuale' ? 'bg-white shadow text-teal-700' : 'text-slate-500 hover:text-slate-700'}`}>
                      <FileText className="w-3 h-3" /> Manuale
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputMode('visura')}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all flex items-center gap-1
                        ${inputMode === 'visura' ? 'bg-white shadow text-teal-700' : 'text-slate-500 hover:text-slate-700'}`}>
                      <Upload className="w-3 h-3" /> Da Visura
                    </button>
                  </div>
                </div>

                {/* ── Sezione caricamento visura ── */}
                {inputMode === 'visura' && !visuraParsed && (
                  <div
                    className="border-2 border-dashed border-teal-200 rounded-xl p-6 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50/30 transition-all"
                    onClick={() => visuraRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleVisuraFile(f); }}>
                    {parsingVisura ? (
                      <div className="space-y-2">
                        <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
                        <p className="text-sm text-teal-600 font-medium">Analisi visura in corso...</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="w-8 h-8 mx-auto text-teal-400" />
                        <p className="text-sm font-medium text-slate-600">
                          Trascina qui la visura camerale PDF<br />
                          <span className="text-xs text-slate-400">oppure clicca per selezionare il file</span>
                        </p>
                      </div>
                    )}
                    <input ref={visuraRef} type="file" accept=".pdf" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleVisuraFile(f); }} />
                  </div>
                )}

                {/* ── Risultato parsing ── */}
                {visuraParsed && (
                  <div className="bg-slate-50 rounded-lg p-3 border space-y-2">
                    <div className="flex items-center justify-between text-sm font-medium text-slate-700">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-teal-600" /> {visuraFileName}
                      </div>
                      {visuraChars > 0 && (
                        <span className="text-xs text-slate-400">{visuraChars.toLocaleString()} caratteri estratti</span>
                      )}
                    </div>
                    {visuraError ? (
                      <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{visuraError}</span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {visuraFound.map(f => (
                          <span key={f} className="inline-flex items-center gap-0.5 text-[11px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                            <CheckCircle className="w-2.5 h-2.5" /> {f}
                          </span>
                        ))}
                        {visuraNotFound.map(f => (
                          <span key={f} className="inline-flex items-center gap-0.5 text-[11px] bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-2.5 h-2.5" /> {f}
                          </span>
                        ))}
                      </div>
                    )}
                    {!visuraError && visuraFound.length > 0 && (
                      <p className="text-xs text-teal-600">✏️ Controlla e correggi i campi pre-compilati sotto prima di salvare.</p>
                    )}
                  </div>
                )}

                {/* ── Campi form (sempre visibili, pre-compilati dopo visura) ── */}
                {(inputMode === 'manuale' || visuraParsed) && (
                  <form onSubmit={saveClient} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { key: 'ragione_sociale', label: 'Ragione Sociale *', required: true, span: 2 },
                        { key: 'partita_iva',     label: 'Partita IVA' },
                        { key: 'codice_fiscale',  label: 'Codice Fiscale' },
                        { key: 'email',           label: 'Email cliente' },
                        { key: 'telefono',        label: 'Telefono' },
                        { key: 'codice_ateco',    label: 'Codice ATECO' },
                        { key: 'settore',         label: 'Settore' },
                      ].map(f => (
                        <div key={f.key} className={f.span === 2 ? 'col-span-2' : ''}>
                          <label className="text-xs font-medium text-slate-600">{f.label}</label>
                          <input
                            required={f.required}
                            className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 ring-teal-400 outline-none"
                            value={(formData as Record<string, string>)[f.key]}
                            onChange={e => setFormData(d => ({ ...d, [f.key]: e.target.value }))} />
                        </div>
                      ))}
                      <div className="col-span-2">
                        <label className="text-xs font-medium text-slate-600">Indirizzo / Sede Legale</label>
                        <input
                          className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 ring-teal-400 outline-none"
                          value={formData.indirizzo}
                          onChange={e => setFormData(d => ({ ...d, indirizzo: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button type="submit" size="sm" className="bg-teal-600 hover:bg-teal-700" disabled={savingClient}>
                        {savingClient ? 'Salvataggio...' : 'Salva cliente'}
                      </Button>
                      <Button type="button" variant="outline" size="sm"
                        onClick={() => { setShowForm(false); setInputMode('manuale'); setVisuraParsed(false); }}>
                        Annulla
                      </Button>
                      {visuraParsed && (
                        <Button type="button" variant="outline" size="sm"
                          onClick={() => { setVisuraParsed(false); setVisuraFileName(''); setFormData({ ...EMPTY_FORM }); }}>
                          🔄 Ricarica visura
                        </Button>
                      )}
                    </div>
                  </form>
                )}
              </div>
            )}

            {/* ── Lista clienti ── */}
            {loading ? (
              <div className="py-10 text-center text-sm text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Caricamento...</div>
            ) : clients.length === 0 ? (
              <div className="py-14 text-center border-2 border-dashed rounded-xl">
                <Users className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                <p className="font-medium text-slate-500">Nessun cliente ancora</p>
                <p className="text-sm text-slate-400 mt-1">Clicca "Nuovo cliente" per iniziare</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {clients.map(c => {
                  const clientReports = reports.filter(r => r.client_id === c.id);
                  const consent = consents.find(cs => cs.client_id === c.id);
                  return (
                    <div key={c.id} className="bg-white rounded-xl border hover:border-teal-300 transition-colors p-4 flex items-center gap-4">
                      <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center shrink-0">
                        <span className="text-teal-700 font-bold text-sm">{c.ragione_sociale.slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-slate-800 truncate">{c.ragione_sociale}</p>
                          {/* Badge consenso CR */}
                          {consent?.status === 'accepted' && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                              ✅ CR autorizzato
                            </span>
                          )}
                          {consent?.status === 'pending' && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                              🟡 CR in attesa
                            </span>
                          )}
                          {consent?.status === 'declined' && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                              ❌ CR rifiutato
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {[c.partita_iva && `P.IVA ${c.partita_iva}`, c.codice_ateco && `ATECO ${c.codice_ateco}`, c.email].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="text-xs text-slate-400">{clientReports.length} report</div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          title={consent?.status === 'pending' ? 'In attesa di autorizzazione CR' : undefined}
                          className={`h-8 text-xs ${
                            consent?.status === 'accepted'
                              ? 'bg-green-600 hover:bg-green-700'
                              : consent?.status === 'pending'
                              ? 'bg-amber-500 hover:bg-amber-600 opacity-80'
                              : 'bg-teal-600 hover:bg-teal-700'
                          }`}
                          onClick={() => navigate(`/consulente/cliente/${c.id}/nuovo-report`)}>
                          <FileBarChart2 className="w-3.5 h-3.5 mr-1" />
                          {consent?.status === 'accepted' ? '✅ Nuovo report' : 'Nuovo report'}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => deleteClient(c.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Tab Report ── */}
        {tab === 'report' && (
          <div className="space-y-3">
            <h2 className="font-semibold text-slate-700">Report generati</h2>
            {loading ? (
              <div className="py-10 text-center text-sm text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /></div>
            ) : reports.length === 0 ? (
              <div className="py-14 text-center border-2 border-dashed rounded-xl">
                <FileBarChart2 className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                <p className="font-medium text-slate-500">Nessun report ancora</p>
              </div>
            ) : (
              <div className="space-y-2">
                {reports.map(r => {
                  const rating = r.indice_bancabilita !== null ? ratingInfo(r.indice_bancabilita) : null;
                  return (
                    <div key={r.id} className="bg-white rounded-xl border p-4 flex items-center gap-4 hover:border-teal-200 transition-colors cursor-pointer"
                      onClick={() => navigate(`/consulente/report/${r.id}`)}>
                      <FileBarChart2 className="w-5 h-5 text-teal-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{r.client_name}</p>
                        <p className="text-xs text-slate-500">Bilancio {r.anno_bilancio ?? 'N/D'} · {new Date(r.created_at).toLocaleDateString('it-IT')}</p>
                      </div>
                      {r.indice_bancabilita !== null && rating && (
                        <div className="text-right">
                          <div className="text-lg font-black text-slate-700">{Math.round(r.indice_bancabilita)}/100</div>
                          <Badge className={`text-[10px] py-0 ${rating.cls}`}>{rating.label}</Badge>
                        </div>
                      )}
                      {r.sent_at && <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 shrink-0">✅ Inviato</Badge>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
