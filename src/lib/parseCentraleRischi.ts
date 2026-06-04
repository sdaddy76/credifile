// ═══════════════════════════════════════════════════════════
//  PARSER CENTRALE RISCHI - BANCA D'ITALIA  (v4)
//
//  Approccio robusto:
//  1. Strip della sezione "guida alla lettura" (contiene dati finti)
//  2. Trova data di riferimento (3 pattern fallback)
//  3. Isola il blocco di ogni Intermediario
//  4. Nella sezione "Crediti per cassa" usa un REGEX DIRETTO per le
//     righe finanziarie: "Ruolo Aff | Accordato | Acc.Op. | Utilizzato
//     | Saldo | Imp.Gar." = 6 numeri consecutivi separati da spazi
//     (il formato italiano "43.389" distingue dagli interi rumore)
//  5. Accoppia le righe finanziarie trovate con le categorie
//     nell'ORDINE in cui appaiono nel testo (invariante BDI)
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
  const m1 = low.match(
    /^(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})$/
  );
  if (m1) return parseInt(m1[2]) * 100 + (MESI_IT[m1[1]] ?? 0);
  const m2 = low.match(/^([a-z]{3})-(\d{2})$/);
  if (m2) return (2000 + parseInt(m2[2])) * 100 + (MESI_ABBR[m2[1]] ?? 0);
  return 0;
}

/** Numero italiano → float; null se anno (4 cifre, 1900-2099) */
function parseNum(s: string): number | null {
  if (!s || s === '-') return null;
  const val = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (isNaN(val)) return null;
  if (val >= 1900 && val <= 2099 && /^\d{4}$/.test(s)) return null;
  return val;
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

// ── Pattern per riga finanziaria (Ruolo Aff | Acc | AccOp | Util | Saldo | ImpGar)
// I veri importi sono in formato italiano (43.389, 136.858) → \d{1,3}(?:\.\d{3})+
// oppure esattamente 0.  Il regex cattura 6 token numerici consecutivi separati da \s+
// dove almeno uno sia un numero italiano con punto-migliaia (> 999).
const NUM_IT = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?`;
const NUM_ANY = String.raw`(?:\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)`;
// Pattern: 6 numeri separati da spazi, almeno uno in formato italiano-migliaia
const FINANCIAL_ROW_RE = new RegExp(
  `(${NUM_ANY})\\s+(${NUM_ANY})\\s+(${NUM_ANY})\\s+(${NUM_ANY})\\s+(${NUM_ANY})\\s+(${NUM_ANY})`,
  'g'
);

function isLargeItalian(s: string): boolean {
  return /\d{1,3}(?:\.\d{3})+/.test(s);
}

// ── Categorie CR ──────────────────────────────────────────
const CATEGORIE = ['RISCHI A SCADENZA','RISCHI A REVOCA','RISCHI AUTOLIQUIDANTI','SOFFERENZE'];

// ── Helper per tipo garanzia ──────────────────────────────
function extractGaranzia(ctx: string): string {
  const pats: [RegExp, string][] = [
    [/IPOTECA\s+INTERNA/i,   'IPOTECA INTERNA'],
    [/IPOTECA\s+ESTERNA/i,   'IPOTECA ESTERNA'],
    [/IPOTECA/i,              'IPOTECA'],
    [/PEGNO\s+INTERNO/i,      'PEGNO INTERNO'],
    [/PEGNO/i,                'PEGNO'],
    [/GARANZIE\s+PERSONALI\s+DI\s+PRIMA/i, 'GARANZIE PERSONALI DI PRIMA ISTANZA'],
    [/GARANZIE\s+PERSONALI/i, 'GARANZIE PERSONALI'],
    [/ASSENZA\s+DI\s+GARANZIE\s+REALI\s+E\/O\s+PRIVILEGI/i, 'ASSENZA DI GARANZIE REALI'],
    [/ASSENZA\s+DI\s+GARANZIE/i, 'ASSENZA DI GARANZIE'],
  ];
  for (const [re, label] of pats) {
    if (re.test(ctx)) return label;
  }
  return '';
}

function extractStato(ctx: string): string {
  if (/RAPPORTI\s+NON\s+CONTESTATI/i.test(ctx))  return 'Rapporti non contestati';
  if (/SOFFERENZ/i.test(ctx))                     return 'Sofferenza';
  if (/CONTESTAT/i.test(ctx))                     return 'Contestato';
  return '';
}

// ── Marcatori ─────────────────────────────────────────────
const GUIDA_START_RE  = /Il\s+prospetto\s+dati\s+della\s+Centrale\s+dei\s+rischi[:\s]+guida\s+alla\s+lettura/i;
const CC_END_RE       = /Garanzie\s+ricevute|Crediti\s+di\s+firma|INFORMAZIONI\s+SUI\s+GARANTI|INFORMAZIONI\s+SUI\s+DEBITORI/i;

// ═══════════════════════════════════════════════════════════
//  PARSER PRINCIPALE
// ═══════════════════════════════════════════════════════════

export function parseCentraleRischi(fullText: string): CRResult {

  // ── 1. Rimuovi guida alla lettura ─────────────────────
  const guidaIdx = fullText.search(GUIDA_START_RE);
  const cleanText = guidaIdx > 0 ? fullText.substring(0, guidaIdx) : fullText;

  // ── 2. Intestatario ────────────────────────────────────
  const intestatario =
    cleanText.match(/Intestatario:\s*([^\n\r]{3,120})/i)?.[1]?.trim() ?? '';

  // ── 3. Data di riferimento (3 pattern) ────────────────
  const MESE_RE_STR =
    'gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre';

  type DateOcc = { label: string; sort: number; idx: number };
  const dateOccs: DateOcc[] = [];
  let dm: RegExpExecArray | null;

  // Pattern A: "DATA DI RIFERIMENTO: [mese] [anno]"
  const patA = new RegExp(
    `DATA\\s+DI\\s+RIFERIMENTO:\\s*((?:${MESE_RE_STR})\\s+\\d{4})`, 'gi'
  );
  while ((dm = patA.exec(cleanText)) !== null) {
    dateOccs.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });
  }

  // Pattern B: "[mese] [anno]" nei 300 char dopo RILEVAZIONE MENSILE
  // (gestisce PDF BDI dove data precede l'etichetta)
  if (dateOccs.length === 0) {
    const patB = new RegExp(
      `RILEVAZIONE\\s+MENSILE[\\s\\S]{0,300}?((?:${MESE_RE_STR})\\s+\\d{4})`, 'gi'
    );
    while ((dm = patB.exec(cleanText)) !== null) {
      dateOccs.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });
    }
  }

  // Pattern C: formato abbreviato dic-25, mar-26 …
  if (dateOccs.length === 0) {
    const patC = /\b((?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)-\d{2})\b/gi;
    const seen = new Set<string>();
    while ((dm = patC.exec(cleanText)) !== null) {
      const sort = parseDateSort(dm[1]);
      if (sort > 0 && !seen.has(dm[1].toLowerCase())) {
        seen.add(dm[1].toLowerCase());
        dateOccs.push({ label: dm[1], sort, idx: dm.index });
      }
    }
  }

  // ── 4. Seleziona primo per posizione = mese più recente ──
  let dataRiferimento = '';
  let workText = cleanText;

  if (dateOccs.length > 0) {
    dateOccs.sort((a, b) => a.idx - b.idx);  // ordine nel documento
    const first  = dateOccs[0];
    const second = dateOccs.length > 1 ? dateOccs[1] : null;
    dataRiferimento = first.label;
    workText = second
      ? cleanText.substring(first.idx, second.idx)
      : cleanText.substring(first.idx);
  }

  // ── 5. Trova blocchi Intermediario ────────────────────
  const BANK_RE = /Intermediario:\s+([A-Z][A-Z0-9 ''\u2019.,\-&/()]+?)(?=\s{3,}|\n|Crediti\s+per\s+cassa|Garanzie\s+ricevute|DATA\s+DI)/g;
  const bankBlocks: { name: string; idx: number }[] = [];
  let bm: RegExpExecArray | null;

  while ((bm = BANK_RE.exec(workText)) !== null) {
    const name = bm[1].replace(/\s+/g, ' ').trim();
    if (name.length >= 3 && name.length <= 130) {
      bankBlocks.push({ name, idx: bm.index });
    }
  }

  // Fallback: cerca in cleanText intero se non trovato in workText
  if (bankBlocks.length === 0) {
    BANK_RE.lastIndex = 0;
    while ((bm = BANK_RE.exec(cleanText)) !== null) {
      const name = bm[1].replace(/\s+/g, ' ').trim();
      if (name.length >= 3 && name.length <= 130) {
        bankBlocks.push({ name, idx: bm.index });
      }
    }
    if (bankBlocks.length > 0) workText = cleanText;
  }

  // ── 6. Per ogni banca: estrai sezione CC e righe ──────
  const righe: CRRiga[] = [];

  for (let bi = 0; bi < bankBlocks.length; bi++) {
    const { name: banca, idx: bankIdx } = bankBlocks[bi];
    const nextBankIdx = bi + 1 < bankBlocks.length
      ? bankBlocks[bi + 1].idx : workText.length;
    const bankText = workText.substring(bankIdx, nextBankIdx);

    // Trova "Crediti per cassa"
    const ccStart = bankText.search(/Crediti\s+per\s+cassa/i);
    if (ccStart === -1) continue;

    // Fine sezione CC
    const afterCC    = bankText.substring(ccStart + 20);
    const ccEndRel   = afterCC.search(CC_END_RE);
    const ccEnd      = ccEndRel !== -1 ? ccStart + 20 + ccEndRel : bankText.length;
    const ccText     = bankText.substring(ccStart, ccEnd);

    // ── 6a. Cerca CATEGORIE in cc_text (ordine documenti) ──
    const foundCats: { cat: string; idx: number }[] = [];
    for (const cat of CATEGORIE) {
      // Gestisce "RISCHI A\nSCADENZA" o "RISCHI A SCADENZA" (spazio o newline)
      const words = cat.split(' ');
      const reStr = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                         .join('[\\s\\S]{0,5}');
      const catRe = new RegExp(reStr, 'g');
      let cm: RegExpExecArray | null;
      while ((cm = catRe.exec(ccText)) !== null) {
        foundCats.push({ cat, idx: cm.index });
      }
    }
    foundCats.sort((a, b) => a.idx - b.idx);

    // Dedup: per ogni categoria, tieni solo la prima occorrenza
    const uniqueCats: { cat: string; idx: number }[] = [];
    const seenC = new Set<string>();
    for (const fc of foundCats) {
      if (!seenC.has(fc.cat)) { uniqueCats.push(fc); seenC.add(fc.cat); }
    }

    if (uniqueCats.length === 0) continue;

    // ── 6b. Cerca RIGHE FINANZIARIE nel cc_text ───────────
    // Una riga finanziaria = 6 numeri consecutivi (sep. \s+)
    // dove almeno un elemento è in formato italiano (punto-migliaia)
    type FinRow = { idx: number; nums: number[] };
    const finRows: FinRow[] = [];
    FINANCIAL_ROW_RE.lastIndex = 0;
    let frm: RegExpExecArray | null;
    while ((frm = FINANCIAL_ROW_RE.exec(ccText)) !== null) {
      const groups = [frm[1], frm[2], frm[3], frm[4], frm[5], frm[6]];
      // Almeno un valore deve essere in formato italiano-migliaia (> 999)
      if (!groups.some(isLargeItalian)) continue;
      const nums = groups.map(parseNum).filter((n): n is number => n !== null);
      if (nums.length === 6) {
        finRows.push({ idx: frm.index, nums });
        // Salta oltre questa corrispondenza per evitare sovrapposizioni
        FINANCIAL_ROW_RE.lastIndex = frm.index + frm[0].length;
      }
    }

    // ── 6c. Accoppia categorie ↔ righe finanziarie per ORDINE ──
    // Invariante BDI: le categorie e le loro righe appaiono nello stesso ordine
    const N = Math.min(uniqueCats.length, finRows.length);
    for (let k = 0; k < N; k++) {
      const { cat } = uniqueCats[k];
      const { nums, idx: numIdx } = finRows[k];

      // tail = [RuoloAff, Accordato, AccOp, Utilizzato, Saldo, ImpGar]
      const [, acc = 0, accOp = 0, util = 0, saldo = 0, impGar = 0] = nums;

      // Contesto per garanzia/stato: 400 char attorno alla riga numerica
      const ctxStart = Math.max(0, numIdx - 400);
      const ctx = ccText.substring(ctxStart, numIdx + 100);

      righe.push({
        banca,
        data_riferimento: dataRiferimento,
        categoria: cat,
        accordato:           acc,
        accordato_operativo: accOp,
        utilizzato:          util,
        saldo_medio:         saldo,
        importo_garantito:   impGar,
        tipo_garanzia:       extractGaranzia(ctx),
        stato_rapporto:      extractStato(ctx),
      });
    }
  }

  const banche = [...new Set(righe.map(r => r.banca))];
  return { intestatario, data_riferimento: dataRiferimento, righe, banche };
}
