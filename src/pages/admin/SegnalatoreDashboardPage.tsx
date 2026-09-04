import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FileText, CheckCircle2, XCircle, Clock, RefreshCw,
  TrendingUp, BarChart3, Activity, Banknote,
} from 'lucide-react';
import { STATUS_LABELS, STATUS_COLORS, type PracticeStatus } from '@/lib/types';

// ── Tipi ────────────────────────────────────────────────────────────────────
interface PraticaRiepilogo {
  id: string;
  numero_pratica: string;
  status: PracticeStatus;
  created_at: string;
  clients: { ragione_sociale: string } | null;
}

interface Commissione {
  id: string;
  practice_id: string;
  importo: number;
  stato: string;
  data_maturazione?: string;
  data_liquidazione?: string;
  note?: string;
  practices?: { numero_pratica: string; clients?: { ragione_sociale: string } | null } | null;
}

interface StatusCount {
  status: PracticeStatus;
  label: string;
  count: number;
  color: string;
  barColor: string;
}

// ── Config stati ─────────────────────────────────────────────────────────────
const STATI_ORDER: PracticeStatus[] = [
  'bozza',
  'raccolta_documenti',
  'inviata_banca',
  'istruttoria',
  'in_delibera',
  'deliberata',
  'erogata',
  'declinata',
];

const BAR_COLORS: Record<string, string> = {
  bozza:                  '#94a3b8',
  raccolta_documenti:     '#3b82f6',
  inviata_banca:          '#a855f7',
  istruttoria:            '#06b6d4',
  in_delibera:            '#f59e0b',
  deliberata:             '#10b981',
  erogata:                '#22c55e',
  declinata:              '#f43f5e',
};

// ── Componente Barra SVG ─────────────────────────────────────────────────────
function BarChart({ data, maxVal }: { data: StatusCount[]; maxVal: number }) {
  const BAR_H = 180;
  const BAR_W = 40;
  const GAP   = 14;
  const PAD   = 32;
  const totalW = data.length * (BAR_W + GAP) - GAP + PAD * 2;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${totalW} ${BAR_H + 52}`}
      className="overflow-visible"
      aria-label="Grafico pratiche per stato"
    >
      {/* Griglia orizzontale */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const y = PAD / 2 + BAR_H * (1 - frac);
        const val = Math.round(maxVal * frac);
        return (
          <g key={frac}>
            <line x1={PAD} x2={totalW - PAD} y1={y} y2={y}
              stroke="#e2e8f0" strokeWidth="1" />
            {val > 0 && (
              <text x={PAD - 4} y={y + 4} textAnchor="end"
                fontSize="9" fill="#94a3b8">{val}</text>
            )}
          </g>
        );
      })}

      {/* Barre */}
      {data.map((d, i) => {
        const x = PAD + i * (BAR_W + GAP);
        const barH = maxVal > 0 ? (d.count / maxVal) * BAR_H : 0;
        const y = PAD / 2 + BAR_H - barH;
        return (
          <g key={d.status}>
            {/* Barra */}
            <rect
              x={x} y={y}
              width={BAR_W} height={Math.max(barH, d.count > 0 ? 4 : 0)}
              rx={5} ry={5}
              fill={d.barColor}
              opacity={0.85}
            />
            {/* Valore sopra la barra */}
            {d.count > 0 && (
              <text
                x={x + BAR_W / 2} y={y - 5}
                textAnchor="middle" fontSize="11"
                fontWeight="700" fill={d.barColor}
              >
                {d.count}
              </text>
            )}
            {/* Label stato (su 2 righe se lungo) */}
            {d.label.split(' ').slice(0, 2).map((word, wi) => (
              <text
                key={wi}
                x={x + BAR_W / 2}
                y={PAD / 2 + BAR_H + 14 + wi * 13}
                textAnchor="middle" fontSize="9" fill="#64748b"
              >
                {word}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ── Componente principale ────────────────────────────────────────────────────
export default function SegnalatoreDashboardPage() {
  const { user } = useAuth();
  const [pratiche, setPratiche] = useState<PraticaRiepilogo[]>([]);
  const [commissioni, setCommissioni] = useState<Commissione[]>([]);
  const [loading,  setLoading]  = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data, error }, { data: comm }] = await Promise.all([
      supabase
        .from('practices')
        .select('id, numero_pratica, status, created_at, clients(ragione_sociale)')
        .eq('segnalatore_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('segnalatore_commissions')
        .select('id, practice_id, importo, stato, data_maturazione, data_liquidazione, note, practices(numero_pratica, clients(ragione_sociale))')
        .eq('segnalatore_id', user.id)
        .order('data_maturazione', { ascending: false }),
    ]);

    if (!error) setPratiche((data ?? []) as unknown as PraticaRiepilogo[]);
    setCommissioni((comm ?? []) as unknown as Commissione[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // ── Calcoli statistiche ──────────────────────────────────────────────────
  const totale = pratiche.length;

  // Conta per stato
  const countByStatus = pratiche.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] ?? 0) + 1;
    return acc;
  }, {});

  const statusCounts: StatusCount[] = STATI_ORDER
    .filter(s => countByStatus[s] !== undefined)
    .map(s => ({
      status:   s,
      label:    STATUS_LABELS[s],
      count:    countByStatus[s] ?? 0,
      color:    STATUS_COLORS[s],
      barColor: BAR_COLORS[s] ?? '#94a3b8',
    }));

  // Tutti gli stati per il grafico (includi anche quelli con count=0 se ci sono pratiche)
  const chartData: StatusCount[] = STATI_ORDER.map(s => ({
    status:   s,
    label:    STATUS_LABELS[s],
    count:    countByStatus[s] ?? 0,
    color:    STATUS_COLORS[s],
    barColor: BAR_COLORS[s] ?? '#94a3b8',
  })).filter(d => d.count > 0);

  const maxBarVal = Math.max(...chartData.map(d => d.count), 1);

  // Ultime 5 pratiche
  const ultime5 = pratiche.slice(0, 5);

  // Calcoli commissioni
  const totaleMaturato = commissioni.reduce((s, c) => s + (c.importo ?? 0), 0);
  const liquidato = commissioni.filter(c => c.stato === 'liquidata').reduce((s, c) => s + (c.importo ?? 0), 0);
  const daLiquidare = commissioni.filter(c => c.stato !== 'liquidata').reduce((s, c) => s + (c.importo ?? 0), 0);
  const fmtEur = (v: number) => v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

  // KPI rapidi
  const concluse = (countByStatus['deliberata'] ?? 0) + (countByStatus['erogata'] ?? 0);
  const declinateR = countByStatus['declinata'] ?? 0;
  const attive = totale - concluse - declinateR;

  return (
    <div className="space-y-6 p-1">
      {/* Titolo sezione */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold text-foreground">Le Mie Statistiche</h2>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Aggiorna
        </button>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
          <p className="text-sm text-muted-foreground">Caricamento statistiche...</p>
        </div>
      ) : (
        <>
          {/* ── KPI Cards ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: 'Totale Pratiche',
                value: totale,
                icon: FileText,
                cls: 'text-primary bg-primary/10',
              },
              {
                label: 'Pratiche Attive',
                value: attive,
                icon: Clock,
                cls: 'text-blue-600 bg-blue-50',
              },
              {
                label: 'Approvate',
                value: approvate,
                icon: CheckCircle2,
                cls: 'text-emerald-600 bg-emerald-50',
              },
              {
                label: 'Declinate / Rifiutate',
                value: declinateR,
                icon: XCircle,
                cls: 'text-red-500 bg-red-50',
              },
            ].map(k => (
              <Card key={k.label} className="border-border">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${k.cls}`}>
                      <k.icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-2xl font-black text-foreground">{k.value}</div>
                      <div className="text-xs text-muted-foreground leading-tight">{k.label}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* ── Pratiche per stato + Grafico SVG ──────────────────────────── */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Lista contatori per stato */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Pratiche per Stato
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                {totale === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Nessuna pratica segnalata ancora.</p>
                ) : (
                  <div className="space-y-2">
                    {statusCounts.map(s => (
                      <div key={s.status} className="flex items-center justify-between gap-2">
                        <Badge className={`text-xs ${s.color}`}>{s.label}</Badge>
                        <div className="flex items-center gap-2 flex-1 min-w-0 ml-2">
                          {/* Barra proporzionale */}
                          <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                            <div
                              className="h-2 rounded-full transition-all duration-500"
                              style={{
                                width: `${totale > 0 ? (s.count / totale) * 100 : 0}%`,
                                backgroundColor: s.barColor,
                              }}
                            />
                          </div>
                          <span className="text-sm font-bold text-foreground w-6 text-right shrink-0">
                            {s.count}
                          </span>
                        </div>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                      <span>Totale</span>
                      <span className="font-bold text-foreground">{totale}</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Grafico a barre SVG */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-primary" />
                  Grafico per Stato
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                {chartData.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Nessun dato disponibile.</p>
                ) : (
                  <BarChart data={chartData} maxVal={maxBarVal} />
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Commissioni ──────────────────────────────────────────────── */}
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Banknote className="w-4 h-4 text-primary" />
                Le Mie Commissioni
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 space-y-4">
              {/* KPI commissioni */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Totale Maturato', value: fmtEur(totaleMaturato), cls: 'text-primary bg-primary/10' },
                  { label: 'Liquidato',        value: fmtEur(liquidato),       cls: 'text-emerald-600 bg-emerald-50' },
                  { label: 'Da Liquidare',     value: fmtEur(daLiquidare),     cls: 'text-amber-600 bg-amber-50' },
                ].map(k => (
                  <div key={k.label} className={`rounded-xl p-3 ${k.cls.split(' ')[1]}`}>
                    <p className={`text-sm font-black ${k.cls.split(' ')[0]}`}>{k.value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{k.label}</p>
                  </div>
                ))}
              </div>
              {/* Elenco commissioni */}
              {commissioni.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Nessuna commissione registrata</p>
              ) : (
                <div className="divide-y divide-border">
                  {commissioni.slice(0, 8).map(c => (
                    <div key={c.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{c.practices?.clients?.ragione_sociale ?? '—'}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{c.practices?.numero_pratica ?? c.practice_id.slice(0,8)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className="text-sm font-bold text-foreground">{fmtEur(c.importo)}</span>
                        <Badge className={`text-[10px] py-0 ${c.stato === 'liquidata' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                          {c.stato}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Ultima attività: ultime 5 pratiche ────────────────────────── */}
          <Card className="border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Ultima Attività
              </CardTitle>
              <p className="text-xs text-muted-foreground">Ultime 5 pratiche segnalate</p>
            </CardHeader>
            <CardContent className="pb-4">
              {ultime5.length === 0 ? (
                <div className="py-10 text-center border-2 border-dashed rounded-xl">
                  <FileText className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
                  <p className="text-sm text-muted-foreground">Nessuna pratica segnalata ancora.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {ultime5.map(p => (
                    <div key={p.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <FileText className="w-4 h-4 text-primary" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {p.clients?.ragione_sociale ?? '—'}
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {p.numero_pratica}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge className={`text-[10px] py-0 ${STATUS_COLORS[p.status]}`}>
                          {STATUS_LABELS[p.status]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString('it-IT', {
                            day: '2-digit', month: 'short', year: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
