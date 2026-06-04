// ═══════════════════════════════════════════════════════════
//  PARSER CENTRALE RISCHI - BANCA D'ITALIA  (v3 - robust)
//  Estrae righe "Crediti per cassa" dal testo PDF (pdfjs)
//
//  Logica:
//   1. Elimina sezione "guida alla lettura" (contiene esempi finti)
//   2. Identifica il PRIMO "DATA DI RIFERIMENTO" nel documento
//      (BDI mostra il mese più recente per primo)
//   3. Estrae solo la sezione di quel mese
//   4. Per ogni "Intermediario:" trova "Crediti per cassa" e le righe
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
  const m1 = low.match(
    /^(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})$/
  );
  if (m1) return parseInt(m1[2]) * 100 + (MESI_IT[m1[1]] ?? 0);
  const m2 = low.match(/^([a-z]{3})-(\d{2})$/);
  if (m2) return (2000 + parseInt(m2[2])) * 100 + (MESI_ABBR[m2[1]] ?? 0);
  return 0;
}

/** Converte numero italiano ("1.234.567" o "43.389") → float.
 *  Filtra anni (1900-2099 isolati) che non sono importi. */
function parseNum(s: string): number | null {
  if (!s || s === '-') return null;
  const val = parseFloat(s.replace(/\./g, '').replace(',', '.'));
  if (isNaN(val)) return null;
  // Esclude anni (numero intero 4 cifre tra 1900-2099)
  if (val >= 1900 && val <= 2099 && Number.isInteger(val) && s.length === 4) return null;
  return val;
}

function extractNums(s: string): number[] {
  const matches = s.match(/\b(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+)\b/g) ?? [];
  return matches.map(parseNum).filter((n): n is number => n !== null);
}

/** Categoria CR → denominazione bancaria standard */
export function categoriaToTipologia(cat: string): string {
  const c = cat.toUpperCase();
  if (c.includes('SCADENZA'))       return 'Mutuo/Prestito (CR - A Scadenza)';
  if (c.includes('REVOCA'))         return 'Fido/C.Corrente (CR - A Revoca)';
  if (c.includes('AUTOLIQUIDANT'))  return 'Anticipo/SBF (CR - Autoliquidante)';
  if (c.includes('SOFFERENZ'))      return 'Sofferenza (CR)';
  return 'Altro (CR)';
}

// ── marcatori fine-sezione Crediti per cassa ─────────────
const CC_END_RE = /Garanzie\s+ricevute|Crediti\s+di\s+firma|INFORMAZIONI\s+SUI\s+GARANTI|INFORMAZIONI\s+SUI\s+DEBITORI/i;

// ── marcatori fine sezione dati reali (inizio guida) ─────
const GUIDA_START_RE = /Il\s+prospetto\s+dati\s+della\s+Centrale\s+dei\s+rischi[:\s]+guida\s+alla\s+lettura/i;

// ── categorie da cercare ──────────────────────────────────
const CATEGORIE = [
  'RISCHI A SCADENZA',
  'RISCHI A REVOCA',
  'RISCHI AUTOLIQUIDANTI',
  'SOFFERENZE',
];

// ═══════════════════════════════════════════════════════════
//  PARSER PRINCIPALE
// ═══════════════════════════════════════════════════════════

export function parseCentraleRischi(fullText: string): CRResult {

  // ── 1. Rimuovi sezione "guida alla lettura" ────────────
  // Contiene esempi con BANCA UNO/DUE/QUATTRO e dati finti
  const guidaIdx = fullText.search(GUIDA_START_RE);
  const cleanText = guidaIdx > 0 ? fullText.substring(0, guidaIdx) : fullText;

  // ── 2. Intestatario ────────────────────────────────────
  const intestatario =
    cleanText.match(/Intestatario:\s*([^\n\r]{3,120})/i)?.[1]?.trim() ?? '';

  // ── 3. Trova tutte le date nel testo pulito ────────────
  //    Pattern A: "DATA DI RIFERIMENTO:  marzo 2026"
  const dateRe = /DATA\s+DI\s+RIFERIMENTO:\s*((?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})/gi;
  const dateOccurrences: { label: string; sort: number; idx: number }[] = [];
  let dm: RegExpExecArray | null;

  while ((dm = dateRe.exec(cleanText)) !== null) {
    dateOccurrences.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });
  }

  // Pattern B: mese+anno nei 200 char dopo "RILEVAZIONE MENSILE"
  if (dateOccurrences.length === 0) {
    const blockRe = /RILEVAZIONE\s+MENSILE[\s\S]{0,200}?((?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})/gi;
    while ((dm = blockRe.exec(cleanText)) !== null) {
      dateOccurrences.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });
    }
  }

  // Pattern C: formato abbreviato (mar-26, dic-25)
  if (dateOccurrences.length === 0) {
    const abbrRe = /\b((?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)-\d{2})\b/gi;
    while ((dm = abbrRe.exec(cleanText)) !== null) {
      const sort = parseDateSort(dm[1]);
      if (sort > 0) dateOccurrences.push({ label: dm[1], sort, idx: dm.index });
    }
  }

  // ── 4. Seleziona il PRIMO per posizione = mese più recente ──
  // BDI mostra sempre il mese più recente come primo nel documento
  let dataRiferimento = '';
  let workText = cleanText;

  if (dateOccurrences.length > 0) {
    // Ordina per posizione nel documento
    dateOccurrences.sort((a, b) => a.idx - b.idx);
    const first = dateOccurrences[0];  // primo nel doc = più recente
    dataRiferimento = first.label;

    if (dateOccurrences.length > 1) {
      // Taglia da prima a seconda occorrenza (secondo mese)
      const second = dateOccurrences[1];
      workText = cleanText.substring(first.idx, second.idx);
    } else {
      workText = cleanText.substring(first.idx);
    }
  }

  // ── 5. Trova blocchi Intermediario ────────────────────
  // \s+ permette qualsiasi numero di spazi (pdfjs può produrne molti)
  const BANK_RE = /Intermediario:\s+([A-Z][A-Z0-9 '.,\-&/()]+?)(?=\s{3,}|\n|Crediti\s+per\s+cassa|Garanzie\s+ricevute|DATA\s+DI)/g;
  const bankBlocks: { name: string; idx: number }[] = [];
  let bm: RegExpExecArray | null;

  while ((bm = BANK_RE.exec(workText)) !== null) {
    const name = bm[1].replace(/\s+/g, ' ').trim();
    if (name.length >= 3 && name.length <= 120) {
      bankBlocks.push({ name, idx: bm.index });
    }
  }

  // Fallback: se nessun intermediario trovato nel workText, cerca in cleanText
  if (bankBlocks.length === 0) {
    BANK_RE.lastIndex = 0;
    while ((bm = BANK_RE.exec(cleanText)) !== null) {
      const name = bm[1].replace(/\s+/g, ' ').trim();
      if (name.length >= 3 && name.length <= 120) {
        bankBlocks.push({ name, idx: bm.index });
      }
    }
    if (bankBlocks.length > 0) workText = cleanText;
  }

  // ── 6. Estrai righe per ogni banca ────────────────────
  const righe: CRRiga[] = [];

  for (let bi = 0; bi < bankBlocks.length; bi++) {
    const { name: banca, idx: bankIdx } = bankBlocks[bi];
    const nextIdx = bi + 1 < bankBlocks.length ? bankBlocks[bi + 1].idx : workText.length;
    const bankText = workText.substring(bankIdx, nextIdx);

    // Sezione "Crediti per cassa"
    const ccIdx = bankText.search(/Crediti\s+per\s+cassa/i);
    if (ccIdx === -1) continue;

    const afterCC = bankText.substring(ccIdx + 20);
    const ccEndIdx = afterCC.search(CC_END_RE);
    const ccEnd = ccEndIdx !== -1 ? ccIdx + 20 + ccEndIdx : bankText.length;
    const ccText = bankText.substring(ccIdx, ccEnd);

    // Riga per categoria
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

        // Estrai numeri (esclusi anni)
        const nums = extractNums(rowText);
        if (nums.length < 3) continue;

        // Colonne finali: [RuoloAffidato] | Accordato | Acc.Op. | Utilizzato | Saldo | ImpGar
        const tail = nums.slice(-6);
        let accordato = 0, accordatoOp = 0, utilizzato = 0, saldo = 0, impGar = 0;

        if (tail.length >= 6) {
          accordato   = tail[1];
          accordatoOp = tail[2];
          utilizzato  = tail[3];
          saldo       = tail[4];
          impGar      = tail[5];
        } else if (tail.length === 5) {
          accordato   = tail[0];
          accordatoOp = tail[1];
          utilizzato  = tail[2];
          saldo       = tail[3];
          impGar      = tail[4];
        } else {
          accordato   = tail[0] ?? 0;
          accordatoOp = tail[1] ?? 0;
          utilizzato  = tail[2] ?? 0;
        }

        // Tipo garanzia
        const garPatterns: RegExp[] = [
          /IPOTECA\s+INTERNA/i, /IPOTECA\s+ESTERNA/i, /IPOTECA/i,
          /PEGNO\s+INTERNO/i, /PEGNO/i,
          /GARANZIE\s+PERSONALI\s+DI\s+PRIMA\s+ISTANZA/i,
          /GARANZIE\s+PERSONALI/i,
          /ASSENZA\s+DI\s+GARANZIE\s+REALI\s+E\/O\s+PRIVILEGI/i,
          /ASSENZA\s+DI\s+GARANZIE/i,
        ];
        let tipo_garanzia = '';
        for (const p of garPatterns) {
          const gm = rowText.match(p);
          if (gm) { tipo_garanzia = gm[0].replace(/\s+/g, ' ').trim(); break; }
        }

        // Stato rapporto
        let stato_rapporto = '';
        if (/RAPPORTI\s+NON\s+CONTESTATI/i.test(rowText))      stato_rapporto = 'Rapporti non contestati';
        else if (/SOFFERENZ/i.test(rowText))                    stato_rapporto = 'Sofferenza';
        else if (/CONTESTATI/i.test(rowText))                   stato_rapporto = 'Contestato';

        righe.push({
          banca,
          data_riferimento: dataRiferimento,
          categoria: cat,
          accordato,
          accordato_operativo: accordatoOp,
          utilizzato,
          saldo_medio:       saldo,
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
