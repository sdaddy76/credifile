import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  BalanceAnomalyAnalysis,
  BalanceAnomalyFinding,
} from '../../supabase/functions/_shared/balance-anomaly-engine';

export type { BalanceAnomalyAnalysis, BalanceAnomalyFinding };

export interface KpiScore {
  kpi_key: string; kpi_label: string; kpi_area: string;
  valore: number | null; formatted: string; score: number | null;
  benchmark: number | null; benchmark_formatted: string;
  benchmark_key?: string;
  peso?: number;
  inverso: boolean;
}
export interface AiSuggerimento {
  kpi_key: string; kpi_label: string;
  diagnosi: string; azioni: string[]; impatto_atteso: string;
}
export interface FinanziamentoItem {
  istituto: string;
  tipo: string;
  importo_residuo: number;
  rata_mensile?: number | null;
  scadenza?: string | null;
  fonte: string;
}
export interface ReportData {
  // campi già esistenti
  ragione_sociale: string; partita_iva?: string; codice_ateco?: string;
  settore?: string; indirizzo?: string;
  anno_bilancio: number;
  indice_bancabilita: number | null;
  kpi_scores: KpiScore[];
  top3: KpiScore[]; bottom3: KpiScore[];
  ai_suggerimenti: AiSuggerimento[];
  consulente_nome: string; consulente_email?: string;
  consulente_logo_url?: string | null;
  // NUOVI — tutti opzionali per retrocompatibilità
  credifile_logo_url?: string | null;
  settore_label?: string;
  benchmark_settore?: Record<string, number | null>;
  benchmark_aggiornato_il?: string;
  commento_settore?: string;
  finanziamenti?: FinanziamentoItem[];
  rating_bancabile?: 'bancabile' | 'attenzione' | 'non_bancabile';
  motivi_rating?: string[];
  kpi_disponibili?: number;
  kpi_totali?: number;
  dscr_metodo?: 'finanziamenti' | 'approssimato';
  servizio_debito_annuo?: number;
  anomaly_analysis?: BalanceAnomalyAnalysis | null;
}

// ── Colori ─────────────────────────────────────────────────────────────────
type n = number;
const TEAL:  [n,n,n] = [15, 118, 110];
const DARK:  [n,n,n] = [30,  41,  59];
const GRAY:  [n,n,n] = [100,116,139];
const WHITE: [n,n,n] = [255,255,255];
const GREEN: [n,n,n] = [22, 163,  74];
const RED:   [n,n,n] = [220,  38,  38];
const AMBER: [n,n,n] = [217,119,   6];
const LIGHT: [n,n,n] = [241,245,249];

function ratingInfo(score: number): { label: string; color: [n,n,n] } {
  if (score >= 85) return { label: 'Eccellente',    color: GREEN };
  if (score >= 70) return { label: 'Buono',         color: [22,101,52]   as [n,n,n] };
  if (score >= 55) return { label: 'Sufficiente',   color: AMBER };
  if (score >= 40) return { label: 'Critico',       color: [234,88,12]   as [n,n,n] };
  return               { label: 'Non bancabile', color: RED };
}

function barColor(score: number): [n,n,n] {
  if (score >= 85) return GREEN;
  if (score >= 70) return [34,197,94] as [n,n,n];
  if (score >= 55) return AMBER;
  if (score >= 40) return [249,115,22] as [n,n,n];
  return RED;
}

function ratingBancabileInfo(r?: 'bancabile' | 'attenzione' | 'non_bancabile' | null): { label: string; color: [n,n,n]; bg: [n,n,n] } {
  if (r === 'bancabile')    return { label: 'BANCABILE',    color: GREEN,        bg: [220,252,231] as [n,n,n] };
  if (r === 'attenzione')   return { label: 'ATTENZIONE',   color: [146,64,14]   as [n,n,n], bg: [254,243,199] as [n,n,n] };
  if (r === 'non_bancabile')return { label: 'NON BANCABILE', color: [185,28,28]  as [n,n,n], bg: [254,226,226] as [n,n,n] };
  return                           { label: 'N/D',           color: GRAY,         bg: LIGHT };
}

function anomalyLevelInfo(level?: BalanceAnomalyAnalysis['level'] | null): { label: string; color: [n,n,n]; bg: [n,n,n] } {
  if (level === 'critico') return { label: 'CRITICO', color: RED, bg: [254,226,226] as [n,n,n] };
  if (level === 'elevato') return { label: 'ELEVATO', color: [194,65,12] as [n,n,n], bg: [255,237,213] as [n,n,n] };
  if (level === 'attenzione') return { label: 'ATTENZIONE', color: AMBER, bg: [254,243,199] as [n,n,n] };
  return { label: 'BASSO', color: GREEN, bg: [220,252,231] as [n,n,n] };
}

// Carica immagine da URL come base64
async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

function fmtEur(v: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}

export async function generateReportPdf(data: ReportData): Promise<{ pdfBlob: Blob; base64: string }> {
  const doc   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W     = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 0;

  // ── HELPERS ─────────────────────────────────────────────────────────────
  const checkPage = (needed: number) => {
    if (y + needed > pageH - 18) { doc.addPage(); y = 18; }
  };

  const sectionTitle = (title: string, icon?: string) => {
    checkPage(16);
    doc.setFillColor(...TEAL);
    doc.rect(14, y, W - 28, 8, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold');
    doc.text((icon ? icon + '  ' : '') + title.toUpperCase(), 18, y + 5.5);
    y += 12;
    doc.setTextColor(...DARK);
  };

  const drawHorizontalBar = (x: number, barY: number, barW: number, barH: number, pct: number, color: [n,n,n]) => {
    doc.setFillColor(225, 225, 225);
    doc.roundedRect(x, barY, barW, barH, 1, 1, 'F');
    if (pct > 0) {
      doc.setFillColor(...color);
      doc.roundedRect(x, barY, barW * Math.min(1, pct), barH, 1, 1, 'F');
    }
  };

  const addFooter = (pageNum: number, totalPages: number) => {
    doc.setFillColor(...LIGHT);
    doc.rect(0, pageH - 12, W, 12, 'F');
    doc.setTextColor(...GRAY); doc.setFontSize(7); doc.setFont('helvetica', 'normal');
    doc.text(`Credifile — Report Bancabilità | ${data.consulente_nome}`, 14, pageH - 4.5);
    doc.text('Riservato e Confidenziale', W / 2, pageH - 4.5, { align: 'center' });
    doc.text(`Pagina ${pageNum} di ${totalPages}`, W - 14, pageH - 4.5, { align: 'right' });
  };

  // ── Carica loghi ───────────────────────────────────────────────────────
  const [consulenteLogo, credifileLogo] = await Promise.all([
    data.consulente_logo_url ? loadImageAsBase64(data.consulente_logo_url) : Promise.resolve(null),
    loadImageAsBase64(data.credifile_logo_url ?? 'https://credifile-eosin.vercel.app/logo.png'),
  ]);

  // ══════════════════════════════════════════════════════════════════════
  // PAGINA 1 — COPERTINA
  // ══════════════════════════════════════════════════════════════════════

  // Banner teal h=48mm
  doc.setFillColor(...TEAL);
  doc.rect(0, 0, W, 48, 'F');

  // Logo Credifile a sinistra
  if (credifileLogo) {
    try { doc.addImage(credifileLogo, 'PNG', 12, 10, 28, 28); } catch { /* ignora */ }
  } else {
    doc.setTextColor(...WHITE); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text('CREDIFILE', 14, 26);
  }

  // Testo centrato
  doc.setTextColor(...WHITE);
  doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text('REPORT DI BANCABILITÀ', W / 2, 18, { align: 'center' });
  doc.setFontSize(11); doc.setFont('helvetica', 'normal');
  doc.text(data.ragione_sociale, W / 2, 28, { align: 'center' });
  doc.setFontSize(8.5);
  doc.text(`Bilancio ${data.anno_bilancio}  ·  ${new Date().toLocaleDateString('it-IT')}`, W / 2, 35, { align: 'center' });

  // Logo consulente a destra
  if (consulenteLogo) {
    try { doc.addImage(consulenteLogo, 'PNG', W - 42, 10, 28, 28); } catch { /* ignora */ }
  }

  y = 56;

  // Box dati societari
  doc.setFillColor(...LIGHT);
  doc.roundedRect(14, y, W - 28, 28, 2, 2, 'F');
  doc.setTextColor(...DARK); doc.setFontSize(12); doc.setFont('helvetica', 'bold');
  doc.text(data.ragione_sociale, 19, y + 8);
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY);
  const infoLine = [
    data.partita_iva  ? `P.IVA: ${data.partita_iva}`   : null,
    data.codice_ateco ? `ATECO: ${data.codice_ateco}`   : null,
    data.settore_label ?? data.settore ?? null,
  ].filter(Boolean).join('   ·   ');
  doc.text(infoLine, 19, y + 15);
  if (data.indirizzo) doc.text(data.indirizzo, 19, y + 21);

  // Box consulente (destra)
  doc.setTextColor(DARK[0], DARK[1], DARK[2]);
  doc.setFontSize(8); doc.setFont('helvetica', 'bold');
  doc.text('Consulente', W - 15, y + 8, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  doc.text(data.consulente_nome, W - 15, y + 14, { align: 'right' });
  if (data.consulente_email) doc.text(data.consulente_email, W - 15, y + 20, { align: 'right' });

  y += 34;

  // ── Gauge indice bancabilità ─────────────────────────────────────────
  if (data.indice_bancabilita !== null) {
    const score = data.indice_bancabilita;
    const { label, color } = ratingInfo(score);

    const cx = W / 2, cy = y + 22;
    // Cerchio esterno grigio
    doc.setDrawColor(220, 220, 220); doc.setLineWidth(4);
    doc.circle(cx, cy, 22);
    // Cerchio colorato interno
    doc.setDrawColor(...color); doc.setLineWidth(4);
    doc.circle(cx, cy, 19);
    // Numero
    doc.setTextColor(...color); doc.setFontSize(26); doc.setFont('helvetica', 'black');
    doc.text(String(Math.round(score)), cx, cy + 5, { align: 'center' });
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text('/100', cx, cy + 12, { align: 'center' });

    y += 50;

    // Label rating
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...color);
    doc.text(`${label.toUpperCase()} — ${Math.round(score)}/100`, W / 2, y, { align: 'center' });
    y += 6;

    if (data.kpi_totali) {
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY);
      doc.text(
        `Indice ponderato calcolato su ${data.kpi_disponibili ?? data.kpi_scores.length}/${data.kpi_totali} KPI disponibili`,
        W / 2,
        y,
        { align: 'center' },
      );
      y += 5;
    }

    // Barra soglie
    const barX = 24; const barW = W - 48; const barH = 5;
    doc.setFillColor(230, 230, 230);
    doc.roundedRect(barX, y, barW, barH, 2, 2, 'F');
    doc.setFillColor(...barColor(score));
    doc.roundedRect(barX, y, barW * (score / 100), barH, 2, 2, 'F');
    doc.setFontSize(6); doc.setTextColor(...GRAY);
    for (const [pct, lbl] of [[0,'0'],[40,'40'],[55,'55'],[70,'70'],[85,'85'],[100,'100']]) {
      const px = barX + barW * (Number(pct) / 100);
      doc.setDrawColor(180,180,180); doc.setLineWidth(0.3);
      doc.line(px, y - 1, px, y + barH + 1);
      doc.text(String(lbl), px, y + barH + 4, { align: 'center' });
    }
    y += 14;
  }

  // ── Box situazione bancabile ─────────────────────────────────────────
  const rbInfo = ratingBancabileInfo(data.rating_bancabile);
  checkPage(22);
  doc.setFillColor(...rbInfo.bg);
  doc.roundedRect(14, y, W - 28, data.motivi_rating?.length ? 18 + data.motivi_rating.length * 5 : 14, 2, 2, 'F');
  doc.setDrawColor(...rbInfo.color); doc.setLineWidth(0.8);
  doc.roundedRect(14, y, W - 28, data.motivi_rating?.length ? 18 + data.motivi_rating.length * 5 : 14, 2, 2, 'S');
  doc.setTextColor(...rbInfo.color); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
  doc.text(`Profilo ${rbInfo.label}`, 19, y + 7);
  if (data.indice_bancabilita !== null) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text(`La società presenta un profilo ${rbInfo.label} con score ${Math.round(data.indice_bancabilita)}/100.`, 19, y + 13);
  }
  if (data.motivi_rating?.length) {
    let my = y + 18;
    doc.setFontSize(8); doc.setTextColor(...rbInfo.color);
    for (const m of data.motivi_rating) {
      doc.text(`• ${m}`, 22, my); my += 5;
    }
  }
  y += (data.motivi_rating?.length ? 22 + data.motivi_rating.length * 5 : 18);

  // ══════════════════════════════════════════════════════════════════════
  // PAGINA 2 — ANALISI KPI vs BENCHMARK SETTORE
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage(); y = 18;

  const settLabel = data.settore_label ?? data.settore ?? 'Media PMI Italiane';
  const benchDate = data.benchmark_aggiornato_il
    ? new Date(data.benchmark_aggiornato_il).toLocaleDateString('it-IT')
    : new Date().toLocaleDateString('it-IT');

  sectionTitle(`Confronto KPI — ${settLabel}`, '📊');

  doc.setFontSize(7.5); doc.setTextColor(...GRAY); doc.setFont('helvetica', 'italic');
  doc.text(`Fonte: Mediobanca / Banca d'Italia — benchmark aggiornati al ${benchDate}`, 14, y);
  y += 7;

  // Tabella KPI completa con confronto benchmark settore
  const kpiRows = data.kpi_scores.map(k => {
    const sc        = k.score ?? null;
    const scLabel   = sc === null ? 'N/D' : sc >= 70 ? '🟢 OK' : sc >= 40 ? '🟡 Att.' : '🔴 Crit.';
    const benchVal  = data.benchmark_settore?.[k.benchmark_key ?? k.kpi_label] ?? k.benchmark;
    const delta     = (benchVal !== null && benchVal !== undefined && k.valore !== null)
      ? (k.inverso ? benchVal - k.valore : k.valore - benchVal)
      : null;
    const deltaStr  = delta !== null
      ? (delta >= 0 ? `+${Math.abs(delta) >= 100 ? delta.toFixed(0) : delta.toFixed(2)}` : `${Math.abs(delta) >= 100 ? delta.toFixed(0) : delta.toFixed(2)}`)
      : '—';
    const benchFmt  = benchVal !== null && benchVal !== undefined
      ? (Math.abs(benchVal) >= 100 ? benchVal.toFixed(0) : benchVal.toFixed(2))
      : '—';
    return [
      k.kpi_label,
      k.kpi_area,
      k.formatted,
      benchFmt,
      delta !== null ? deltaStr : '—',
      sc !== null ? `${Math.round(sc)}/100` : 'N/D',
      { content: scLabel, styles: {
        fillColor: sc !== null ? (sc >= 70 ? [220,252,231] : sc >= 40 ? [254,243,199] : [254,226,226]) : [241,245,249],
        textColor: sc !== null ? (sc >= 70 ? [22,101,52]  : sc >= 40 ? [146,64,14]   : [185,28,28])  : [100,116,139],
        fontStyle: 'bold', cellPadding: 2,
      }},
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['KPI', 'Area', 'Valore Azienda', 'Benchmark', 'Scostamento', 'Score', 'Semaforo']],
    body: kpiRows as Parameters<typeof autoTable>[1]['body'],
    headStyles: { fillColor: TEAL, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 },
    bodyStyles: { fontSize: 7.5, textColor: DARK },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 38 },
      1: { cellWidth: 22, textColor: GRAY },
      2: { halign: 'right', cellWidth: 26 },
      3: { halign: 'right', cellWidth: 20 },
      4: { halign: 'right', cellWidth: 22 },
      5: { halign: 'center', cellWidth: 16 },
      6: { halign: 'center', cellWidth: 20 },
    },
    margin: { left: 14, right: 14 },
    theme: 'striped',
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  // Barre KPI visive (progress orizzontali)
  checkPage(16);
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...DARK);
  doc.text('Visualizzazione score KPI:', 14, y); y += 5;
  for (const k of data.kpi_scores.filter(kk => kk.score !== null)) {
    checkPage(8);
    doc.setFontSize(6.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...DARK);
    doc.text(k.kpi_label.substring(0, 18), 14, y + 3);
    drawHorizontalBar(60, y, W - 80, 4, (k.score ?? 0) / 100, barColor(k.score ?? 0));
    doc.setTextColor(...GRAY);
    doc.text(`${k.score}/100`, W - 16, y + 3, { align: 'right' });
    y += 6;
  }

  // Legenda
  checkPage(12);
  y += 3;
  doc.setFontSize(7); doc.setTextColor(...GRAY); doc.setFont('helvetica', 'italic');
  doc.text('Legenda: 🟢 ≥ 70 OK  |  🟡 40-69 Attenzione  |  🔴 < 40 Critico', 14, y);
  y += 8;

  // ══════════════════════════════════════════════════════════════════════
  // PAGINA 3 — CONTESTO SETTORE + TOP3 / BOTTOM3
  // ══════════════════════════════════════════════════════════════════════
  doc.addPage(); y = 18;

  sectionTitle('Contesto di Settore', '🌐');

  if (data.commento_settore) {
    const lines = doc.splitTextToSize(data.commento_settore, W - 32) as string[];
    doc.setTextColor(...DARK); doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
    doc.text(lines, 16, y); y += lines.length * 4.5 + 4;
  } else {
    doc.setTextColor(...GRAY); doc.setFontSize(8.5); doc.setFont('helvetica', 'italic');
    const fallbackText = `Il settore ${settLabel} per le PMI italiane mostra caratteristiche di mercato in evoluzione. I dati benchmark sono elaborati su base statistica da fonti Mediobanca e Banca d'Italia.`;
    const lines = doc.splitTextToSize(fallbackText, W - 32) as string[];
    doc.text(lines, 16, y); y += lines.length * 4.5 + 4;
  }

  doc.setFontSize(7); doc.setTextColor(...GRAY); doc.setFont('helvetica', 'italic');
  doc.text(`Dati Mediobanca / Banca d'Italia — aggiornati al ${benchDate}`, 14, y);
  y += 10;

  // ── Top 3 / Bottom 3 ─────────────────────────────────────────────────
  sectionTitle('Sintesi: Migliori e Peggiori Indicatori', '📋');

  const colW = (W - 34) / 2;
  const rightX = 14 + colW + 6;

  // Titoli colonne
  doc.setFillColor(220, 252, 231);
  doc.roundedRect(14, y, colW, 8, 2, 2, 'F');
  doc.setTextColor(22, 101, 52); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('✅  TOP 3 — Punti di Forza', 19, y + 5.5);

  doc.setFillColor(254, 226, 226);
  doc.roundedRect(rightX, y, colW, 8, 2, 2, 'F');
  doc.setTextColor(185, 28, 28); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('⚠  BOTTOM 3 — Aree Critiche', rightX + 4, y + 5.5);
  y += 10;

  const maxRows = Math.max(data.top3.length, data.bottom3.length);
  for (let i = 0; i < maxRows; i++) {
    checkPage(10);
    const rowH = 8;

    if (data.top3[i]) {
      const k = data.top3[i];
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(14, y, colW, rowH, 1, 1, 'F');
      doc.setTextColor(22, 101, 52); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      doc.text(k.kpi_label, 18, y + 3.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text(`${k.formatted}  ·  Score: ${k.score}/100`, 18, y + 6.5);
      const scoreW = colW - 10;
      drawHorizontalBar(18, y + rowH - 1.5, scoreW - 8, 2, (k.score ?? 0) / 100, GREEN);
    }

    if (data.bottom3[i]) {
      const k = data.bottom3[i];
      doc.setFillColor(255, 241, 242);
      doc.roundedRect(rightX, y, colW, rowH, 1, 1, 'F');
      doc.setTextColor(185, 28, 28); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
      doc.text(k.kpi_label, rightX + 4, y + 3.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
      doc.text(`${k.formatted}  ·  Score: ${k.score}/100`, rightX + 4, y + 6.5);
      drawHorizontalBar(rightX + 4, y + rowH - 1.5, colW - 10, 2, (k.score ?? 0) / 100, RED);
    }
    y += rowH + 2;
  }
  y += 6;

  // ══════════════════════════════════════════════════════════════════════
  // ANALISI ANOMALIE E POSTE DA VERIFICARE
  // ══════════════════════════════════════════════════════════════════════
  if (data.anomaly_analysis) {
    const analysis = data.anomaly_analysis;
    const anomalyInfo = anomalyLevelInfo(analysis.level);
    doc.addPage(); y = 18;

    sectionTitle('Anomalie di Bilancio da Approfondire', '🔎');

    doc.setFillColor(...anomalyInfo.bg);
    doc.setDrawColor(...anomalyInfo.color);
    doc.roundedRect(14, y, W - 28, 18, 2, 2, 'FD');
    doc.setTextColor(...anomalyInfo.color); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(`Livello ${anomalyInfo.label} — score anomalie ${analysis.score}/100`, 19, y + 7);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(
      `${analysis.findings.length} segnalazioni · motore ${analysis.engine_version}` +
      (analysis.comparison_year ? ` · confronto con ${analysis.comparison_year}` : ''),
      19,
      y + 13,
    );
    y += 24;

    if (analysis.findings.length === 0) {
      doc.setFillColor(240, 253, 244);
      doc.roundedRect(14, y, W - 28, 16, 2, 2, 'F');
      doc.setTextColor(22, 101, 52); doc.setFontSize(8.5);
      doc.text('Nessuna anomalia significativa rilevata dai controlli automatici disponibili.', 19, y + 7);
      doc.text('Resta necessaria la normale verifica professionale della documentazione.', 19, y + 12);
      y += 22;
    } else {
      const anomalyRows = analysis.findings.map(finding => [
        finding.severity.toUpperCase(),
        finding.category.replace(/_/g, ' '),
        finding.title,
        finding.evidence.join(' · '),
        finding.recommended_checks[0] ?? 'Approfondire la documentazione',
      ]);
      autoTable(doc, {
        startY: y,
        head: [['Gravità', 'Categoria', 'Segnalazione', 'Evidenza', 'Prima verifica']],
        body: anomalyRows,
        headStyles: { fillColor: TEAL, textColor: WHITE, fontStyle: 'bold', fontSize: 7 },
        bodyStyles: { fontSize: 6.8, textColor: DARK, cellPadding: 1.7, overflow: 'linebreak' },
        columnStyles: {
          0: { cellWidth: 16, fontStyle: 'bold' },
          1: { cellWidth: 27 },
          2: { cellWidth: 39, fontStyle: 'bold' },
          3: { cellWidth: 58 },
          4: { cellWidth: 42 },
        },
        margin: { left: 14, right: 14 },
        theme: 'striped',
        didParseCell(hook) {
          if (hook.section !== 'body' || hook.column.index !== 0) return;
          const severity = String(hook.cell.raw).toLowerCase();
          if (severity === 'alta') {
            hook.cell.styles.fillColor = [254,226,226];
            hook.cell.styles.textColor = [185,28,28];
          } else if (severity === 'media') {
            hook.cell.styles.fillColor = [254,243,199];
            hook.cell.styles.textColor = [146,64,14];
          } else {
            hook.cell.styles.fillColor = [241,245,249];
            hook.cell.styles.textColor = [71,85,105];
          }
        },
      });
      y = (doc as any).lastAutoTable.finalY + 8;

      for (const finding of analysis.findings.filter(item => item.severity !== 'bassa').slice(0, 8)) {
        checkPage(34);
        const info = finding.severity === 'alta'
          ? { color: RED, bg: [254,226,226] as [n,n,n] }
          : { color: AMBER, bg: [254,243,199] as [n,n,n] };
        doc.setFillColor(...info.bg);
        doc.roundedRect(14, y, W - 28, 7, 1, 1, 'F');
        doc.setTextColor(...info.color); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        doc.text(`${finding.severity.toUpperCase()} · ${finding.title}`, 18, y + 4.8);
        y += 10;

        doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
        const explanation = doc.splitTextToSize(finding.explanation, W - 34) as string[];
        doc.text(explanation, 17, y);
        y += explanation.length * 4 + 2;

        const alternatives = `Possibili spiegazioni: ${finding.possible_explanations.join('; ')}.`;
        const alternativeLines = doc.splitTextToSize(alternatives, W - 34) as string[];
        doc.setTextColor(...GRAY); doc.setFont('helvetica', 'italic');
        doc.text(alternativeLines, 17, y);
        y += alternativeLines.length * 4 + 2;

        const checks = `Verifiche: ${finding.recommended_checks.join('; ')}.`;
        const checkLines = doc.splitTextToSize(checks, W - 34) as string[];
        doc.setTextColor(...DARK); doc.setFont('helvetica', 'normal');
        doc.text(checkLines, 17, y);
        y += checkLines.length * 4 + 5;
      }
    }

    checkPage(28);
    doc.setFillColor(...LIGHT);
    const disclaimerLines = doc.splitTextToSize(analysis.disclaimer, W - 38) as string[];
    const disclaimerHeight = Math.max(18, disclaimerLines.length * 4 + 8);
    doc.roundedRect(14, y, W - 28, disclaimerHeight, 2, 2, 'F');
    doc.setTextColor(...GRAY); doc.setFont('helvetica', 'italic'); doc.setFontSize(7);
    doc.text(disclaimerLines, 19, y + 6);
    y += disclaimerHeight + 6;
  }

  // ══════════════════════════════════════════════════════════════════════
  // PAGINA 4 — FINANZIAMENTI IN ESSERE (solo se presenti)
  // ══════════════════════════════════════════════════════════════════════
  if (data.finanziamenti && data.finanziamenti.length > 0) {
    doc.addPage(); y = 18;

    sectionTitle('Finanziamenti in Essere', '🏦');

    const fRows = data.finanziamenti.map(f => [
      f.istituto,
      f.tipo,
      fmtEur(f.importo_residuo),
      f.rata_mensile != null ? fmtEur(f.rata_mensile) : '—',
      f.scadenza ?? '—',
      f.fonte === 'centrale_rischi' ? 'CR' : 'Dichiarato',
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Istituto', 'Tipo', 'Importo Residuo', 'Rata Mensile', 'Scadenza', 'Fonte']],
      body: fRows,
      headStyles: { fillColor: TEAL, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8, textColor: DARK },
      columnStyles: {
        0: { cellWidth: 42 },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'center' },
        5: { halign: 'center', cellWidth: 22 },
      },
      margin: { left: 14, right: 14 },
      theme: 'striped',
    });
    y = (doc as any).lastAutoTable.finalY + 8;

    // Totali
    const totResiduo = data.finanziamenti.reduce((s, f) => s + f.importo_residuo, 0);
    const totRate    = data.finanziamenti.reduce((s, f) => s + (f.rata_mensile ?? 0), 0);

    checkPage(20);
    doc.setFillColor(...LIGHT);
    doc.roundedRect(14, y, W - 28, 16, 2, 2, 'F');
    doc.setTextColor(...DARK); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
    doc.text(`Totale debito residuo: ${fmtEur(totResiduo)}`, 19, y + 7);
    if (totRate > 0) doc.text(`Totale rate mensili: ${fmtEur(totRate)}`, 19, y + 13);

    y += 20;
    doc.setFontSize(7.5); doc.setTextColor(...GRAY); doc.setFont('helvetica', 'italic');
    const dscrNote = data.dscr_metodo === 'finanziamenti'
      ? `DSCR operativo = EBITDA / servizio del debito annuo${data.servizio_debito_annuo ? ` (${fmtEur(data.servizio_debito_annuo)})` : ''}.`
      : 'DSCR approssimato tramite EBITDA / interessi passivi in assenza delle rate complete.';
    doc.text(dscrNote, 14, y);
    y += 8;
  }

  // ══════════════════════════════════════════════════════════════════════
  // PAGINA FINALE — RACCOMANDAZIONI AI
  // ══════════════════════════════════════════════════════════════════════
  if (data.ai_suggerimenti?.length > 0) {
    doc.addPage(); y = 18;

    sectionTitle('Raccomandazioni per Migliorare la Bancabilità', '🎯');

    for (const s of data.ai_suggerimenti) {
      checkPage(55);

      // Header card
      doc.setFillColor(254, 243, 199);
      doc.roundedRect(14, y, W - 28, 8, 2, 2, 'F');
      doc.setTextColor(146, 64, 14); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
      doc.text(`⚠  ${s.kpi_label}`, 18, y + 5.5);
      y += 11;

      // Diagnosi
      doc.setTextColor(...DARK); doc.setFontSize(8.5); doc.setFont('helvetica', 'italic');
      const diagLines = doc.splitTextToSize(s.diagnosi, W - 32) as string[];
      doc.text(diagLines, 16, y);
      y += diagLines.length * 4.5 + 4;

      // Azioni
      checkPage(20);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...DARK);
      doc.text('Azioni raccomandate:', 16, y); y += 5;
      doc.setFont('helvetica', 'normal');
      for (const [i, az] of s.azioni.entries()) {
        checkPage(10);
        const azLines = doc.splitTextToSize(`${i + 1}. ${az}`, W - 38) as string[];
        doc.text(azLines, 20, y);
        y += azLines.length * 4.5 + 2;
      }

      // Impatto atteso
      checkPage(14);
      doc.setFillColor(236, 254, 255);
      doc.roundedRect(14, y, W - 28, 10, 1, 1, 'F');
      doc.setTextColor(14, 116, 144); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text('Impatto atteso:', 18, y + 4);
      doc.setFont('helvetica', 'normal');
      const impLines = doc.splitTextToSize(s.impatto_atteso, W - 62) as string[];
      doc.text(impLines, 52, y + 4);
      y += 14;

      y += 4;
    }
  }

  // ── FOOTER su tutte le pagine ─────────────────────────────────────────
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(i, totalPages);
    // Mini logo Credifile nel footer al centro se disponibile
    if (credifileLogo) {
      try { doc.addImage(credifileLogo, 'PNG', W / 2 - 3, pageH - 11, 6, 6); } catch { /* ignora */ }
    }
  }

  const pdfBlob = doc.output('blob');
  const base64  = doc.output('datauristring').split(',')[1];
  return { pdfBlob, base64 };
}
