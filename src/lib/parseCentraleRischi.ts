// ═══════════════════════════════════════════════════════════
//  PARSER CENTRALE RISCHI - BANCA D'ITALIA
//  Estrae righe "Crediti per cassa" dal testo PDF estratto
// ═══════════════════════════════════════════════════════════

export interface CRRiga {
  banca:               string;
  data_riferimento:    string;
  categoria:           string;   // RISCHI A SCADENZA / RISCHI A REVOCA / RISCHI AUTOLIQUIDANTI
  accordato:           number;
  accordato_operativo: number;
  utilizzato:          number;
  saldo_medio:         number;
  importo_garantito:   number;
  tipo_garanzia:       string;
  stato_rapporto:      string;
}

export interface CRResult {
  intestatario: string;
  data_riferimento: string;  // es. "marzo 2026"
  righe: CRRiga[];
  banche: string[];          // lista banche trovate
}

// ── mesi in italiano ──────────────────────────────────────
const MESI: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

function parseDateSort(label: string): number {
  const m = label.toLowerCase().match(/(\w+)\s+(\d{4})/);
  if (!m) return 0;
  return parseInt(m[2]) * 100 + (MESI[m[1]] ?? 0);
}

/** Converte numero italiano (1.234.567 o 1.234,56) → float */
function parseNum(s: string): number {
  if (!s || s === '0') return 0;
  const clean = s.replace(/\./g, '').replace(',', '.');
  return parseFloat(clean) || 0;
}

/** Estrae tutti i numeri italiani presenti in una stringa */
function extractNums(s: string): number[] {
  const matches = s.match(/\b(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\b/g) ?? [];
  return matches.map(parseNum);
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

  // 1. Intestatario (pagina 1)
  const intestatario = fullText.match(/Intestatario:\s*([^\n\r]+)/i)?.[1]?.trim() ?? '';

  // 2. Tutte le date DI RIFERIMENTO con posizione
  const dateRe = /DATA\s+DI\s+RIFERIMENTO:\s*((?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})/gi;
  const dates: { label: string; sort: number; idx: number }[] = [];
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(fullText)) !== null) {
    dates.push({ label: dm[1], sort: parseDateSort(dm[1]), idx: dm.index });
  }
  if (!dates.length) return { intestatario, data_riferimento: '', righe: [], banche: [] };

  // 3. Data più recente (sortKey massimo)
  const mostRecent = dates.reduce((a, b) => b.sort > a.sort ? b : a);

  // 4. Sezione della data più recente: da prima occorrenza di questa data
  //    fino alla prima occorrenza di una data meno recente
  const olderDates = dates.filter(d => d.sort < mostRecent.sort);
  const sectionEnd = olderDates.length > 0
    ? Math.min(...olderDates.map(d => d.idx))
    : fullText.length;
  const sectionText = fullText.substring(mostRecent.idx, sectionEnd);

  // 5. Trova blocchi per Intermediario
  //    Pattern: "Intermediario:  NOME BANCA" seguito da spazi/newline
  const BANK_RE = /Intermediario:\s{1,4}([A-Z'][A-Z0-9 '.,\-&]+?)(?=\s{3,}|\n|Crediti|Garanzie|DATA\s+DI)/g;
  const bankBlocks: { name: string; idx: number }[] = [];
  let bm: RegExpExecArray | null;
  while ((bm = BANK_RE.exec(sectionText)) !== null) {
    const name = bm[1].replace(/\s+/g, ' ').trim();
    if (name.length >= 3) bankBlocks.push({ name, idx: bm.index });
  }

  const righe: CRRiga[] = [];

  for (let bi = 0; bi < bankBlocks.length; bi++) {
    const { name: banca, idx: bankIdx } = bankBlocks[bi];
    const nextIdx = bi + 1 < bankBlocks.length ? bankBlocks[bi + 1].idx : sectionText.length;
    const bankText = sectionText.substring(bankIdx, nextIdx);

    // 6. Trova sezione "Crediti per cassa"
    const ccIdx = bankText.search(/Crediti\s+per\s+cassa/i);
    if (ccIdx === -1) continue;

    // Fine sezione: prima delle sezioni successive
    const afterCC = bankText.substring(ccIdx + 20);
    const ccEndRe = /Garanzie\s+ricevute|Crediti\s+di\s+firma|INFORMAZIONI\s+SUI\s+GARANTI|INFORMAZIONI\s+SUI\s+DEBITORI/i;
    const ccEndMatch = afterCC.search(ccEndRe);
    const ccEnd = ccEndMatch !== -1 ? ccIdx + 20 + ccEndMatch : bankText.length;
    const ccText = bankText.substring(ccIdx, ccEnd);

    // 7. Estrai righe per categoria
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

        // 8. Estrai numeri dal blocco riga
        //    Colonne finali (sempre): Ruolo Affidato | Accordato | Acc.Op. | Utilizzato | Saldo Medio | Importo Garantito
        const nums = extractNums(rowText);
        if (nums.length < 3) continue;

        // Prendi gli ultimi 6 (o meno)
        const tail = nums.slice(-6);
        let accordato = 0, accordato_op = 0, utilizzato = 0, saldo_medio = 0, importo_garantito = 0;
        if (tail.length >= 6) {
          // [ruolo_affidato, accordato, acc_op, utilizzato, saldo, imp_gar]
          accordato        = tail[1];
          accordato_op     = tail[2];
          utilizzato       = tail[3];
          saldo_medio      = tail[4];
          importo_garantito = tail[5];
        } else if (tail.length === 5) {
          accordato        = tail[0];
          accordato_op     = tail[1];
          utilizzato       = tail[2];
          saldo_medio      = tail[3];
          importo_garantito = tail[4];
        } else {
          accordato    = tail[0] ?? 0;
          accordato_op = tail[1] ?? 0;
          utilizzato   = tail[2] ?? 0;
        }

        // 9. Tipo garanzia
        const garPatterns = [
          /IPOTECA\s+INTERNA/i,
          /IPOTECA/i,
          /PEGNO\s+INTERNO/i,
          /PEGNO/i,
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

        // 10. Stato rapporto (primo pattern significativo)
        const statoRe = /RAPPORTI\s+NON\s+CONTESTATI[^A-Z]{0,5}/i;
        const statMatch = rowText.match(statoRe);
        const stato_rapporto = statMatch
          ? 'Rapporti non contestati'
          : (rowText.match(/SOFFERENZ/i) ? 'Sofferenza' : '');

        righe.push({
          banca,
          data_riferimento: mostRecent.label,
          categoria: cat,
          accordato,
          accordato_operativo: accordato_op,
          utilizzato,
          saldo_medio,
          importo_garantito,
          tipo_garanzia,
          stato_rapporto,
        });
      }
    }
  }

  const banche = [...new Set(righe.map(r => r.banca))];
  return { intestatario, data_riferimento: mostRecent.label, righe, banche };
}
