import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { RefreshCw, ShieldCheck, Download, ChevronDown, ChevronUp, AlertCircle, TrendingUp, Plus, FileDown, Upload, Loader2, FileText } from 'lucide-react';
import IndiceBancabilita from '@/components/IndiceBancabilita';
import { toast } from 'sonner';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Props { practiceId: string }

interface KpiEntry { valore: number | null; formatted: string; semaforo: string; label: string }
type KpiResult = Record<string, Record<string, KpiEntry>>;

interface BilancioRecord {
  id: string; anno_esercizio: number; ragione_sociale: string;
  is_holding: boolean; kpi: KpiResult; created_at: string;
  ricavi_vendite?: number | null; utile_netto?: number | null;
}

// Chiavi KPI che sono colonne dirette in bilanci_kpi, NON nel JSON kpi
const ABSOLUTE_KPI_KEYS: Record<string, 'ricavi_vendite' | 'utile_netto'> = {
  ricavi_vendite: 'ricavi_vendite',
  fatturato:      'ricavi_vendite',
  ricavi:         'ricavi_vendite',
  utile_netto:    'utile_netto',
  utile:          'utile_netto',
};
interface BankKpiReq {
  id: string; bank_id: string; kpi_key: string; kpi_area: string;
  kpi_label: string; min_value: number | null; max_value: number | null;
}
interface AtecoReq { id: string; bank_id: string; codice: string; tipo: 'incluso' | 'escluso'; descrizione: string | null }
interface BankModulo { id: string; bank_id: string; nome: string; descrizione: string | null; file_path: string }
interface CompilatoRecord { id: string; modulo_id: string; file_path: string; note: string | null; uploaded_at: string }
interface BancaCheck {
  bankId: string; bankName: string; logoUrl: string | null;
  reqs: Array<BankKpiReq & { actual: number | null; pass: boolean | null }>;
  passCount: number; failCount: number; ndCount: number;
  atecoPass: boolean | null;
  atecoInclusi: AtecoReq[];
  atecoEsclusi: AtecoReq[];
  isAssigned: boolean;        // già assegnata alla pratica
  practiceBankId?: string;    // id riga practice_banks se assegnata
}

// ── helpers colore ──────────────────────────────────────────────────────────
function passColorFill(p: boolean | null): [number,number,number] {
  if (p === true)  return [220,252,231];
  if (p === false) return [254,226,226];
  return [243,244,246];
}
function passColorText(p: boolean | null): [number,number,number] {
  if (p === true)  return [22,101,52];
  if (p === false) return [185,28,28];
  return [107,114,128];
}
function semColorFill(s: string): [number,number,number] {
  if (s === 'verde')  return [220,252,231];
  if (s === 'giallo') return [254,243,199];
  if (s === 'rosso')  return [254,226,226];
  return [243,244,246];
}
function semColorText(s: string): [number,number,number] {
  if (s === 'verde')  return [22,101,52];
  if (s === 'giallo') return [146,64,14];
  if (s === 'rosso')  return [185,28,28];
  return [107,114,128];
}
function passLabel(p: boolean | null) { return p === true ? 'OK' : p === false ? 'KO' : 'N/D'; }

// ── commenti KPI per PDF ─────────────────────────────────────────────────────
function kpiComment(label: string, valore: number | null, semaforo: string): string {
  if (valore === null || semaforo === 'nd') return 'Dato non disponibile.';
  const v = valore;
  switch (label) {
    case 'Current Ratio':
      if (semaforo === 'verde') return v >= 2 ? 'Ottima liquidità a breve termine.' : 'Buona copertura delle passività a breve.';
      if (semaforo === 'giallo') return 'Liquidità sufficiente ma da monitorare.';
      return 'Rischio liquidità: attivo corrente insufficiente.';
    case 'Quick Ratio':
      if (semaforo === 'verde') return 'Buona liquidità senza dipendenza dal magazzino.';
      if (semaforo === 'giallo') return 'Dipendenza dal magazzino per la liquidità.';
      return 'Liquidità immediata critica.';
    case 'Acid Test':
      if (semaforo === 'verde') return 'Eccellente disponibilità di cassa e crediti.';
      if (semaforo === 'giallo') return 'Riserve liquide nel limite minimo.';
      return 'Scarsa liquidità immediata, rischio insolvenza.';
    case 'Debt/Equity':
      if (semaforo === 'verde') return v < 1 ? 'Eccellente indipendenza finanziaria.' : 'Rapporto debito/PN nella norma.';
      if (semaforo === 'giallo') return 'Indebitamento elevato, monitorare.';
      return 'Eccessivo ricorso al capitale di debito.';
    case 'Leverage':
      if (semaforo === 'verde') return 'Struttura finanziaria equilibrata.';
      if (semaforo === 'giallo') return 'Leva finanziaria elevata, prudenza.';
      return 'Leva eccessiva, rischio finanziario alto.';
    case 'PN / Totale Attivo':
      if (semaforo === 'verde') return v > 50 ? 'Solida capitalizzazione aziendale.' : 'Buona autonomia finanziaria.';
      if (semaforo === 'giallo') return 'Autonomia finanziaria da rafforzare.';
      return 'Capitalizzazione insufficiente.';
    case 'Grado Indebitamento':
      if (semaforo === 'verde') return 'Bassa esposizione bancaria a breve.';
      if (semaforo === 'giallo') return 'Esposizione bancaria da monitorare.';
      return 'Elevata dipendenza dal credito bancario.';
    case 'ROE':
      if (semaforo === 'verde') return v > 15 ? 'Ottima redditività per gli azionisti.' : 'Buona remunerazione del capitale.';
      if (semaforo === 'giallo') return 'Redditività del capitale modesta.';
      return 'Rendimento insufficiente per gli investitori.';
    case 'ROI':
      if (semaforo === 'verde') return 'Buon rendimento degli investimenti.';
      if (semaforo === 'giallo') return 'Rendimento degli asset da migliorare.';
      return 'Scarsa efficienza nell\'utilizzo degli investimenti.';
    case 'ROS':
      if (semaforo === 'verde') return v > 10 ? 'Ottimi margini operativi sulle vendite.' : 'Margine operativo positivo.';
      if (semaforo === 'giallo') return 'Margine di vendita ridotto, rivedere costi.';
      return 'Marginalità operativa critica.';
    case 'EBITDA Margin':
      if (semaforo === 'verde') return v > 20 ? 'Eccellente generazione di cassa operativa.' : 'Buona generazione di cassa.';
      if (semaforo === 'giallo') return 'Cassa operativa al limite minimo.';
      return 'Cassa operativa insufficiente.';
    case 'PFN / EBITDA':
      if (semaforo === 'verde') return v < 1.5 ? 'Debito ripagabile in meno di 2 anni.' : 'Posizione debitoria sostenibile.';
      if (semaforo === 'giallo') return 'Debito elevato rispetto ai flussi.';
      return `Debito netto critico (${v.toFixed(1)}× EBITDA).`;
    case 'DSO (giorni crediti)':
      if (semaforo === 'verde') return 'Incassi rapidi, ottima gestione crediti.';
      if (semaforo === 'giallo') return `Tempi di incasso da ridurre (${Math.round(v)} gg).`;
      return `Incassi lenti (${Math.round(v)} gg), rischio crediti inesigibili.`;
    case 'Interest Coverage':
      if (semaforo === 'verde') return v > 5 ? 'Eccellente copertura oneri finanziari.' : 'Buona copertura degli interessi.';
      if (semaforo === 'giallo') return 'Copertura interessi nel limite.';
      return 'Difficoltà a coprire gli interessi passivi.';
    default:
      if (label.startsWith('DSCR')) {
        if (semaforo === 'verde') return 'Adeguata copertura del servizio debito.';
        if (semaforo === 'giallo') return 'Copertura rata finanziamenti al limite.';
        return 'Copertura rata insufficiente, rischio default.';
      }
      if (semaforo === 'verde') return 'Valore nella norma, nessuna criticità.';
      if (semaforo === 'giallo') return 'Richiede attenzione e monitoraggio.';
      return 'Valore critico, intervento necessario.';
  }
}

function buildGeneralComment(bilanci: BilancioRecord[]): string {
  if (bilanci.length === 0) return 'Dati bilancio insufficienti per una valutazione complessiva.';
  const latest = bilanci[0];
  if (!latest.kpi) return 'KPI non ancora calcolati.';
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
  if (pct >= 70) { giudizio = 'solidità finanziaria buona'; consiglio = 'Profilo di rischio contenuto, posizionamento favorevole per l\'accesso al credito.'; }
  else if (pct >= 50) { giudizio = 'profilo finanziario nella media'; consiglio = 'Monitoraggio periodico degli indicatori consigliato.'; }
  else if (pct >= 30) { giudizio = 'aree di attenzione significative'; consiglio = 'Piano di miglioramento finanziario opportuno prima di nuove richieste di credito.'; }
  else { giudizio = 'criticità finanziarie rilevanti'; consiglio = 'Intervento urgente di riequilibrio patrimoniale e finanziario raccomandato.'; }
  let text = `${nome} presenta, con riferimento all'esercizio ${anno}, ${giudizio} (${pct}% KPI positivi su ${total} analizzati: ${verde} positivi, ${giallo} in attenzione, ${rosso} critici). `;
  if (positivi.length > 0) text += `Punti di forza: ${positivi.slice(0, 4).join(', ')}. `;
  if (critici.length > 0) text += `Aree critiche: ${critici.join(', ')}. `;
  text += consiglio;
  if (bilanci.length > 1) text += ` Analisi su ${bilanci.length} esercizi (${bilanci.map((b) => b.anno_esercizio).join(', ')}).`;
  return text;
}

// ── generazione PDF ─────────────────────────────────────────────────────────
function generatePdf(bilanci: BilancioRecord[], checks: BancaCheck[], practiceId: string) {
  const doc  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W    = doc.internal.pageSize.getWidth();
  const BLUE: [number,number,number] = [30,58,138];
  const DGRAY: [number,number,number] = [71,85,105];
  const now  = new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'2-digit', year:'numeric' });
  let y = 0;

  // header
  doc.setFillColor(...BLUE);
  doc.rect(0, 0, W, 28, 'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(16); doc.setFont('helvetica','bold');
  doc.text('REPORT BANCABILITÀ', 14, 11);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.text('Credifile — Sistema di Gestione Finanziaria', 14, 17);
  doc.setFontSize(8);
  doc.text(`Pratica: ${practiceId}   |   Generato il: ${now}`, 14, 23);
  y = 35;

  // dati societari
  if (bilanci.length > 0) {
    const b0 = bilanci[0];
    doc.setFillColor(248,250,252);
    doc.roundedRect(14, y, W-28, 18, 2, 2, 'F');
    doc.setTextColor(30,41,59); doc.setFontSize(12); doc.setFont('helvetica','bold');
    doc.text(b0.ragione_sociale ?? '—', 19, y+7);
    doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(...DGRAY);
    doc.text(
      `Esercizi analizzati: ${bilanci.map(b => b.anno_esercizio).join(', ')}` +
      (b0.is_holding ? '   ★ Holding' : ''), 19, y+13,
    );
    y += 25;
  }

  // KPI per bilancio
  for (const bil of bilanci) {
    if (!bil.kpi) continue;
    doc.setTextColor(...BLUE); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text(`KPI BANCARI — Esercizio ${bil.anno_esercizio}`, 14, y);
    y += 4;

    const areaMap: Record<string,string> = {
      liquidita:'Liquidità', solidita:'Solidità Patrimoniale',
      redditivita:'Redditività', indebitamento:'Indebitamento',
      efficienza:'Efficienza Operativa', copertura:'Copertura',
    };
    const rows: (string | {content:string;styles:object})[][] = [];
    for (const [area, areaLabel] of Object.entries(areaMap)) {
      const entries = bil.kpi[area]; if (!entries) continue;
      rows.push([{ content: areaLabel.toUpperCase(), styles:{ fontStyle:'bold', fillColor:BLUE, textColor:[255,255,255] as [number,number,number], colSpan:4 } },'','','']);
      for (const entry of Object.values(entries)) {
        const sem = entry.semaforo === 'verde' ? '● OK' : entry.semaforo === 'giallo' ? '● Attenzione' : entry.semaforo === 'rosso' ? '● Critico' : '—';
        rows.push([entry.label, entry.formatted, { content:sem, styles:{ fillColor:semColorFill(entry.semaforo), textColor:semColorText(entry.semaforo), fontStyle:'bold' } }, kpiComment(entry.label, entry.valore, entry.semaforo)]);
      }
    }
    autoTable(doc, {
      startY: y,
      head: [['Indicatore','Valore','Rating','Commento']],
      body: rows,
      margin: { left:14, right:14 },
      styles: { fontSize:7.5, cellPadding:2 },
      headStyles: { fillColor:BLUE, textColor:[255,255,255], fontStyle:'bold', fontSize:7.5 },
      columnStyles: { 0:{ cellWidth:58 }, 1:{ cellWidth:22, halign:'right' }, 2:{ cellWidth:24, halign:'center' }, 3:{ cellWidth:78, fontStyle:'italic', textColor:DGRAY } },
      didParseCell(data) {
        if (data.section === 'body') {
          const cell = data.cell.raw as { styles?: { fillColor?:[number,number,number]; textColor?:[number,number,number]; fontStyle?:string } } | string;
          if (typeof cell === 'object' && cell.styles?.fillColor) {
            data.cell.styles.fillColor = cell.styles.fillColor;
            data.cell.styles.textColor = cell.styles.textColor ?? [0,0,0];
            if (cell.styles.fontStyle) data.cell.styles.fontStyle = cell.styles.fontStyle as 'bold'|'normal'|'italic'|'bolditalic';
          }
        }
      },
    });
    y = (doc as jsPDF & { lastAutoTable:{ finalY:number } }).lastAutoTable.finalY + 8;
    if (y > 260) { doc.addPage(); y = 15; }
  }

  // valutazione complessiva
  if (bilanci.length > 0 && bilanci[0].kpi) {
    if (y > 220) { doc.addPage(); y = 15; }
    doc.setTextColor(...BLUE); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('VALUTAZIONE COMPLESSIVA', 14, y); y += 5;
    const commentText = buildGeneralComment(bilanci);
    const commentLines = doc.splitTextToSize(commentText, W - 32);
    const boxH = Math.max(20, commentLines.length * 4.5 + 8);
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(14, y, W-28, boxH, 2, 2, 'F');
    doc.setDrawColor(148, 163, 184);
    doc.roundedRect(14, y, W-28, boxH, 2, 2, 'S');
    doc.setTextColor(30, 41, 59); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text(commentLines, 19, y+6);
    y += boxH + 10;
  }

  // verifica bancabilità
  if (checks.length > 0) {
    if (y > 200) { doc.addPage(); y = 15; }
    doc.setTextColor(...BLUE); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text('VERIFICA BANCABILITÀ', 14, y); y += 5;

    for (const banca of checks) {
      const total   = banca.reqs.length;
      const allPass = total > 0 && banca.failCount === 0 && banca.ndCount === 0;
      const hasFail = banca.failCount > 0;
      const sfill: [number,number,number] = total === 0 ? [243,244,246] : allPass ? [220,252,231] : hasFail ? [254,226,226] : [254,243,199];
      const stext: [number,number,number] = total === 0 ? [107,114,128] : allPass ? [22,101,52] : hasFail ? [185,28,28] : [146,64,14];
      const slabel = total === 0 ? 'Nessun requisito' : allPass ? '✔ BANCABILE' : hasFail ? '✘ NON BANCABILE' : '⚠ DATI INCOMPLETI';

      if (y > 265) { doc.addPage(); y = 15; }
      doc.setFillColor(...sfill);
      doc.roundedRect(14, y, W-28, 11, 2, 2, 'F');
      doc.setTextColor(30,41,59); doc.setFontSize(9); doc.setFont('helvetica','bold');
      doc.text(banca.bankName, 18, y+7);
      doc.setTextColor(...stext); doc.setFontSize(8); doc.setFont('helvetica','bold');
      doc.text(slabel, W-14, y+7, { align:'right' });
      y += 14;

      if (total === 0) {
        doc.setTextColor(...DGRAY); doc.setFontSize(7.5); doc.setFont('helvetica','italic');
        doc.text('Nessun requisito KPI configurato.', 18, y); y += 8; continue;
      }
      doc.setTextColor(...DGRAY); doc.setFontSize(7.5); doc.setFont('helvetica','normal');
      doc.text(`${banca.passCount} OK  ·  ${banca.failCount} KO  ·  ${banca.ndCount} N/D  su ${total} requisiti`, 18, y);
      y += 4;

      autoTable(doc, {
        startY: y,
        head: [['KPI','Area','Soglia','Valore','Esito']],
        body: banca.reqs.map(req => {
          const th = [req.min_value !== null ? `≥ ${req.min_value}` : '', req.max_value !== null ? `≤ ${req.max_value}` : ''].filter(Boolean).join('  ');
          const val = req.actual !== null ? new Intl.NumberFormat('it-IT',{ maximumFractionDigits:2 }).format(req.actual) : 'N/D';
          return [req.kpi_label, `(${req.kpi_area})`, th, val,
            { content:passLabel(req.pass), styles:{ fillColor:passColorFill(req.pass), textColor:passColorText(req.pass), fontStyle:'bold', halign:'center' } }];
        }),
        margin: { left:14, right:14 },
        styles: { fontSize:7.5, cellPadding:2 },
        headStyles: { fillColor:[51,65,85] as [number,number,number], textColor:[255,255,255] as [number,number,number], fontSize:7.5, fontStyle:'bold' },
        columnStyles: { 0:{ cellWidth:60 }, 1:{ cellWidth:30, textColor:DGRAY }, 2:{ cellWidth:35, halign:'center' }, 3:{ cellWidth:30, halign:'right' }, 4:{ cellWidth:20, halign:'center' } },
        didParseCell(data) {
          if (data.section === 'body' && data.column.index === 4) {
            const cell = data.cell.raw as { styles?:{ fillColor?:[number,number,number]; textColor?:[number,number,number]; fontStyle?:string } } | string;
            if (typeof cell === 'object' && cell.styles?.fillColor) {
              data.cell.styles.fillColor = cell.styles.fillColor;
              data.cell.styles.textColor = cell.styles.textColor ?? [0,0,0];
              if (cell.styles.fontStyle) data.cell.styles.fontStyle = cell.styles.fontStyle as 'bold'|'normal';
            }
          }
        },
      });
      y = (doc as jsPDF & { lastAutoTable:{ finalY:number } }).lastAutoTable.finalY + 8;
    }
  }

  // footer pagine
  const tot = (doc as jsPDF & { internal:{ getNumberOfPages:()=>number } }).internal.getNumberOfPages();
  for (let i = 1; i <= tot; i++) {
    doc.setPage(i);
    doc.setFontSize(7); doc.setTextColor(148,163,184); doc.setFont('helvetica','normal');
    doc.text(`Credifile — Report riservato ad uso interno  |  Pagina ${i} di ${tot}`, W/2, 290, { align:'center' });
  }

  const safeName = (bilanci[0]?.ragione_sociale ?? 'azienda').replace(/[^a-zA-Z0-9_]/g,'_').substring(0,30);
  doc.save(`Bancabilita_${safeName}_${now.replace(/\//g,'-')}.pdf`);
}

// ── componente ──────────────────────────────────────────────────────────────
// ── BankLogo: mostra logo banca con fallback iniziali ───────────────────────
function BankLogo({ name, logoUrl, size = 'md' }: { name: string; logoUrl: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'w-5 h-5 text-[9px]' : size === 'lg' ? 'w-12 h-12 text-base' : 'w-8 h-8 text-xs';
  const initials = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  if (logoUrl) {
    return (
      <img
        src={logoUrl} alt={name}
        className={`${dim} object-contain rounded shrink-0`}
        onError={e => {
          const el = e.currentTarget;
          el.style.display = 'none';
          const fb = el.nextElementSibling as HTMLElement | null;
          if (fb) fb.style.display = 'flex';
        }}
      />
    );
  }
  return (
    <div className={`${dim} rounded bg-primary/10 text-primary font-bold flex items-center justify-center shrink-0`}>
      {initials}
    </div>
  );
}
// fallback span (reso visibile da onError)
function BankLogoWithFallback({ name, logoUrl, size = 'md' }: { name: string; logoUrl: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'w-5 h-5 text-[9px]' : size === 'lg' ? 'w-12 h-12 text-base' : 'w-8 h-8 text-xs';
  const initials = name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return (
    <div className={`relative ${dim} shrink-0`}>
      {logoUrl && (
        <img src={logoUrl} alt={name}
          className="w-full h-full object-contain rounded absolute inset-0"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      )}
      <div className={`${dim} rounded bg-primary/10 text-primary font-bold flex items-center justify-center`}
        style={{ visibility: logoUrl ? 'hidden' : 'visible' }}>
        {initials}
      </div>
    </div>
  );
}

export default function BancabilitaTab({ practiceId }: Props) {
  const [bilanci,   setBilanci]   = useState<BilancioRecord[]>([]);
  const [checks,    setChecks]    = useState<BancaCheck[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  // moduli
  const [moduli,         setModuli]         = useState<BankModulo[]>([]);
  const [compilati,      setCompilati]      = useState<CompilatoRecord[]>([]);
  const [uploadingComp,  setUploadingComp]  = useState<string | null>(null); // moduloId durante upload

  // ── carica TUTTE le banche con bancabilità ──────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      // bilancio più recente (può essere assente)
      const { data: kpiRows } = await supabase
        .from('bilanci_kpi')
        .select('id,anno_esercizio,ragione_sociale,is_holding,kpi,ricavi_vendite,utile_netto,created_at')
        .eq('practice_id', practiceId)
        .order('anno_esercizio', { ascending: false });
      const bil = (kpiRows ?? []) as BilancioRecord[];
      setBilanci(bil);
      const latestKpi: KpiResult | null = bil.length > 0 ? bil[0].kpi : null;

      // TUTTE le banche (nessun filtro attiva — include anche quelle con attiva=NULL)
      const { data: allBanks, error: banksErr } = await supabase
        .from('banks').select('id, nome, email, logo_url').order('nome');
      if (banksErr) { toast.error('Errore caricamento banche'); setChecks([]); return; }
      if (!allBanks || allBanks.length === 0) { setChecks([]); return; }

      const allIds = allBanks.map((b: { id: string }) => b.id);

      // banche già assegnate + requisiti KPI/ATECO + ATECO pratica
      const [
        { data: pbRows },
        { data: kpiReqRows },
        { data: atecoReqRows },
        { data: practiceRow },
        { data: moduliRows },
        { data: compilatiRows },
      ] = await Promise.all([
        supabase.from('practice_banks').select('id, bank_id').eq('practice_id', practiceId),
        supabase.from('bank_kpi_requirements').select('*').in('bank_id', allIds),
        supabase.from('bank_ateco_requirements').select('*').in('bank_id', allIds),
        supabase.from('practices').select('codice_ateco, clients(codice_ateco)').eq('id', practiceId).maybeSingle(),
        supabase.from('bank_moduli').select('*').in('bank_id', allIds),
        supabase.from('practice_moduli_compilati').select('*').eq('practice_id', practiceId),
      ]);

      const assignedMap = new Map((pbRows ?? []).map((r: { id: string; bank_id: string }) => [r.bank_id, r.id]));
      const reqs      = (kpiReqRows  ?? []) as BankKpiReq[];
      const atecoReqs = (atecoReqRows ?? []) as AtecoReq[];
      const practiceAteco = ((practiceRow?.codice_ateco) || (practiceRow?.clients as {codice_ateco?: string} | null)?.codice_ateco || '').toUpperCase().trim();
      setModuli((moduliRows ?? []) as BankModulo[]);
      setCompilati((compilatiRows ?? []) as CompilatoRecord[]);

      const built: BancaCheck[] = (allBanks as { id: string; nome: string; email?: string; logo_url?: string }[]).map(bank => {
        const logoUrl  = bank.logo_url || (bank.email ? `https://logo.clearbit.com/${bank.email.split('@')[1]}` : null);
        const bankReqs = reqs.filter(r => r.bank_id === bank.id);

        const enriched = bankReqs.map(req => {
          // 1. Valori assoluti di bilancio: sempre dalla colonna diretta (ricavi_vendite, utile_netto)
          //    Non dal JSON kpi (che potrebbe contenere 0 o essere assente per questi campi)
          let actual: number | null = null;
          const absCol = ABSOLUTE_KPI_KEYS[req.kpi_key];
          if (absCol && bil.length > 0) {
            actual = bil[0][absCol] ?? null;
          }
          // 2. KPI ratio standard: cerca nel JSON kpi solo se non è un valore assoluto
          if (actual === null) {
            const areaObj = latestKpi ? latestKpi[req.kpi_area] as Record<string, KpiEntry> | undefined : undefined;
            actual = areaObj?.[req.kpi_key]?.valore ?? null;
          }
          let pass: boolean | null = null;
          if (actual !== null) {
            pass = true;
            if (req.min_value !== null && actual < req.min_value) pass = false;
            if (req.max_value !== null && actual > req.max_value) pass = false;
          }
          return { ...req, actual, pass };
        });

        const inclusi = atecoReqs.filter(a => a.bank_id === bank.id && a.tipo === 'incluso');
        const esclusi = atecoReqs.filter(a => a.bank_id === bank.id && a.tipo === 'escluso');
        let atecoPass: boolean | null = null;
        if ((inclusi.length > 0 || esclusi.length > 0) && practiceAteco) {
          atecoPass = true;
          if (inclusi.length > 0 && !inclusi.some(a => practiceAteco.startsWith(a.codice.toUpperCase()))) atecoPass = false;
          if (atecoPass && esclusi.some(a => practiceAteco.startsWith(a.codice.toUpperCase()))) atecoPass = false;
        }

        return {
          bankId: bank.id, bankName: bank.nome, logoUrl,
          reqs: enriched,
          passCount: enriched.filter(e => e.pass === true).length,
          failCount: enriched.filter(e => e.pass === false).length,
          ndCount:   enriched.filter(e => e.pass === null).length,
          atecoPass, atecoInclusi: inclusi, atecoEsclusi: esclusi,
          isAssigned: assignedMap.has(bank.id),
          practiceBankId: assignedMap.get(bank.id),
        };
      });

      setChecks(built);
    } catch (err) {
      toast.error('Errore caricamento bancabilità: ' + String(err));
    } finally {
      setLoading(false);
    }
  }, [practiceId]);

  const assignBank = async (bankId: string) => {
    setAssigning(bankId);
    const { error } = await supabase.from('practice_banks')
      .insert({ practice_id: practiceId, bank_id: bankId, status: 'assegnata' });
    setAssigning(null);
    if (error) { toast.error('Errore assegnazione banca'); return; }
    toast.success('Banca assegnata alla pratica');
    load();
  };

  const downloadModuloTemplate = async (filePath: string, nome: string) => {
    const { data } = await supabase.storage.from('bank-moduli').createSignedUrl(filePath, 300);
    if (!data?.signedUrl) { toast.error('Impossibile scaricare il template'); return; }
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = nome; a.click();
  };

  const uploadCompilato = async (moduloId: string, file: File) => {
    setUploadingComp(moduloId);
    const ext  = file.name.split('.').pop() ?? 'pdf';
    const path = `${practiceId}/${moduloId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('practice-files').upload(path, file, { upsert: false });
    if (upErr) { toast.error('Errore upload: ' + upErr.message); setUploadingComp(null); return; }
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('practice_moduli_compilati').insert({
      practice_id: practiceId, modulo_id: moduloId,
      file_path: path, uploaded_by: user?.id ?? null,
    });
    toast.success('Modulo compilato caricato');
    setUploadingComp(null);
    load();
  };

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
      <RefreshCw className="w-4 h-4 animate-spin" /> Caricamento bancabilità...
    </div>
  );

  const latest = bilanci[0];
  const noBilancio = bilanci.length === 0;
  const noBanche   = checks.length === 0;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2 text-base">
            <ShieldCheck className="w-4 h-4 text-primary" /> Verifica Bancabilità
          </h3>
          {latest ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              Basato su bilancio <strong>{latest.anno_esercizio}</strong> · {latest.ragione_sociale}
              {latest.is_holding && <Badge variant="outline" className="ml-2 text-[10px] py-0">Holding</Badge>}
            </p>
          ) : (
            <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> Nessun bilancio analizzato — vai al tab "Analisi Finanziaria"
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Aggiorna
          </Button>
          {!noBilancio && (
            <Button size="sm" onClick={() => generatePdf(bilanci, checks, practiceId)}>
              <Download className="w-3.5 h-3.5 mr-1.5" /> Genera Report PDF
            </Button>
          )}
        </div>
      </div>

      {/* ── Banner bilancio mancante (non blocca le card) ── */}
      {noBilancio && checks.length > 0 && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <TrendingUp className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Nessun bilancio analizzato — i KPI non sono verificabili. Puoi comunque assegnare una banca. Vai al tab <strong>Analisi Finanziaria</strong> per calcolare i KPI.</span>
        </div>
      )}

      {/* ── Indice di Bancabilità globale ── */}
      <IndiceBancabilita latestKpi={latest?.kpi ?? null} practiceId={practiceId} />

      {noBanche && (
        <div className="py-10 text-center border rounded-xl bg-muted/30">
          <ShieldCheck className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-40" />
          <p className="font-medium">Nessuna banca configurata nel sistema</p>
          <p className="text-sm text-muted-foreground mt-1">Aggiungi banche in <strong>Gestione Banche</strong>.</p>
        </div>
      )}

      {/* ── Strip: banche presentabili ── */}
      {checks.length > 0 && (() => {
        // presentabile = nessun KO su KPI E ateco non bloccato
        // (banche senza requisiti = nessuna restrizione = ammesse)
        const presentabili = noBilancio
          ? checks.filter(b => b.atecoPass !== false)
          : checks.filter(b => b.failCount === 0 && b.ndCount === 0 && b.atecoPass !== false);
        const parziali = noBilancio
          ? []
          : checks.filter(b => b.failCount === 0 && b.ndCount > 0 && b.atecoPass !== false);
        const nonPres = checks.filter(b => b.failCount > 0 || b.atecoPass === false);
        return (
          <div className="rounded-xl border-2 border-green-200 bg-green-50 p-4">
            <p className="text-xs font-semibold text-green-800 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Pratica presentabile a
            </p>
            {noBilancio && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1 mb-2 flex items-center gap-1.5">
                <span>⚠️</span> KPI non verificati — analizza prima un bilancio nel tab "Analisi Finanziaria"
              </p>
            )}
            {presentabili.length === 0 ? (
              <p className="text-sm text-green-700 italic">Nessuna banca soddisfa tutti i requisiti KPI configurati.</p>
            ) : (
              <div className="flex flex-wrap gap-3 items-center">
                {presentabili.map(b => (
                  <div key={b.bankId} className="flex items-center gap-2 bg-white rounded-lg border border-green-200 px-3 py-2 shadow-sm">
                    <BankLogo name={b.bankName} logoUrl={b.logoUrl} size="md" />
                    <span className="text-sm font-semibold text-green-900">{b.bankName}</span>
                    <span className="text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full font-medium">{b.passCount}/{b.reqs.length} OK</span>
                  </div>
                ))}
              </div>
            )}
            {(parziali.length > 0 || nonPres.length > 0) && (
              <div className="mt-3 pt-3 border-t border-green-200 flex flex-wrap gap-2">
                {parziali.map(b => (
                  <div key={b.bankId} className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                    <BankLogo name={b.bankName} logoUrl={b.logoUrl} size="sm" />
                    <span>{b.bankName}</span>
                    <span className="opacity-70">⚠️ {b.ndCount} N/D</span>
                  </div>
                ))}
                {nonPres.map(b => (
                  <div key={b.bankId} className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-lg">
                    <BankLogo name={b.bankName} logoUrl={b.logoUrl} size="sm" />
                    <span>{b.bankName}</span>
                    <span className="opacity-70">❌ {b.failCount} KO</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Cards banche (visione immediata) ── */}
      {checks.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {checks.map(banca => {
              const total   = banca.reqs.length;
              const allPass = total > 0 && banca.failCount === 0 && banca.ndCount === 0;
              const hasFail = banca.failCount > 0;
              const noReqs  = total === 0;

              const cardCls = noReqs
                ? 'border-gray-200 bg-gray-50'
                : allPass  ? 'border-green-300 bg-green-50'
                : hasFail  ? 'border-red-300 bg-red-50'
                : 'border-amber-300 bg-amber-50';

              const iconBg = noReqs
                ? 'bg-gray-100 text-gray-400'
                : allPass  ? 'bg-green-100 text-green-600'
                : hasFail  ? 'bg-red-100 text-red-600'
                : 'bg-amber-100 text-amber-600';

              const statusText = noReqs
                ? 'Nessun requisito KPI'
                : allPass  ? 'Bancabile ✅'
                : hasFail  ? 'Non bancabile ❌'
                : 'Dati incompleti ⚠️';

              const statusColor = noReqs
                ? 'text-gray-500'
                : allPass  ? 'text-green-700 font-semibold'
                : hasFail  ? 'text-red-700 font-semibold'
                : 'text-amber-700 font-semibold';

              const isOpen = expanded === banca.bankId;

              return (
                <Card key={banca.bankId} className={`border-2 transition-shadow hover:shadow-sm ${cardCls}`}>
                  <CardContent className="p-4">
                    {/* Card header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border ${iconBg}`}>
                        <BankLogoWithFallback name={banca.bankName} logoUrl={banca.logoUrl} size="md" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-foreground text-sm truncate">{banca.bankName}</p>
                        <p className={`text-xs mt-0.5 ${statusColor}`}>{statusText}</p>
                      </div>
                    </div>

                    {/* Contatori KPI */}
                    {total > 0 && (
                      <div className="flex gap-3 mt-3 text-xs">
                        <span className="flex items-center gap-1 text-green-700"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{banca.passCount} OK</span>
                        <span className="flex items-center gap-1 text-red-700"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{banca.failCount} KO</span>
                        {banca.ndCount > 0 && <span className="flex items-center gap-1 text-gray-500"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block" />{banca.ndCount} N/D</span>}
                        <span className="text-muted-foreground ml-auto">{total} KPI</span>
                      </div>
                    )}

                    {/* Badge ATECO */}
                    {(banca.atecoInclusi.length > 0 || banca.atecoEsclusi.length > 0) && (
                      <div className={`mt-2 flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border ${
                        banca.atecoPass === true  ? 'bg-green-50 border-green-200 text-green-800' :
                        banca.atecoPass === false ? 'bg-red-50 border-red-200 text-red-800' :
                        'bg-amber-50 border-amber-200 text-amber-800'
                      }`}>
                        <span className="font-bold">ATECO</span>
                        <span>{banca.atecoPass === true ? '✅ compatibile' : banca.atecoPass === false ? '❌ non compatibile' : '— codice pratica mancante'}</span>
                        <span className="ml-auto text-muted-foreground">
                          {banca.atecoInclusi.length > 0 && `+${banca.atecoInclusi.map(a => a.codice).join(', ')}`}
                          {banca.atecoEsclusi.length > 0 && ` −${banca.atecoEsclusi.map(a => a.codice).join(', ')}`}
                        </span>
                      </div>
                    )}

                    {/* Moduli da compilare per questa banca */}
                    {(() => {
                      const bancaModuli = moduli.filter(m => m.bank_id === banca.bankId);
                      if (bancaModuli.length === 0) return null;
                      return (
                        <div className="mt-3 border border-dashed border-primary/30 rounded-lg p-3 bg-primary/5 space-y-2">
                          <p className="text-[10px] font-semibold text-primary/70 uppercase tracking-wider flex items-center gap-1">
                            <FileText className="w-3 h-3" /> Moduli richiesti dalla banca
                          </p>
                          {bancaModuli.map(m => {
                            const mCompilati = compilati.filter(c => c.modulo_id === m.id);
                            return (
                              <div key={m.id} className="bg-white rounded-md p-2 border border-border/50 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <FileText className="w-3.5 h-3.5 text-primary shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium truncate">{m.nome}</p>
                                    {m.descrizione && <p className="text-[10px] text-muted-foreground truncate">{m.descrizione}</p>}
                                  </div>
                                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] gap-1 text-primary shrink-0"
                                    onClick={() => downloadModuloTemplate(m.file_path, m.nome)}>
                                    <FileDown className="w-3 h-3" /> Template
                                  </Button>
                                </div>
                                {mCompilati.length > 0 && (
                                  <div className="pl-5 space-y-1">
                                    {mCompilati.map(c => (
                                      <p key={c.id} className="text-[10px] text-green-700 flex items-center gap-1">
                                        ✅ Caricato il {new Date(c.uploaded_at).toLocaleDateString('it-IT')}
                                      </p>
                                    ))}
                                  </div>
                                )}
                                <div className="pl-5">
                                  <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-primary hover:underline">
                                    {uploadingComp === m.id
                                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Caricamento...</>
                                      : <><Upload className="w-3 h-3" /> {mCompilati.length > 0 ? 'Carica nuova versione' : 'Carica compilato'}</>
                                    }
                                    <input type="file" accept=".pdf,.doc,.docx,.odt" className="hidden"
                                      disabled={uploadingComp === m.id}
                                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadCompilato(m.id, f); e.target.value = ''; }} />
                                  </label>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Bottone dettaglio / Assegna */}
                    <div className="mt-3 flex gap-2">
                      {banca.isAssigned ? (
                        <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full font-medium flex items-center gap-1">
                          ✅ Assegnata
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 flex-1"
                          disabled={assigning === banca.bankId}
                          onClick={() => assignBank(banca.bankId)}>
                          {assigning === banca.bankId ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                          Assegna
                        </Button>
                      )}
                      {total > 0 && (
                        <button
                          className="flex-1 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 border border-dashed border-current rounded-md"
                          onClick={() => setExpanded(isOpen ? null : banca.bankId)}>
                          {isOpen ? <><ChevronUp className="w-3.5 h-3.5" /> Nascondi</> : <><ChevronDown className="w-3.5 h-3.5" /> KPI</>}
                        </button>
                      )}
                    </div>
                  </CardContent>

                  {/* Dettaglio espanso — lista KPI rispettati e non */}
                  {isOpen && total > 0 && (
                    <div className="border-t border-current/20 bg-white/60 px-4 pb-3 pt-2 rounded-b-lg">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-border/50">
                            <th className="text-left py-1.5 font-medium">KPI</th>
                            <th className="text-center py-1.5 font-medium">Soglia</th>
                            <th className="text-right py-1.5 font-medium">Valore</th>
                            <th className="text-center py-1.5 font-medium">Esito</th>
                          </tr>
                        </thead>
                        <tbody>
                          {banca.reqs.map(req => {
                            const minS = req.min_value !== null ? `≥${req.min_value}` : '';
                            const maxS = req.max_value !== null ? `≤${req.max_value}` : '';
                            const thr  = [minS, maxS].filter(Boolean).join(' ');
                            const valS = req.actual !== null
                              ? new Intl.NumberFormat('it-IT',{ maximumFractionDigits:2 }).format(req.actual)
                              : 'N/D';
                            const esitoCls = req.pass === true
                              ? 'bg-green-100 text-green-800'
                              : req.pass === false ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-500';
                            return (
                              <tr key={req.id} className="border-b border-border/30 last:border-0">
                                <td className="py-1.5 pr-2 font-medium text-foreground">{req.kpi_label}</td>
                                <td className="py-1.5 text-center text-muted-foreground font-mono">{thr || '—'}</td>
                                <td className="py-1.5 text-right font-mono tabular-nums">{valS}</td>
                                <td className="py-1.5 text-center">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${esitoCls}`}>
                                    {passLabel(req.pass)}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
