import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, Upload, RefreshCw, AlertCircle, CheckCircle2, Building2, BarChart3, FileText, ShieldCheck, Download, Trash2, MessageSquare, CircleSlash2, UserRoundCheck } from 'lucide-react';
import { toast } from 'sonner';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtBenchmark, getAtecoBenchmark, type SectorBenchmark } from '@/lib/sectorBenchmarks';
import type { BalanceAnomalyAnalysis } from '../../supabase/functions/_shared/balance-anomaly-engine';
import { normalizePrimaryStatus } from '@/lib/practiceTimeline';

interface Props { practiceId: string }

interface UploadedPdf { id: string; nome_file: string; storage_path: string; created_at: string }

interface KpiEntry { valore: number | null; formatted: string; semaforo: 'verde' | 'giallo' | 'rosso' | 'nd'; label: string }
interface KpiResult {
  liquidita: Record<string, KpiEntry>;
  solidita: Record<string, KpiEntry>;
  redditivita: Record<string, KpiEntry>;
  indebitamento: Record<string, KpiEntry>;
  efficienza: Record<string, KpiEntry>;
  copertura: Record<string, KpiEntry>;
}
interface BilancioRecord {
  id: string;
  anno_esercizio: number;
  ragione_sociale: string;
  is_holding: boolean;
  totale_attivo: number;
  totale_patrimonio_netto: number;
  totale_debiti: number;
  ricavi_vendite: number;
  utile_netto: number;
  kpi: KpiResult;
  anomaly_analysis: BalanceAnomalyAnalysis | null;
  anomaly_score: number | null;
  anomaly_level: BalanceAnomalyAnalysis['level'] | null;
  anomaly_engine_version: string | null;
  created_at: string;
}

type BalanceAnomalyAlertStatus =
  | 'open'
  | 'answered_by_consultant'
  | 'client_requested'
  | 'client_answered'
  | 'ignored';

interface BalanceAnomalyAlert {
  id: string;
  bilancio_id: string;
  practice_id: string;
  finding_id: string;
  title: string;
  category: string;
  severity: 'alta' | 'media' | 'bassa';
  confidence: 'alta' | 'media' | 'bassa';
  finding: BalanceAnomalyAnalysis['findings'][number];
  status: BalanceAnomalyAlertStatus;
  consultant_response: string | null;
  ignore_reason: string | null;
  client_question_id: string | null;
  practice_client_questions?: { risposta: string | null; answered_at: string | null } | null;
  active: boolean;
  resolved_at: string | null;
}

const ALERT_STATUS_LABELS: Record<BalanceAnomalyAlertStatus, string> = {
  open: 'Da valutare',
  answered_by_consultant: 'Spiegata dal consulente',
  client_requested: 'Richiesta al cliente',
  client_answered: 'Risposta dal cliente',
  ignored: 'Ignorata',
};

// Bancabilità
interface BankKpiReq { id: string; bank_id: string; kpi_key: string; kpi_area: string; kpi_label: string; min_value: number | null; max_value: number | null }
interface BancaCheck {
  bankId: string;
  bankName: string;
  reqs: Array<BankKpiReq & { actual: number | null; pass: boolean | null }>;
  passCount: number;
  failCount: number;
  ndCount: number;
}

const SEMAFORO_COLOR: Record<string, string> = {
  verde: 'bg-green-100 text-green-800 border-green-200',
  giallo: 'bg-amber-100 text-amber-800 border-amber-200',
  rosso: 'bg-red-100 text-red-800 border-red-200',
  nd: 'bg-gray-100 text-gray-500 border-gray-200',
};
const SEMAFORO_DOT: Record<string, string> = {
  verde: 'bg-green-500', giallo: 'bg-amber-400', rosso: 'bg-red-500', nd: 'bg-gray-300',
};

const AREA_LABELS: Record<keyof KpiResult, string> = {
  liquidita: '💧 Liquidità',
  solidita: '🏛️ Solidità Patrimoniale',
  redditivita: '📈 Redditività',
  indebitamento: '💳 Indebitamento',
  efficienza: '⚙️ Efficienza Operativa',
  copertura: '🛡️ Copertura',
};

const KPI_DESC: Record<string, string> = {
  'Current Ratio':        'Att. Corrente / Pass. Corrente — liquidità nel breve (ottimale ≥ 1,5)',
  'Quick Ratio':          '(Att. Corrente − Rimanenze) / Pass. Corrente — liquidità senza magazzino (≥ 1,0)',
  'Acid Test':            'Liquidità immediata / Pass. Corrente — cassa + crediti vs debiti a breve (≥ 0,5)',
  'Debt/Equity':          'Debiti Totali / Patrimonio Netto — dipendenza dal debito (ottimale ≤ 1,5)',
  'Leverage':             'Totale Attivo / Patrimonio Netto — moltiplicatore finanziario (≤ 2,5)',
  'PN / Totale Attivo':   'Patrimonio Netto / Totale Attivo — autonomia finanziaria (≥ 25%)',
  'Grado Indebitamento':  'Debiti bancari a breve / Patrimonio Netto — esposizione bancaria (≤ 1,0)',
  'ROE':                  'Utile Netto / Patrimonio Netto — redditività del capitale proprio (≥ 5%)',
  'ROI':                  'EBIT / Totale Attivo — rendimento degli investimenti (≥ 3%)',
  'ROS':                  'EBIT / Ricavi di Vendita — margine operativo sulle vendite (≥ 3%)',
  'EBITDA Margin':        'EBITDA / Ricavi — capacità di generare cassa operativa (≥ 10%)',
  'EBITDA (€)':           'Margine Operativo Lordo — utile prima di ammortamenti e interessi',
  'Fatturato (€)':        'Ricavi totali da vendite e prestazioni di servizi',
  'PFN (€)':              'Posizione Finanziaria Netta = Debiti Fin. − Liquidità (negativo = cassa netta)',
  'PFN / EBITDA':         'Anni di EBITDA per ripagare il debito finanziario netto (ottimale ≤ 3×)',
  'PFN / PN':             'Debito finanziario netto su Patrimonio Netto (≤ 1,0)',
  'DSO (giorni crediti)': 'Days Sales Outstanding — media giorni di incasso dei crediti (≤ 60 gg)',
  'DPO (giorni debiti)':  'Days Payable Outstanding — media giorni di pagamento fornitori',
  'DSI (giorni magazzino)':'Days Sales Inventory — rotazione del magazzino in giorni',
  'Interest Coverage':    'EBIT / Interessi Passivi — quante volte l\'azienda copre gli interessi (≥ 3×)',
  'DSCR (da finanziamenti)': 'EBITDA / Rata annua finanziamenti — copertura del servizio del debito (≥ 1,25)',
  'DSCR (approx.)':       'EBITDA / Interessi passivi — proxy DSCR in assenza di dati finanziamenti (≥ 1,25)',
};

function fmt(n: number | null, isEur = false) {
  if (n === null) return 'N/D';
  if (isEur) return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  return new Intl.NumberFormat('it-IT').format(n);
}


// Direzione KPI: true = più alto è meglio, false = più basso è meglio
const KPI_DIRECTION: Record<string, boolean> = {
  'Current Ratio': true,  'Quick Ratio': true,  'Acid Test': true,
  'Debt/Equity': false,   'Leverage': false,    'PN / Totale Attivo': true,
  'Grado Indebitamento': false,
  'ROE': true,  'ROI': true,  'ROS': true,  'EBITDA Margin': true,
  'EBITDA': true,  'Fatturato': true,
  'PFN / EBITDA': false,  'PFN / PN': false,
  'DSO': false,
  'Interest Coverage': true,  'DSCR': true,
};

// Score normalizzato -1 … +1 (0 = pari al benchmark, +1 = molto meglio, -1 = molto peggio)
function calcScore(companyVal: number | null, benchVal: number | null | undefined, label: string): number | null {
  if (companyVal === null || benchVal === null || benchVal === undefined) return null;
  if (benchVal === 0) return null;
  const higherBetter = KPI_DIRECTION[label] ?? true;
  const raw = higherBetter
    ? (companyVal - benchVal) / Math.abs(benchVal)
    : (benchVal - companyVal) / Math.abs(benchVal);
  // Scala più stretta: ±20% dal benchmark = metà barra
  return Math.max(-1, Math.min(1, raw * 2.5));
}

// Colore basato sullo score
function scoreColor(score: number): string {
  if (score >= 0.4)  return '#15803d';  // verde scuro: molto meglio
  if (score >= 0.15) return '#22c55e';  // verde
  if (score >= -0.1) return '#4ade80';  // verde chiaro: vicino al benchmark
  if (score >= -0.25) return '#facc15'; // giallo
  if (score >= -0.5) return '#f97316';  // arancione
  return '#ef4444';                      // rosso
}

function scoreLabel(score: number): string {
  if (score >= 0.4)  return 'Eccellente';
  if (score >= 0.15) return 'Sopra media';
  if (score >= -0.1) return 'In linea';
  if (score >= -0.25) return 'Sotto media';
  if (score >= -0.5) return 'Critico';
  return 'Molto critico';
}

function KpiBar({ score }: { score: number | null }) {
  if (score === null) return (
    <div className="h-6 flex items-center justify-center">
      <span className="text-xs text-muted-foreground/50 italic">n.d.</span>
    </div>
  );
  // Posizione marker: 0% = estremo sinistro (peggiore), 100% = destra (migliore)
  const pct = Math.round((score + 1) / 2 * 100); // 0-100
  const clampedPct = Math.max(3, Math.min(97, pct));
  const color = scoreColor(score);
  const tip = scoreLabel(score);
  return (
    <div className="relative h-6 flex items-center" title={tip}>
      {/* Barra gradiente */}
      <div
        className="w-full h-2 rounded-full overflow-hidden"
        style={{ background: 'linear-gradient(to right, #ef4444 0%, #f97316 20%, #facc15 40%, #4ade80 55%, #22c55e 70%, #15803d 100%)' }}
      >
        {/* Zona grigia di sfondo per segnare il centro (benchmark) */}
      </div>
      {/* Linea centrale benchmark */}
      <div
        className="absolute top-0 bottom-0 w-px bg-slate-400/60"
        style={{ left: '50%' }}
      />
      {/* Marker posizione azienda */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-md"
        style={{ left: `${clampedPct}%`, transform: 'translate(-50%, -50%)', backgroundColor: color }}
        title={tip}
      />
    </div>
  );
}

function KpiCard({ entry, benchmarkValue }: { entry: KpiEntry; benchmarkValue?: number | null }) {
  const sem = entry.semaforo ?? 'nd';
  const desc = KPI_DESC[entry.label];
  const score = calcScore(entry.valore, benchmarkValue, entry.label);
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-0 border border-border/60 rounded-lg overflow-hidden text-sm hover:border-border transition-colors">
      {/* Colonna 1: KPI azienda */}
      <div className={`flex items-start gap-2 px-3 py-2.5 ${SEMAFORO_COLOR[sem]}`}>
        <span className={`w-2 h-2 rounded-full shrink-0 mt-1 ${SEMAFORO_DOT[sem]}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{entry.label}</span>
            <span className="font-bold tabular-nums ml-2 shrink-0">{entry.formatted}</span>
          </div>
          {desc && <p className="text-xs opacity-60 mt-0.5 leading-tight">{desc}</p>}
        </div>
      </div>
      {/* Colonna 2: Benchmark settore */}
      <div className="flex items-center justify-center px-4 py-2.5 bg-slate-50 border-l border-border/60 min-w-[4.5rem]">
        <span className="tabular-nums text-slate-600 font-medium text-sm">
          {benchmarkValue !== undefined && benchmarkValue !== null ? fmtBenchmark(benchmarkValue) : '—'}
        </span>
      </div>
      {/* Colonna 3: Barra confronto */}
      <div className="flex items-center px-3 py-2.5 bg-slate-50/70 border-l border-border/60 w-32">
        <KpiBar score={score} />
      </div>
    </div>
  );
}

function KpiSection({ title, entries, benchmarks }: { title: string; entries: Record<string, KpiEntry>; benchmarks?: SectorBenchmark }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1">
        {Object.values(entries).map(e => (
          <KpiCard key={e.label} entry={e} benchmarkValue={benchmarks?.kpi[e.label]} />
        ))}
      </div>
    </div>
  );
}


// Estrae testo da un PDF usando pdfjs-dist, ricostruendo le righe per coordinata Y
async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Raggruppa gli item per coordinata Y (arrotondata a 2 unità = stessa riga)
    const lineMap = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5] / 2) * 2;
      const x = item.transform[4];
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push({ x, str: item.str });
    }

    // Ordina le righe dall'alto in basso (Y decrescente nei PDF), testo da sinistra a destra
    const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a);
    for (const y of sortedYs) {
      const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
      const lineText = items.map(i => i.str).join(' ').replace(/\s{2,}/g, ' ').trim();
      if (lineText) fullText += lineText + '\n';
    }
    fullText += '\n';
  }
  return fullText;
}

// ─── Helper colori semaforo per PDF ─────────────────────────────────────────
function semColorFill(s: string): [number, number, number] {
  if (s === 'verde')  return [220, 252, 231];
  if (s === 'giallo') return [254, 243, 199];
  if (s === 'rosso')  return [254, 226, 226];
  return [243, 244, 246];
}
function semColorText(s: string): [number, number, number] {
  if (s === 'verde')  return [22,  101,  52];
  if (s === 'giallo') return [146,  64,  14];
  if (s === 'rosso')  return [185,  28,  28];
  return [107, 114, 128];
}
function passColorFill(pass: boolean | null): [number, number, number] {
  if (pass === true)  return [220, 252, 231];
  if (pass === false) return [254, 226, 226];
  return [243, 244, 246];
}
function passColorText(pass: boolean | null): [number, number, number] {
  if (pass === true)  return [22,  101,  52];
  if (pass === false) return [185,  28,  28];
  return [107, 114, 128];
}
function passLabel(pass: boolean | null) {
  if (pass === true)  return 'OK';
  if (pass === false) return 'KO';
  return 'N/D';
}

// ─── Commenti KPI per PDF ─────────────────────────────────────────────────────
function kpiComment(label: string, valore: number | null, semaforo: string): string {
  if (valore === null || semaforo === 'nd') return 'Dato non disponibile.';
  const v = valore;
  switch (label) {
    case 'Current Ratio':
      if (semaforo === 'verde') return v >= 2 ? 'Ottima liquidità a breve termine.' : 'Buona copertura delle passività a breve.';
      if (semaforo === 'giallo') return 'Liquidità sufficiente ma da monitorare attentamente.';
      return 'Rischio liquidità: attivo corrente non copre i debiti a breve.';
    case 'Quick Ratio':
      if (semaforo === 'verde') return 'Buona liquidità senza dipendenza dal magazzino.';
      if (semaforo === 'giallo') return 'Dipendenza significativa dal magazzino per la liquidità.';
      return 'Liquidità immediata critica, difficoltà nel breve termine.';
    case 'Acid Test':
      if (semaforo === 'verde') return 'Eccellente disponibilità di cassa e crediti a breve.';
      if (semaforo === 'giallo') return 'Riserve liquide nel limite minimo.';
      return 'Scarsa liquidità immediata, rischio insolvenza a breve.';
    case 'Debt/Equity':
      if (semaforo === 'verde') return v < 1 ? 'Eccellente indipendenza finanziaria dal debito.' : 'Rapporto debito/PN nella norma.';
      if (semaforo === 'giallo') return 'Indebitamento elevato rispetto al patrimonio, monitorare.';
      return 'Eccessivo ricorso al capitale di debito, struttura fragile.';
    case 'Leverage':
      if (semaforo === 'verde') return 'Struttura finanziaria equilibrata, leva contenuta.';
      if (semaforo === 'giallo') return 'Leva finanziaria elevata, prudenza nell\'assumere nuovi debiti.';
      return 'Leva eccessiva, rischio finanziario significativo.';
    case 'PN / Totale Attivo':
      if (semaforo === 'verde') return v > 50 ? 'Solida capitalizzazione aziendale, basso rischio.' : 'Buona autonomia finanziaria.';
      if (semaforo === 'giallo') return 'Autonomia finanziaria da rafforzare con nuovi apporti.';
      return 'Capitalizzazione insufficiente, alta dipendenza da terzi.';
    case 'Grado Indebitamento':
      if (semaforo === 'verde') return 'Bassa esposizione bancaria a breve, situazione fisiologica.';
      if (semaforo === 'giallo') return 'Esposizione bancaria a breve da monitorare.';
      return 'Elevata dipendenza dal credito bancario a breve termine.';
    case 'ROE':
      if (semaforo === 'verde') return v > 15 ? 'Ottima redditività per gli azionisti.' : 'Buona remunerazione del capitale proprio.';
      if (semaforo === 'giallo') return 'Redditività del capitale proprio modesta ma positiva.';
      return 'Rendimento insufficiente per gli investitori.';
    case 'ROI':
      if (semaforo === 'verde') return 'Buon rendimento degli investimenti effettuati.';
      if (semaforo === 'giallo') return 'Rendimento degli asset da migliorare.';
      return 'Scarsa efficienza nell\'utilizzo degli investimenti.';
    case 'ROS':
      if (semaforo === 'verde') return v > 10 ? 'Ottimi margini operativi sulle vendite.' : 'Margine operativo sulle vendite positivo.';
      if (semaforo === 'giallo') return 'Margine di vendita ridotto, pricing o costi da rivedere.';
      return 'Marginalità operativa critica, pressione sui costi elevata.';
    case 'EBITDA Margin':
      if (semaforo === 'verde') return v > 20 ? 'Eccellente capacità di generare cassa operativa.' : 'Buona generazione di cassa dalla gestione corrente.';
      if (semaforo === 'giallo') return 'Capacità di generare cassa al limite minimo accettabile.';
      return 'Cassa operativa insufficiente per sostenere gli investimenti.';
    case 'PFN / EBITDA':
      if (semaforo === 'verde') return v < 1.5 ? 'Debito finanziario netto ripagabile in meno di 2 anni.' : 'Posizione debitoria sostenibile rispetto ai flussi.';
      if (semaforo === 'giallo') return 'Debito elevato rispetto alla capacità di rimborso.';
      return `Debito netto critico (${v.toFixed(1)}× EBITDA), sostenibilità a rischio.`;
    case 'DSO (giorni crediti)':
      if (semaforo === 'verde') return 'Incassi rapidi, ottima gestione del credito commerciale.';
      if (semaforo === 'giallo') return `Tempi di incasso da ridurre (${Math.round(v)} gg medi).`;
      return `Incassi lenti (${Math.round(v)} gg), rischio crediti inesigibili.`;
    case 'Interest Coverage':
      if (semaforo === 'verde') return v > 5 ? 'Eccellente copertura degli oneri finanziari.' : 'Buona capacità di coprire gli interessi passivi.';
      if (semaforo === 'giallo') return 'Copertura interessi nel limite minimo, monitorare.';
      return 'Difficoltà a sostenere il costo del debito finanziario.';
    default:
      if (label.startsWith('DSCR')) {
        if (semaforo === 'verde') return 'Adeguata copertura del servizio del debito (rate + interessi).';
        if (semaforo === 'giallo') return 'Copertura rata finanziamenti al limite, margine ridotto.';
        return 'Copertura rata insufficiente, rischio default su finanziamenti.';
      }
      if (semaforo === 'verde') return 'Valore nella norma, nessuna criticità rilevata.';
      if (semaforo === 'giallo') return 'Valore richiede attenzione e monitoraggio periodico.';
      return 'Valore critico, intervento correttivo raccomandato.';
  }
}

function buildGeneralComment(bilanci: BilancioRecord[]): string {
  if (bilanci.length === 0) return 'Dati bilancio insufficienti per una valutazione complessiva.';
  const latest = bilanci[0];
  if (!latest.kpi) return 'KPI non ancora calcolati. Caricare il bilancio per la valutazione.';

  let verde = 0, giallo = 0, rosso = 0, total = 0;
  const critici: string[] = [];
  const positivi: string[] = [];

  for (const area of Object.values(latest.kpi) as Record<string, KpiEntry>[]) {
    for (const entry of Object.values(area)) {
      total++;
      if (entry.semaforo === 'verde') { verde++; positivi.push(entry.label); }
      else if (entry.semaforo === 'giallo') giallo++;
      else if (entry.semaforo === 'rosso') { rosso++; critici.push(entry.label); }
    }
  }

  const pct = total > 0 ? Math.round((verde / total) * 100) : 0;
  const nome = latest.ragione_sociale ?? 'L\'azienda';
  const anno = latest.anno_esercizio;

  let giudizio: string;
  let consiglio: string;
  if (pct >= 70) {
    giudizio = 'solidità finanziaria complessivamente buona';
    consiglio = 'Il profilo di rischio risulta contenuto e il posizionamento è favorevole per l\'accesso al credito.';
  } else if (pct >= 50) {
    giudizio = 'profilo finanziario nella media del settore';
    consiglio = 'Si raccomanda un monitoraggio periodico degli indicatori e il rafforzamento delle aree in giallo.';
  } else if (pct >= 30) {
    giudizio = 'presenza di aree di attenzione significative';
    consiglio = 'È opportuno elaborare un piano di miglioramento finanziario prima di procedere con nuove richieste di credito.';
  } else {
    giudizio = 'situazione finanziaria con criticità rilevanti';
    consiglio = 'Si raccomanda un intervento urgente di riequilibrio patrimoniale e finanziario.';
  }

  let text = `${nome} presenta, con riferimento all'esercizio ${anno}, ${giudizio} (${pct}% degli indicatori in area positiva su ${total} KPI analizzati, con ${verde} positivi, ${giallo} in attenzione e ${rosso} critici). `;
  if (positivi.length > 0) {
    const top = positivi.slice(0, 4).join(', ');
    text += `Punti di forza: ${top}. `;
  }
  if (critici.length > 0) {
    text += `Aree critiche: ${critici.join(', ')}. `;
  }
  text += consiglio;
  if (bilanci.length > 1) {
    text += ` Analisi condotta su ${bilanci.length} esercizi (${bilanci.map((b) => b.anno_esercizio).join(', ')}).`;
  }
  return text;
}

// ─── Generazione report PDF ──────────────────────────────────────────────────
function generateBancabilitaReport(
  bilanci: BilancioRecord[],
  bancabilita: BancaCheck[],
  practiceId: string,
  anomalyAlerts: BalanceAnomalyAlert[],
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const BLUE: [number, number, number]  = [30, 58, 138];
  const LGRAY: [number, number, number] = [248, 250, 252];
  const DGRAY: [number, number, number] = [71, 85, 105];
  const now = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  let y = 0;

  // ── INTESTAZIONE ──────────────────────────────────────────────────────────
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('REPORT BANCABILITÀ', 14, 11);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Credifile — Sistema di Gestione Finanziaria', 14, 17);
  doc.setFontSize(8);
  doc.text(`Pratica: ${practiceId}   |   Generato il: ${now}`, 14, 23);
  y = 35;

  // ── SOMMARIO BILANCI ────────────────────────────────────────────────────
  if (bilanci.length > 0) {
    doc.setTextColor(30, 58, 138);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('DATI SOCIETARI', 14, y);
    y += 6;

    const b0 = bilanci[0];
    doc.setFillColor(...LGRAY);
    doc.roundedRect(14, y, W - 28, 18, 2, 2, 'F');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(b0.ragione_sociale ?? '—', 19, y + 7);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DGRAY);
    doc.text(
      `Esercizi analizzati: ${bilanci.map(b => b.anno_esercizio).join(', ')}` +
      (b0.is_holding ? '   ★ Holding' : ''),
      19, y + 13,
    );
    y += 25;
  }

  // ── PER OGNI BILANCIO: TABELLA KPI ────────────────────────────────────────
  for (const bil of bilanci) {
    if (!bil.kpi) continue;

    // Titolo sezione
    doc.setTextColor(...BLUE);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`KPI BANCARI — Esercizio ${bil.anno_esercizio}`, 14, y);
    y += 4;

    const areaLabels: Record<string, string> = {
      liquidita:     'Liquidità',
      solidita:      'Solidità Patrimoniale',
      redditivita:   'Redditività',
      indebitamento: 'Indebitamento',
      efficienza:    'Efficienza Operativa',
      copertura:     'Copertura',
    };

    const rows: (string | { content: string; styles: object })[][] = [];

    for (const [area, areaLabel] of Object.entries(areaLabels)) {
      const entries = bil.kpi[area as keyof KpiResult];
      if (!entries) continue;

      // Riga di intestazione area
      rows.push([
        { content: areaLabel.toUpperCase(), styles: { fontStyle: 'bold', fillColor: [30, 58, 138] as [number,number,number], textColor: [255,255,255] as [number,number,number], colSpan: 4 } },
        '', '', '',
      ]);

      for (const entry of Object.values(entries)) {
        const fill = semColorFill(entry.semaforo);
        const text = semColorText(entry.semaforo);
        const sem  = entry.semaforo === 'verde' ? '● OK' : entry.semaforo === 'giallo' ? '● Attenzione' : entry.semaforo === 'rosso' ? '● Critico' : '—';
        rows.push([
          entry.label,
          entry.formatted,
          { content: sem, styles: { fillColor: fill, textColor: text, fontStyle: 'bold' } },
          kpiComment(entry.label, entry.valore, entry.semaforo),
        ]);
      }
    }

    autoTable(doc, {
      startY: y,
      head: [['Indicatore', 'Valore', 'Rating', 'Commento']],
      body: rows,
      margin: { left: 14, right: 14 },
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: {
        0: { cellWidth: 58 },
        1: { cellWidth: 22, halign: 'right' },
        2: { cellWidth: 24, halign: 'center' },
        3: { cellWidth: 78, fontStyle: 'italic', textColor: DGRAY },
      },
      didParseCell(data) {
        // le righe di intestazione area hanno colSpan impostato nell'oggetto
        if (data.section === 'body') {
          const cell = data.cell.raw as { styles?: { fillColor?: [number,number,number]; textColor?: [number,number,number]; fontStyle?: string } } | string;
          if (typeof cell === 'object' && cell.styles?.fillColor) {
            data.cell.styles.fillColor = cell.styles.fillColor;
            data.cell.styles.textColor = cell.styles.textColor ?? [0,0,0];
            if (cell.styles.fontStyle) data.cell.styles.fontStyle = cell.styles.fontStyle as 'bold' | 'normal' | 'italic' | 'bolditalic';
          }
        }
      },
    });

    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

    if (bil.anomaly_analysis) {
      const reportAlerts = anomalyAlerts.filter(alert =>
        alert.bilancio_id === bil.id && alert.active && alert.status !== 'ignored'
      );
      if (y > 225) { doc.addPage(); y = 15; }
      const analysis = bil.anomaly_analysis;
      doc.setTextColor(...BLUE);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`ANOMALIE DI BILANCIO DA APPROFONDIRE — ${analysis.score}/100 (${analysis.level.toUpperCase()})`, 14, y);
      y += 5;

      if (analysis.findings.length === 0 || (reportAlerts.length === 0 && anomalyAlerts.some(alert => alert.bilancio_id === bil.id))) {
        doc.setTextColor(22, 101, 52);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text('Nessuna anomalia di bilancio aperta da approfondire.', 14, y);
        y += 8;
      } else {
        const rows = reportAlerts.length > 0
          ? reportAlerts.map(alert => {
              const resolution = alert.status === 'answered_by_consultant'
                ? alert.consultant_response ?? 'Spiegazione inserita dal consulente'
                : alert.status === 'client_answered'
                  ? alert.practice_client_questions?.risposta ?? 'Risposta ricevuta dal cliente'
                  : alert.status === 'client_requested'
                    ? 'Chiarimento richiesto al cliente'
                    : alert.finding.recommended_checks[0] ?? 'Da approfondire';
              return [
                alert.severity.toUpperCase(),
                alert.title,
                alert.finding.evidence.join(' · '),
                ALERT_STATUS_LABELS[alert.status],
                resolution,
              ];
            })
          : analysis.findings.map(finding => [
              finding.severity.toUpperCase(),
              finding.title,
              finding.evidence.join(' · '),
              'Da valutare',
              finding.recommended_checks[0] ?? 'Approfondire',
            ]);
        autoTable(doc, {
          startY: y,
          head: [['Gravità', 'Anomalia', 'Evidenza', 'Stato', 'Approfondimento']],
          body: rows,
          margin: { left: 14, right: 14 },
          styles: { fontSize: 6.8, cellPadding: 1.8, overflow: 'linebreak' },
          headStyles: { fillColor: BLUE, textColor: [255,255,255], fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 16, fontStyle: 'bold' },
            1: { cellWidth: 38 },
            2: { cellWidth: 50 },
            3: { cellWidth: 29 },
            4: { cellWidth: 49 },
          },
        });
        y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
      }

      const disclaimerLines = doc.splitTextToSize(analysis.disclaimer, W - 28);
      doc.setTextColor(...DGRAY);
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'italic');
      doc.text(disclaimerLines, 14, y);
      y += disclaimerLines.length * 3.5 + 7;
    }

    // Nuova pagina se necessario
    if (y > 260 && bilanci.indexOf(bil) < bilanci.length - 1) {
      doc.addPage();
      y = 15;
    }
  }

  // ── VALUTAZIONE COMPLESSIVA ────────────────────────────────────────────────
  if (bilanci.length > 0 && bilanci[0].kpi) {
    if (y > 220) { doc.addPage(); y = 15; }
    doc.setTextColor(...BLUE);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('VALUTAZIONE COMPLESSIVA', 14, y);
    y += 5;

    const commentText = buildGeneralComment(bilanci);
    const commentLines = doc.splitTextToSize(commentText, W - 32);
    const boxH = Math.max(20, commentLines.length * 4.5 + 8);

    doc.setFillColor(241, 245, 249);
    doc.roundedRect(14, y, W - 28, boxH, 2, 2, 'F');
    doc.setDrawColor(148, 163, 184);
    doc.roundedRect(14, y, W - 28, boxH, 2, 2, 'S');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(commentLines, 19, y + 6);
    y += boxH + 10;
  }

  // ── VERIFICA BANCABILITÀ ───────────────────────────────────────────────────
  if (bancabilita.length > 0) {
    // Vai a nuova pagina se troppo in basso
    if (y > 200) { doc.addPage(); y = 15; }

    doc.setTextColor(...BLUE);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('VERIFICA BANCABILITÀ', 14, y);
    y += 5;

    for (const banca of bancabilita) {
      const totalReqs = banca.reqs.length;
      const allPass   = totalReqs > 0 && banca.failCount === 0 && banca.ndCount === 0;
      const hasFail   = banca.failCount > 0;
      const statusStr = totalReqs === 0 ? 'Nessun requisito KPI'
        : allPass  ? '✔ BANCABILE'
        : hasFail  ? '✘ NON BANCABILE'
        : '⚠ DATI INCOMPLETI';
      const statusFill: [number,number,number] = totalReqs === 0 ? [243,244,246]
        : allPass  ? [220,252,231]
        : hasFail  ? [254,226,226]
        : [254,243,199];
      const statusText: [number,number,number] = totalReqs === 0 ? [107,114,128]
        : allPass  ? [22,101,52]
        : hasFail  ? [185,28,28]
        : [146,64,14];

      // Intestazione banca
      if (y > 265) { doc.addPage(); y = 15; }
      doc.setFillColor(...statusFill);
      doc.roundedRect(14, y, W - 28, 11, 2, 2, 'F');
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(banca.bankName, 18, y + 7);
      doc.setTextColor(...statusText);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(statusStr, W - 14, y + 7, { align: 'right' });
      y += 14;

      if (totalReqs === 0) {
        doc.setTextColor(...DGRAY);
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'italic');
        doc.text('Nessun requisito KPI configurato per questa banca.', 18, y);
        y += 8;
        continue;
      }

      // Sub-header conteggi
      doc.setTextColor(...DGRAY);
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.text(
        `${banca.passCount} OK  ·  ${banca.failCount} KO  ·  ${banca.ndCount} N/D  su ${totalReqs} requisiti`,
        18, y,
      );
      y += 4;

      const kpiRows = banca.reqs.map(req => {
        const fill = passColorFill(req.pass);
        const text = passColorText(req.pass);
        const minStr = req.min_value !== null ? `≥ ${req.min_value}` : '';
        const maxStr = req.max_value !== null ? `≤ ${req.max_value}` : '';
        const threshold = [minStr, maxStr].filter(Boolean).join('  ');
        const actualStr = req.actual !== null
          ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(req.actual)
          : 'N/D';
        return [
          req.kpi_label,
          `(${req.kpi_area})`,
          threshold,
          actualStr,
          { content: passLabel(req.pass), styles: { fillColor: fill, textColor: text, fontStyle: 'bold' as const, halign: 'center' as const } },
        ];
      });

      autoTable(doc, {
        startY: y,
        head: [['KPI', 'Area', 'Soglia', 'Valore', 'Esito']],
        body: kpiRows,
        margin: { left: 14, right: 14 },
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontSize: 7.5, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 60 },
          1: { cellWidth: 30, textColor: DGRAY },
          2: { cellWidth: 35, halign: 'center' },
          3: { cellWidth: 30, halign: 'right' },
          4: { cellWidth: 20, halign: 'center' },
        },
        didParseCell(data) {
          if (data.section === 'body' && data.column.index === 4) {
            const cell = data.cell.raw as { styles?: { fillColor?: [number,number,number]; textColor?: [number,number,number]; fontStyle?: string; halign?: string } } | string;
            if (typeof cell === 'object' && cell.styles?.fillColor) {
              data.cell.styles.fillColor = cell.styles.fillColor;
              data.cell.styles.textColor = cell.styles.textColor ?? [0,0,0];
              if (cell.styles.fontStyle) data.cell.styles.fontStyle = cell.styles.fontStyle as 'bold' | 'normal';
            }
          }
        },
      });

      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }
  }

  // ── FOOTER ULTIMA PAGINA ──────────────────────────────────────────────────
  const totalPages = (doc as jsPDF & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Credifile — Report riservato ad uso interno  |  Pagina ${i} di ${totalPages}`,
      W / 2, 290, { align: 'center' },
    );
  }

  // ── DOWNLOAD ──────────────────────────────────────────────────────────────
  const firstName = bilanci[0]?.ragione_sociale ?? 'azienda';
  const safeName  = firstName.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 30);
  doc.save(`Bancabilita_${safeName}_${now.replace(/\//g, '-')}.pdf`);
}

export default function AnalisiFinanziariaTab({ practiceId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [bilanci, setBilanci] = useState<BilancioRecord[]>([]);
  const [uploadedPdfs, setUploadedPdfs] = useState<UploadedPdf[]>([]);
  const [selectedPdfId, setSelectedPdfId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedBilancio, setSelectedBilancio] = useState<BilancioRecord | null>(null);
  const [codiceAteco, setCodiceAteco] = useState<string | null>(null);
  const [bancabilita, setBancabilita] = useState<BancaCheck[]>([]);
  const [loadingBanca, setLoadingBanca] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [anomalyAlerts, setAnomalyAlerts] = useState<BalanceAnomalyAlert[]>([]);
  const [alertNotes, setAlertNotes] = useState<Record<string, string>>({});
  const [savingAlertId, setSavingAlertId] = useState<string | null>(null);

  const loadBancabilita = useCallback(async (latestKpi: KpiResult | null) => {
    setLoadingBanca(true);
    try {
      // 1. Banche assegnate alla pratica
      const { data: pbData } = await supabase
        .from('practice_banks')
        .select('bank_id, banks(id, nome)')
        .eq('practice_id', practiceId);

      if (!pbData || pbData.length === 0) { setBancabilita([]); return; }

      const bankIds = pbData.map((r: { bank_id: string }) => r.bank_id);

      // 2. Requisiti KPI per ogni banca assegnata
      const { data: reqData } = await supabase
        .from('bank_kpi_requirements')
        .select('*')
        .in('bank_id', bankIds);

      const reqs = (reqData ?? []) as BankKpiReq[];

      // 3. Costruisce i check per ogni banca
      const checks: BancaCheck[] = pbData.map((r: { bank_id: string; banks: { id: string; nome: string }[] | null }) => {
        const bankReqs = reqs.filter(req => req.bank_id === r.bank_id);
        const enriched = bankReqs.map(req => {
          let actual: number | null = null;
          if (latestKpi) {
            const area = latestKpi[req.kpi_area as keyof KpiResult];
            if (area) {
              const areaObj = latestKpi[req.kpi_area as keyof KpiResult] as Record<string, KpiEntry>;
              actual = areaObj[req.kpi_key]?.valore ?? null;
            }
          }
          let pass: boolean | null = null;
          if (actual !== null) {
            pass = true;
            if (req.min_value !== null && actual < req.min_value) pass = false;
            if (req.max_value !== null && actual > req.max_value) pass = false;
          }
          return { ...req, actual, pass };
        });

        return {
          bankId: r.bank_id,
          bankName: r.banks?.[0]?.nome ?? r.bank_id,
          reqs: enriched,
          passCount: enriched.filter(e => e.pass === true).length,
          failCount: enriched.filter(e => e.pass === false).length,
          ndCount: enriched.filter(e => e.pass === null).length,
        };
      });

      setBancabilita(checks);
    } finally {
      setLoadingBanca(false);
    }
  }, [practiceId]);

  const loadData = async () => {
    setLoading(true);
    // Codice ATECO della pratica (per benchmark settoriale)
    const { data: practiceData } = await supabase
      .from('practices').select('codice_ateco').eq('id', practiceId).maybeSingle();
    setCodiceAteco(practiceData?.codice_ateco ?? null);
    // KPI già calcolati
    const { data: kpiData } = await supabase
      .from('bilanci_kpi')
      .select('*')
      .eq('practice_id', practiceId)
      .order('anno_esercizio', { ascending: false });
    const list = (kpiData ?? []) as BilancioRecord[];
    setBilanci(list);
    if (list.length > 0) setSelectedBilancio(b => b ?? list[0]);
    if (list.length > 0) {
      const { data: alertData } = await supabase
        .from('balance_anomaly_alerts')
        .select('*, practice_client_questions(risposta,answered_at)')
        .in('bilancio_id', list.map(bilancio => bilancio.id))
        .eq('active', true)
        .order('created_at');
      setAnomalyAlerts((alertData ?? []) as BalanceAnomalyAlert[]);
    } else {
      setAnomalyAlerts([]);
    }

    // PDF già caricati nella pratica
    const { data: pdfData } = await supabase
      .from('uploaded_files')
      .select('id, nome_file, storage_path, created_at')
      .eq('practice_id', practiceId)
      .ilike('nome_file', '%.pdf')
      .order('created_at', { ascending: false });
    setUploadedPdfs((pdfData ?? []) as UploadedPdf[]);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [practiceId]);

  const handleDeleteBilancio = async (id: string, anno: number) => {
    if (!window.confirm(`Eliminare il bilancio ${anno}? L'operazione è irreversibile.`)) return;
    setDeletingId(id);
    try {
      const { error } = await supabase.from('bilanci_kpi').delete().eq('id', id);
      if (error) throw error;
      const updated = bilanci.filter(b => b.id !== id);
      setBilanci(updated);
      if (selectedBilancio?.id === id) setSelectedBilancio(updated[0] ?? null);
      toast.success(`Bilancio ${anno} eliminato`);
    } catch (e: unknown) {
      toast.error('Errore eliminazione: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeletingId(null);
    }
  };

  // Ricarica bancabilità ogni volta che cambia il set di bilanci analizzati
  useEffect(() => {
    const latest = bilanci.length > 0 ? bilanci[0].kpi : null;
    loadBancabilita(latest);
  }, [bilanci, loadBancabilita]);

  const updateAlert = async (
    alert: BalanceAnomalyAlert,
    status: 'answered_by_consultant' | 'ignored',
  ) => {
    const note = alertNotes[alert.id]?.trim() ?? '';
    if (!note) {
      toast.error(status === 'ignored'
        ? 'Inserisci il motivo per cui l’alert può essere ignorato'
        : 'Inserisci la spiegazione del consulente');
      return;
    }
    setSavingAlertId(alert.id);
    try {
      const { error } = await supabase
        .from('balance_anomaly_alerts')
        .update({
          status,
          consultant_response: status === 'answered_by_consultant' ? note : null,
          ignore_reason: status === 'ignored' ? note : null,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', alert.id);
      if (error) throw error;
      setAnomalyAlerts(previous => previous.map(item => (
        item.id === alert.id
          ? {
              ...item,
              status,
              consultant_response: status === 'answered_by_consultant' ? note : null,
              ignore_reason: status === 'ignored' ? note : null,
              resolved_at: new Date().toISOString(),
            }
          : item
      )));
      toast.success(status === 'ignored' ? 'Alert ignorato con motivazione' : 'Spiegazione del consulente salvata');
    } catch (error) {
      toast.error('Errore aggiornamento alert: ' + String(error));
    } finally {
      setSavingAlertId(null);
    }
  };

  const askClientAboutAlert = async (alert: BalanceAnomalyAlert) => {
    const question = alertNotes[alert.id]?.trim()
      || alert.finding.suggested_question
      || `Con riferimento all’anomalia di bilancio “${alert.title}” (${alert.finding.evidence.join('; ')}), vi chiediamo di fornire una spiegazione dettagliata e la documentazione contabile di supporto.`;
    if (!question) {
      toast.error('Inserisci la domanda da inviare al cliente');
      return;
    }
    setSavingAlertId(alert.id);
    let integrationRequestId: string | null = null;
    let questionId: string | null = null;
    try {
      const { data: authData } = await supabase.auth.getUser();
      const currentUser = authData.user;
      const [{ data: practiceData, error: practiceError }, { data: accessCode, error: accessError }, { data: profile }] = await Promise.all([
        supabase
          .from('practices')
          .select('numero_pratica,status,clients(ragione_sociale,email),assigned_agent:admin_profiles!practices_assigned_to_fkey(nome,email)')
          .eq('id', practiceId)
          .single(),
        supabase
          .from('practice_access_codes')
          .select('id,codice,email_cliente')
          .eq('practice_id', practiceId)
          .maybeSingle(),
        currentUser
          ? supabase.from('admin_profiles').select('nome,email').eq('id', currentUser.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (practiceError) throw practiceError;
      if (accessError) throw accessError;

      const practiceWithRelations = practiceData as unknown as {
        numero_pratica: string;
        status: string;
        clients: { ragione_sociale: string; email: string } | null;
        assigned_agent: { nome?: string; email: string } | null;
      };
      const client = practiceWithRelations.clients;
      if (!client?.email) throw new Error('Il cliente non ha un indirizzo email');
      if (!accessCode?.codice) throw new Error('Genera prima il link e il codice di accesso del cliente');
      const assignedAgentEmail = practiceWithRelations.assigned_agent?.email?.trim() || null;
      if (!assignedAgentEmail) {
        throw new Error('Assegna alla pratica un agente con email valida prima di inviare la domanda al cliente');
      }

      const { data: integrationRequest, error: integrationError } = await supabase
        .from('practice_integration_requests')
        .insert({
          practice_id: practiceId,
          origin_status: normalizePrimaryStatus(practiceWithRelations.status),
          status: 'open',
          note: `Chiarimento su anomalia di bilancio: ${alert.title}`,
          created_by: currentUser?.id ?? null,
        })
        .select('id')
        .single();
      if (integrationError || !integrationRequest?.id) {
        throw integrationError ?? new Error('Impossibile creare la richiesta di chiarimento');
      }
      integrationRequestId = integrationRequest.id;

      const { data: insertedQuestion, error: questionError } = await supabase
        .from('practice_client_questions')
        .insert({
          practice_id: practiceId,
          integration_request_id: integrationRequestId,
          domanda: question,
          stato: 'richiesta',
          created_by: currentUser?.id ?? null,
        })
        .select('id')
        .single();
      if (questionError || !insertedQuestion?.id) {
        throw questionError ?? new Error('Impossibile creare la domanda');
      }
      questionId = insertedQuestion.id;

      const { error: alertError } = await supabase
        .from('balance_anomaly_alerts')
        .update({
          status: 'client_requested',
          client_question_id: questionId,
          resolved_at: null,
        })
        .eq('id', alert.id);
      if (alertError) throw alertError;

      const consultantName = profile?.nome ?? currentUser?.email ?? 'Il tuo consulente';
      const { data: emailData, error: emailError } = await supabase.functions.invoke('send-client-email', {
        body: {
          to: client.email,
          consultant_name: consultantName,
          documents: [],
          questions: [question],
          link: `https://credifile-eosin.vercel.app/#/accesso?p=${practiceId}`,
          code: accessCode.codice,
          practice_number: practiceWithRelations.numero_pratica,
          company_name: client.ragione_sociale,
          subject_override: `Anomalia di bilancio da approfondire — ${client.ragione_sociale}`,
          cc: assignedAgentEmail,
          reply_to: assignedAgentEmail,
        },
      });
      if (emailError || emailData?.success === false) {
        throw new Error(`La domanda è stata creata, ma l’email non è stata inviata: ${emailData?.error ?? emailError?.message ?? 'errore sconosciuto'}`);
      }

      await Promise.all([
        supabase
          .from('practice_integration_requests')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', integrationRequestId),
        supabase.from('practice_activity_log').insert({
          practice_id: practiceId,
          action: 'chiarimento_anomalia_bilancio_richiesto',
          actor_id: currentUser?.id ?? null,
          actor_nome: consultantName,
          actor_ruolo: 'consulente',
          metadata: {
            alert_id: alert.id,
            bilancio_id: alert.bilancio_id,
            titolo: alert.title,
            domanda: question,
            destinatario: client.email,
            integration_request_id: integrationRequestId,
          },
        }),
      ]);

      setAnomalyAlerts(previous => previous.map(item => (
        item.id === alert.id
          ? { ...item, status: 'client_requested', client_question_id: questionId }
          : item
      )));
      toast.success(`Domanda inviata a ${client.email}`);
    } catch (error) {
      if (!questionId && integrationRequestId) {
        await supabase.from('practice_integration_requests').delete().eq('id', integrationRequestId);
      }
      toast.error(String(error));
    } finally {
      setSavingAlertId(null);
    }
  };

  // Logica core: dato il testo PDF + metadati, chiama l'edge function
  const runAnalysis = async (pdfText: string, uploadedFileId: string | null) => {
    // Carica finanziamenti in essere dalla pratica
    const { data: finData } = await supabase
      .from('client_financing')
      .select('rata, debito_residuo, durata_mesi, tipologia')
      .eq('practice_id', practiceId);
    const financing = (finData ?? []).map(f => ({
      rata: Number(f.rata) || 0,
      debito_residuo: Number(f.debito_residuo) || 0,
      durata_mesi: Number(f.durata_mesi) || 0,
      tipologia: f.tipologia ?? '',
    }));

    const { data: result, error: fnErr } = await supabase.functions.invoke('analizza-bilancio', {
      body: { practice_id: practiceId, pdf_text: pdfText, uploaded_file_id: uploadedFileId, financing },
    });
    if (fnErr || result?.error) {
      throw new Error(fnErr?.message ?? result?.error ?? 'Errore sconosciuto');
    }
    return result;
  };

  // Analizza un PDF già caricato nella pratica
  const handleAnalyzeExisting = async () => {
    if (!selectedPdfId) { toast.error('Seleziona un file PDF dalla lista'); return; }
    const pdf = uploadedPdfs.find(p => p.id === selectedPdfId);
    if (!pdf) return;
    setAnalyzing(true);
    toast.info('Download e analisi del bilancio in corso...');
    try {
      // Scarica il PDF da storage tramite URL firmato
      const { data: signData, error: signErr } = await supabase.storage
        .from('practice-files')
        .createSignedUrl(pdf.storage_path, 60);
      if (signErr || !signData?.signedUrl) throw new Error('Impossibile accedere al file: ' + (signErr?.message ?? 'URL non disponibile'));

      const response = await fetch(signData.signedUrl);
      if (!response.ok) throw new Error('Download fallito: ' + response.statusText);
      const blob = await response.blob();
      const file = new File([blob], pdf.nome_file, { type: 'application/pdf' });

      toast.info('Analisi XBRL e calcolo KPI...');
      const pdfText = await extractPdfText(file);
      const result = await runAnalysis(pdfText, pdf.id);
      toast.success(`Bilancio ${result.anno ?? ''} analizzato — KPI calcolati`);
      await loadData();
    } catch (err: unknown) {
      toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAnalyzing(false);
    }
  };

  // Analizza un PDF nuovo (upload dal disco)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { toast.error('Seleziona un file PDF'); return; }
    setAnalyzing(true);
    toast.info('Estrazione testo dal PDF in corso...');
    try {
      const storagePath = `bilanci/${practiceId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from('practice-files').upload(storagePath, file);
      if (upErr) throw new Error('Errore upload: ' + upErr.message);
      const { data: ufRow } = await supabase.from('uploaded_files').insert({
        practice_id: practiceId, nome_file: file.name,
        storage_path: storagePath, mime_type: 'application/pdf', dimensione: file.size,
      }).select('id').single();
      toast.info('Analisi XBRL e calcolo KPI...');
      const pdfText = await extractPdfText(file);
      const result = await runAnalysis(pdfText, ufRow?.id ?? null);
      toast.success(`Bilancio ${result.anno ?? ''} analizzato — KPI calcolati`);
      await loadData();
    } catch (err: unknown) {
      toast.error('Errore: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAnalyzing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Conteggio semafori
  const countSemafori = (b: BilancioRecord) => {
    if (!b.kpi) return { verde: 0, giallo: 0, rosso: 0 };
    const all = Object.values(b.kpi).flatMap(area => Object.values(area as Record<string, KpiEntry>));
    return {
      verde: all.filter(k => k.semaforo === 'verde').length,
      giallo: all.filter(k => k.semaforo === 'giallo').length,
      rosso: all.filter(k => k.semaforo === 'rosso').length,
    };
  };

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Caricamento analisi...</div>;

  const selectedAlerts = selectedBilancio
    ? anomalyAlerts.filter(alert => alert.bilancio_id === selectedBilancio.id)
    : [];

  return (
    <div className="space-y-4">
      {/* Header con selezione PDF esistente o upload nuovo */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Analisi Finanziaria
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Seleziona un bilancio già caricato nella pratica oppure carica un nuovo PDF
          </p>
        </div>

        {/* Sezione selezione PDF esistenti */}
        {uploadedPdfs.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <Select value={selectedPdfId} onValueChange={setSelectedPdfId}>
              <SelectTrigger className="flex-1 min-w-[220px] max-w-sm h-9 text-sm">
                <SelectValue placeholder="Seleziona bilancio dalla pratica..." />
              </SelectTrigger>
              <SelectContent>
                {uploadedPdfs.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome_file}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleAnalyzeExisting} disabled={analyzing || !selectedPdfId}>
              {analyzing
                ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Analisi...</>
                : <><BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Analizza</>}
            </Button>
          </div>
        )}

        {/* Fallback upload nuovo + refresh */}
        <div className="flex items-center gap-2">
          {uploadedPdfs.length === 0 && (
            <p className="text-xs text-muted-foreground">Nessun PDF presente nella pratica.</p>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="outline" size="sm" onClick={loadData} disabled={analyzing}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Aggiorna
            </Button>
            {bilanci.length > 0 && (
              <Button variant="outline" size="sm"
                onClick={() => generateBancabilitaReport(bilanci, bancabilita, practiceId, anomalyAlerts)}
                title="Genera PDF riassuntivo KPI + bancabilità">
                <Download className="w-3.5 h-3.5 mr-1.5" /> Genera Report PDF
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={analyzing}
              title="Carica un nuovo PDF di bilancio non presente tra i documenti">
              <Upload className="w-3.5 h-3.5 mr-1.5" /> Carica nuovo PDF
            </Button>
            <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
          </div>
        </div>
      </div>

      <Separator />

      {/* Dashboard KPI */}
      {bilanci.length === 0 ? (
        <div className="py-10 text-center border rounded-lg bg-muted/30">
          <TrendingUp className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium text-foreground">Nessun bilancio analizzato</p>
          <p className="text-sm text-muted-foreground mt-1">
            {uploadedPdfs.length > 0
              ? 'Seleziona un PDF dalla lista sopra e clicca "Analizza"'
              : 'Carica il PDF del bilancio di esercizio per calcolare i KPI bancari'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Lista bilanci analizzati */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bilanci analizzati</p>
            {bilanci.map(b => {
              const s = countSemafori(b);
              const isSelected = selectedBilancio?.id === b.id;
              const isDeleting = deletingId === b.id;
              return (
                <div key={b.id}
                  className={`relative w-full text-left p-3 rounded-lg border transition-colors ${isSelected ? 'bg-primary/5 border-primary' : 'bg-card border-border hover:border-muted-foreground/50'}`}>
                  {/* area cliccabile per selezione */}
                  <button className="w-full text-left" onClick={() => setSelectedBilancio(b)}>
                    <div className="font-semibold text-sm">{b.anno_esercizio ?? '—'}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{b.ragione_sociale}</div>
                    {b.is_holding && <Badge variant="outline" className="text-xs mt-1.5 py-0">Holding</Badge>}
                    <div className="flex gap-2 mt-2 text-xs">
                      <span className="text-green-700">🟢 {s.verde}</span>
                      <span className="text-amber-600">🟡 {s.giallo}</span>
                      <span className="text-red-600">🔴 {s.rosso}</span>
                    </div>
                    {b.anomaly_analysis && (
                      <div className={`mt-2 text-[10px] font-semibold ${
                        b.anomaly_level === 'critico'
                          ? 'text-red-700'
                          : b.anomaly_level === 'elevato'
                            ? 'text-orange-700'
                            : b.anomaly_level === 'attenzione'
                              ? 'text-amber-700'
                              : 'text-green-700'
                      }`}>
                        Anomalie: {b.anomaly_score ?? b.anomaly_analysis.score}/100 · {b.anomaly_analysis.findings.length} segnalazioni
                      </div>
                    )}
                  </button>
                  {/* pulsante elimina */}
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteBilancio(b.id, b.anno_esercizio); }}
                    disabled={isDeleting}
                    title="Elimina bilancio"
                    className="absolute top-2 right-2 p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                  >
                    {isDeleting
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Dashboard KPI */}
          {selectedBilancio && (
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    {selectedBilancio.ragione_sociale}
                    {selectedBilancio.is_holding && <Badge variant="secondary" className="text-xs">Holding</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Totale Attivo</p><p className="font-semibold">{fmt(selectedBilancio.totale_attivo, true)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Patrimonio Netto</p><p className="font-semibold">{fmt(selectedBilancio.totale_patrimonio_netto, true)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Totale Debiti</p><p className="font-semibold">{fmt(selectedBilancio.totale_debiti, true)}</p></div>
                    <div><p className="text-xs text-muted-foreground">Utile Esercizio</p>
                      <p className={`font-semibold ${(selectedBilancio.utile_netto ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>{fmt(selectedBilancio.utile_netto, true)}</p>
                    </div>
                  </div>
                  {selectedBilancio.is_holding && (
                    <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Azienda holding: nessun ricavo operativo, i proventi derivano da partecipazioni. I KPI di redditività operativa (ROI, ROS) non sono significativi.</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedBilancio.anomaly_analysis && (
                <Card className={
                  selectedBilancio.anomaly_level === 'critico'
                    ? 'border-red-300'
                    : selectedBilancio.anomaly_level === 'elevato'
                      ? 'border-orange-300'
                      : selectedBilancio.anomaly_level === 'attenzione'
                        ? 'border-amber-300'
                        : 'border-green-200'
                }>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                        Anomalie di bilancio da approfondire
                      </span>
                      <Badge variant="outline" className="font-bold">
                        {selectedBilancio.anomaly_analysis.score}/100 · {selectedBilancio.anomaly_analysis.level}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      <span>Voci analizzate: <strong className="text-foreground">{selectedBilancio.anomaly_analysis.line_items_analyzed ?? 0}</strong></span>
                      <span>Poste poco chiare: <strong className="text-foreground">{selectedBilancio.anomaly_analysis.line_items_flagged ?? 0}</strong></span>
                      <span>Alert aperti: <strong className="text-foreground">{selectedAlerts.filter(alert => alert.status === 'open').length}</strong></span>
                    </div>
                    {selectedBilancio.anomaly_analysis.findings.length === 0 ? (
                      <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                        Nessuna anomalia significativa rilevata dai controlli automatici disponibili.
                      </div>
                    ) : selectedAlerts.length > 0 ? (
                      selectedAlerts.map(alert => {
                        const finding = alert.finding;
                        const isResolved = ['answered_by_consultant', 'client_answered', 'ignored'].includes(alert.status);
                        return (
                        <div key={alert.id} className={`rounded-lg border p-3 ${isResolved ? 'bg-muted/20' : 'bg-card'}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={
                              finding.severity === 'alta'
                                ? 'bg-red-100 text-red-800 hover:bg-red-100'
                                : finding.severity === 'media'
                                  ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-100'
                            }>
                              Gravità {finding.severity}
                            </Badge>
                            <Badge variant="outline">Confidenza {finding.confidence}</Badge>
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {finding.category.replace(/_/g, ' ')}
                            </span>
                            <Badge variant="outline" className="ml-auto">
                              {ALERT_STATUS_LABELS[alert.status]}
                            </Badge>
                          </div>
                          <h4 className="mt-2 text-sm font-semibold text-foreground">{finding.title}</h4>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{finding.explanation}</p>
                          <div className="mt-2 rounded-md bg-muted/50 p-2">
                            {finding.evidence.map((line, index) => (
                              <p key={index} className="text-xs font-medium text-foreground">{line}</p>
                            ))}
                          </div>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Possibili spiegazioni</p>
                              <ul className="mt-1 space-y-0.5">
                                {finding.possible_explanations.map((item, index) => (
                                  <li key={index} className="text-xs text-muted-foreground">• {item}</li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Verifiche consigliate</p>
                              <ul className="mt-1 space-y-0.5">
                                {finding.recommended_checks.map((item, index) => (
                                  <li key={index} className="text-xs text-foreground">• {item}</li>
                                ))}
                              </ul>
                            </div>
                          </div>
                          {alert.consultant_response && (
                            <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-2">
                              <p className="text-[10px] font-semibold uppercase text-green-700">Spiegazione del consulente</p>
                              <p className="mt-1 text-xs whitespace-pre-wrap text-green-900">{alert.consultant_response}</p>
                            </div>
                          )}
                          {alert.ignore_reason && (
                            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                              <p className="text-[10px] font-semibold uppercase text-slate-600">Motivo esclusione</p>
                              <p className="mt-1 text-xs whitespace-pre-wrap text-slate-800">{alert.ignore_reason}</p>
                            </div>
                          )}
                          {alert.practice_client_questions?.risposta && (
                            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-2">
                              <p className="text-[10px] font-semibold uppercase text-blue-700">Risposta del cliente</p>
                              <p className="mt-1 text-xs whitespace-pre-wrap text-blue-900">{alert.practice_client_questions.risposta}</p>
                            </div>
                          )}
                          {alert.status === 'client_requested' ? (
                            <div className="mt-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                              <MessageSquare className="h-3.5 w-3.5" />
                              Domanda inviata. L’alert si aggiornerà quando il cliente salverà la risposta.
                            </div>
                          ) : alert.status === 'open' ? (
                            <div className="mt-3 space-y-2 border-t pt-3">
                              <Textarea
                                rows={3}
                                value={alertNotes[alert.id] ?? ''}
                                onChange={event => setAlertNotes(previous => ({ ...previous, [alert.id]: event.target.value }))}
                                placeholder={finding.suggested_question || 'Inserisci una spiegazione, una domanda per il cliente o il motivo per ignorare l’alert...'}
                              />
                              <div className="flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 border-green-200 text-green-700 hover:bg-green-50"
                                  disabled={savingAlertId === alert.id}
                                  onClick={() => updateAlert(alert, 'answered_by_consultant')}
                                >
                                  <UserRoundCheck className="h-3.5 w-3.5" />
                                  Rispondo io
                                </Button>
                                <Button
                                  size="sm"
                                  className="gap-1.5"
                                  disabled={savingAlertId === alert.id}
                                  onClick={() => askClientAboutAlert(alert)}
                                >
                                  <MessageSquare className="h-3.5 w-3.5" />
                                  Chiedi al cliente
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="gap-1.5 text-muted-foreground"
                                  disabled={savingAlertId === alert.id}
                                  onClick={() => updateAlert(alert, 'ignored')}
                                >
                                  <CircleSlash2 className="h-3.5 w-3.5" />
                                  Ignora alert
                                </Button>
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                Se lasci vuoto il testo e scegli “Chiedi al cliente”, sarà usata la domanda proposta automaticamente.
                              </p>
                            </div>
                          ) : null}
                        </div>
                        );
                      })
                    ) : (
                      selectedBilancio.anomaly_analysis.findings.map(finding => (
                        <div key={finding.id} className="rounded-lg border bg-card p-3">
                          <Badge variant="outline">Alert in preparazione</Badge>
                          <h4 className="mt-2 text-sm font-semibold">{finding.title}</h4>
                          <p className="mt-1 text-xs text-muted-foreground">{finding.evidence.join(' · ')}</p>
                        </div>
                      ))
                    )}
                    <p className="text-[10px] leading-relaxed text-muted-foreground italic">
                      {selectedBilancio.anomaly_analysis.disclaimer}
                    </p>
                  </CardContent>
                </Card>
              )}

              {selectedBilancio.kpi && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Scheda KPI Bancari — Esercizio {selectedBilancio.anno_esercizio}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Header colonne */}
                    {(() => {
                      const bench = getAtecoBenchmark(codiceAteco);
                      return (
                        <>
                          {/* Intestazioni colonne */}
                          <div className="grid grid-cols-[1fr_auto_auto] mb-2 text-xs font-semibold text-muted-foreground">
                            <div className="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-tl-lg rounded-bl-lg">
                              📋 Indici dell'azienda
                            </div>
                            <div className="px-4 py-1.5 bg-slate-100 border-t border-b border-slate-200 min-w-[4.5rem] text-center" title={`Benchmark settore: ${bench.label} — Banca d'Italia / Mediobanca 2023`}>
                              📊 Indici del settore
                            </div>
                            <div className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-tr-lg rounded-br-lg w-32 text-center">
                              🎯 Posizione
                            </div>
                          </div>
                          {/* Leggenda barra */}
                          <div className="flex items-center justify-end gap-4 mb-3 text-[10px] text-muted-foreground/70 pr-1">
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block"/>Critico</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block"/>Sotto media</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block"/>In linea</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-700 inline-block"/>Eccellente</span>
                          </div>
                          {(Object.entries(AREA_LABELS) as [keyof KpiResult, string][]).map(([area, label]) => {
                            const entries = selectedBilancio.kpi[area];
                            if (!entries) return null;
                            return (
                              <div key={area}>
                                <KpiSection title={label} entries={entries} benchmarks={bench} />
                                {area !== 'copertura' && <Separator className="mt-3" />}
                              </div>
                            );
                          })}
                          <p className="text-[10px] text-muted-foreground/60 mt-2 text-right">
                            📊 Benchmark: mediane PMI italiane per settore ATECO — Banca d'Italia / Mediobanca 2023
                          </p>
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Sezione Confronto Bilanci YoY ── */}
      {bilanci.length >= 2 && (() => {
        const b0 = bilanci[0];
        const b1 = bilanci[1];
        if (!b0?.kpi || !b1?.kpi) return null;
        type DeltaRow = { label: string; v0: number | null; v1: number | null; pct: number | null };
        const rows: DeltaRow[] = [];
        for (const area of Object.keys(AREA_LABELS) as (keyof KpiResult)[]) {
          const e0 = b0.kpi[area] ?? {}; const e1 = b1.kpi[area] ?? {};
          for (const key of Object.keys(e0)) {
            const r0 = e0[key]; const r1 = e1[key];
            const v0 = r0?.valore ?? null; const v1 = r1?.valore ?? null;
            const delta = v0 != null && v1 != null ? v0 - v1 : null;
            const pct = delta != null && v1 != null && v1 !== 0 ? (delta / Math.abs(v1)) * 100 : null;
            rows.push({ label: r0?.label ?? key, v0, v1, pct });
          }
        }
        return (
          <div key="confronto-yoy">
            <Separator className="my-4" />
            <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-primary" />
              Confronto Bilanci — {b1.anno_esercizio} → {b0.anno_esercizio}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left px-3 py-2 text-muted-foreground font-semibold border-b border-border">Indicatore</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-semibold border-b border-border">{b1.anno_esercizio}</th>
                    <th className="text-right px-3 py-2 text-muted-foreground font-semibold border-b border-border">{b0.anno_esercizio}</th>
                    <th className="text-center px-3 py-2 text-muted-foreground font-semibold border-b border-border">Var. %</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const pos = (r.pct ?? 0) > 0; const neg = (r.pct ?? 0) < 0;
                    return (
                      <tr key={i} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                        <td className="px-3 py-1.5 text-foreground">{r.label}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">{r.v1 != null ? r.v1.toFixed(2) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-semibold">{r.v0 != null ? r.v0.toFixed(2) : '—'}</td>
                        <td className={`px-3 py-1.5 text-center font-bold ${pos ? 'text-green-700' : neg ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {r.pct != null ? `${pos ? '▲ ' : neg ? '▼ ' : '━ '}${Math.abs(r.pct).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-2 text-right">▲ miglioramento · ▼ peggioramento vs esercizio precedente</p>
          </div>
        );
      })()}

      {/* ── Sezione Verifica Bancabilità ── */}
      <Separator />
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Verifica Bancabilità
          </h3>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"
            onClick={() => { const latest = bilanci.length > 0 ? bilanci[0].kpi : null; loadBancabilita(latest); }}
            disabled={loadingBanca}>
            <RefreshCw className={`w-3.5 h-3.5 ${loadingBanca ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {loadingBanca ? (
          <p className="text-sm text-muted-foreground text-center py-4">Caricamento verifica...</p>
        ) : bancabilita.length === 0 ? (
          <div className="py-6 text-center border rounded-lg bg-muted/30">
            <ShieldCheck className="w-8 h-8 mx-auto text-muted-foreground mb-2 opacity-40" />
            <p className="text-sm text-muted-foreground">
              {bilanci.length === 0
                ? 'Analizza prima un bilancio per verificare la bancabilità.'
                : 'Nessuna banca assegnata alla pratica oppure nessun requisito KPI configurato.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {bancabilita.map(banca => {
              const totalReqs = banca.reqs.length;
              const allPass = totalReqs > 0 && banca.failCount === 0 && banca.ndCount === 0;
              const hasFail = banca.failCount > 0;
              const statusColor = totalReqs === 0
                ? 'border-gray-200 bg-gray-50'
                : allPass ? 'border-green-200 bg-green-50'
                : hasFail ? 'border-red-200 bg-red-50'
                : 'border-amber-200 bg-amber-50';
              const statusLabel = totalReqs === 0
                ? 'Nessun requisito'
                : allPass ? '✅ Bancabile'
                : hasFail ? '❌ Non bancabile'
                : '⚠️ Dati incompleti';
              const statusBadge = totalReqs === 0
                ? 'bg-gray-100 text-gray-600'
                : allPass ? 'bg-green-100 text-green-800'
                : hasFail ? 'bg-red-100 text-red-800'
                : 'bg-amber-100 text-amber-800';

              return (
                <Card key={banca.bankId} className={`border ${statusColor}`}>
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Building2 className="w-3.5 h-3.5" />
                        {banca.bankName}
                      </span>
                      <Badge className={`text-xs ${statusBadge}`}>{statusLabel}</Badge>
                    </CardTitle>
                    {totalReqs > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {banca.passCount} OK · {banca.failCount} KO · {banca.ndCount} N/D su {totalReqs} requisiti
                      </p>
                    )}
                  </CardHeader>
                  {totalReqs > 0 && (
                    <CardContent className="px-4 pb-3">
                      <div className="space-y-1">
                        {banca.reqs.map(req => {
                          const icon = req.pass === true ? '✅' : req.pass === false ? '❌' : '—';
                          const rowColor = req.pass === true
                            ? 'text-green-800'
                            : req.pass === false ? 'text-red-700'
                            : 'text-muted-foreground';
                          const threshold = [
                            req.min_value !== null ? `min ${req.min_value}` : '',
                            req.max_value !== null ? `max ${req.max_value}` : '',
                          ].filter(Boolean).join(', ');
                          const actualStr = req.actual !== null
                            ? new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(req.actual)
                            : 'N/D';
                          return (
                            <div key={req.id} className={`flex items-center justify-between text-xs py-1 border-b border-border/40 last:border-0 ${rowColor}`}>
                              <span className="flex items-center gap-1.5">
                                <span>{icon}</span>
                                <span className="font-medium">{req.kpi_label}</span>
                                <span className="text-muted-foreground opacity-70 capitalize">({req.kpi_area})</span>
                              </span>
                              <span className="font-mono tabular-nums">
                                {actualStr}
                                {threshold && <span className="ml-1.5 opacity-60 text-[10px]">[{threshold}]</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
