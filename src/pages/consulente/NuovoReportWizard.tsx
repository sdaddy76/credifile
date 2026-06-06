import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { generateReportPdf } from '@/lib/generateReportPdf';
import type { KpiScore, AiSuggerimento, ReportData } from '@/lib/generateReportPdf';
import { Upload, CheckCircle, Loader2, ArrowLeft, ArrowRight, FileText, BarChart2, Brain, Send, Download } from 'lucide-react';

interface KpiEntry { valore: number | null; formatted: string; semaforo: string; label: string }
type KpiResult = Record<string, Record<string, KpiEntry>>;

const KPI_CONFIG: { key: string; area: string; label: string; inverso: boolean; peso: number; ottimo: number; suff: number; critica: number }[] = [
  { key: 'dscr',          area: 'copertura',     label: 'DSCR',              inverso: false, peso: 30, ottimo: 1.25, suff: 1.0,  critica: 0.8 },
  { key: 'pfn_ebitda',    area: 'indebitamento', label: 'PFN / EBITDA',      inverso: true,  peso: 20, ottimo: 3.0,  suff: 5.0,  critica: 7.0 },
  { key: 'ebitda_margin', area: 'redditivita',   label: 'EBITDA Margin (%)', inverso: false, peso: 15, ottimo: 15,   suff: 5.0,  critica: 0.0 },
  { key: 'current_ratio', area: 'liquidita',     label: 'Current Ratio',     inverso: false, peso: 10, ottimo: 1.5,  suff: 1.0,  critica: 0.8 },
  { key: 'roe',           area: 'redditivita',   label: 'ROE (%)',           inverso: false, peso: 10, ottimo: 10,   suff: 3.0,  critica: 0.0 },
  { key: 'leverage',      area: 'solidita',      label: 'Leverage',          inverso: true,  peso: 10, ottimo: 2.0,  suff: 4.0,  critica: 6.0 },
  { key: 'pfn_pn',        area: 'indebitamento', label: 'PFN / PN',          inverso: true,  peso:  5, ottimo: 1.0,  suff: 3.0,  critica: 5.0 },
];

function calcScore(v: number, ottimo: number, suff: number, critica: number, inv: boolean): number {
  if (!inv) {
    if (v >= ottimo) return 100; if (v <= critica) return 0;
    if (v >= suff) return 55 + ((v - suff) / (ottimo - suff)) * 45;
    return ((v - critica) / (suff - critica)) * 55;
  } else {
    if (v <= ottimo) return 100; if (v >= critica) return 0;
    if (v <= suff) return 55 + ((suff - v) / (suff - ottimo)) * 45;
    return ((critica - v) / (critica - suff)) * 55;
  }
}

export default function NuovoReportWizard() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user, profileNome } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 0: dati cliente & anno
  const [annoStr, setAnnoStr] = useState(String(new Date().getFullYear() - 1));

  // Step 1: bilancio XBRL
  const bilancioRef = useRef<HTMLInputElement>(null);
  const [bilancioFile, setBilancioFile]     = useState<File | null>(null);
  const [analyzingBil, setAnalyzingBil]     = useState(false);
  const [kpiResult,    setKpiResult]        = useState<KpiResult | null>(null);
  const [annoEsercizio, setAnnoEsercizio]   = useState<number | null>(null);
  const [ragSociale,   setRagSociale]       = useState('');

  // Step 2: calcolo scores
  const [kpiScores, setKpiScores]   = useState<KpiScore[]>([]);
  const [indice,    setIndice]      = useState<number | null>(null);

  // Step 3: AI suggestions
  const [aiLoading,    setAiLoading]    = useState(false);
  const [aiSugg,       setAiSugg]       = useState<AiSuggerimento[]>([]);

  // Step 4: genera PDF & invia
  const [generating,   setGenerating]   = useState(false);
  const [pdfBlob,      setPdfBlob]      = useState<Blob | null>(null);
  const [pdfBase64,    setPdfBase64]    = useState<string>('');
  const [sendEmail,    setSendEmail]    = useState('');
  const [sending,      setSending]      = useState(false);
  const [reportSaved,  setReportSaved]  = useState(false);
  const [reportId,     setReportId]     = useState<string | null>(null);

  // Carica info cliente
  const [client, setClient] = useState<{ ragione_sociale: string; email: string | null; partita_iva: string | null; codice_ateco: string | null; settore: string | null; indirizzo: string | null } | null>(null);
  const [clientLoaded, setClientLoaded] = useState(false);
  if (!clientLoaded && clientId) {
    setClientLoaded(true);
    supabase.from('consulente_clients').select('*').eq('id', clientId).maybeSingle().then(({ data }) => {
      if (data) { setClient(data as typeof client); setRagSociale(data.ragione_sociale); setSendEmail(data.email ?? ''); }
    });
  }

  // Carica profilo consulente per logo
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoLoaded, setLogoLoaded] = useState(false);
  if (!logoLoaded && user) {
    setLogoLoaded(true);
    supabase.from('admin_profiles').select('logo_url').eq('id', user.id).maybeSingle().then(({ data }) => {
      setLogoUrl(data?.logo_url ?? null);
    });
  }

  // ── STEP 1: analizza bilancio XBRL ──────────────────────────────────────
  const analizzaBilancio = async () => {
    if (!bilancioFile) { toast.error('Seleziona il file bilancio XBRL'); return; }
    setAnalyzingBil(true);
    try {
      const arrayBuf = await bilancioFile.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
      const { data, error } = await supabase.functions.invoke('analizza-bilancio', {
        body: { file_base64: b64, file_name: bilancioFile.name }
      });
      if (error || !data?.success) { toast.error(data?.error ?? 'Errore analisi bilancio'); return; }
      setKpiResult(data.kpi as KpiResult);
      setAnnoEsercizio(data.anno_esercizio ?? parseInt(annoStr));
      if (data.ragione_sociale) setRagSociale(data.ragione_sociale);
      toast.success('Bilancio analizzato con successo');
      computeScores(data.kpi as KpiResult);
      setStep(2);
    } finally { setAnalyzingBil(false); }
  };

  // ── STEP 2: calcola scores ───────────────────────────────────────────────
  const computeScores = (kpi: KpiResult) => {
    const scores: KpiScore[] = KPI_CONFIG.map(cfg => {
      const entry = kpi?.[cfg.area]?.[cfg.key];
      const v = entry?.valore ?? null;
      const sc = v !== null ? Math.round(Math.min(100, Math.max(0, calcScore(v, cfg.ottimo, cfg.suff, cfg.critica, cfg.inverso)))) : null;
      return {
        kpi_key: cfg.key, kpi_label: cfg.label, kpi_area: cfg.area,
        valore: v, formatted: entry?.formatted ?? (v !== null ? String(v) : 'N/D'),
        score: sc, benchmark: cfg.ottimo, benchmark_formatted: String(cfg.ottimo),
        inverso: cfg.inverso,
      };
    });
    setKpiScores(scores);
    const avail = scores.filter(s => s.score !== null);
    if (avail.length > 0) {
      const tot = avail.reduce((s, k) => s + (k.score! * KPI_CONFIG.find(c => c.key === k.kpi_key)!.peso), 0);
      const wp  = avail.reduce((s, k) => s + KPI_CONFIG.find(c => c.key === k.kpi_key)!.peso, 0);
      setIndice(Math.round((tot / wp) * 100) / 100);
    }
  };

  // ── STEP 3: AI suggestions ───────────────────────────────────────────────
  const generaSuggerimenti = async () => {
    const sorted = [...kpiScores].filter(k => k.score !== null).sort((a, b) => (a.score ?? 99) - (b.score ?? 99));
    const worst3 = sorted.slice(0, 3);
    setAiLoading(true);
    try {
      const { data } = await supabase.functions.invoke('genera-suggerimenti-kpi', {
        body: {
          worst_kpis: worst3.map(k => ({
            kpi_key: k.kpi_key, kpi_label: k.kpi_label, valore: k.valore,
            score: k.score, soglia_ottimo: k.benchmark, soglia_suff: null as number | null,
            inverso: k.inverso, formatted: k.formatted,
          })),
          ragione_sociale: ragSociale,
          settore: client?.settore ?? '',
          codice_ateco: client?.codice_ateco ?? '',
          anno_bilancio: annoEsercizio ?? parseInt(annoStr),
        }
      });
      setAiSugg(data?.suggerimenti ?? []);
      toast.success(`Suggerimenti generati (fonte: ${data?.source ?? 'AI'})`);
    } catch { toast.error('Errore generazione suggerimenti'); }
    finally { setAiLoading(false); }
  };

  // ── STEP 4: genera PDF ───────────────────────────────────────────────────
  const generaPdf = async () => {
    setGenerating(true);
    try {
      const sorted = [...kpiScores].filter(k => k.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const top3    = sorted.slice(0, 3);
      const bottom3 = [...sorted].reverse().slice(0, 3);

      const reportData: ReportData = {
        ragione_sociale: ragSociale,
        partita_iva: client?.partita_iva ?? undefined,
        codice_ateco: client?.codice_ateco ?? undefined,
        settore: client?.settore ?? undefined,
        indirizzo: client?.indirizzo ?? undefined,
        anno_bilancio: annoEsercizio ?? parseInt(annoStr),
        indice_bancabilita: indice,
        kpi_scores: kpiScores,
        top3, bottom3,
        ai_suggerimenti: aiSugg,
        consulente_nome: profileNome ?? user?.email ?? 'Consulente',
        consulente_email: user?.email ?? undefined,
        consulente_logo_url: logoUrl,
      };

      const { pdfBlob: blob, base64 } = await generateReportPdf(reportData);
      setPdfBlob(blob);
      setPdfBase64(base64);

      // Salva in DB
      if (user) {
        const { data: saved, error } = await supabase.from('consulente_reports').insert({
          consulente_id: user.id,
          client_id: clientId ?? null,
          client_name: ragSociale,
          client_email: sendEmail || null,
          anno_bilancio: annoEsercizio ?? parseInt(annoStr),
          kpi_data: kpiResult,
          kpi_scores: kpiScores,
          ai_suggestions: aiSugg,
          indice_bancabilita: indice,
          top3_kpi: top3,
          bottom3_kpi: bottom3,
        }).select('id').single();
        if (!error && saved) { setReportId(saved.id); setReportSaved(true); }
      }
      toast.success('Report PDF generato!');
    } finally { setGenerating(false); }
  };

  const scaricaPdf = () => {
    if (!pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a'); a.href = url;
    a.download = `Report_Bancabilita_${ragSociale.replace(/\s+/g, '_')}_${annoEsercizio ?? annoStr}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  const inviaEmail = async () => {
    if (!sendEmail) { toast.error('Inserisci email destinatario'); return; }
    setSending(true);
    try {
      await supabase.functions.invoke('send-report-consulente', {
        body: {
          to_email: sendEmail, to_name: ragSociale,
          consulente_nome: profileNome ?? user?.email,
          consulente_email: user?.email,
          report_id: reportId,
          client_name: ragSociale,
          anno_bilancio: annoEsercizio ?? parseInt(annoStr),
          indice_bancabilita: indice,
          pdf_base64: pdfBase64,
        }
      });
      if (reportId) await supabase.from('consulente_reports').update({ sent_at: new Date().toISOString() }).eq('id', reportId);
      toast.success(`Report inviato a ${sendEmail}`);
    } finally { setSending(false); }
  };

  // ── STEPS UI ─────────────────────────────────────────────────────────────
  const steps = ['Dati cliente', 'Analisi bilancio', 'Score KPI', 'AI Suggerimenti', 'Report finale'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50/40 to-slate-50">
      {/* Header */}
      <div className="bg-teal-700 text-white px-6 py-3 flex items-center gap-3">
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={() => navigate('/consulente')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Torna alla dashboard
        </Button>
        <span className="text-teal-200 text-sm">|</span>
        <span className="text-sm font-medium">Nuovo Report Bancabilità {client ? `— ${client.ragione_sociale}` : ''}</span>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Progress stepper */}
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all
                ${i < step ? 'bg-teal-600 text-white' : i === step ? 'bg-teal-700 text-white ring-2 ring-teal-300' : 'bg-slate-200 text-slate-400'}`}>
                {i < step ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${i === step ? 'text-teal-700' : 'text-slate-400'}`}>{s}</span>
              {i < steps.length - 1 && <div className={`flex-1 h-0.5 ${i < step ? 'bg-teal-500' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        {/* ── STEP 0: Dati cliente ── */}
        {step === 0 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><FileText className="w-4 h-4 text-teal-600" /> Dati cliente</h2>
            {client ? (
              <div className="bg-teal-50 rounded-lg p-4 space-y-1 text-sm">
                <p className="font-semibold text-teal-800">{client.ragione_sociale}</p>
                {client.partita_iva && <p className="text-slate-600">P.IVA: {client.partita_iva}</p>}
                {client.codice_ateco && <p className="text-slate-600">ATECO: {client.codice_ateco} {client.settore && `— ${client.settore}`}</p>}
              </div>
            ) : (
              <div>
                <label className="text-xs font-semibold text-slate-600">Ragione sociale</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5" value={ragSociale} onChange={e => setRagSociale(e.target.value)} />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-600">Anno bilancio da analizzare</label>
              <input type="number" min="2018" max={new Date().getFullYear()}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5"
                value={annoStr} onChange={e => setAnnoStr(e.target.value)} />
            </div>
            <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={() => setStep(1)}>
              Continua <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── STEP 1: Upload bilancio ── */}
        {step === 1 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><Upload className="w-4 h-4 text-teal-600" /> Carica Bilancio XBRL</h2>
            <p className="text-sm text-slate-500">Carica il bilancio depositato in formato XBRL (.xbrl, .xml) per l'analisi automatica dei KPI.</p>
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-teal-400 transition-colors cursor-pointer"
              onClick={() => bilancioRef.current?.click()}>
              <Upload className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              {bilancioFile ? (
                <p className="text-sm font-medium text-teal-700">✅ {bilancioFile.name}</p>
              ) : (
                <p className="text-sm text-slate-400">Clicca per selezionare il file XBRL</p>
              )}
              <input ref={bilancioRef} type="file" accept=".xbrl,.xml" className="hidden"
                onChange={e => setBilancioFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(0)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={analizzaBilancio} disabled={!bilancioFile || analyzingBil}>
                {analyzingBil ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analisi in corso...</> : 'Analizza bilancio'}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2: KPI Scores ── */}
        {step === 2 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><BarChart2 className="w-4 h-4 text-teal-600" /> Score KPI</h2>
            {indice !== null && (
              <div className="text-center py-3 bg-gradient-to-br from-teal-50 to-slate-50 rounded-xl border">
                <div className="text-4xl font-black text-teal-700">{Math.round(indice)}<span className="text-xl text-slate-400">/100</span></div>
                <div className="text-sm font-semibold text-teal-600 mt-1">Indice di Bancabilità</div>
              </div>
            )}
            <div className="space-y-2">
              {kpiScores.filter(k => k.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map(k => (
                <div key={k.kpi_key} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 font-medium text-slate-700 text-xs">{k.kpi_label}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${k.score! >= 70 ? 'bg-green-500' : k.score! >= 40 ? 'bg-yellow-400' : 'bg-red-500'}`}
                      style={{ width: `${k.score}%` }} />
                  </div>
                  <span className="w-12 text-right text-xs font-bold tabular-nums text-slate-600">{k.score}/100</span>
                  <span className="text-xs text-slate-400 w-16 text-right">{k.formatted}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={() => { setStep(3); generaSuggerimenti(); }}>
                Genera suggerimenti AI <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: AI Suggerimenti ── */}
        {step === 3 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><Brain className="w-4 h-4 text-teal-600" /> Raccomandazioni AI</h2>
            {aiLoading ? (
              <div className="py-10 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-600 mb-3" />
                <p className="text-sm text-slate-500">Groq AI sta elaborando le raccomandazioni...</p>
              </div>
            ) : aiSugg.length === 0 ? (
              <div className="text-center py-6 text-sm text-slate-400">Nessun suggerimento generato</div>
            ) : (
              <div className="space-y-4">
                {aiSugg.map((s, i) => (
                  <div key={s.kpi_key} className="border border-amber-200 rounded-xl p-4 bg-amber-50/40">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <span className="font-semibold text-amber-900">{s.kpi_label}</span>
                    </div>
                    <p className="text-xs text-slate-600 italic mb-2">{s.diagnosi}</p>
                    <ul className="space-y-1">
                      {s.azioni.map((az, j) => (
                        <li key={j} className="text-xs text-slate-700 flex items-start gap-1.5">
                          <span className="text-teal-600 font-bold mt-0.5">→</span> {az}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 text-xs text-teal-700 bg-teal-50 rounded px-2 py-1 border border-teal-200">
                      💡 {s.impatto_atteso}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={() => setStep(4)} disabled={aiLoading}>
                Genera report PDF <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 4: Report finale ── */}
        {step === 4 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><FileText className="w-4 h-4 text-teal-600" /> Report finale</h2>
            {!pdfBlob ? (
              <div className="text-center py-6">
                <Button size="lg" className="bg-teal-600 hover:bg-teal-700" onClick={generaPdf} disabled={generating}>
                  {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generazione PDF...</> : '📄 Genera PDF'}
                </Button>
                <p className="text-xs text-slate-400 mt-2">Il PDF include logo, KPI, benchmark, top/bottom 3 e suggerimenti AI</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-center">
                  <CheckCircle className="w-8 h-8 text-teal-600 mx-auto mb-2" />
                  <p className="font-semibold text-teal-800">Report PDF generato{reportSaved ? ' e salvato' : ''}!</p>
                </div>
                <Button className="w-full" variant="outline" onClick={scaricaPdf}>
                  <Download className="w-4 h-4 mr-2" /> Scarica PDF
                </Button>
                <div className="border-t pt-4 space-y-2">
                  <label className="text-xs font-semibold text-slate-600">Invia via email a:</label>
                  <div className="flex gap-2">
                    <input type="email" className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 ring-teal-400 outline-none"
                      placeholder="email@cliente.it" value={sendEmail} onChange={e => setSendEmail(e.target.value)} />
                    <Button className="bg-teal-600 hover:bg-teal-700" onClick={inviaEmail} disabled={sending || !sendEmail}>
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={() => navigate('/consulente')}>
                  ← Torna alla dashboard
                </Button>
              </div>
            )}
            {!pdfBlob && (
              <Button variant="outline" onClick={() => setStep(3)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
