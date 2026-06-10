import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw, AlertTriangle, CheckCircle2, Building2, User, Users,
  ExternalLink, Clock, TrendingUp, TrendingDown, Newspaper, ShieldAlert,
  BarChart2, Minus, Ban, RotateCcw, Info,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props { practiceId: string; clientId: string }

interface NewsItem { title: string; snippet: string; link: string; date: string; source: string }
interface Signal {
  text: string; category: string; weight: number;
  articleTitle?: string; articleDate?: string; articleLink?: string;
}
interface SubjectResult {
  nome: string; tipo: string; score: number;
  news: NewsItem[]; signals: Signal[]; newsRischio: NewsItem[];
  totalNewsFetched?: number;
}
interface Risultati {
  societa: SubjectResult;
  amministratori: SubjectResult[];
  soci: SubjectResult[];
  generato_il: string;
}
interface ExcludedSignal {
  id: string;          // `${subject_name}__${signal_text}`
  subject_name: string;
  signal_text: string;
  category: string;
  weight: number;
  reason: string;
  excluded_by?: string;
  excluded_at: string;
}
interface AnalysisRecord {
  id: string; created_at: string;
  score_globale: number; score_societa: number; score_amm: number; score_soci: number;
  risultati: Risultati;
  excluded_signals?: ExcludedSignal[];
}

// ─── Helpers di colore ────────────────────────────────────────────────────────
function scoreColor(s: number) {
  if (s >= 75) return 'text-green-700 bg-green-50 border-green-200';
  if (s >= 50) return 'text-amber-700 bg-amber-50 border-amber-200';
  return 'text-red-700 bg-red-50 border-red-200';
}
function scoreBadge(s: number) {
  if (s >= 75) return { label: 'Basso rischio',    color: 'bg-green-100 text-green-800' };
  if (s >= 50) return { label: 'Rischio moderato', color: 'bg-amber-100 text-amber-800' };
  return          { label: 'Alto rischio',     color: 'bg-red-100 text-red-800' };
}
function scoreLine(s: number): string {
  if (s >= 75) return '#16a34a';
  if (s >= 50) return '#d97706';
  return '#dc2626';
}

// ─── Gauge SVG ────────────────────────────────────────────────────────────────
function ScoreGauge({ score, adjusted }: { score: number; adjusted?: number }) {
  const displayScore = adjusted ?? score;
  const color = scoreLine(displayScore);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 100 60" className="w-28 h-[4.5rem]">
        <path d="M10 55 A40 40 0 0 1 90 55" fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round" />
        <path d="M10 55 A40 40 0 0 1 90 55" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${Math.round(displayScore) * 1.257} 126`} />
        <text x="50" y="52" textAnchor="middle" fontSize="18" fontWeight="bold" fill={color}>{Math.round(displayScore)}</text>
      </svg>
      <span className="text-xs text-muted-foreground">/ 100</span>
      {adjusted !== undefined && adjusted !== score && (
        <span className="text-[10px] text-amber-600 font-medium">rettificato</span>
      )}
    </div>
  );
}

// ─── Trend SVG (grafico lineare storico score) ────────────────────────────────
function TrendChart({ analyses }: { analyses: AnalysisRecord[] }) {
  if (analyses.length < 2) return null;
  const sorted = [...analyses].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const W = 320; const H = 80; const PAD = 16;
  const xs = sorted.map((_, i) => PAD + (i / (sorted.length - 1)) * (W - PAD * 2));
  const ys = sorted.map(a => H - PAD - ((a.score_globale / 100) * (H - PAD * 2)));
  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  const last  = sorted[sorted.length - 1];
  const prev  = sorted[sorted.length - 2];
  const delta = last.score_globale - prev.score_globale;
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center justify-between">
          <span className="flex items-center gap-1.5"><BarChart2 className="w-3.5 h-3.5" /> Andamento Score Globale</span>
          <span className={`flex items-center gap-1 text-sm font-bold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-slate-500'}`}>
            {delta > 0 ? <TrendingUp className="w-4 h-4" /> : delta < 0 ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
            {delta > 0 ? '+' : ''}{delta} pt vs analisi precedente
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20">
          {[25, 50, 75].map(v => {
            const y = H - PAD - ((v / 100) * (H - PAD * 2));
            return <line key={v} x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#f1f5f9" strokeWidth="1" />;
          })}
          <line x1={PAD} y1={H - PAD - (0.75 * (H - PAD * 2))} x2={W - PAD} y2={H - PAD - (0.75 * (H - PAD * 2))} stroke="#bbf7d0" strokeWidth="1" strokeDasharray="4 3" />
          <line x1={PAD} y1={H - PAD - (0.50 * (H - PAD * 2))} x2={W - PAD} y2={H - PAD - (0.50 * (H - PAD * 2))} stroke="#fef08a" strokeWidth="1" strokeDasharray="4 3" />
          <polyline points={polyline} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {sorted.map((a, i) => (
            <g key={a.id}>
              <circle cx={xs[i]} cy={ys[i]} r="4" fill={scoreLine(a.score_globale)} stroke="white" strokeWidth="1.5" />
              <title>{new Date(a.created_at).toLocaleDateString('it-IT')} · {a.score_globale}/100</title>
            </g>
          ))}
        </svg>
        <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-0.5">
          {sorted.map((a, i) => (
            <span key={a.id} style={{ width: `${100 / sorted.length}%`, textAlign: i === 0 ? 'left' : i === sorted.length - 1 ? 'right' : 'center' }}>
              {new Date(a.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Badge segnale con link articolo ─────────────────────────────────────────
function SignalBadge({
  signal,
  excluded,
  onExclude,
  onRestore,
}: {
  signal: Signal;
  excluded?: boolean;
  onExclude?: () => void;
  onRestore?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const isPos   = signal.weight > 0;
  const hasRef  = !!signal.articleTitle;
  const hasLink = !!signal.articleLink;

  return (
    <span className="relative inline-flex items-center gap-0.5">
      {/* Badge principale */}
      <span
        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-l-full border font-medium
          ${excluded
            ? 'bg-slate-100 text-slate-400 border-slate-200 line-through opacity-60'
            : isPos
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-red-50 text-red-700 border-red-200'}
          ${hasRef ? 'underline decoration-dotted cursor-pointer' : 'cursor-default'}`}
        onMouseEnter={() => hasRef && setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {isPos ? <TrendingUp className="w-3 h-3" /> : excluded ? <Ban className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
        {signal.text}
        {!isPos && <span className="ml-0.5 font-bold">{signal.weight}</span>}
        {isPos  && <span className="ml-0.5 font-bold">+{signal.weight}</span>}
      </span>

      {/* Link esterno articolo (se disponibile) */}
      {hasLink && !excluded && (
        <a href={signal.articleLink} target="_blank" rel="noopener noreferrer"
          className={`inline-flex items-center px-1.5 py-0.5 border-y border-r rounded-r-full text-[10px]
            ${isPos ? 'border-green-200 text-green-600 bg-green-50 hover:bg-green-100' : 'border-red-200 text-red-600 bg-red-50 hover:bg-red-100'}`}
          title="Apri articolo sorgente">
          <ExternalLink className="w-3 h-3" />
        </a>
      )}

      {/* Pulsante Escludi / Ripristina (solo segnali negativi) */}
      {!isPos && onExclude && !excluded && (
        <button
          onClick={onExclude}
          className="ml-0.5 inline-flex items-center px-1 py-0.5 rounded text-[10px] text-slate-500 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors"
          title="Escludi questo segnale (falso positivo)"
        >
          <Ban className="w-3 h-3" />
        </button>
      )}
      {!isPos && onRestore && excluded && (
        <button
          onClick={onRestore}
          className="ml-0.5 inline-flex items-center px-1 py-0.5 rounded text-[10px] text-slate-400 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-200 transition-colors"
          title="Ripristina segnale"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      )}

      {/* Tooltip articolo sorgente */}
      {hover && hasRef && (
        <div className="absolute bottom-full left-0 mb-1.5 z-50 w-64 bg-slate-900 text-white text-[11px] rounded-lg p-2.5 shadow-xl leading-snug pointer-events-none">
          <p className="font-semibold text-slate-200 mb-0.5">Articolo sorgente:</p>
          <p className="text-slate-300 line-clamp-3">{signal.articleTitle}</p>
          {signal.articleDate && (
            <p className="text-slate-400 mt-1">
              {new Date(signal.articleDate).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })}
            </p>
          )}
          {hasLink && <p className="text-slate-500 mt-0.5 truncate">{signal.articleLink}</p>}
        </div>
      )}
    </span>
  );
}

// ─── Card soggetto ────────────────────────────────────────────────────────────
function SubjectCard({
  result,
  excludedSignals,
  onExclude,
  onRestore,
}: {
  result: SubjectResult;
  excludedSignals: ExcludedSignal[];
  onExclude: (signal: Signal, subjectName: string) => void;
  onRestore: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Segnali effettivi: distingui esclusi dagli attivi
  const negSignals = result.signals.filter(s => s.weight < 0);
  const posSignals = result.signals.filter(s => s.weight > 0);
  const allNews    = result.news ?? [];

  const isExcluded = (s: Signal) =>
    excludedSignals.some(e => e.subject_name === result.nome && e.signal_text === s.text);
  const getExcludeId = (s: Signal) =>
    excludedSignals.find(e => e.subject_name === result.nome && e.signal_text === s.text)?.id;

  // Score rettificato: rimuove il peso dei segnali esclusi
  const excludedWeight = negSignals
    .filter(s => isExcluded(s))
    .reduce((sum, s) => sum + s.weight, 0); // weight è negativo
  const adjustedScore = Math.max(0, Math.min(100, result.score - excludedWeight));
  const hasExclusions = excludedWeight < 0;

  const badge = scoreBadge(adjustedScore);
  const Icon  = result.tipo === 'societa' ? Building2 : result.tipo === 'socio' ? Users : User;
  const tipoLabel = result.tipo === 'societa' ? 'Società' : result.tipo === 'amministratore' ? 'Amministratore' : 'Socio';

  // Raggruppa segnali negativi per categoria (inclusi esclusi, marcati)
  const grouped: Record<string, Signal[]> = {};
  for (const s of negSignals) {
    if (!grouped[s.category]) grouped[s.category] = [];
    if (!grouped[s.category].find(x => x.text === s.text)) grouped[s.category].push(s);
  }

  return (
    <Card className={`border ${negSignals.filter(s => !isExcluded(s)).length > 0 ? 'border-red-200' : 'border-border'}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0
            ${adjustedScore >= 75 ? 'bg-green-100' : adjustedScore >= 50 ? 'bg-amber-100' : 'bg-red-100'}`}>
            <Icon className={`w-4 h-4 ${adjustedScore >= 75 ? 'text-green-700' : adjustedScore >= 50 ? 'text-amber-700' : 'text-red-700'}`} />
          </div>
          <div className="flex-1 min-w-0">
            {/* Header soggetto */}
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm">{result.nome}</p>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{tipoLabel}</span>
              <Badge className={`text-xs ${badge.color}`}>{badge.label}</Badge>
              <span className={`text-xs font-bold px-2 py-0.5 rounded border ${scoreColor(adjustedScore)}`}>
                {adjustedScore}/100
                {hasExclusions && (
                  <span className="ml-1 text-[9px] font-normal text-amber-600">(rettificato)</span>
                )}
              </span>
              {result.totalNewsFetched !== undefined && (
                <span className="text-[10px] text-muted-foreground/60">
                  {result.totalNewsFetched} fonti analizzate
                </span>
              )}
            </div>

            {/* Segnali negativi per categoria */}
            {Object.keys(grouped).length > 0 && (
              <div className="mt-2 space-y-1.5">
                {Object.entries(grouped).map(([cat, sigs]) => (
                  <div key={cat} className="flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide w-full">{cat}</span>
                    {sigs.map((s, i) => (
                      <SignalBadge
                        key={i}
                        signal={s}
                        excluded={isExcluded(s)}
                        onExclude={() => onExclude(s, result.nome)}
                        onRestore={() => { const id = getExcludeId(s); if (id) onRestore(id); }}
                      />
                    ))}
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground/50 flex items-center gap-1 mt-1">
                  <Info className="w-3 h-3" /> Clicca <Ban className="w-3 h-3 inline" /> per escludere segnali non pertinenti (falsi positivi)
                </p>
              </div>
            )}

            {/* Segnali positivi */}
            {posSignals.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {posSignals.map((s, i) => <SignalBadge key={i} signal={s} />)}
              </div>
            )}

            {/* Nessun segnale attivo */}
            {negSignals.filter(s => !isExcluded(s)).length === 0 && negSignals.length > 0 && (
              <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Tutti i segnali esclusi — score rettificato
              </p>
            )}
            {result.signals.length === 0 && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Nessun segnale di rischio rilevato
              </p>
            )}

            {/* Notizie */}
            {allNews.length > 0 && (
              <div className="mt-2">
                <button className="text-xs text-primary underline" onClick={() => setExpanded(e => !e)}>
                  {expanded ? 'Nascondi notizie' : `Mostra ${allNews.length} notizie trovate`}
                </button>
                {expanded && (
                  <div className="mt-2 space-y-2">
                    {allNews.map((n, i) => (
                      <div key={i} className="text-xs bg-muted/40 rounded p-2 space-y-0.5">
                        <a href={n.link} target="_blank" rel="noopener noreferrer"
                          className="font-medium text-primary hover:underline flex items-start gap-1 leading-tight">
                          {n.title.substring(0, 110)}{n.title.length > 110 ? '…' : ''}
                          <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" />
                        </a>
                        {n.snippet && <p className="text-muted-foreground line-clamp-2">{n.snippet.substring(0, 160)}</p>}
                        <div className="flex items-center gap-2 text-muted-foreground/60">
                          {n.source && (
                            <span className={`px-1 py-0.5 rounded text-[10px] ${n.source === 'DuckDuckGo' ? 'bg-orange-50 text-orange-600' : 'bg-blue-50 text-blue-600'}`}>
                              {n.source}
                            </span>
                          )}
                          {n.date && <span>{new Date(n.date).toLocaleDateString('it-IT')}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {allNews.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">Nessuna notizia trovata sul web</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Modale esclusione segnale ────────────────────────────────────────────────
function ExcludeModal({
  signal,
  subjectName,
  onConfirm,
  onCancel,
}: {
  signal: Signal;
  subjectName: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5 space-y-4">
        <h3 className="font-semibold text-base flex items-center gap-2 text-slate-800">
          <Ban className="w-4 h-4 text-red-500" /> Escludi segnale
        </h3>
        <div className="text-sm text-muted-foreground space-y-1">
          <p><span className="font-medium text-foreground">Soggetto:</span> {subjectName}</p>
          <p><span className="font-medium text-foreground">Segnale:</span> {signal.text}
            <span className="ml-1 text-red-600 font-bold">({signal.weight})</span>
          </p>
          {signal.articleTitle && (
            <p className="text-xs bg-slate-50 border rounded p-2 mt-1">
              📰 {signal.articleTitle}
              {signal.articleLink && (
                <a href={signal.articleLink} target="_blank" rel="noopener noreferrer"
                  className="ml-1 text-blue-600 underline inline-flex items-center gap-0.5">
                  apri <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">
            Motivazione dell'esclusione <span className="text-red-500">*</span>
          </label>
          <textarea
            className="w-full border rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
            rows={3}
            placeholder="Es: Società omonima con sede in altra città / P.IVA diversa — non pertinente"
            value={reason}
            onChange={e => setReason(e.target.value)}
            autoFocus
          />
          <p className="text-[10px] text-muted-foreground">La motivazione viene salvata nel log di audit.</p>
        </div>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>Annulla</Button>
          <Button size="sm" onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim()}
            className="gap-1.5 bg-red-600 hover:bg-red-700 text-white border-0">
            <Ban className="w-3.5 h-3.5" /> Conferma esclusione
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Componente principale ────────────────────────────────────────────────────
export default function ReputazioneTab({ practiceId, clientId }: Props) {
  const [loading,        setLoading]        = useState(false);
  const [analyses,       setAnalyses]       = useState<AnalysisRecord[]>([]);
  const [selected,       setSelected]       = useState<AnalysisRecord | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [excludeTarget,  setExcludeTarget]  = useState<{ signal: Signal; subjectName: string } | null>(null);
  const [savingExclude,  setSavingExclude]  = useState(false);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    const { data } = await supabase
      .from('reputational_analyses')
      .select('*')
      .eq('practice_id', practiceId)
      .order('created_at', { ascending: false })
      .limit(10);
    const list = (data ?? []) as AnalysisRecord[];
    setAnalyses(list);
    if (list.length > 0 && !selected) setSelected(list[0]);
    setLoadingHistory(false);
  }, [practiceId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const handleAnalyze = async () => {
    setLoading(true);
    toast.info('Analisi in corso… ricerca parallela su Google News e DuckDuckGo. Può richiedere 20-40 secondi.');
    try {
      const { data, error } = await supabase.functions.invoke('analisi-reputazione', {
        body: { client_id: clientId, practice_id: practiceId },
      });
      if (error || !data?.success) throw new Error(error?.message ?? data?.error ?? 'Errore analisi');
      toast.success(`Analisi completata — Score globale: ${data.score_globale}/100`);
      await loadHistory();
    } catch (e: unknown) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  };

  // Esclusione segnale
  const handleExclude = async (reason: string) => {
    if (!excludeTarget || !selected) return;
    setSavingExclude(true);
    const { signal, subjectName } = excludeTarget;
    const newExclusion: ExcludedSignal = {
      id: `${subjectName}__${signal.text}`,
      subject_name: subjectName,
      signal_text: signal.text,
      category: signal.category,
      weight: signal.weight,
      reason,
      excluded_at: new Date().toISOString(),
    };
    const current: ExcludedSignal[] = selected.excluded_signals ?? [];
    const updated = [...current.filter(e => e.id !== newExclusion.id), newExclusion];
    const { error } = await supabase
      .from('reputational_analyses')
      .update({ excluded_signals: updated })
      .eq('id', selected.id);
    if (error) {
      toast.error('Errore nel salvataggio dell\'esclusione');
    } else {
      const updatedRecord = { ...selected, excluded_signals: updated };
      setSelected(updatedRecord);
      setAnalyses(prev => prev.map(a => a.id === selected.id ? updatedRecord : a));
      toast.success(`Segnale "${signal.text}" escluso dall'analisi`);
    }
    setSavingExclude(false);
    setExcludeTarget(null);
  };

  // Ripristino segnale
  const handleRestore = async (excludeId: string) => {
    if (!selected) return;
    const updated = (selected.excluded_signals ?? []).filter(e => e.id !== excludeId);
    const { error } = await supabase
      .from('reputational_analyses')
      .update({ excluded_signals: updated })
      .eq('id', selected.id);
    if (error) {
      toast.error('Errore nel ripristino del segnale');
    } else {
      const updatedRecord = { ...selected, excluded_signals: updated };
      setSelected(updatedRecord);
      setAnalyses(prev => prev.map(a => a.id === selected.id ? updatedRecord : a));
      toast.success('Segnale ripristinato');
    }
  };

  if (loadingHistory) return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const r = selected?.risultati;
  const excludedSignals: ExcludedSignal[] = selected?.excluded_signals ?? [];

  // Segnali negativi aggregati (solo attivi — non esclusi)
  const isExcluded = (s: Signal, subjectName: string) =>
    excludedSignals.some(e => e.subject_name === subjectName && e.signal_text === s.text);

  const allNegSignalsActive: Signal[] = r ? [
    ...(r.societa.signals ?? []).filter(s => s.weight < 0 && !isExcluded(s, r.societa.nome)),
    ...(r.amministratori ?? []).flatMap(a => (a.signals ?? []).filter(s => s.weight < 0 && !isExcluded(s, a.nome))),
    ...(r.soci ?? []).flatMap(s => (s.signals ?? []).filter(sig => sig.weight < 0 && !isExcluded(sig, s.nome))),
  ] : [];

  const groupedNeg: Record<string, Signal[]> = {};
  for (const s of allNegSignalsActive) {
    if (!groupedNeg[s.category]) groupedNeg[s.category] = [];
    if (!groupedNeg[s.category].find(x => x.text === s.text)) groupedNeg[s.category].push(s);
  }

  // Score rettificati per i gauge globali
  const computeAdjustedScore = (subj: SubjectResult) => {
    const excW = (subj.signals ?? []).filter(s => s.weight < 0 && isExcluded(s, subj.nome)).reduce((acc, s) => acc + s.weight, 0);
    return Math.max(0, Math.min(100, subj.score - excW));
  };
  const adjSocieta = r ? computeAdjustedScore(r.societa) : selected?.score_societa ?? 0;
  const adjAmm     = r && (r.amministratori ?? []).length > 0
    ? Math.round((r.amministratori ?? []).reduce((s, a) => s + computeAdjustedScore(a), 0) / (r.amministratori ?? []).length)
    : selected?.score_amm ?? 0;
  const adjSoci    = r && (r.soci ?? []).length > 0
    ? Math.round((r.soci ?? []).reduce((s, a) => s + computeAdjustedScore(a), 0) / (r.soci ?? []).length)
    : selected?.score_soci ?? 0;
  const adjGlobale  = r ? Math.round(adjSocieta * 0.5 + adjAmm * 0.3 + adjSoci * 0.2) : selected?.score_globale ?? 0;
  const hasAdjustments = excludedSignals.length > 0;

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-primary" /> Analisi Reputazionale
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ricerca su Google News + DuckDuckGo · 7 query parallele per soggetto · 9 categorie di rischio
          </p>
        </div>
        <Button onClick={handleAnalyze} disabled={loading} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Analisi in corso…' : analyses.length > 0 ? 'Aggiorna Analisi' : 'Avvia Analisi'}
        </Button>
      </div>

      {/* ── Storico pill ── */}
      {analyses.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {analyses.map(a => (
            <button key={a.id} onClick={() => setSelected(a)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-colors
                ${selected?.id === a.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:border-muted-foreground/50'}`}>
              <Clock className="w-3 h-3 inline mr-1" />
              {new Date(a.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })}
              {' · '}{a.score_globale}/100
              {(a.excluded_signals ?? []).length > 0 && (
                <span className="ml-1 text-amber-500">✱</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* ── Nessuna analisi ── */}
      {analyses.length === 0 && (
        <div className="py-14 text-center border rounded-lg bg-muted/20">
          <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-30" />
          <p className="font-medium">Nessuna analisi effettuata</p>
          <p className="text-sm text-muted-foreground mt-1">
            Clicca "Avvia Analisi" per cercare notizie e segnali di rischio su web<br />
            per la società, gli amministratori e i soci
          </p>
          <div className="flex items-center justify-center gap-4 mt-3 text-[10px] text-muted-foreground/50">
            <span className="flex items-center gap-1"><Newspaper className="w-3 h-3" /> Google News Italia</span>
            <span className="flex items-center gap-1"><Newspaper className="w-3 h-3" /> DuckDuckGo Web</span>
            <span>9 categorie di rischio · Nessuna API key richiesta</span>
          </div>
        </div>
      )}

      {/* ── Dashboard risultati ── */}
      {selected && r && (
        <>
          {/* Banner rettifica attiva */}
          {hasAdjustments && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>
                <strong>{excludedSignals.length} segnale{excludedSignals.length > 1 ? 'i' : ''} escluso{excludedSignals.length > 1 ? 'i' : ''}</strong> dall'agente.
                Gli score rettificati sono indicativi — avvia una nuova analisi per aggiornare i dati ufficiali.
              </span>
            </div>
          )}

          {/* Grafico trend */}
          {analyses.length >= 2 && <TrendChart analyses={analyses} />}

          {/* Score globale — 4 gauge */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Score Globale',  score: selected.score_globale, adjusted: adjGlobale,  icon: <TrendingUp className="w-4 h-4" /> },
              { label: 'Società',        score: selected.score_societa, adjusted: adjSocieta,  icon: <Building2  className="w-4 h-4" /> },
              { label: 'Amministratori', score: selected.score_amm,     adjusted: adjAmm,       icon: <User       className="w-4 h-4" /> },
              { label: 'Soci',           score: selected.score_soci,    adjusted: adjSoci,      icon: <Users      className="w-4 h-4" /> },
            ].map(({ label, score, adjusted, icon }) => {
              const b = scoreBadge(adjusted);
              return (
                <Card key={label} className={`border ${scoreColor(adjusted)}`}>
                  <CardContent className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">{icon}{label}</div>
                    <ScoreGauge score={score} adjusted={adjusted} />
                    <Badge className={`text-[10px] mt-1 ${b.color}`}>{b.label}</Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Segnali aggregati attivi */}
          {Object.keys(groupedNeg).length === 0 ? (
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="py-3 px-4 flex items-center gap-2 text-green-700 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                {allNegSignalsActive.length === 0 && excludedSignals.length > 0
                  ? 'Tutti i segnali di rischio esclusi dall\'agente'
                  : 'Nessun segnale di rischio rilevato per nessun soggetto analizzato'}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-red-200/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-red-800">
                  <AlertTriangle className="w-4 h-4" /> Segnali di Rischio Aggregati
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    Passa il cursore su un segnale per i dettagli · clicca <Ban className="w-3 h-3 inline" /> per escludere
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(groupedNeg).map(([cat, sigs]) => (
                  <div key={cat}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{cat}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {sigs.map((s, i) => <SignalBadge key={i} signal={s} />)}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Segnali esclusi (riepilogo) */}
          {excludedSignals.length > 0 && (
            <Card className="border-slate-200 bg-slate-50/50">
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                  <Ban className="w-3.5 h-3.5" /> Segnali Esclusi ({excludedSignals.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {excludedSignals.map(e => (
                  <div key={e.id} className="flex items-start gap-2 text-xs border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                    <Ban className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-slate-600">{e.subject_name}</span>
                      <span className="mx-1 text-slate-400">→</span>
                      <span className="text-red-500 line-through">{e.signal_text}</span>
                      <span className="ml-1 text-slate-400 text-[10px]">({e.weight})</span>
                      <p className="text-muted-foreground mt-0.5 italic">"{e.reason}"</p>
                    </div>
                    <button
                      onClick={() => handleRestore(e.id)}
                      className="text-[10px] text-blue-500 hover:underline shrink-0 flex items-center gap-0.5"
                      title="Ripristina segnale"
                    >
                      <RotateCcw className="w-3 h-3" /> ripristina
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Dettaglio per soggetto */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Analisi per Soggetto
            </p>
            <SubjectCard
              result={r.societa}
              excludedSignals={excludedSignals}
              onExclude={(sig, name) => setExcludeTarget({ signal: sig, subjectName: name })}
              onRestore={handleRestore}
            />
            {(r.amministratori ?? []).map((a, i) => (
              <SubjectCard
                key={i}
                result={a}
                excludedSignals={excludedSignals}
                onExclude={(sig, name) => setExcludeTarget({ signal: sig, subjectName: name })}
                onRestore={handleRestore}
              />
            ))}
            {(r.soci ?? []).map((s, i) => (
              <SubjectCard
                key={i}
                result={s}
                excludedSignals={excludedSignals}
                onExclude={(sig, name) => setExcludeTarget({ signal: sig, subjectName: name })}
                onRestore={handleRestore}
              />
            ))}
          </div>

          {/* Footer */}
          <p className="text-[10px] text-muted-foreground/50 text-right">
            Analisi del {new Date(r.generato_il).toLocaleString('it-IT')} ·
            Fonti: Google News Italia + DuckDuckGo · I risultati sono indicativi e vanno verificati
          </p>
        </>
      )}

      {/* ── Modale esclusione ── */}
      {excludeTarget && (
        <ExcludeModal
          signal={excludeTarget.signal}
          subjectName={excludeTarget.subjectName}
          onConfirm={reason => { if (!savingExclude) handleExclude(reason); }}
          onCancel={() => setExcludeTarget(null)}
        />
      )}
    </div>
  );
}
