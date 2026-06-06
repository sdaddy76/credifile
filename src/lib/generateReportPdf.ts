import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface KpiScore {
  kpi_key: string; kpi_label: string; kpi_area: string;
  valore: number | null; formatted: string; score: number | null;
  benchmark: number | null; benchmark_formatted: string;
  inverso: boolean;
}
export interface AiSuggerimento {
  kpi_key: string; kpi_label: string;
  diagnosi: string; azioni: string[]; impatto_atteso: string;
}
export interface ReportData {
  ragione_sociale: string; partita_iva?: string; codice_ateco?: string;
  settore?: string; indirizzo?: string;
  anno_bilancio: number;
  indice_bancabilita: number | null;
  kpi_scores: KpiScore[];
  top3: KpiScore[]; bottom3: KpiScore[];
  ai_suggerimenti: AiSuggerimento[];
  consulente_nome: string; consulente_email?: string;
  consulente_logo_url?: string | null;
}

// ── Colori ─────────────────────────────────────────────────────────────────
const TEAL:  [n,n,n] = [15, 118, 110];
const DARK:  [n,n,n] = [30,  41,  59];
const GRAY:  [n,n,n] = [100,116,139];
const WHITE: [n,n,n] = [255,255,255];
const GREEN: [n,n,n] = [22, 163,  74];
const RED:   [n,n,n] = [220,  38,  38];
const AMBER: [n,n,n] = [217,119,   6];
const LIGHT: [n,n,n] = [241,245,249];
type n = number;

function ratingInfo(score: number): { label: string; color: [n,n,n] } {
  if (score >= 85) return { label: 'Eccellente',      color: GREEN };
  if (score >= 70) return { label: 'Buono',           color: [22,101,52] as [n,n,n] };
  if (score >= 55) return { label: 'Sufficiente',     color: AMBER };
  if (score >= 40) return { label: 'Critico',         color: [234,88,12] as [n,n,n] };
  return               { label: 'Non bancabile',    color: RED };
}

function barColor(score: number): [n,n,n] {
  if (score >= 85) return GREEN;
  if (score >= 70) return [34,197,94] as [n,n,n];
  if (score >= 55) return AMBER;
  if (score >= 40) return [249,115,22] as [n,n,n];
  return RED;
}

// Carica immagine da URL come base64
async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export async function generateReportPdf(data: ReportData): Promise<{ pdfBlob: Blob; base64: string }> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 0;

  // ── HELPER ──────────────────────────────────────────────────────────────
  const checkPage = (needed: number) => {
    if (y + needed > pageH - 20) {
      doc.addPage();
      y = 20;
    }
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

  // ── PAGINA 1: HEADER ────────────────────────────────────────────────────
  // Banner intestazione consulente
  doc.setFillColor(...TEAL);
  doc.rect(0, 0, W, 36, 'F');

  // Logo consulente (se disponibile)
  let logoLoaded = false;
  if (data.consulente_logo_url) {
    const b64 = await loadImageAsBase64(data.consulente_logo_url);
    if (b64) {
      try {
        doc.addImage(b64, 'PNG', 14, 5, 26, 26);
        logoLoaded = true;
      } catch { /* ignora errori logo */ }
    }
  }
  const textLeft = logoLoaded ? 46 : 14;
  doc.setTextColor(...WHITE);
  doc.setFontSize(18); doc.setFont('helvetica', 'bold');
  doc.text('REPORT DI BANCABILITÀ', textLeft, 16);
  doc.setFontSize(10); doc.setFont('helvetica', 'normal');
  doc.text(`Consulente: ${data.consulente_nome}`, textLeft, 24);
  if (data.consulente_email) doc.text(data.consulente_email, textLeft, 30);
  doc.setFontSize(8.5);
  doc.text(`Generato il: ${new Date().toLocaleDateString('it-IT')}`, W - 14, 24, { align: 'right' });

  y = 44;

  // ── Dati societari ──────────────────────────────────────────────────────
  doc.setFillColor(...LIGHT);
  doc.roundedRect(14, y, W - 28, 22, 2, 2, 'F');
  doc.setTextColor(...DARK); doc.setFontSize(13); doc.setFont('helvetica', 'bold');
  doc.text(data.ragione_sociale, 19, y + 8);
  doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY);
  const infoLine = [
    data.partita_iva ? `P.IVA: ${data.partita_iva}` : null,
    data.codice_ateco ? `ATECO: ${data.codice_ateco}` : null,
    data.settore || null,
    `Bilancio ${data.anno_bilancio}`,
  ].filter(Boolean).join('   ·   ');
  doc.text(infoLine, 19, y + 14);
  if (data.indirizzo) doc.text(data.indirizzo, 19, y + 19);
  y += 28;

  // ── Gauge indice ────────────────────────────────────────────────────────
  if (data.indice_bancabilita !== null) {
    const score = data.indice_bancabilita;
    const { label, color } = ratingInfo(score);
    checkPage(40);

    // Cerchio gauge simulato con archi
    const cx = W / 2, cy = y + 20;
    doc.setDrawColor(220, 220, 220); doc.setLineWidth(3);
    doc.circle(cx, cy, 18);
    doc.setDrawColor(...color); doc.setLineWidth(3);
    // Barra piena del cerchio (simulazione semplice)
    doc.circle(cx, cy, 16);

    doc.setTextColor(...color); doc.setFontSize(22); doc.setFont('helvetica', 'black');
    doc.text(String(Math.round(score)), cx, cy + 4, { align: 'center' });
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text('/100', cx, cy + 9, { align: 'center' });

    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(...color);
    doc.text(`INDICE DI BANCABILITÀ: ${Math.round(score)}/100 — ${label.toUpperCase()}`, W / 2, y + 44, { align: 'center' });

    // Barra orizzontale
    y += 49;
    const barY = y; const barW = W - 60; const barX = 30; const barH = 5;
    doc.setFillColor(230, 230, 230);
    doc.roundedRect(barX, barY, barW, barH, 2, 2, 'F');
    doc.setFillColor(...barColor(score));
    doc.roundedRect(barX, barY, barW * (score / 100), barH, 2, 2, 'F');
    // Etichette soglie
    doc.setFontSize(6.5); doc.setTextColor(...GRAY);
    for (const [pct, lbl] of [[0, '0'], [40, '40'], [55, '55'], [70, '70'], [85, '85'], [100, '100']]) {
      const px = barX + barW * (Number(pct) / 100);
      doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3);
      doc.line(px, barY - 1, px, barY + barH + 1);
      doc.text(String(lbl), px, barY + barH + 4, { align: 'center' });
    }
    y += 14;
  }

  // ── SEZIONE: KPI AZIENDA vs BENCHMARK ───────────────────────────────────
  sectionTitle('KPI Aziendali vs. Benchmark di Settore', '📊');

  const kpiRows = data.kpi_scores
    .filter(k => k.score !== null)
    .map(k => {
      const score = k.score!;
      const scLabel = score >= 70 ? '● OK' : score >= 40 ? '● Attenzione' : '● Critico';
      const delta = (k.benchmark !== null && k.valore !== null)
        ? (k.inverso ? k.benchmark - k.valore : k.valore - k.benchmark)
        : null;
      return [
        `${k.kpi_label}`,
        k.formatted,
        k.benchmark_formatted || '—',
        delta !== null ? (delta >= 0 ? `+${delta.toFixed(2)}` : `${delta.toFixed(2)}`) : '—',
        { content: `${Math.round(score)}/100\n${scLabel}`, styles: { fillColor: score >= 70 ? [220,252,231] : score >= 40 ? [254,243,199] : [254,226,226], textColor: score >= 70 ? [22,101,52] : score >= 40 ? [146,64,14] : [185,28,28], fontStyle: 'bold', cellPadding: 3 } },
      ];
    });

  autoTable(doc, {
    startY: y,
    head: [['KPI', 'Valore Azienda', 'Benchmark Settore', 'Scostamento', 'Score']],
    body: kpiRows as Parameters<typeof autoTable>[1]['body'],
    headStyles: { fillColor: TEAL, textColor: WHITE, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: DARK },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'center', cellWidth: 28 } },
    margin: { left: 14, right: 14 },
    theme: 'striped',
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // ── SEZIONE: TOP 3 / BOTTOM 3 ───────────────────────────────────────────
  checkPage(50);
  sectionTitle('Sintesi: Migliori e Peggiori Indicatori', '📋');

  // Top 3
  doc.setFillColor(220, 252, 231);
  doc.roundedRect(14, y, (W - 34) / 2, 8, 2, 2, 'F');
  doc.setTextColor(22, 101, 52); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('✅  TOP 3 — Punti di Forza', 19, y + 5.5);
  y += 10;

  for (const k of data.top3) {
    checkPage(8);
    doc.setFillColor(240, 253, 244);
    doc.roundedRect(14, y, (W - 34) / 2, 7, 1, 1, 'F');
    doc.setTextColor(22, 101, 52); doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
    doc.text(k.kpi_label, 18, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`${k.formatted}  |  Score: ${k.score}/100`, (W - 34) / 2, y + 4.5, { align: 'right' });
    y += 8;
  }

  // Bottom 3 — stessa riga, colonna destra
  const rightX = 14 + (W - 34) / 2 + 6;
  let y2 = y - 34; // Torna su per affiancare
  doc.setFillColor(254, 226, 226);
  doc.roundedRect(rightX, y2, (W - 34) / 2, 8, 2, 2, 'F');
  doc.setTextColor(185, 28, 28); doc.setFontSize(9); doc.setFont('helvetica', 'bold');
  doc.text('❌  BOTTOM 3 — Aree Critiche', rightX + 5, y2 + 5.5);
  y2 += 10;

  for (const k of data.bottom3) {
    doc.setFillColor(255, 241, 242);
    doc.roundedRect(rightX, y2, (W - 34) / 2, 7, 1, 1, 'F');
    doc.setTextColor(185, 28, 28); doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
    doc.text(k.kpi_label, rightX + 4, y2 + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`${k.formatted}  |  Score: ${k.score}/100`, rightX + (W - 34) / 2 - 2, y2 + 4.5, { align: 'right' });
    y2 += 8;
  }

  y = Math.max(y, y2) + 8;

  // ── SEZIONE: RACCOMANDAZIONI AI ─────────────────────────────────────────
  if (data.ai_suggerimenti?.length > 0) {
    checkPage(20);
    sectionTitle('Raccomandazioni per Migliorare la Bancabilità', '🎯');

    for (const s of data.ai_suggerimenti) {
      checkPage(50);
      // Card KPI
      doc.setFillColor(254, 243, 199);
      doc.roundedRect(14, y, W - 28, 7, 2, 2, 'F');
      doc.setTextColor(146, 64, 14); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
      doc.text(`⚠  ${s.kpi_label}`, 18, y + 5);
      y += 9;

      // Diagnosi
      doc.setTextColor(...DARK); doc.setFontSize(8.5); doc.setFont('helvetica', 'italic');
      const diagLines = doc.splitTextToSize(s.diagnosi, W - 30) as string[];
      doc.text(diagLines, 16, y);
      y += diagLines.length * 4.5 + 3;

      // Azioni
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text('Azioni raccomandate:', 16, y); y += 5;
      doc.setFont('helvetica', 'normal');
      for (const [i, az] of s.azioni.entries()) {
        checkPage(12);
        const azLines = doc.splitTextToSize(`${i + 1}. ${az}`, W - 36) as string[];
        doc.text(azLines, 20, y);
        y += azLines.length * 4.5 + 1.5;
      }

      // Impatto atteso
      checkPage(14);
      doc.setFillColor(236, 254, 255);
      doc.roundedRect(14, y, W - 28, 9, 1, 1, 'F');
      doc.setTextColor(14, 116, 144); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      doc.text('Impatto atteso:', 18, y + 3.5);
      doc.setFont('helvetica', 'normal');
      const impLines = doc.splitTextToSize(s.impatto_atteso, W - 60) as string[];
      doc.text(impLines, 50, y + 3.5);
      y += 12;

      y += 5; // spazio tra suggerimenti
    }
  }

  // ── FOOTER su tutte le pagine ────────────────────────────────────────────
  const totalPages = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFillColor(241, 245, 249);
    doc.rect(0, pageH - 12, W, 12, 'F');
    doc.setTextColor(...GRAY); doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
    doc.text(`Credifile — Report Bancabilità | ${data.consulente_nome}`, 14, pageH - 4.5);
    doc.text(`Pagina ${i} di ${totalPages}`, W - 14, pageH - 4.5, { align: 'right' });
  }

  const pdfBlob = doc.output('blob');
  const base64  = doc.output('datauristring').split(',')[1];
  return { pdfBlob, base64 };
}
