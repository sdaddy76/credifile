import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { BarChart3, FileText, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  latestLinkedChartBalances, practiceChartPoints,
  type PracticeChartBalance,
} from '@/lib/practiceChartData';
import { getAtecoBenchmark, SECTOR_BENCHMARK_UPDATED_AT } from '@/lib/sectorBenchmarks';
import { PD_MODEL } from '@/lib/probabilityOfDefault';

interface Props {
  practiceId: string;
  onOpenAnalysis: () => void;
  onOpenReport: () => void;
}

const euro = (value: number) => value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const compact = (value: number) => value.toLocaleString('it-IT', { notation: 'compact', maximumFractionDigits: 1 });
const kpiLabels = ['Current Ratio', 'Quick Ratio', 'ROE', 'ROI', 'ROS', 'EBITDA Margin', 'Debt/Equity', 'Leverage', 'PFN / EBITDA', 'DSCR'];

export default function PracticeChartsTab({ practiceId, onOpenAnalysis, onOpenReport }: Props) {
  const [balances, setBalances] = useState<PracticeChartBalance[]>([]);
  const [ateco, setAteco] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [year, setYear] = useState('');
  const [metric, setMetric] = useState('Current Ratio');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [analysis, documents, practice] = await Promise.all([
          supabase.from('bilanci_kpi').select('*').eq('practice_id', practiceId),
          supabase.from('uploaded_files').select('id').eq('practice_id', practiceId),
          supabase.from('practices').select('codice_ateco,client_id').eq('id', practiceId).maybeSingle(),
        ]);
        for (const result of [analysis, documents, practice]) {
          if (result.error) throw new Error(result.error.message);
        }
        let code = practice.data?.codice_ateco || null;
        if (!code && practice.data?.client_id) {
          const client = await supabase.from('clients').select('codice_ateco').eq('id', practice.data.client_id).maybeSingle();
          if (client.error) throw new Error(client.error.message);
          code = client.data?.codice_ateco || null;
        }
        if (!cancelled) {
          setAteco(code);
          setBalances(latestLinkedChartBalances(
            (analysis.data ?? []) as PracticeChartBalance[],
            new Set((documents.data ?? []).map(document => document.id)),
          ));
        }
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'Impossibile caricare i dati dei grafici.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [practiceId, revision]);

  const selected = balances.find(balance => String(balance.anno_esercizio) === year) ?? balances[0];
  const points = practiceChartPoints(balances, ateco);
  const benchmark = getAtecoBenchmark(ateco);
  const entries = Object.values(selected?.kpi ?? {}).flatMap(area => Object.values(area));
  const entry = entries.find(kpi => kpi.label === metric || kpi.label?.replace(/\s*\([^)]*\)/g, '') === metric);
  const actual = typeof entry?.valore === 'number' && Number.isFinite(entry.valore) ? entry.valore : null;
  const reference = benchmark.kpi[metric] ?? null;
  const comparison = [
    { nome: 'Azienda', valore: actual },
    { nome: 'Riferimento settore', valore: reference },
  ];

  return (
    <section className="min-w-0 space-y-4" aria-label="Grafici della pratica">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold"><BarChart3 className="h-5 w-5" /> Grafici della pratica</h3>
          <p className="mt-1 text-sm text-muted-foreground">Bilanci analizzati, confronto tra esercizi e indicatori finanziari.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onOpenAnalysis}>Analisi Finanziaria</Button>
          <Button size="sm" variant="outline" onClick={onOpenReport}><FileText className="mr-2 h-4 w-4" /> Report di Bancabilità</Button>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Aggiorna</Button>
        </div>
      </div>
      {loading ? <p role="status" className="py-8 text-center text-muted-foreground">Caricamento grafici…</p>
        : error ? <div role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive">Impossibile caricare i grafici: {error}. Premi Aggiorna per riprovare.</div>
        : !selected ? (
          <Card><CardContent className="space-y-3 pt-6">
            <p className="font-medium">Nessun bilancio analizzato disponibile per i grafici.</p>
            <p className="text-sm text-muted-foreground">Carica i documenti nella pratica, poi apri Analisi Finanziaria e analizza il PDF del bilancio. I grafici compariranno qui dopo il salvataggio dei KPI.</p>
            <Button onClick={onOpenAnalysis}>Apri Analisi Finanziaria</Button>
          </CardContent></Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor="chart-year" className="text-sm font-medium">Esercizio per il confronto KPI</label>
              <Select value={String(selected.anno_esercizio)} onValueChange={setYear}>
                <SelectTrigger id="chart-year" className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{balances.map(balance => <SelectItem key={balance.id} value={String(balance.anno_esercizio)}>{balance.anno_esercizio}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">{balances.length} esercizi disponibili · il più recente è mostrato per primo.</span>
            </div>
            <div className="grid min-w-0 gap-4 xl:grid-cols-2">
              <Card className="min-w-0"><CardHeader><CardTitle className="text-base">Fatturato e utile / perdita</CardTitle></CardHeader><CardContent>
                <ResponsiveContainer width="100%" height={280} minWidth={0}>
                  <BarChart data={points}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="anno" /><YAxis tickFormatter={compact} width={65} /><Tooltip formatter={value => typeof value === 'number' ? euro(value) : 'N/D'} /><Legend />
                    <Bar dataKey="fatturato" name="Fatturato" fill="#0f766e" /><Bar dataKey="utile" name="Utile / perdita" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
                {points.length < 2 && <p className="mt-2 text-xs text-muted-foreground">Un solo esercizio disponibile: per osservare un andamento servono almeno due annualità analizzate.</p>}
              </CardContent></Card>
              <Card className="min-w-0"><CardHeader><CardTitle className="text-base">Attivo, patrimonio netto e debiti</CardTitle></CardHeader><CardContent>
                <ResponsiveContainer width="100%" height={280} minWidth={0}>
                  <BarChart data={points}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="anno" /><YAxis tickFormatter={compact} width={65} /><Tooltip formatter={value => typeof value === 'number' ? euro(value) : 'N/D'} /><Legend />
                    <Bar dataKey="attivo" name="Totale attivo" fill="#0f766e" /><Bar dataKey="patrimonio" name="Patrimonio netto" fill="#2563eb" /><Bar dataKey="debiti" name="Totale debiti" fill="#d97706" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent></Card>
              <Card className="min-w-0"><CardHeader><CardTitle className="text-base">Azienda e riferimento di settore · {selected.anno_esercizio}</CardTitle></CardHeader><CardContent className="space-y-3">
                <Select value={metric} onValueChange={setMetric}>
                  <SelectTrigger aria-label="Indicatore da confrontare"><SelectValue /></SelectTrigger>
                  <SelectContent>{kpiLabels.map(label => <SelectItem key={label} value={label}>{label}</SelectItem>)}</SelectContent>
                </Select>
                {actual === null ? <p className="py-8 text-sm text-muted-foreground">Il valore di {metric} non è disponibile nel bilancio selezionato. Scegli un altro indicatore.</p> : (
                  <ResponsiveContainer width="100%" height={230} minWidth={0}>
                    <BarChart data={comparison}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="nome" /><YAxis /><Tooltip formatter={value => typeof value === 'number' ? value.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : 'N/D'} /><Bar dataKey="valore" name={metric} fill="#0f766e" /></BarChart>
                  </ResponsiveContainer>
                )}
                <p className="text-xs text-muted-foreground">{benchmark.label} · riferimenti indicativi aggiornati al {SECTOR_BENCHMARK_UPDATED_AT}. Non costituiscono una soglia di approvazione bancaria. Per gli indici di debito valori più bassi possono essere migliori.</p>
              </CardContent></Card>
              <Card className="min-w-0"><CardHeader><CardTitle className="text-base">PD indicativa per esercizio</CardTitle></CardHeader><CardContent>
                {points.some(point => point.pd !== null) ? (
                  <ResponsiveContainer width="100%" height={280} minWidth={0}>
                    <LineChart data={points}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="anno" /><YAxis domain={[0, 100]} unit="%" /><Tooltip formatter={value => typeof value === 'number' ? `${value.toLocaleString('it-IT', { maximumFractionDigits: 2 })}%` : 'N/D'} /><Line dataKey="pd" name="PD indicativa" stroke="#0f766e" strokeWidth={2} dot connectNulls={false} /></LineChart>
                  </ResponsiveContainer>
                ) : <p className="py-8 text-sm text-muted-foreground">PD non disponibile: verifica i dati necessari al calcolo nella sezione Analisi Finanziaria.</p>}
                <p className="mt-2 text-xs text-muted-foreground">{PD_MODEL.limitation}</p>
              </CardContent></Card>
            </div>
            <Card><CardHeader><CardTitle className="text-base">Dati utilizzati nei grafici</CardTitle></CardHeader><CardContent className="overflow-x-auto">
              <table className="w-full text-left text-sm"><caption className="sr-only">Valori estratti dai bilanci, esercizio più recente per primo. Dati mancanti indicati N/D.</caption>
                <thead><tr>{['Anno', 'Fatturato', 'Utile / perdita', 'Attivo', 'Patrimonio netto', 'Debiti'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-2 py-2">{label}</th>)}</tr></thead>
                <tbody>{[...points].reverse().map(point => <tr key={point.anno} className="border-t"><th scope="row" className="px-2 py-2">{point.anno}</th>{[point.fatturato, point.utile, point.attivo, point.patrimonio, point.debiti].map((value, index) => <td key={index} className="whitespace-nowrap px-2 py-2">{value === null ? 'N/D' : euro(value)}</td>)}</tr>)}</tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">Non vengono mostrati bilanci senza un documento sorgente nella pratica. Dati mancanti non sono trasformati in zero.</p>
            </CardContent></Card>
          </>
        )}
    </section>
  );
}
