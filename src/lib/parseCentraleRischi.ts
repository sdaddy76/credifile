// ═══════════════════════════════════════════════════════════
//  PARSER CENTRALE RISCHI - BANCA D'ITALIA  (v5 - definitivo)
//
//  Struttura testo pdfjs per ogni riga dati BDI:
//    "[CATEGORIA]   [0]   [ImpGar]  [testo descrittivo...]
//     [Utilizzato]   [Accordato]   [AccOp]   [SaldoMedio]"
//
//  I numeri appaiono in DUE GRUPPI separati da blocchi di testo:
//   Gruppo 1 (2 num, dopo categoria): Ruolo Affidato, Importo Garantito
//   Gruppo 2 (4 num, dopo testo descrittivo): Util, Acc, AccOp, Saldo
//
//  Strategia: cercare il Gruppo 2 = 4 numeri consecutivi dove
//  almeno 1 ha il formato italiano (punto-migliaia: "43.389").
//  Accoppiare per ORDINE con le categorie trovate.
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

/** Numero italiano → float; null se anno (4 cifre 1900-2099) */
function parseNum(s: string): number | null {
  if (!s || s === '-') return null;
  const val = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (isNaN(val)) return null;
  if (val >= 1900 && val <= 2099 && /^\d{4}$/.test(s)) return null;
  return val;
}

/** True se il token è un numero in formato italiano-migliaia (es. "43.389") */
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

// ── Pattern numero generico (italiano o intero) ───────────
const NUM_TOK = String.raw`\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?`;

// Regex: 4 numeri consecutivi separati da \s+
// Nota: con flag 'g' trova un gruppo alla volta senza sovrapposizioni
const FOUR_NUM_RE = new RegExp(
  `(${NUM_TOK})\\s+(${NUM_TOK})\\s+(${NUM_TOK})\\s+(${NUM_TOK})`,
  'g'
);

// Regex: 2 numeri consecutivi (Gruppo 1 = Ruolo Aff + Importo Garantito)
const TWO_NUM_RE = new RegExp(
  `(${NUM_TOK})\\s+(${NUM_TOK})`,
  'g'
);

// ── Helper garanzia / stato ───────────────────────────────
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

// ── Categorie ─────────────────────────────────────────────
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

  // ── 3. Data di riferimento (3 pattern) ────────────────
  type DateOcc = { label: string; sort: number; idx: number };
  const dateOccs: DateOcc[] = [];
  let dm: RegExpExecArray | null;

  // A: "DATA DI RIFERIMENTO: [mese] [anno]"
  const patA = new RegExp(`DATA\\s+DI\\s+RIFERIMENTO:\\s*((?:${MESE_STR})\\s+\\d{4})`, 'gi');
  while ((dm = patA.exec(cleanText)) !== null)
    dateOccs.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });

  // B: "[mese] [anno]" nei 300 char dopo RILEVAZIONE MENSILE
  if (!dateOccs.length) {
    const patB = new RegExp(`RILEVAZIONE\\s+MENSILE[\\s\\S]{0,300}?((?:${MESE_STR})\\s+\\d{4})`, 'gi');
    while ((dm = patB.exec(cleanText)) !== null)
      dateOccs.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });
  }

  // C: formato abbreviato (dic-25, mar-26)
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

  // ── 4. Seleziona PRIMO per posizione = mese più recente ─
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
  const BANK_RE = /Intermediario:\s+([A-Z][A-Z0-9 ''\u2019.,\-&/()]+?)(?=\s{3,}|\n|Crediti\s+per\s+cassa|Garanzie\s+ricevute|DATA\s+DI)/g;
  const bankBlocks: { name: string; idx: number }[] = [];
  let bm: RegExpExecArray | null;

  while ((bm = BANK_RE.exec(workText)) !== null) {
    const name = bm[1].replace(/\s+/g, ' ').trim();
    if (name.length >= 3 && name.length <= 130)
      bankBlocks.push({ name, idx: bm.index });
  }

  // Fallback: cerca in tutto cleanText
  if (!bankBlocks.length) {
    BANK_RE.lastIndex = 0;
    while ((bm = BANK_RE.exec(cleanText)) !== null) {
      const name = bm[1].replace(/\s+/g, ' ').trim();
      if (name.length >= 3 && name.length <= 130)
        bankBlocks.push({ name, idx: bm.index });
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
      // Flessibile: permette \s{0,5} tra le parole (gestisce \n o spazi extra)
      const words = cat.split(' ');
      const reStr = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                         .join('[\\s\\S]{0,5}');
      const catRe = new RegExp(reStr, 'g');
      let cm: RegExpExecArray | null;
      while ((cm = catRe.exec(ccText)) !== null)
        foundCats.push({ cat, idx: cm.index });
    }
    foundCats.sort((a, b) => a.idx - b.idx);
    const uniqueCats: { cat: string; idx: number }[] = [];
    const seenC = new Set<string>();
    for (const fc of foundCats) {
      if (!seenC.has(fc.cat)) { uniqueCats.push(fc); seenC.add(fc.cat); }
    }
    if (!uniqueCats.length) continue;

    // ── 6b. Trova Gruppi 2 (4 numeri, almeno 1 italiano-migliaia) ─
    // In pdfjs BDI: Gruppo2 = [Utilizzato, Accordato, AccOp, SaldoMedio]
    // appare DOPO il blocco di testo descrittivo di ogni riga
    type Fin4 = { idx: number; nums: [number, number, number, number] };
    const fin4s: Fin4[] = [];
    FOUR_NUM_RE.lastIndex = 0;
    let fm: RegExpExecArray | null;
    while ((fm = FOUR_NUM_RE.exec(ccText)) !== null) {
      const toks = [fm[1], fm[2], fm[3], fm[4]];
      // Almeno 1 token deve essere in formato italiano-migliaia
      if (!toks.some(isItalianThousands)) continue;
      const nums = toks.map(t => parseNum(t) ?? 0) as [number, number, number, number];
      fin4s.push({ idx: fm.index, nums });
      // Avanza oltre questo match per evitare sovrapposizioni
      FOUR_NUM_RE.lastIndex = fm.index + fm[0].length;
    }

    // ── 6c. Trova Gruppi 1 (2 numeri per Importo Garantito) ──
    // Appare subito dopo la categoria: [RuoloAffidato=0, ImportoGarantito]
    TWO_NUM_RE.lastIndex = 0;
    const twoNums: { idx: number; second: number }[] = [];
    let tm: RegExpExecArray | null;
    while ((tm = TWO_NUM_RE.exec(ccText)) !== null) {
      // Solo se NON seguito da un terzo numero (altrimenti è parte di un gruppo 4)
      const afterEnd = ccText.substring(tm.index + tm[0].length).match(/^\s+\d/);
      if (!afterEnd) {
        const secondVal = parseNum(tm[2]) ?? 0;
        twoNums.push({ idx: tm.index, second: secondVal });
        TWO_NUM_RE.lastIndex = tm.index + tm[0].length;
      }
    }

    // ── 6d. Accoppia categorie ↔ Gruppo2 per ORDINE ──────
    const N = Math.min(uniqueCats.length, fin4s.length);
    for (let k = 0; k < N; k++) {
      const { cat, idx: catIdx } = uniqueCats[k];
      const { nums, idx: numIdx } = fin4s[k];

      // Pdfjs BDI column order for Gruppo2: Utilizzato, Accordato, AccOp, SaldoMedio
      const [utilizzato, accordato, accordato_operativo, saldo_medio] = nums;

      // Importo Garantito: dal Gruppo1 più vicino DOPO la categoria (prima del Gruppo2)
      const g1after = twoNums.find(t => t.idx > catIdx && t.idx < numIdx);
      const importo_garantito = g1after ? g1after.second : 0;

      // Contesto per garanzia/stato
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
