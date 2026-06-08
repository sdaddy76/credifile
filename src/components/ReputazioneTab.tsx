import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw, AlertTriangle, CheckCircle2, Building2, User, Users,
  ExternalLink, Clock, TrendingUp, TrendingDown, Newspaper, ShieldAlert,
  BarChart2, Minus,
} from 'lucide-react';
import { toast } from 'sonner';

interface Props { practiceId: string; clientId: string }

interface NewsItem { title: string; snippet: string; link: string; date: string; source: string }
interface Signal {
  text: string; category: string; weight: number;
  articleTitle?: string; articleDate?: string;
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
interface AnalysisRecord {
  id: string; created_at: string;
  score_globale: number; score_societa: number; score_amm: number; score_soci: number;
  risultati: Risultati;
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
function ScoreGauge({ score }: { score: number }) {
  const color = scoreLine(score);
  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 100 60" className="w-28 h-[4.5rem]">
        <path d="M10 55 A40 40 0 0 1 90 55" fill="none" stroke="#e5e7eb" strokeWidth="10" strokeLinecap="round" />
        <path d="M10 55 A40 40 0 0 1 90 55" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${Math.round(score) * 1.257} 126`} />
        <text x="50" y="52" textAnchor="middle" fontSize="18" fontWeight="bold" fill={color}>{Math.round(score)}</text>
      </svg>
      <span className="text-xs text-muted-foreground">/ 100</span>
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
          {/* Griglia orizzontale */}
          {[25, 50, 75].map(v => {
            const y = H - PAD - ((v / 100) * (H - PAD * 2));
            return <line key={v} x1={PAD} y1={y} x2={W - PAD} y2={y} stroke="#f1f5f9" strokeWidth="1" />;
          })}
          {/* Soglie colorate */}
          <line x1={PAD} y1={H - PAD - (0.75 * (H - PAD * 2))} x2={W - PAD} y2={H - PAD - (0.75 * (H - PAD * 2))} stroke="#bbf7d0" strokeWidth="1" strokeDasharray="4 3" />
          <line x1={PAD} y1={H - PAD - (0.50 * (H - PAD * 2))} x2={W - PAD} y2={H - PAD - (0.50 * (H - PAD * 2))} stroke="#fef08a" strokeWidth="1" strokeDasharray="4 3" />
          {/* Linea score */}
          <polyline points={polyline} fill="none" stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {/* Punti + tooltip */}
          {sorted.map((a, i) => (
            <g key={a.id}>
              <circle cx={xs[i]} cy={ys[i]} r="4" fill={scoreLine(a.score_globale)} stroke="white" strokeWidth="1.5" />
              <title>{new Date(a.created_at).toLocaleDateString('it-IT')} · {a.score_globale}/100</title>
            </g>
          ))}
        </svg>
        {/* Date etichette */}
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

// ─── Badge segnale con tooltip articolo ──────────────────────────────────────
function SignalBadge({ signal }: { signal: Signal }) {
  const [hover, setHover] = useState(false);
  const isPos = signal.weight > 0;
  const hasRef = !!signal.articleTitle;
  return (
    <span className="relative inline-flex"
      onMouseEnter={() => hasRef && setHover(true)}
      onMouseLeave={() => setHover(false)}>
      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium cursor-default
        ${isPos ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}
        ${hasRef ? 'underline decoration-dotted' : ''}`}>
        {isPos ? <TrendingUp className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
        {signal.text}
        {!isPos && <span className="ml-0.5 font-bold">{signal.weight}</span>}
        {isPos && <span className="ml-0.5 font-bold">+{signal.weight}</span>}
      </span>
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
        </div>
      )}
    </span>
  );
}

// ─── Card soggetto ────────────────────────────────────────────────────────────
function SubjectCard({ result }: { result: SubjectResult }) {
  const [expanded, setExpanded] = useState(false);
  const badge   = scoreBadge(result.score);
  const Icon    = result.tipo === 'societa' ? Building2 : User;
  const tipoLabel = result.tipo === 'societa' ? 'Società' : result.tipo === 'amministratore' ? 'Amministratore' : 'Socio';
  const negSignals = result.signals.filter(s => s.weight < 0);
  const posSignals = result.signals.filter(s => s.weight > 0);
  const allNews    = result.news ?? [];

  // Raggruppa segnali negativi per categoria
  const grouped: Record<string, Signal[]> = {};
  for (const s of negSignals) {
    if (!grouped[s.category]) grouped[s.category] = [];
    if (!grouped[s.category].find(x => x.text === s.text)) grouped[s.category].push(s);
  }

  return (
    <Card className={`border ${negSignals.length > 0 ? 'border-red-200' : 'border-border'}`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0
            ${result.score >= 75 ? 'bg-green-100' : result.score >= 50 ? 'bg-amber-100' : 'bg-red-100'}`}>
            <Icon className={`w-4 h-4 ${result.score >= 75 ? 'text-green-700' : result.score >= 50 ? 'text-amber-700' : 'text-red-700'}`} />
          </div>
          <div className="flex-1 min-w-0">
            {/* Header soggetto */}
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm">{result.nome}</p>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{tipoLabel}</span>
              <Badge className={`text-xs ${badge.color}`}>{badge.label}</Badge>
              <span className={`text-xs font-bold px-2 py-0.5 rounded border ${scoreColor(result.score)}`}>
                {result.score}/100
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
                    {sigs.map((s, i) => <SignalBadge key={i} signal={s} />)}
                  </div>
                ))}
              </div>
            )}

            {/* Segnali positivi */}
            {posSignals.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {posSignals.map((s, i) => <SignalBadge key={i} signal={s} />)}
              </div>
            )}

            {/* Nessun segnale */}
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

// ─── Componente principale ────────────────────────────────────────────────────
export default function ReputazioneTab({ practiceId, clientId }: Props) {
  const [loading,        setLoading]        = useState(false);
  const [analyses,       setAnalyses]       = useState<AnalysisRecord[]>([]);
  const [selected,       setSelected]       = useState<AnalysisRecord | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);

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
    toast.info('Analisi in corso… ricerca parallela su Google News e DuckDuckGo per società, amministratori e soci. Può richiedere 20-40 secondi.');
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

  if (loadingHistory) return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const r = selected?.risultati;

  // Segnali negativi aggregati (tutti i soggetti)
  const allNegSignals: Signal[] = r ? [
    ...(r.societa.signals ?? []),
    ...(r.amministratori ?? []).flatMap(a => a.signals ?? []),
    ...(r.soci ?? []).flatMap(s => s.signals ?? []),
  ].filter(s => s.weight < 0) : [];

  const groupedNeg: Record<string, Signal[]> = {};
  for (const s of allNegSignals) {
    if (!groupedNeg[s.category]) groupedNeg[s.category] = [];
    if (!groupedNeg[s.category].find(x => x.text === s.text)) groupedNeg[s.category].push(s);
  }

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
          {/* Grafico trend */}
          {analyses.length >= 2 && <TrendChart analyses={analyses} />}

          {/* Score globale — 4 gauge */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Score Globale',  score: selected.score_globale, icon: <TrendingUp className="w-4 h-4" /> },
              { label: 'Società',        score: selected.score_societa, icon: <Building2   className="w-4 h-4" /> },
              { label: 'Amministratori', score: selected.score_amm,     icon: <User        className="w-4 h-4" /> },
              { label: 'Soci',           score: selected.score_soci,    icon: <Users       className="w-4 h-4" /> },
            ].map(({ label, score, icon }) => {
              const b = scoreBadge(score);
              return (
                <Card key={label} className={`border ${scoreColor(score)}`}>
                  <CardContent className="p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">{icon}{label}</div>
                    <ScoreGauge score={score} />
                    <Badge className={`text-[10px] mt-1 ${b.color}`}>{b.label}</Badge>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Segnali aggregati */}
          {Object.keys(groupedNeg).length === 0 ? (
            <Card className="border-green-200 bg-green-50/50">
              <CardContent className="py-3 px-4 flex items-center gap-2 text-green-700 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                Nessun segnale di rischio rilevato per nessun soggetto analizzato
              </CardContent>
            </Card>
          ) : (
            <Card className="border-red-200/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2 text-red-800">
                  <AlertTriangle className="w-4 h-4" /> Segnali di Rischio Aggregati
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    Passa il cursore su un segnale per vedere l'articolo sorgente
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

          {/* Dettaglio per soggetto */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Analisi per Soggetto
            </p>
            <SubjectCard result={r.societa} />
            {(r.amministratori ?? []).map((a, i) => <SubjectCard key={i} result={a} />)}
            {(r.soci ?? []).map((s, i) => <SubjectCard key={i} result={s} />)}
          </div>

          {/* Footer */}
          <p className="text-[10px] text-muted-foreground/50 text-right">
            Analisi del {new Date(r.generato_il).toLocaleString('it-IT')} ·
            Fonti: Google News Italia + DuckDuckGo · I risultati sono indicativi e vanno verificati
          </p>
        </>
      )}
    </div>
  );
}
