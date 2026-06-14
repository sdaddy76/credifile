// @section: report-page — Generatore Report Bancabilità per email alle banche
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FileText, Mail, Search, RefreshCw, Download,
  ChevronRight, Send, CheckCircle2, AlertCircle,
  Building2, User, Calendar, BarChart3, Eye,
} from 'lucide-react';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── Tipi ──────────────────────────────────────────────────────────────────
interface KpiEntry { valore: number | null; formatted: string; semaforo: 'verde' | 'giallo' | 'rosso' | 'nd'; label: string }
interface KpiResult {
  liquidita:    Record<string, KpiEntry>;
  solidita:     Record<string, KpiEntry>;
  redditivita:  Record<string, KpiEntry>;
  indebitamento:Record<string, KpiEntry>;
  efficienza:   Record<string, KpiEntry>;
  copertura:    Record<string, KpiEntry>;
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
interface ClienteKpi {
  clientId: string;
  ragioneSociale: string;
  bilanci: BilancioRecord[];
  practiceId: string | null;
  numeroPratica: string | null;
}
interface EmailLog {
  id: string;
  created_at: string;
  practice_id: string;
  bank_nome: string | null;
  destinatari: string[] | null;
  oggetto: string | null;
  stato: string;
  sent_by_nome: string | null;
  practices?: { numero_pratica: string; clients?: { ragione_sociale: string } | null } | null;
}

// ── Helper colori semaforo ─────────────────────────────────────────────────
function semFill(s: string): [number, number, number] {
  if (s === 'verde')  return [220, 252, 231];
  if (s === 'giallo') return [254, 243, 199];
  if (s === 'rosso')  return [254, 226, 226];
  return [243, 244, 246];
}
function semText(s: string): [number, number, number] {
  if (s === 'verde')  return [22,  101,  52];
  if (s === 'giallo') return [146,  64,  14];
  if (s === 'rosso')  return [185,  28,  28];
  return [107, 114, 128];
}
const SEM_DOT: Record<string, string> = {
  verde: '● OK', giallo: '● Attenzione', rosso: '● Critico',
};
const SEM_COLOR_CSS: Record<string, string> = {
  verde: 'text-green-600', giallo: 'text-amber-500', rosso: 'text-red-600', nd: 'text-gray-400',
};

// ── Commento testuale KPI ─────────────────────────────────────────────────
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

// ── Valutazione complessiva testuale ──────────────────────────────────────
function buildGeneralComment(bilanci: BilancioRecord[]): string {
  if (bilanci.length === 0) return 'Dati bilancio insufficienti per una valutazione complessiva.';
  const latest = bilanci[0];
  if (!latest.kpi) return 'KPI non ancora calcolati. Caricare il bilancio per la valutazione.';
  let verde = 0, giallo = 0, rosso = 0, total = 0;
  const critici: string[] = [], positivi: string[] = [];
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
  let giudizio: string, consiglio: string;
  if (pct >= 70)      { giudizio = 'solidità finanziaria complessivamente buona';           consiglio = 'Il profilo di rischio risulta contenuto e il posizionamento è favorevole per l\'accesso al credito.'; }
  else if (pct >= 50) { giudizio = 'profilo finanziario nella media del settore';           consiglio = 'Si raccomanda un monitoraggio periodico degli indicatori e il rafforzamento delle aree in giallo.'; }
  else if (pct >= 30) { giudizio = 'presenza di aree di attenzione significative';         consiglio = 'È opportuno elaborare un piano di miglioramento finanziario prima di procedere con nuove richieste di credito.'; }
  else                { giudizio = 'situazione finanziaria con criticità rilevanti';        consiglio = 'Si raccomanda un intervento urgente di riequilibrio patrimoniale e finanziario.'; }
  let text = `${nome} presenta, con riferimento all'esercizio ${anno}, ${giudizio} (${pct}% degli indicatori in area positiva su ${total} KPI analizzati, con ${verde} positivi, ${giallo} in attenzione e ${rosso} critici). `;
  if (positivi.length > 0) text += `Punti di forza: ${positivi.slice(0, 4).join(', ')}. `;
  if (critici.length  > 0) text += `Aree critiche: ${critici.join(', ')}. `;
  text += consiglio;
  if (bilanci.length > 1) text += ` Analisi condotta su ${bilanci.length} esercizi (${bilanci.map(b => b.anno_esercizio).join(', ')}).`;
  return text;
}

// ── Genera PDF bancabilità (stessa logica di AnalisiFinanziariaTab) ────────
function generateReportPdf(bilanci: BilancioRecord[], practiceLabel: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const BLUE: [number, number, number]  = [30, 58, 138];
  const LGRAY: [number, number, number] = [248, 250, 252];
  const DGRAY: [number, number, number] = [71, 85, 105];
  const now = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  let y = 0;

  // Intestazione
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16); doc.setFont('helvetica', 'bold');
  doc.text('REPORT BANCABILITÀ', 14, 11);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text('Credifile — Sistema di Gestione Finanziaria', 14, 17);
  doc.setFontSize(8);
  doc.text(`Pratica: ${practiceLabel}   |   Generato il: ${now}`, 14, 23);
  y = 35;

  // Sommario dati societari
  if (bilanci.length > 0) {
    const b0 = bilanci[0];
    doc.setTextColor(...BLUE); doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('DATI SOCIETARI', 14, y); y += 6;
    doc.setFillColor(...LGRAY);
    doc.roundedRect(14, y, W - 28, 18, 2, 2, 'F');
    doc.setTextColor(30, 41, 59); doc.setFontSize(12); doc.setFont('helvetica', 'bold');
    doc.text(b0.ragione_sociale ?? '—', 19, y + 7);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(...DGRAY);
    doc.text(`Esercizi analizzati: ${bilanci.map(b => b.anno_esercizio).join(', ')}${b0.is_holding ? '   ★ Holding' : ''}`, 19, y + 13);
    y += 25;
  }

  // KPI per bilancio
  const areaLabels: Record<string, string> = {
    liquidita: 'Liquidità', solidita: 'Solidità Patrimoniale',
    redditivita: 'Redditività', indebitamento: 'Indebitamento',
    efficienza: 'Efficienza Operativa', copertura: 'Copertura',
  };

  for (const bil of bilanci) {
    if (!bil.kpi) continue;
    doc.setTextColor(...BLUE); doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text(`KPI BANCARI — Esercizio ${bil.anno_esercizio}`, 14, y); y += 4;

    const rows: (string | { content: string; styles: object })[][] = [];
    for (const [area, areaLabel] of Object.entries(areaLabels)) {
      const entries = bil.kpi[area as keyof KpiResult];
      if (!entries) continue;
      rows.push([
        { content: areaLabel.toUpperCase(), styles: { fontStyle: 'bold', fillColor: BLUE, textColor: [255,255,255] as [number,number,number], colSpan: 4 } },
        '', '', '',
      ]);
      for (const entry of Object.values(entries)) {
        const fill = semFill(entry.semaforo);
        const text = semText(entry.semaforo);
        const sem  = SEM_DOT[entry.semaforo] ?? '—';
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
    if (y > 260 && bilanci.indexOf(bil) < bilanci.length - 1) { doc.addPage(); y = 15; }
  }

  // Valutazione complessiva
  if (bilanci.length > 0 && bilanci[0].kpi) {
    if (y > 220) { doc.addPage(); y = 15; }
    doc.setTextColor(...BLUE); doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('VALUTAZIONE COMPLESSIVA', 14, y); y += 5;
    const commentText = buildGeneralComment(bilanci);
    const commentLines = doc.splitTextToSize(commentText, W - 32);
    const boxH = Math.max(20, commentLines.length * 4.5 + 8);
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(14, y, W - 28, boxH, 2, 2, 'F');
    doc.setDrawColor(148, 163, 184);
    doc.roundedRect(14, y, W - 28, boxH, 2, 2, 'S');
    doc.setTextColor(30, 41, 59); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text(commentLines, 19, y + 6);
    y += boxH + 10;
  }

  // Footer
  const totalPages = (doc as jsPDF & { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(148, 163, 184); doc.setFont('helvetica', 'normal');
    doc.text(`Credifile — Report riservato ad uso interno  |  Pagina ${i} di ${totalPages}`, W / 2, 290, { align: 'center' });
  }

  const safeName = (bilanci[0]?.ragione_sociale ?? 'azienda').replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 30);
  doc.save(`Bancabilita_${safeName}_${now.replace(/\//g, '-')}.pdf`);
}

// ── Status pratica colori ──────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  bozza: 'Bozza', raccolta_documenti: 'Raccolta Doc.', analisi: 'Analisi',
  inviata_banca: 'Inviata Banca', approvata: 'Approvata', rifiutata: 'Rifiutata',
};
const STATUS_COLOR: Record<string, string> = {
  bozza: 'bg-gray-100 text-gray-700', raccolta_documenti: 'bg-yellow-100 text-yellow-800',
  analisi: 'bg-blue-100 text-blue-800', inviata_banca: 'bg-purple-100 text-purple-800',
  approvata: 'bg-green-100 text-green-800', rifiutata: 'bg-red-100 text-red-800',
};

// ═══════════════════════════════════════════════════════════════════════════
export default function ReportPage() {
  const navigate = useNavigate();
  const [tab, setTab]                       = useState<'genera' | 'email'>('genera');
  const [loading, setLoading]               = useState(true);
  const [search, setSearch]                 = useState('');
  const [clientiKpi, setClientiKpi]         = useState<ClienteKpi[]>([]);
  const [emailLogs, setEmailLogs]           = useState<EmailLog[]>([]);
  const [generando, setGenerando]           = useState<string | null>(null);
  const [expandedId, setExpandedId]         = useState<string | null>(null);

  // ── Carica dati ─────────────────────────────────────────────────────────
  const load = async () => {
    setLoading(true);
    try {
      // Bilanci KPI
      const { data: kpiRaw } = await supabase
        .from('bilanci_kpi')
        .select('id, client_id, anno_bilancio, ragione_sociale, is_holding, totale_attivo, totale_patrimonio_netto, totale_debiti, ricavi_vendite, utile_netto, kpi, created_at')
        .order('anno_bilancio', { ascending: false })
        .limit(500);

      // Pratiche (per collegare client_id → practice_id + numero_pratica)
      const { data: practicesRaw } = await supabase
        .from('practices')
        .select('id, client_id, numero_pratica, status')
        .order('created_at', { ascending: false })
        .limit(500);

      // Email log
      const { data: logs } = await supabase
        .from('email_send_log')
        .select('*, practices(numero_pratica, clients(ragione_sociale))')
        .order('created_at', { ascending: false })
        .limit(200);

      // Raggruppa bilanci per client_id
      const byClient: Record<string, BilancioRecord[]> = {};
      for (const row of (kpiRaw ?? [])) {
        const bil: BilancioRecord = {
          id: row.id,
          anno_esercizio: row.anno_bilancio,
          ragione_sociale: row.ragione_sociale ?? '—',
          is_holding: row.is_holding ?? false,
          totale_attivo: row.totale_attivo ?? 0,
          totale_patrimonio_netto: row.totale_patrimonio_netto ?? 0,
          totale_debiti: row.totale_debiti ?? 0,
          ricavi_vendite: row.ricavi_vendite ?? 0,
          utile_netto: row.utile_netto ?? 0,
          kpi: row.kpi as KpiResult,
          created_at: row.created_at,
        };
        if (!byClient[row.client_id]) byClient[row.client_id] = [];
        byClient[row.client_id].push(bil);
      }

      // Mappa client_id → pratica più recente
      const practiceByClient: Record<string, { id: string; numero: string; status: string }> = {};
      for (const p of (practicesRaw ?? [])) {
        if (p.client_id && !practiceByClient[p.client_id]) {
          practiceByClient[p.client_id] = { id: p.id, numero: p.numero_pratica, status: p.status };
        }
      }

      const list: ClienteKpi[] = Object.entries(byClient).map(([clientId, bilanci]) => ({
        clientId,
        ragioneSociale: bilanci[0]?.ragione_sociale ?? '—',
        bilanci,
        practiceId:    practiceByClient[clientId]?.id   ?? null,
        numeroPratica: practiceByClient[clientId]?.numero ?? null,
      }));
      list.sort((a, b) => a.ragioneSociale.localeCompare(b.ragioneSociale));

      setClientiKpi(list);
      setEmailLogs(logs ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Filtri ───────────────────────────────────────────────────────────────
  const q = search.toLowerCase();
  const filteredClienti = clientiKpi.filter(c =>
    !q || c.ragioneSociale.toLowerCase().includes(q) || (c.numeroPratica ?? '').toLowerCase().includes(q)
  );
  const filteredLogs = emailLogs.filter(l =>
    !q ||
    (l.practices?.clients?.ragione_sociale ?? '').toLowerCase().includes(q) ||
    (l.bank_nome ?? '').toLowerCase().includes(q) ||
    (l.practices?.numero_pratica ?? '').toLowerCase().includes(q)
  );

  // ── Genera PDF ───────────────────────────────────────────────────────────
  const handleGenera = (cliente: ClienteKpi) => {
    setGenerando(cliente.clientId);
    try {
      generateReportPdf(cliente.bilanci, cliente.numeroPratica ?? 'N/D');
      toast.success(`Report PDF generato per ${cliente.ragioneSociale}`);
    } catch (e) {
      toast.error('Errore nella generazione del PDF');
    } finally {
      setGenerando(null);
    }
  };

  const fmtFull = (d: string) => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ── Preview KPI inline ────────────────────────────────────────────────────
  const AREA_ORDER = ['liquidita','solidita','redditivita','indebitamento','efficienza','copertura'];
  const AREA_LABEL: Record<string, string> = {
    liquidita: '💧 Liquidità', solidita: '🏛️ Solidità', redditivita: '📈 Redditività',
    indebitamento: '💳 Indebitamento', efficienza: '⚙️ Efficienza', copertura: '🛡️ Copertura',
  };

  return (
    <div className="space-y-6">
      {/* @section: header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Report Bancabilità</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Genera il report con KPI + commenti + valutazione da allegare alle email per le banche
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Aggiorna
        </Button>
      </div>

      {/* @section: tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: 'genera', label: 'Genera Report', icon: FileText },
          { key: 'email',  label: 'Email Inviate',  icon: Mail    },
        ] as const).map(t => (
          <button
            key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.key === 'genera' && clientiKpi.length > 0 && (
              <span className="ml-1 bg-blue-100 text-blue-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                {clientiKpi.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* @section: search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Cerca cliente, pratica…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* ═══ TAB GENERA REPORT ════════════════════════════════════════════ */}
      {tab === 'genera' && (
        <div className="space-y-2">
          {loading ? (
            <div className="p-10 text-center text-muted-foreground text-sm">Caricamento…</div>
          ) : filteredClienti.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              {search ? 'Nessun risultato.' : 'Nessun cliente con KPI disponibili. Carica un bilancio dalla pratica → Tab Analisi Finanziaria.'}
            </div>
          ) : filteredClienti.map(cliente => {
            const isExpanded = expandedId === cliente.clientId;
            const latestBil = cliente.bilanci[0];
            // Conteggio semafori sul bilancio più recente
            let verde = 0, giallo = 0, rosso = 0;
            if (latestBil?.kpi) {
              for (const area of Object.values(latestBil.kpi) as Record<string, KpiEntry>[]) {
                for (const e of Object.values(area)) {
                  if (e.semaforo === 'verde') verde++;
                  else if (e.semaforo === 'giallo') giallo++;
                  else if (e.semaforo === 'rosso') rosso++;
                }
              }
            }
            return (
              <Card key={cliente.clientId} className="border overflow-hidden">
                {/* Riga principale */}
                <div
                  className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : cliente.clientId)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{cliente.ragioneSociale}</span>
                      {cliente.numeroPratica && (
                        <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                          {cliente.numeroPratica}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                      <span>Anni bilancio: {cliente.bilanci.map(b => b.anno_esercizio).join(', ')}</span>
                      <span>|</span>
                      <span className={SEM_COLOR_CSS.verde + ' font-medium'}>{verde} OK</span>
                      <span className={SEM_COLOR_CSS.giallo + ' font-medium'}>{giallo} Att.</span>
                      <span className={SEM_COLOR_CSS.rosso + ' font-medium'}>{rosso} Crit.</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="default"
                      className="gap-1.5"
                      disabled={generando === cliente.clientId}
                      onClick={e => { e.stopPropagation(); handleGenera(cliente); }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      {generando === cliente.clientId ? 'Generazione…' : 'Scarica PDF'}
                    </Button>
                    {cliente.practiceId && (
                      <Button
                        size="sm" variant="outline" className="gap-1"
                        onClick={e => { e.stopPropagation(); navigate(`/admin/pratiche/${cliente.practiceId}`); }}
                      >
                        <Eye className="w-3.5 h-3.5" /> Pratica
                      </Button>
                    )}
                    <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  </div>
                </div>

                {/* Anteprima KPI espansa */}
                {isExpanded && latestBil?.kpi && (
                  <div className="border-t bg-muted/10 p-4 space-y-4">
                    {/* Valutazione complessiva */}
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-slate-600 mb-1">📝 Valutazione Complessiva — Esercizio {latestBil.anno_esercizio}</p>
                      <p className="text-xs text-slate-700 leading-relaxed">{buildGeneralComment(cliente.bilanci)}</p>
                    </div>
                    {/* Tabella KPI */}
                    <div className="overflow-x-auto rounded-md border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-700 text-white">
                            <th className="text-left px-3 py-2 font-medium">Indicatore</th>
                            <th className="text-right px-3 py-2 font-medium">Valore</th>
                            <th className="text-center px-3 py-2 font-medium">Rating</th>
                            <th className="text-left px-3 py-2 font-medium">Commento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {AREA_ORDER.map(area => {
                            const entries = latestBil.kpi[area as keyof KpiResult];
                            if (!entries || Object.keys(entries).length === 0) return null;
                            return [
                              <tr key={`hdr-${area}`} className="bg-blue-800">
                                <td colSpan={4} className="px-3 py-1.5 text-white font-semibold text-[11px] uppercase tracking-wide">
                                  {AREA_LABEL[area]}
                                </td>
                              </tr>,
                              ...Object.values(entries).map((entry, i) => (
                                <tr key={entry.label} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                  <td className="px-3 py-1.5 text-slate-700">{entry.label}</td>
                                  <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{entry.formatted}</td>
                                  <td className="px-3 py-1.5 text-center">
                                    <span className={`text-[11px] font-bold ${SEM_COLOR_CSS[entry.semaforo] ?? 'text-gray-400'}`}>
                                      {SEM_DOT[entry.semaforo] ?? '—'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5 text-slate-500 italic">{kpiComment(entry.label, entry.valore, entry.semaforo)}</td>
                                </tr>
                              )),
                            ];
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ═══ TAB EMAIL INVIATE ════════════════════════════════════════════ */}
      {tab === 'email' && (
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Caricamento…</div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {search ? 'Nessun risultato per la ricerca.' : 'Nessuna email inviata ancora.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data/Ora</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cliente</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Pratica</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Banca</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Destinatario</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stato</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Inviato da</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredLogs.map((log, i) => (
                      <tr key={log.id} className={`hover:bg-muted/30 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Calendar className="w-3.5 h-3.5" />{fmtFull(log.created_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium">{log.practices?.clients?.ragione_sociale ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{log.practices?.numero_pratica ?? '—'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-muted-foreground" />{log.bank_nome ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate">
                          {(log.destinatari ?? []).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {log.stato === 'inviata' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" /> Inviata
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                              <AlertCircle className="w-3 h-3" /> {log.stato}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1"><User className="w-3 h-3" />{log.sent_by_nome ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          {log.practice_id && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1"
                              onClick={() => navigate(`/admin/pratiche/${log.practice_id}`)}>
                              <Eye className="w-3.5 h-3.5" /> Pratica
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
