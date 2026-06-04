import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TrendingUp, Upload, RefreshCw, AlertCircle, CheckCircle2, Building2, BarChart3, FileText, ShieldCheck, Download } from 'lucide-react';
import { toast } from 'sonner';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  created_at: string;
}

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

function KpiCard({ entry }: { entry: KpiEntry }) {
  const sem = entry.semaforo ?? 'nd';
  const desc = KPI_DESC[entry.label];
  return (
    <div className={`flex items-start justify-between p-2.5 rounded-lg border text-sm ${SEMAFORO_COLOR[sem]}`}>
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 mt-0.5 ${SEMAFORO_DOT[sem]}`} />
        <div className="min-w-0">
          <span className="font-medium">{entry.label}</span>
          {desc && <p className="text-xs opacity-70 mt-0.5 leading-tight">{desc}</p>}
        </div>
      </div>
      <span className="font-bold tabular-nums ml-3 shrink-0">{entry.formatted}</span>
    </div>
  );
}

function KpiSection({ title, entries }: { title: string; entries: Record<string, KpiEntry> }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">
        {Object.values(entries).map(e => <KpiCard key={e.label} entry={e} />)}
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

// ─── Generazione report PDF ──────────────────────────────────────────────────
function generateBancabilitaReport(
  bilanci: BilancioRecord[],
  bancabilita: BancaCheck[],
  practiceId: string,
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
        { content: areaLabel.toUpperCase(), styles: { fontStyle: 'bold', fillColor: [30, 58, 138] as [number,number,number], textColor: [255,255,255] as [number,number,number], colSpan: 3 } },
        '', '',
      ]);

      for (const entry of Object.values(entries)) {
        const fill = semColorFill(entry.semaforo);
        const text = semColorText(entry.semaforo);
        const sem  = entry.semaforo === 'verde' ? '● OK' : entry.semaforo === 'giallo' ? '● Attenzione' : entry.semaforo === 'rosso' ? '● Critico' : '—';
        rows.push([
          entry.label,
          entry.formatted,
          { content: sem, styles: { fillColor: fill, textColor: text, fontStyle: 'bold' } },
        ]);
      }
    }

    autoTable(doc, {
      startY: y,
      head: [['Indicatore', 'Valore', 'Rating']],
      body: rows,
      margin: { left: 14, right: 14 },
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: BLUE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 90 },
        1: { cellWidth: 40, halign: 'right' },
        2: { cellWidth: 40, halign: 'center' },
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

    // Nuova pagina se necessario
    if (y > 260 && bilanci.indexOf(bil) < bilanci.length - 1) {
      doc.addPage();
      y = 15;
    }
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
  const [bancabilita, setBancabilita] = useState<BancaCheck[]>([]);
  const [loadingBanca, setLoadingBanca] = useState(false);

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
    // KPI già calcolati
    const { data: kpiData } = await supabase
      .from('bilanci_kpi')
      .select('*')
      .eq('practice_id', practiceId)
      .order('anno_esercizio', { ascending: false });
    const list = (kpiData ?? []) as BilancioRecord[];
    setBilanci(list);
    if (list.length > 0) setSelectedBilancio(b => b ?? list[0]);

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

  // Ricarica bancabilità ogni volta che cambia il set di bilanci analizzati
  useEffect(() => {
    const latest = bilanci.length > 0 ? bilanci[0].kpi : null;
    loadBancabilita(latest);
  }, [bilanci, loadBancabilita]);

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
                onClick={() => generateBancabilitaReport(bilanci, bancabilita, practiceId)}
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
              return (
                <button key={b.id} onClick={() => setSelectedBilancio(b)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${isSelected ? 'bg-primary/5 border-primary' : 'bg-card border-border hover:border-muted-foreground/50'}`}>
                  <div className="font-semibold text-sm">{b.anno_esercizio ?? '—'}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{b.ragione_sociale}</div>
                  {b.is_holding && <Badge variant="outline" className="text-xs mt-1.5 py-0">Holding</Badge>}
                  <div className="flex gap-2 mt-2 text-xs">
                    <span className="text-green-700">🟢 {s.verde}</span>
                    <span className="text-amber-600">🟡 {s.giallo}</span>
                    <span className="text-red-600">🔴 {s.rosso}</span>
                  </div>
                </button>
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

              {selectedBilancio.kpi && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Scheda KPI Bancari — Esercizio {selectedBilancio.anno_esercizio}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(Object.entries(AREA_LABELS) as [keyof KpiResult, string][]).map(([area, label]) => {
                      const entries = selectedBilancio.kpi[area];
                      if (!entries) return null;
                      return (
                        <div key={area}>
                          <KpiSection title={label} entries={entries} />
                          {area !== 'copertura' && <Separator className="mt-3" />}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

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
