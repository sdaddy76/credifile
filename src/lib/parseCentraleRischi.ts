// ═══════════════════════════════════════════════════════════
//  PARSER CENTRALE RISCHI - BANCA D'ITALIA  (v2 - robust)
//  Estrae righe "Crediti per cassa" dal testo PDF (pdfjs)
// ═══════════════════════════════════════════════════════════

export interface CRRiga {
  banca:               string;
  data_riferimento:    string;
  categoria:           string;
  accordato:           number;
  accordato_operativo: number;
  utilizzato:          number;
  saldo_medio:         number;
  importo_garantito:   number;
  tipo_garanzia:       string;
  stato_rapporto:      string;
}

export interface CRResult {
  intestatario:     string;
  data_riferimento: string;
  righe:            CRRiga[];
  banche:           string[];
}

// ── helpers ──────────────────────────────────────────────
const MESI_IT: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

const MESI_ABBR: Record<string, number> = {
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6,
  lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12,
};

function parseDateSort(label: string): number {
  const low = label.toLowerCase().trim();
  // "marzo 2026" / "febbraio 2026"
  const m1 = low.match(/^(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})$/);
  if (m1) return parseInt(m1[2]) * 100 + (MESI_IT[m1[1]] ?? 0);
  // "mar-26" / "dic-25"
  const m2 = low.match(/^([a-z]{3})-(\d{2})$/);
  if (m2) return (2000 + parseInt(m2[2])) * 100 + (MESI_ABBR[m2[1]] ?? 0);
  return 0;
}

/** Converte numero italiano ("1.234.567" o "43.389") → float */
function parseNum(s: string): number {
  if (!s || s === '-') return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

/** Estrae tutti i numeri in formato italiano da una stringa */
function extractNums(s: string): number[] {
  // Match: 1.234.567 | 43.389 | 1.234,56 | singolo 0
  const matches = s.match(/\b(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+)\b/g) ?? [];
  return matches
    .map(parseNum)
    .filter(n => !isNaN(n));
}

/** Categoria CR → tipologia UI */
export function categoriaToTipologia(cat: string): string {
  if (cat.includes('SCADENZA'))      return 'Rischi a Scadenza (CR)';
  if (cat.includes('REVOCA'))        return 'Rischi a Revoca (CR)';
  if (cat.includes('AUTOLIQUIDANT')) return 'Rischi Autoliquidanti (CR)';
  if (cat.includes('SOFFERENZ'))     return 'Sofferenze (CR)';
  return 'Altro (CR)';
}

// ═══════════════════════════════════════════════════════════
//  PARSER PRINCIPALE
// ═══════════════════════════════════════════════════════════

export function parseCentraleRischi(fullText: string): CRResult {
  const CATEGORIE = [
    'RISCHI A SCADENZA',
    'RISCHI A REVOCA',
    'RISCHI AUTOLIQUIDANTI',
    'SOFFERENZE',
  ];

  // ── 1. Intestatario ────────────────────────────────────
  const intestatario =
    fullText.match(/Intestatario:\s*([^\n\r]{3,120})/i)?.[1]?.trim() ?? '';

  // ── 2. Data di riferimento (soft — più pattern) ────────
  // Pattern A: "DATA DI RIFERIMENTO:  marzo 2026"
  const dateRe = /DATA\s+DI\s+RIFERIMENTO:\s*((?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})/gi;
  const dates: { label: string; sort: number; idx: number }[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(fullText)) !== null) {
    dates.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });
  }

  // Pattern B: mese+anno standalone vicino a "RILEVAZIONE MENSILE"
  if (dates.length === 0) {
    const blockRe = /RILEVAZIONE\s+MENSILE[\s\S]{0,200}?((?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})/gi;
    while ((dm = blockRe.exec(fullText)) !== null) {
      dates.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });
    }
  }

  // Pattern C: date in formato abbreviato "mar-26" nell'intestazione
  if (dates.length === 0) {
    const abbrRe = /\b((?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)-\d{2})\b/gi;
    const abbrDates: { label: string; sort: number; idx: number }[] = [];
    while ((dm = abbrRe.exec(fullText)) !== null) {
      const sort = parseDateSort(dm[1]);
      if (sort > 0) abbrDates.push({ label: dm[1], sort, idx: dm.index });
    }
    // Prendi la più recente
    if (abbrDates.length > 0) {
      abbrDates.sort((a, b) => b.sort - a.sort);
      dates.push(abbrDates[0]);
    }
  }

  // Data più recente (sortKey massimo); se nessuna data → stringa vuota
  const mostRecent = dates.length > 0
    ? dates.reduce((a, b) => b.sort > a.sort ? b : a)
    : null;
  const dataRiferimento = mostRecent?.label ?? '';

  // ── 3. Sezione da elaborare ────────────────────────────
  // Se abbiamo date, limita il testo alla sezione più recente
  let workText = fullText;
  if (mostRecent && dates.length > 1) {
    const olderDates = dates.filter(d => d.sort < mostRecent.sort);
    const sectionEnd = Math.min(...olderDates.map(d => d.idx));
    workText = fullText.substring(mostRecent.idx, sectionEnd);
  } else if (mostRecent) {
    workText = fullText.substring(mostRecent.idx);
  }

  // ── 4. Trova blocchi per Intermediario ─────────────────
  // Permette whitespace variabile (\s+ invece di \s{1,4})
  // Terminator: 3+ spazi, nuova riga, o keyword note
  const BANK_RE = /Intermediario:\s+([A-Z][A-Z0-9 '.,\-&/()]+?)(?=\s{3,}|\n|Crediti\s+per\s+cassa|Garanzie\s+ricevute|DATA\s+DI)/g;
  const bankBlocks: { name: string; idx: number }[] = [];
  let bm: RegExpExecArray | null;
  while ((bm = BANK_RE.exec(workText)) !== null) {
    const name = bm[1].replace(/\s+/g, ' ').trim();
    if (name.length >= 3 && name.length <= 120) {
      bankBlocks.push({ name, idx: bm.index });
    }
  }

  // Fallback se non trovati nel workText: cerca in tutto il testo
  if (bankBlocks.length === 0) {
    BANK_RE.lastIndex = 0;
    while ((bm = BANK_RE.exec(fullText)) !== null) {
      const name = bm[1].replace(/\s+/g, ' ').trim();
      if (name.length >= 3 && name.length <= 120) {
        bankBlocks.push({ name, idx: bm.index });
      }
    }
    // Se trovati in fallback, usa tutto il testo come workText
    if (bankBlocks.length > 0) workText = fullText;
  }

  const righe: CRRiga[] = [];

  for (let bi = 0; bi < bankBlocks.length; bi++) {
    const { name: banca, idx: bankIdx } = bankBlocks[bi];
    const nextIdx = bi + 1 < bankBlocks.length ? bankBlocks[bi + 1].idx : workText.length;
    const bankText = workText.substring(bankIdx, nextIdx);

    // ── 5. Sezione "Crediti per cassa" ───────────────────
    const ccIdx = bankText.search(/Crediti\s+per\s+cassa/i);
    if (ccIdx === -1) continue;

    // Fine sezione CC
    const afterCC = bankText.substring(ccIdx + 20);
    const ccEndRe = /Garanzie\s+ricevute|Crediti\s+di\s+firma|INFORMAZIONI\s+SUI\s+GARANTI|INFORMAZIONI\s+SUI\s+DEBITORI/i;
    const ccEndMatch = afterCC.search(ccEndRe);
    const ccEnd = ccEndMatch !== -1 ? ccIdx + 20 + ccEndMatch : bankText.length;
    const ccText = bankText.substring(ccIdx, ccEnd);

    // ── 6. Estrai righe per categoria ────────────────────
    for (const cat of CATEGORIE) {
      const catRe = new RegExp(cat, 'g');
      let catMatch: RegExpExecArray | null;

      while ((catMatch = catRe.exec(ccText)) !== null) {
        const rowStart = catMatch.index;

        // Fine riga = prossima categoria o fine sezione
        let rowEnd = ccText.length;
        for (const other of CATEGORIE) {
          const nextOcc = ccText.indexOf(other, rowStart + cat.length);
          if (nextOcc !== -1 && nextOcc < rowEnd) rowEnd = nextOcc;
        }
        const rowText = ccText.substring(rowStart, rowEnd);

        // ── 7. Estrai i numeri finali ─────────────────────
        // Colonne finali: Ruolo Affidato | Accordato | Acc.Op. | Utilizzato | Saldo | ImpGar
        const nums = extractNums(rowText);
        if (nums.length < 3) continue;

        const tail = nums.slice(-6);
        let accordato = 0, accordatoOp = 0, utilizzato = 0, saldo = 0, impGar = 0;

        if (tail.length >= 6) {
          // [ruolo, accordato, acc_op, utilizzato, saldo, imp_gar]
          accordato  = tail[1];
          accordatoOp = tail[2];
          utilizzato = tail[3];
          saldo      = tail[4];
          impGar     = tail[5];
        } else if (tail.length === 5) {
          accordato  = tail[0];
          accordatoOp = tail[1];
          utilizzato = tail[2];
          saldo      = tail[3];
          impGar     = tail[4];
        } else {
          accordato  = tail[0] ?? 0;
          accordatoOp = tail[1] ?? 0;
          utilizzato = tail[2] ?? 0;
        }

        // ── 8. Tipo garanzia ──────────────────────────────
        const garPatterns = [
          /IPOTECA\s+INTERNA/i, /IPOTECA\s+ESTERNA/i, /IPOTECA/i,
          /PEGNO\s+INTERNO/i, /PEGNO/i,
          /GARANZIE\s+PERSONALI\s+DI\s+PRIMA\s+ISTANZA/i, /GARANZIE\s+PERSONALI/i,
          /ASSENZA\s+DI\s+GARANZIE\s+REALI\s+E\/O\s+PRIVILEGI/i,
          /ASSENZA\s+DI\s+GARANZIE/i,
        ];
        let tipo_garanzia = '';
        for (const p of garPatterns) {
          const gm = rowText.match(p);
          if (gm) { tipo_garanzia = gm[0].replace(/\s+/g, ' ').trim(); break; }
        }

        // ── 9. Stato rapporto ─────────────────────────────
        let stato_rapporto = '';
        if (/RAPPORTI\s+NON\s+CONTESTATI/i.test(rowText)) stato_rapporto = 'Rapporti non contestati';
        else if (/SOFFERENZ/i.test(rowText)) stato_rapporto = 'Sofferenza';
        else if (/CONTESTATI/i.test(rowText)) stato_rapporto = 'Contestato';

        righe.push({
          banca,
          data_riferimento: dataRiferimento,
          categoria: cat,
          accordato,
          accordato_operativo: accordatoOp,
          utilizzato,
          saldo_medio: saldo,
          importo_garantito: impGar,
          tipo_garanzia,
          stato_rapporto,
        });
      }
    }
  }

  const banche = [...new Set(righe.map(r => r.banca))];
  return { intestatario, data_riferimento: dataRiferimento, righe, banche };
}
