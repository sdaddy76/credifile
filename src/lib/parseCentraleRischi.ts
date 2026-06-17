// ═══════════════════════════════════════════════════════════
//  PARSER CENTRALE RISCHI - BANCA D'ITALIA  (v6)
//
//  BUG ROOT CAUSE (v1-v5):
//  In pdfjs la stringa pdfjs per ogni sezione banca ha il formato:
//    "... CR DI FERMO SPA Intermediario:  Crediti per cassa ..."
//  Il nome banca appare PRIMA di "Intermediario:", non dopo.
//  I parser v1-v5 cercavano il nome DOPO → zero match → zero righe.
//
//  STRUTTURA RIGA DATI pdfjs BDI:
//    "[CATEGORIA]   [0]   [ImpGar]  [testo descrittivo...]
//     [Utilizzato]   [Accordato]   [AccOp]   [SaldoMedio]"
//  I numeri appaiono in DUE GRUPPI separati da blocchi di testo:
//   Gruppo 1 (2 num, dopo categoria): RuoloAff, ImportoGarantito
//   Gruppo 2 (4 num, dopo testo):     Util, Acc, AccOp, Saldo
//
//  STRATEGIA v6:
//  1. Trova "Intermediario:" → guarda i 150 char PRIMA per il nome banca
//  2. Cerca 4 numeri consecutivi (≥1 italiano-migliaia) come Gruppo 2
//  3. Accoppia per ORDINE categorie ↔ Gruppo 2
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
  gennaio:1, febbraio:2, marzo:3, aprile:4, maggio:5, giugno:6,
  luglio:7, agosto:8, settembre:9, ottobre:10, novembre:11, dicembre:12,
};
const MESI_ABBR: Record<string, number> = {
  gen:1, feb:2, mar:3, apr:4, mag:5, giu:6,
  lug:7, ago:8, set:9, ott:10, nov:11, dic:12,
};

function parseDateSort(label: string): number {
  const low = label.toLowerCase().trim();
  const m1 = low.match(/^(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})$/);
  if (m1) return parseInt(m1[2]) * 100 + (MESI_IT[m1[1]] ?? 0);
  const m2 = low.match(/^([a-z]{3})-(\d{2})$/);
  if (m2) return (2000 + parseInt(m2[2])) * 100 + (MESI_ABBR[m2[1]] ?? 0);
  return 0;
}

function parseNum(s: string): number | null {
  if (!s || s === '-') return null;
  const val = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (isNaN(val)) return null;
  if (val >= 1900 && val <= 2099 && /^\d{4}$/.test(s)) return null;
  return val;
}

/** True se il token è in formato italiano-migliaia (es. "43.389") */
function isItalianThousands(s: string): boolean {
  return /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s);
}

/** Categoria CR → denominazione bancaria standard */
export function categoriaToTipologia(cat: string): string {
  const c = cat.toUpperCase();
  if (c.includes('SCADENZA'))      return 'Mutuo/Prestito (CR - A Scadenza)';
  if (c.includes('REVOCA'))        return 'Fido/C.Corrente (CR - A Revoca)';
  if (c.includes('AUTOLIQUIDANT')) return 'Anticipo/SBF (CR - Autoliquidante)';
  if (c.includes('SOFFERENZ'))     return 'Sofferenza (CR)';
  return 'Altro (CR)';
}

// ── Marcatori ─────────────────────────────────────────────
const GUIDA_START_RE = /Il\s+prospetto\s+dati\s+della\s+Centrale\s+dei\s+rischi[:\s]+guida\s+alla\s+lettura/i;
const CC_END_RE      = /Garanzie\s+ricevute|Crediti\s+di\s+firma|INFORMAZIONI\s+SUI\s+GARANTI|INFORMAZIONI\s+SUI\s+DEBITORI/i;

const MESE_STR = 'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';

// Pattern numero generico (italiano-migliaia o intero)
const NUM_TOK = String.raw`\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?`;

// 4 numeri consecutivi separati da \s+
// Usato per trovare Gruppo 2 (Util, Acc, AccOp, Saldo)
const FOUR_NUM_RE = new RegExp(
  `(${NUM_TOK})\\s+(${NUM_TOK})\\s+(${NUM_TOK})\\s+(${NUM_TOK})`,
  'g'
);

// 2 numeri consecutivi separati da \s+
// Usato per trovare Gruppo 1 (RuoloAff, ImportoGarantito)
const TWO_NUM_RE = new RegExp(
  `(${NUM_TOK})\\s+(${NUM_TOK})`,
  'g'
);

function extractGaranzia(ctx: string): string {
  if (/IPOTECA\s+INTERNA/i.test(ctx))   return 'IPOTECA INTERNA';
  if (/IPOTECA\s+ESTERNA/i.test(ctx))   return 'IPOTECA ESTERNA';
  if (/IPOTECA/i.test(ctx))             return 'IPOTECA';
  if (/PEGNO\s+INTERNO/i.test(ctx))     return 'PEGNO INTERNO';
  if (/PEGNO/i.test(ctx))               return 'PEGNO';
  if (/GARANZIE\s+PERSONALI\s+DI\s+PRIMA/i.test(ctx)) return 'GARANZIE PERSONALI DI PRIMA ISTANZA';
  if (/GARANZIE\s+PERSONALI/i.test(ctx))return 'GARANZIE PERSONALI';
  if (/ASSENZA\s+DI\s+GARANZIE/i.test(ctx)) return 'ASSENZA DI GARANZIE';
  return '';
}
function extractStato(ctx: string): string {
  if (/RAPPORTI\s+NON\s+CONTESTATI/i.test(ctx)) return 'Rapporti non contestati';
  if (/SOFFERENZ/i.test(ctx))                   return 'Sofferenza';
  if (/CONTESTAT/i.test(ctx))                   return 'Contestato';
  return '';
}

const CATEGORIE = ['RISCHI A SCADENZA','RISCHI A REVOCA','RISCHI AUTOLIQUIDANTI','SOFFERENZE'];

// ═══════════════════════════════════════════════════════════
//  PARSER PRINCIPALE
// ═══════════════════════════════════════════════════════════

export function parseCentraleRischi(fullText: string): CRResult {

  // ── 1. Strip guida alla lettura ────────────────────────
  const guidaIdx = fullText.search(GUIDA_START_RE);
  const cleanText = guidaIdx > 0 ? fullText.substring(0, guidaIdx) : fullText;

  // ── 2. Intestatario ────────────────────────────────────
  const intestatario =
    cleanText.match(/Intestatario:\s+([^\n\r]{3,120})/i)?.[1]?.trim() ?? '';

  // ── 3. Data di riferimento ────────────────────────────
  type DateOcc = { label: string; sort: number; idx: number };
  const dateOccs: DateOcc[] = [];
  let dm: RegExpExecArray | null;

  const patA = new RegExp(`DATA\\s+DI\\s+RIFERIMENTO:\\s*((?:${MESE_STR})\\s+\\d{4})`, 'gi');
  while ((dm = patA.exec(cleanText)) !== null)
    dateOccs.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });

  if (!dateOccs.length) {
    const patB = new RegExp(`RILEVAZIONE\\s+MENSILE[\\s\\S]{0,300}?((?:${MESE_STR})\\s+\\d{4})`, 'gi');
    while ((dm = patB.exec(cleanText)) !== null)
      dateOccs.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });
  }

  if (!dateOccs.length) {
    const patC = /\b((?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)-\d{2})\b/gi;
    const seen = new Set<string>();
    while ((dm = patC.exec(cleanText)) !== null) {
      const s = parseDateSort(dm[1]);
      if (s > 0 && !seen.has(dm[1].toLowerCase())) {
        seen.add(dm[1].toLowerCase());
        dateOccs.push({ label: dm[1], sort: s, idx: dm.index });
      }
    }
  }

  // ── 4. Seleziona primo per posizione (= mese più recente) ─
  let dataRiferimento = '';
  let workText = cleanText;

  if (dateOccs.length) {
    dateOccs.sort((a, b) => a.idx - b.idx);
    const first  = dateOccs[0];
    const second = dateOccs.length > 1 ? dateOccs[1] : null;
    dataRiferimento = first.label;
    workText = second
      ? cleanText.substring(first.idx, second.idx)
      : cleanText.substring(first.idx);
  }

  // ── 5. Trova blocchi Intermediario ────────────────────
  //  FIX v6: il nome banca compare PRIMA di "Intermediario:" nel testo pdfjs
  //  Es.: "CR DI FERMO SPA Intermediario:  Crediti per cassa"
  //  → leggo i 150 char prima di "Intermediario:" e estraggo il nome MAIUSCOLO finale
  const bankBlocks: { name: string; idx: number }[] = [];
  const INTERM_RE = /Intermediario:/g;
  let im: RegExpExecArray | null;

  const findBankName = (src: string, intermIdx: number): string => {
    const before = src.substring(Math.max(0, intermIdx - 150), intermIdx).trimEnd();
    // Estrai l'ultima sequenza di sole MAIUSCOLE (nome banca) alla fine del prima-testo
    // Es.: "...01/04/2026  CR DI FERMO SPA" → "CR DI FERMO SPA"
    const m = before.match(/([A-Z][A-Z '.,\-&()]{2,79})\s*$/);
    return m ? m[1].trim() : '';
  };

  while ((im = INTERM_RE.exec(workText)) !== null) {
    const name = findBankName(workText, im.index);
    if (name.length >= 3)
      bankBlocks.push({ name, idx: im.index });
  }

  // Fallback: cerca in cleanText se workText non ha trovato nulla
  if (!bankBlocks.length) {
    INTERM_RE.lastIndex = 0;
    while ((im = INTERM_RE.exec(cleanText)) !== null) {
      const name = findBankName(cleanText, im.index);
      if (name.length >= 3)
        bankBlocks.push({ name, idx: im.index });
    }
    if (bankBlocks.length) workText = cleanText;
  }

  // ── 6. Per ogni banca: estrai sezione CC ──────────────
  const righe: CRRiga[] = [];

  for (let bi = 0; bi < bankBlocks.length; bi++) {
    const { name: banca, idx: bankIdx } = bankBlocks[bi];
    const nextBankIdx = bi + 1 < bankBlocks.length
      ? bankBlocks[bi + 1].idx : workText.length;
    const bankText = workText.substring(bankIdx, nextBankIdx);

    const ccStart = bankText.search(/Crediti\s+per\s+cassa/i);
    if (ccStart === -1) continue;

    const afterCC = bankText.substring(ccStart + 20);
    const ccEndRel = afterCC.search(CC_END_RE);
    const ccEnd = ccEndRel !== -1 ? ccStart + 20 + ccEndRel : bankText.length;
    const ccText = bankText.substring(ccStart, ccEnd);

    // ── 6a. Trova categorie (ordine documento) ────────────
    const foundCats: { cat: string; idx: number }[] = [];
    for (const cat of CATEGORIE) {
      const words = cat.split(' ');
      const reStr = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                         .join('[\\s\\S]{0,5}');
      const catRe = new RegExp(reStr, 'g');
      let cm: RegExpExecArray | null;
      while ((cm = catRe.exec(ccText)) !== null)
        foundCats.push({ cat, idx: cm.index });
    }
    foundCats.sort((a, b) => a.idx - b.idx);
    // NON deduplicare per nome: la stessa banca può avere N righe dello stesso tipo
    // (es. 3 mutui = 3 occorrenze di RISCHI A SCADENZA → tutte vanno tenute)
    if (!foundCats.length) continue;

    // ── 6b. Gruppo 2: 4 numeri consecutivi con ≥1 italiano-migliaia ──
    // pdfjs BDI column order: [Utilizzato, Accordato, AccordatoOp, SaldoMedio]
    type Fin4 = { idx: number; nums: [number, number, number, number] };
    const fin4s: Fin4[] = [];
    FOUR_NUM_RE.lastIndex = 0;
    let fm: RegExpExecArray | null;
    while ((fm = FOUR_NUM_RE.exec(ccText)) !== null) {
      const toks = [fm[1], fm[2], fm[3], fm[4]];
      if (!toks.some(isItalianThousands)) continue;
      const nums = toks.map(t => parseNum(t) ?? 0) as [number, number, number, number];
      fin4s.push({ idx: fm.index, nums });
      FOUR_NUM_RE.lastIndex = fm.index + fm[0].length;
    }

    // ── 6c. Gruppo 1: 2 numeri dopo categoria → ImportoGarantito ──
    TWO_NUM_RE.lastIndex = 0;
    const twoNums: { idx: number; second: number }[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = TWO_NUM_RE.exec(ccText)) !== null) {
      // Skip se seguito da terzo numero (fa parte di un Gruppo 4)
      const afterEnd = ccText.substring(tm.index + tm[0].length).match(/^\s+\d/);
      if (!afterEnd) {
        twoNums.push({ idx: tm.index, second: parseNum(tm[2]) ?? 0 });
        TWO_NUM_RE.lastIndex = tm.index + tm[0].length;
      }
    }

    // ── 6d. Accoppia ogni occorrenza di categoria ↔ fin4 più vicino dopo di essa ──
    // IMPORTANTE: usare foundCats (non uniqueCats) per gestire N righe dello stesso tipo
    // Es: 3 × "RISCHI A SCADENZA" → 3 fin4 distinti assegnati in ordine posizionale
    const usedFin4Idx = new Set<number>();
    for (const { cat, idx: catIdx } of foundCats) {
      // Primo fin4 non ancora usato con idx > catIdx (= appare dopo questa categoria)
      const fin4 = fin4s.find(f => f.idx > catIdx && !usedFin4Idx.has(f.idx));
      if (!fin4) continue;
      usedFin4Idx.add(fin4.idx);

      const { nums, idx: numIdx } = fin4;
      // Ordine colonne BDI (da sinistra): Accordato, AccordatoOp, Utilizzato, SaldoMedio
      // Utilizzato = debito residuo attuale; Accordato = importo iniziale concesso
      const [accordato, accordato_operativo, utilizzato, saldo_medio] = nums;

      // ImportoGarantito dal Gruppo 1 tra catIdx e numIdx
      const g1 = twoNums.find(t => t.idx > catIdx && t.idx < numIdx);
      const importo_garantito = g1 ? g1.second : 0;

      const ctxStart = Math.max(0, numIdx - 500);
      const ctx = ccText.substring(ctxStart, numIdx + 50);

      righe.push({
        banca,
        data_riferimento: dataRiferimento,
        categoria: cat,
        accordato,
        accordato_operativo,
        utilizzato,
        saldo_medio,
        importo_garantito,
        tipo_garanzia:  extractGaranzia(ctx),
        stato_rapporto: extractStato(ctx),
      });
    }
  }

  const banche = [...new Set(righe.map(r => r.banca))];
  return { intestatario, data_riferimento: dataRiferimento, righe, banche };
}
