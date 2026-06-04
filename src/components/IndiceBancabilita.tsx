import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ChevronDown, ChevronUp, Info, TrendingUp, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ─── Tipi ────────────────────────────────────────────────────────────────────
interface PesoRecord {
  id: string;
  banca_id: string | null;
  kpi_key: string;
  kpi_area: string;
  kpi_label: string;
  peso: number;
  soglia_ottimo: number | null;
  soglia_suff: number | null;
  soglia_critica: number | null;
  inverso: boolean;
  attivo: boolean;
}

interface KpiEntry { valore: number | null; formatted: string; semaforo: string; label: string }
type KpiResult = Record<string, Record<string, KpiEntry>>;

interface KpiScore {
  kpi_key: string;
  kpi_area: string;
  kpi_label: string;
  peso: number;
  valore: number | null;
  formatted: string;
  score: number | null;       // 0–100
  contributo: number | null;  // peso × score / 100
  inverso: boolean;
  soglia_ottimo: number | null;
  soglia_suff: number | null;
  soglia_critica: number | null;
}

interface Props {
  latestKpi: KpiResult | null;
  practiceId: string;
  /** Se valorizzato, usa pesi override di questa banca (+ fallback default) */
  bancaId?: string | null;
}

// ─── Logica punteggio ────────────────────────────────────────────────────────
function calcolaScore(
  valore: number,
  ottimo: number | null,
  suff: number | null,
  critica: number | null,
  inverso: boolean,
): number {
  if (ottimo === null || suff === null || critica === null) return 50;

  // Per i KPI inversi (più basso = meglio) invertiamo il segno della disuguaglianza
  const hi  = inverso ? critica : ottimo;   // estremo "peggiore"
  const lo  = inverso ? ottimo  : critica;  // estremo "migliore" (score alto)
  // Normalizzazione: lo→100, hi→0 se non-inverso; lo→100, hi→0 se inverso
  const best   = inverso ? ottimo  : ottimo;
  const pass   = inverso ? suff    : suff;
  const worst  = inverso ? critica : critica;

  if (!inverso) {
    // maggiore = meglio
    if (valore >= best)  return 100;
    if (valore <= worst) return 0;
    if (valore >= pass) {
      // interpola tra pass (55) e best (100)
      return 55 + ((valore - pass) / (best - pass)) * 45;
    } else {
      // interpola tra worst (0) e pass (55)
      return ((valore - worst) / (pass - worst)) * 55;
    }
  } else {
    // minore = meglio
    if (valore <= best)  return 100;
    if (valore >= worst) return 0;
    if (valore <= pass) {
      // interpola tra best (100) e pass (55)
      return 55 + ((pass - valore) / (pass - best)) * 45;
    } else {
      // interpola tra pass (55) e worst (0)
      return ((worst - valore) / (worst - pass)) * 55;
    }
  }
  void lo; void hi; // suppress unused
}

// ─── Rating ──────────────────────────────────────────────────────────────────
function getRating(score: number): { label: string; color: string; bg: string; border: string; dot: string } {
  if (score >= 85) return { label: 'Eccellente', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-300', dot: 'bg-emerald-500' };
  if (score >= 70) return { label: 'Buono',      color: 'text-green-700',   bg: 'bg-green-50',   border: 'border-green-300',   dot: 'bg-green-500'   };
  if (score >= 55) return { label: 'Sufficiente',color: 'text-yellow-700',  bg: 'bg-yellow-50',  border: 'border-yellow-300',  dot: 'bg-yellow-500'  };
  if (score >= 40) return { label: 'Critico',    color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-300',  dot: 'bg-orange-500'  };
  return               { label: 'Non bancabile',color: 'text-red-700',    bg: 'bg-red-50',     border: 'border-red-300',     dot: 'bg-red-500'     };
}

function getBarColor(score: number): string {
  if (score >= 85) return 'bg-emerald-500';
  if (score >= 70) return 'bg-green-500';
  if (score >= 55) return 'bg-yellow-400';
  if (score >= 40) return 'bg-orange-400';
  return 'bg-red-500';
}

function scoreLabel(score: number | null): string {
  if (score === null) return 'N/D';
  return Math.round(score).toString();
}

// ─── Componente Gauge ─────────────────────────────────────────────────────────
function CircleGauge({ score, size = 120 }: { score: number; size?: number }) {
  const radius = (size - 10) / 2;
  const circ   = 2 * Math.PI * radius;
  const dash   = (score / 100) * circ;
  const rating = getRating(score);
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={10} />
        <circle
          cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={score >= 85 ? '#10b981' : score >= 70 ? '#22c55e' : score >= 55 ? '#eab308' : score >= 40 ? '#f97316' : '#ef4444'}
          strokeWidth={10} strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-2xl font-black text-foreground leading-none">{Math.round(score)}</div>
        <div className={`text-[9px] font-bold uppercase tracking-wide mt-0.5 ${rating.color}`}>{rating.label}</div>
      </div>
    </div>
  );
}

// ─── Componente principale ───────────────────────────────────────────────────
export default function IndiceBancabilita({ latestKpi, practiceId, bancaId }: Props) {
  const [pesi,        setPesi]        = useState<PesoRecord[]>([]);
  const [scores,      setScores]      = useState<KpiScore[]>([]);
  const [indice,      setIndice]      = useState<number | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [expanded,    setExpanded]    = useState(false);
  const [editMode,    setEditMode]    = useState(false);
  const [editPesi,    setEditPesi]    = useState<PesoRecord[]>([]);
  const [saving,      setSaving]      = useState(false);

  // ── carica pesi ─────────────────────────────────────────────────────────
  const loadPesi = useCallback(async () => {
    setLoading(true);
    try {
      // Pesi default (banca_id IS NULL)
      const { data: defaults } = await supabase
        .from('bancabilita_pesi')
        .select('*')
        .is('banca_id', null)
        .eq('attivo', true);

      // Override banca specifica
      let overrides: PesoRecord[] = [];
      if (bancaId) {
        const { data: ov } = await supabase
          .from('bancabilita_pesi')
          .select('*')
          .eq('banca_id', bancaId)
          .eq('attivo', true);
        overrides = (ov ?? []) as PesoRecord[];
      }

      const def = (defaults ?? []) as PesoRecord[];
      // Merge: override ha priorità per lo stesso kpi_key
      const merged: PesoRecord[] = def.map(d => {
        const ov = overrides.find(o => o.kpi_key === d.kpi_key);
        return ov ?? d;
      });
      // Aggiungi override che non sono nei default
      for (const ov of overrides) {
        if (!merged.find(m => m.kpi_key === ov.kpi_key)) merged.push(ov);
      }

      setPesi(merged);
      calcolaIndice(merged, latestKpi);
    } finally {
      setLoading(false);
    }
  }, [bancaId, latestKpi]);

  // ── calcolo indice ───────────────────────────────────────────────────────
  function calcolaIndice(pesiList: PesoRecord[], kpi: KpiResult | null) {
    if (!kpi) {
      setScores([]);
      setIndice(null);
      return;
    }

    const kpiScores: KpiScore[] = pesiList
      .filter(p => p.peso > 0)
      .map(p => {
        const areaObj = kpi[p.kpi_area] as Record<string, KpiEntry> | undefined;
        const entry   = areaObj?.[p.kpi_key];
        const valore  = entry?.valore ?? null;
        const formatted = entry?.formatted ?? (valore !== null ? String(valore) : 'N/D');
        const score   = valore !== null
          ? Math.round(Math.min(100, Math.max(0,
              calcolaScore(valore, p.soglia_ottimo, p.soglia_suff, p.soglia_critica, p.inverso)
            )))
          : null;
        const contributo = score !== null ? (p.peso * score) / 100 : null;
        return {
          kpi_key: p.kpi_key, kpi_area: p.kpi_area, kpi_label: p.kpi_label,
          peso: p.peso, valore, formatted, score, contributo,
          inverso: p.inverso,
          soglia_ottimo: p.soglia_ottimo, soglia_suff: p.soglia_suff, soglia_critica: p.soglia_critica,
        };
      });

    setScores(kpiScores);

    // Calcola indice solo sui KPI con valore disponibile
    const disponibili = kpiScores.filter(k => k.score !== null);
    if (disponibili.length === 0) { setIndice(null); return; }
    const sommaContributi = disponibili.reduce((s, k) => s + (k.contributo ?? 0), 0);
    const sommaPesi       = disponibili.reduce((s, k) => s + k.peso, 0);
    // Normalizza rispetto ai pesi disponibili (ignora KPI senza valore)
    const indiceNorm = sommaPesi > 0 ? (sommaContributi / sommaPesi) * 100 : null;
    setIndice(indiceNorm !== null ? Math.round(indiceNorm) : null);
  }

  useEffect(() => { loadPesi(); }, [loadPesi]);

  // ── salva pesi per questa banca ──────────────────────────────────────────
  const salvaPesi = async () => {
    if (!bancaId) return;
    setSaving(true);
    try {
      for (const p of editPesi) {
        await supabase.from('bancabilita_pesi').upsert({
          banca_id: bancaId,
          kpi_key: p.kpi_key, kpi_area: p.kpi_area, kpi_label: p.kpi_label,
          peso: p.peso,
          soglia_ottimo: p.soglia_ottimo, soglia_suff: p.soglia_suff, soglia_critica: p.soglia_critica,
          inverso: p.inverso, attivo: p.attivo,
        }, { onConflict: 'banca_id,kpi_key' });
      }
      setEditMode(false);
      await loadPesi();
    } finally {
      setSaving(false);
    }
  };

  const apriEdit = () => {
    setEditPesi(JSON.parse(JSON.stringify(pesi)));
    setEditMode(true);
  };

  // ── render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="animate-pulse h-24 rounded-xl bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">
        Calcolo indice di bancabilità...
      </div>
    );
  }

  if (pesi.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-muted-foreground/30 p-4 text-sm text-muted-foreground text-center">
        Tabella <code>bancabilita_pesi</code> non trovata — esegui la migration SQL nel Dashboard Supabase.
      </div>
    );
  }

  const noKpi = !latestKpi;
  const rating = indice !== null ? getRating(indice) : null;

  return (
    <div className="rounded-xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-background overflow-hidden">

      {/* ── Header / Score principale ── */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">

          {/* Gauge + titolo */}
          <div className="flex items-center gap-5">
            {noKpi ? (
              <div className="w-[100px] h-[100px] rounded-full border-[10px] border-muted/40 flex items-center justify-center text-xs text-muted-foreground font-medium">
                N/D
              </div>
            ) : indice !== null ? (
              <CircleGauge score={indice} size={110} />
            ) : (
              <div className="w-[110px] h-[110px] rounded-full border-[10px] border-muted/40 flex items-center justify-center text-xs text-muted-foreground text-center font-medium">
                Dati<br/>insufficienti
              </div>
            )}

            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-foreground flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-primary" /> Indice di Bancabilità
                </h3>
                {bancaId && (
                  <Badge variant="outline" className="text-[10px] py-0">override banca</Badge>
                )}
              </div>
              {noKpi ? (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <Info className="w-3.5 h-3.5" /> Analizza un bilancio per calcolare l'indice
                </p>
              ) : indice !== null && rating ? (
                <div className="mt-2 space-y-1.5">
                  <div className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-0.5 rounded-full border ${rating.bg} ${rating.color} ${rating.border}`}>
                    <span className={`w-2 h-2 rounded-full ${rating.dot}`} />
                    {rating.label} — {indice}/100
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Basato su {scores.filter(s => s.score !== null).length} di {scores.length} KPI disponibili
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground mt-1">KPI non disponibili per il calcolo</p>
              )}
            </div>
          </div>

          {/* Bottoni */}
          <div className="flex items-center gap-2 self-start">
            {bancaId && (
              <Button variant="outline" size="sm" onClick={apriEdit} className="text-xs">
                <Settings className="w-3 h-3 mr-1" /> Pesi
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setExpanded(e => !e)} className="text-xs">
              {expanded ? <><ChevronUp className="w-3.5 h-3.5 mr-1" />Comprimi</> : <><ChevronDown className="w-3.5 h-3.5 mr-1" />Dettaglio</>}
            </Button>
          </div>
        </div>

        {/* Mini barra progresso sempre visibile */}
        {!noKpi && indice !== null && (
          <div className="mt-4">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>0 — Non bancabile</span>
              <span>55 — Sufficiente</span>
              <span>85 — Eccellente — 100</span>
            </div>
            <div className="h-2.5 rounded-full bg-muted/50 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${getBarColor(indice)}`}
                style={{ width: `${indice}%` }}
              />
            </div>
            {/* Soglie visive */}
            <div className="relative h-0">
              {[40, 55, 70, 85].map(soglia => (
                <div key={soglia}
                  className="absolute top-[-10px] w-px h-3 bg-muted-foreground/30"
                  style={{ left: `${soglia}%` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Dettaglio KPI ── */}
      {expanded && (
        <div className="border-t border-primary/10 bg-background/60 p-4">
          {noKpi ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nessun dato bilancio disponibile.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_80px_80px_100px_60px] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 pb-1 border-b">
                <span>KPI</span>
                <span className="text-right">Valore</span>
                <span className="text-right">Score</span>
                <span className="text-right pr-1">Contributo</span>
                <span className="text-right">Peso</span>
              </div>
              {scores.map(s => (
                <div key={s.kpi_key}
                  className="grid grid-cols-[1fr_80px_80px_100px_60px] items-center px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors">

                  {/* KPI label */}
                  <div>
                    <span className="text-sm font-medium text-foreground">{s.kpi_label}</span>
                    <span className="ml-1.5 text-[10px] text-muted-foreground capitalize">{s.kpi_area}</span>
                  </div>

                  {/* Valore */}
                  <div className="text-right text-sm font-mono text-foreground">
                    {s.valore !== null ? s.formatted : <span className="text-muted-foreground text-xs">N/D</span>}
                  </div>

                  {/* Score bar */}
                  <div className="text-right">
                    {s.score !== null ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className={`h-full rounded-full ${getBarColor(s.score)}`} style={{ width: `${s.score}%` }} />
                        </div>
                        <span className="text-xs font-semibold tabular-nums w-7 text-right">{scoreLabel(s.score)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">N/D</span>
                    )}
                  </div>

                  {/* Contributo */}
                  <div className="text-right pr-1">
                    {s.contributo !== null ? (
                      <span className={`text-xs font-semibold ${s.contributo >= 20 ? 'text-emerald-600' : s.contributo >= 10 ? 'text-yellow-600' : 'text-red-500'}`}>
                        +{s.contributo.toFixed(1)} pt
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Peso */}
                  <div className="text-right text-xs text-muted-foreground">{s.peso}%</div>
                </div>
              ))}

              {/* Soglie leggenda */}
              {scores.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted-foreground border-t pt-3">
                  <span className="font-semibold">Soglie default:</span>
                  {scores.slice(0, 3).map(s => (
                    <span key={s.kpi_key}>
                      <strong>{s.kpi_label}</strong>:
                      {s.inverso
                        ? ` ≤${s.soglia_ottimo} (ottimo) / ≤${s.soglia_suff} (suff.) / ≥${s.soglia_critica} (critico)`
                        : ` ≥${s.soglia_ottimo} (ottimo) / ≥${s.soglia_suff} (suff.) / ≤${s.soglia_critica} (critico)`
                      }
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Modal edit pesi banca ── */}
      {editMode && bancaId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditMode(false)}>
          <div className="bg-background rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto p-6"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold mb-1">Configura pesi — questa banca</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Sovrascrive i pesi globali solo per questa banca. Somma pesi consigliata: 100.
            </p>

            <div className="space-y-3">
              {editPesi.map((p, idx) => (
                <div key={p.kpi_key} className="grid grid-cols-[1fr_60px_80px_80px_80px] gap-2 items-center text-xs">
                  <span className="font-medium text-sm">{p.kpi_label}</span>

                  {/* Peso */}
                  <div>
                    <label className="text-[10px] text-muted-foreground block">Peso%</label>
                    <input type="number" min="0" max="100" step="5"
                      className="w-full border rounded px-1.5 py-1 text-xs text-right"
                      value={p.peso}
                      onChange={e => {
                        const n = [...editPesi];
                        n[idx] = { ...n[idx], peso: Number(e.target.value) };
                        setEditPesi(n);
                      }}
                    />
                  </div>

                  {/* Soglia ottimo */}
                  <div>
                    <label className="text-[10px] text-muted-foreground block">
                      {p.inverso ? '≤ Ottimo' : '≥ Ottimo'}
                    </label>
                    <input type="number" step="0.01"
                      className="w-full border rounded px-1.5 py-1 text-xs text-right"
                      value={p.soglia_ottimo ?? ''}
                      onChange={e => {
                        const n = [...editPesi];
                        n[idx] = { ...n[idx], soglia_ottimo: e.target.value === '' ? null : Number(e.target.value) };
                        setEditPesi(n);
                      }}
                    />
                  </div>

                  {/* Soglia suff */}
                  <div>
                    <label className="text-[10px] text-muted-foreground block">
                      {p.inverso ? '≤ Suff.' : '≥ Suff.'}
                    </label>
                    <input type="number" step="0.01"
                      className="w-full border rounded px-1.5 py-1 text-xs text-right"
                      value={p.soglia_suff ?? ''}
                      onChange={e => {
                        const n = [...editPesi];
                        n[idx] = { ...n[idx], soglia_suff: e.target.value === '' ? null : Number(e.target.value) };
                        setEditPesi(n);
                      }}
                    />
                  </div>

                  {/* Soglia critica */}
                  <div>
                    <label className="text-[10px] text-muted-foreground block">
                      {p.inverso ? '≥ Critico' : '≤ Critico'}
                    </label>
                    <input type="number" step="0.01"
                      className="w-full border rounded px-1.5 py-1 text-xs text-right"
                      value={p.soglia_critica ?? ''}
                      onChange={e => {
                        const n = [...editPesi];
                        n[idx] = { ...n[idx], soglia_critica: e.target.value === '' ? null : Number(e.target.value) };
                        setEditPesi(n);
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 pt-4 border-t flex justify-between items-center">
              <span className="text-xs text-muted-foreground">
                Somma pesi: {editPesi.reduce((s, p) => s + Number(p.peso), 0)}%
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditMode(false)} disabled={saving}>Annulla</Button>
                <Button size="sm" onClick={salvaPesi} disabled={saving}>
                  {saving ? 'Salvataggio...' : 'Salva'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
