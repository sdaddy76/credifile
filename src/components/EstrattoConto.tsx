// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Upload, Trash2, RefreshCw, TrendingUp, TrendingDown, AlertCircle, FileText, Users, Building2, Receipt, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';
import { classificaTransazione } from '@/lib/classificaTransazione';

/* ─────────────────────────────────────────────
   CSV / XLS PARSING
───────────────────────────────────────────── */

/** Normalizza una stringa header per il confronto */
function normHdr(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

/** Parser CSV robusto: gestisce separatori , e ; e campi quoted */
function parseCsvText(text: string): string[][] {
  // Rimuove BOM (UTF-8 con BOM da Excel)
  const clean = text.replace(/^\uFEFF/, '');
  // Auto-detect separatore: conta ; vs , nella prima riga
  const firstLine = clean.split('\n')[0] ?? '';
  const sep = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuote = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuote) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === sep) {
        row.push(field.trim());
        field = '';
      } else if (ch === '\n') {
        row.push(field.trim());
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
        field = '';
        if (clean[i + 1] === '\r') i++; // CRLF
      } else if (ch === '\r') {
        // skip bare CR
      } else {
        field += ch;
      }
    }
  }
  if (field || row.length) { row.push(field.trim()); if (row.some(c => c !== '')) rows.push(row); }
  return rows;
}

interface ColMap {
  date?: number;       // data operazione/valuta
  date2?: number;      // seconda data (valuta o contabile)
  desc?: number;       // descrizione/causale
  dare?: number;       // addebito/uscita/dare
  avere?: number;      // accredito/entrata/avere
  importo?: number;    // importo unico con segno
  saldo?: number;      // saldo progressivo
}

/** Rileva automaticamente le colonne di un estratto conto italiano */
function detectColumns(headers: string[]): ColMap {
  const nh = headers.map(normHdr);
  const col: ColMap = {};

  nh.forEach((h, i) => {
    // Date
    if (col.date === undefined && (h.includes('data op') || h.includes('data cont') || h === 'data' || h.startsWith('data ') || h === 'date')) col.date = i;
    else if (col.date2 === undefined && (h.includes('data val') || h.includes('valuta') || h === 'data valuta')) col.date2 = i;

    // Descrizione
    if (col.desc === undefined && (h.includes('descriz') || h.includes('causal') || h.includes('movim') || h.includes('operaz') || h === 'nota' || h === 'dettaglio' || h.includes('dett'))) col.desc = i;

    // Dare (uscita)
    if (col.dare === undefined && (h === 'dare' || h.includes('addeb') || h === 'uscite' || h === 'uscita' || h.includes('debit') || h.includes('pagam'))) col.dare = i;

    // Avere (entrata)
    if (col.avere === undefined && (h === 'avere' || h.includes('accred') || h === 'entrate' || h === 'entrata' || h.includes('credit'))) col.avere = i;

    // Importo unico
    if (col.importo === undefined && !col.dare && !col.avere &&
        (h === 'importo' || h === 'importo (eur)' || h === 'importo eur' || h === 'amount' || h === 'valore' || h.startsWith('importo'))) col.importo = i;

    // Saldo
    if (col.saldo === undefined && (h.includes('saldo') || h === 'balance')) col.saldo = i;
  });

  return col;
}

/** Converte un importo testuale italiano ("1.234,56" o "-1234.56") in numero */
function parseNum(s: string): number {
  if (!s) return 0;
  // Rimuove simboli valuta e spazi
  let t = s.replace(/[€$£\s]/g, '').replace(/'/g, '');
  // Formato italiano: 1.234,56
  if (/\d,\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  // Formato anglosassone: 1,234.56 — già OK per parseFloat
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}

/** Converte righe tabellari in Transazioni usando la ColMap */
function righeToTransazioni(
  rows: string[][],
  col: ColMap,
  fileName: string,
  practiceId: string,
): Transazione[] {
  const result: Transazione[] = [];

  for (const row of rows) {
    if (row.length < 2) continue;

    // Descrizione
    const desc = col.desc !== undefined ? row[col.desc] ?? '' : row.slice(1).join(' ');
    if (!desc.trim()) continue;

    // Data
    let dataStr: string | undefined;
    const rawDate = col.date !== undefined ? row[col.date] : undefined;
    if (rawDate) {
      // Tenta parsing date in vari formati
      const mIT = /(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/.exec(rawDate);
      const mISO = /(\d{4})[.\-](\d{2})[.\-](\d{2})/.exec(rawDate);
      if (mISO) dataStr = `${mISO[1]}-${mISO[2]}-${mISO[3]}`;
      else if (mIT) {
        const a = mIT[3].length === 2 ? `20${mIT[3]}` : mIT[3];
        dataStr = `${a}-${mIT[2].padStart(2,'0')}-${mIT[1].padStart(2,'0')}`;
      }
    }

    // Importo e tipo
    let importoAbs = 0;
    let tipo: 'entrata' | 'uscita' = 'altro' as any;

    if (col.dare !== undefined && col.avere !== undefined) {
      const dare = Math.abs(parseNum(row[col.dare] ?? ''));
      const avere = Math.abs(parseNum(row[col.avere] ?? ''));
      if (dare > 0) { importoAbs = dare; tipo = 'uscita'; }
      else if (avere > 0) { importoAbs = avere; tipo = 'entrata'; }
      else continue; // riga senza importo
    } else if (col.importo !== undefined) {
      const val = parseNum(row[col.importo] ?? '');
      if (val === 0) continue;
      importoAbs = Math.abs(val);
      tipo = val >= 0 ? 'entrata' : 'uscita';
    } else {
      // Fallback: cerca il primo numero nella riga
      for (const cell of row) {
        const v = parseNum(cell);
        if (Math.abs(v) > 0.005) { importoAbs = Math.abs(v); tipo = v >= 0 ? 'entrata' : 'uscita'; break; }
      }
      if (importoAbs === 0) continue;
    }

    // Saldo
    const saldo = col.saldo !== undefined ? Math.abs(parseNum(row[col.saldo] ?? '')) || undefined : undefined;

    const categoria = classificaTransazione(desc, tipo);

    result.push({
      practice_id: practiceId,
      data_valuta: dataStr,
      importo: importoAbs,
      tipo,
      categoria,
      descrizione: desc.substring(0, 200),
      saldo_progressivo: saldo,
      file_nome: fileName,
    });
  }
  return result;
}

/** Legge un file CSV (testo) e restituisce le transazioni */
function parseCsvFile(text: string, fileName: string, practiceId: string): Transazione[] {
  const rows = parseCsvText(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const col = detectColumns(headers);
  // Se non troviamo nessuna colonna utile, proviamo a considerare che la prima riga sia già dati
  if (col.date === undefined && col.importo === undefined && col.dare === undefined) {
    // Prova senza header (raw numeric scan)
    return [];
  }
  return righeToTransazioni(rows.slice(1), col, fileName, practiceId);
}

/** Legge un file XLS/XLSX con SheetJS e restituisce le transazioni */
function parseXlsxFile(arrayBuffer: ArrayBuffer, fileName: string, practiceId: string): Transazione[] {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // Converte in array di array (AOA)
  const aoa: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as string[][];
  if (aoa.length < 2) return [];

  // Cerca la riga header (la prima con almeno 3 celle non vuote)
  let headerRow = 0;
  for (let i = 0; i < Math.min(10, aoa.length); i++) {
    if (aoa[i].filter(c => c && String(c).trim()).length >= 3) { headerRow = i; break; }
  }
  const headers = aoa[headerRow].map(c => String(c));
  const col = detectColumns(headers);
  const dataRows = aoa.slice(headerRow + 1).map(r => r.map(c => String(c)));
  return righeToTransazioni(dataRows, col, fileName, practiceId);
}

/* ─────────────────────────────────────────────
   TYPES
───────────────────────────────────────────── */

interface Props { practiceId: string }

interface Transazione {
  id?: string;
  practice_id?: string;
  data_valuta?: string;
  data_contabile?: string;
  importo: number;
  tipo: 'entrata' | 'uscita';
  categoria: 'incasso_cliente' | 'anticipo_sbf' | 'versamento' | 'altro_entrata' | 'fornitore' | 'rata_finanziamento' | 'tributo' | 'stipendio' | 'spesa_bancaria' | 'prelievo' | 'altro_uscita' | 'cliente' | 'altro';
  descrizione: string;
  beneficiario_ordinante?: string;
  saldo_progressivo?: number;
  file_nome?: string;
}

interface Kpi {
  totale_entrate: number;
  totale_uscite: number;
  entrate_clienti: number;
  uscite_stipendi: number;
  uscite_fornitori: number;
  uscite_tributi: number;
  uscite_rate_finanziamenti: number;
  uscite_spese_bancarie: number;
  uscite_prelievi: number;
  uscite_altro: number;
  saldo_netto: number;
  num_transazioni: number;
  indice_liquidita: number;
}

interface KpiMensili {
  mesiAnalizzati: number;
  mediaIncassiClienti: number;
  mediaPagamentiFornitori: number;
  mediaRateFinanziamenti: number;
  mediaTributi: number;
  saldoOperativoMedio: number;
  mesiSaldoNegativo: number;
  meseIncassiMassimi: { mese: string; valore: number } | null;
  meseUsciteMassime: { mese: string; valore: number } | null;
}

/* ─────────────────────────────────────────────
   CONSTANTS / CLASSIFICATION RULES
───────────────────────────────────────────── */

/** Parole chiave che in una riga PDF indicano DARE (uscita) — usate da parseRighe
 *  quando non c'è separazione esplicita DARE/AVERE */
const KW_RIGA_DARE = [
  'VOSTRO ASSEGNO BANCARIO',          // assegno emesso
  'VOSTRA DISPOSIZIONE A FAVORE',     // bonifico uscita MPS
  'BON.SEPA TELEMATICO',              // bonifico SEPA uscita
  'PAGAMENTI DIVERSI',                // addebiti vari
  'ADDEBITO DIRETTO', 'ADDEBITO SDD', // RID/SDD
  'PRELEVAMENTO', 'PREL. CONT',       // prelievi ATM
  'COMMISSIONI SBF', 'COMMISSIONI ',  // spese bancarie
  'PAGAMENTO RATA', 'RIMBORSO FINANZ',// rate mutuo/finanziamento
  'ADD/PREMI', 'PREMI ASS',           // premi assicurativi addebito
  'ADDEBITO RATA', 'ADDEBITO LEASING',
];

/* ─────────────────────────────────────────────
   PDF PARSING
───────────────────────────────────────────── */

/** Estrae testo dal PDF ricostruendo righe per coordinata Y */
async function estraiTestoPdf(arrayBuffer: ArrayBuffer): Promise<string[][]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const allLines: string[][] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Raggruppa token per coordinata Y (tolleranza 3pt), registrando anche X
    const byY: Map<number, Array<{ str: string; x: number }>> = new Map();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round((item as any).transform[5] / 3) * 3;
      const x = (item as any).transform[4] as number;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ str: (item as any).str, x });
    }
    // Ordina per Y decrescente (top→bottom), poi per X crescente (sinistra→destra)
    const sorted = [...byY.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, tokObjs] of sorted) {
      tokObjs.sort((a, b) => a.x - b.x); // sinistra → destra garantisce: data | desc | importo | saldo
      const tokens = tokObjs.map(t => t.str);
      const line = tokens.join(' ').trim();
      if (line) allLines.push(tokens);
    }
  }
  return allLines;
}

/** Regexp per date italiane */
const RE_DATA = /\b(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/;
/** Regexp per importi con virgola decimale (es. 1.234,56 oppure 1234,56) */
const RE_IMPORTO = /([+-]?\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?)\s*([+-])?/;
/** Regexp per segnale di segno esplicito */
const RE_SEGNO = /^[+-]$/;

function parseImporto(str: string): number | null {
  // Rimuove punti migliaia, sostituisce virgola con punto
  const clean = str.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function dataISO(giorno: string, mese: string, anno: string): string {
  const g = giorno.padStart(2, '0');
  const m = mese.padStart(2, '0');
  const a = anno.length === 2 ? `20${anno}` : anno;
  return `${a}-${m}-${g}`;
}

/**
 * Analizza le righe di testo e tenta di estrarre transazioni.
 * Gestisce i formati più comuni degli estratti conto italiani.
 */
function parseRighe(righe: string[][]): Transazione[] {
  const transazioni: Transazione[] = [];

  for (const tokens of righe) {
    const riga = tokens.join(' ');
    if (!riga.trim() || riga.length < 10) continue;

    // Cerca data (contabile o valuta)
    const mData = RE_DATA.exec(riga);
    if (!mData) continue;

    // Cerca almeno un importo nella riga
    // Strategia: raccoglie tutti i token numerici
    const numeri: number[] = [];
    for (const tok of tokens) {
      const cleaned = tok.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
      const n = parseFloat(cleaned);
      if (!isNaN(n) && Math.abs(n) > 0.01 && cleaned.includes('.') === false && tok.includes(',')) {
        numeri.push(n);
      }
    }

    // Cerca importi con virgola decimale (formato italiano: 1.234,56)
    const importiMatch = [...riga.matchAll(/([+-]?\s*\d{1,3}(?:\.\d{3})*,\d{2})/g)];
    if (importiMatch.length === 0) continue;

    // Raccoglie tutti gli importi trovati sulla riga
    const allAmounts = importiMatch
      .map(m => ({ raw: m[1].replace(/\s/g, ''), val: parseImporto(m[1].replace(/\s/g, '')) }))
      .filter((a): a is { raw: string; val: number } => a.val !== null && Math.abs(a.val) > 0.005);
    if (allAmounts.length === 0) continue;

    // Selezione importo transazione vs saldo progressivo:
    // Se ci sono ≥2 importi e il massimo è ≥10× il minimo → il massimo è il saldo, prende il minimo
    // (tipico estratto conto IT: data | desc | importo_transazione | saldo_conto)
    let importoVal: number;
    let importoRaw: string;
    if (allAmounts.length === 1) {
      importoVal = allAmounts[0].val;
      importoRaw = allAmounts[0].raw;
    } else {
      const absVals = allAmounts.map(a => Math.abs(a.val));
      const maxAbs = Math.max(...absVals);
      const minAbs = Math.min(...absVals);
      if (maxAbs / (minAbs || 0.01) >= 10) {
        // Il massimo è quasi certamente il saldo: sceglie il non-massimo più a sinistra
        const chosen = allAmounts.find(a => Math.abs(a.val) < maxAbs) ?? allAmounts[0];
        importoVal = chosen.val;
        importoRaw = chosen.raw;
      } else {
        // Valori comparabili: prende il primo in ordine visivo (già ordinato per X)
        importoVal = allAmounts[0].val;
        importoRaw = allAmounts[0].raw;
      }
    }
    if (importoVal === 0) continue;

    // Determina tipo (entrata/uscita) da segno o contesto
    let tipo: 'entrata' | 'uscita' = importoVal >= 0 ? 'entrata' : 'uscita';
    const rigaUp = riga.toUpperCase();

    // Segnali espliciti di debito/credito nel testo
    if (rigaUp.includes(' DARE ') || rigaUp.includes('ADDEBIT') || rigaUp.includes('USCITA') || rigaUp.includes(' D ')) {
      tipo = 'uscita';
    }
    if (rigaUp.includes(' AVERE ') || rigaUp.includes('ACCREDIT') || rigaUp.includes('ENTRATA') || rigaUp.includes(' A ')) {
      tipo = 'entrata';
    }

    // Override con le keyword MPS specifiche di DARE (uscita)
    // Nel PDF MPS le colonne DARE/AVERE non portano segno separato nei token,
    // quindi si usa il contenuto descrittivo per determinare la direzione.
    if (KW_RIGA_DARE.some(k => rigaUp.includes(k))) {
      tipo = 'uscita';
    }
    // "BONIFICO A VOSTRO FAVORE" è sempre entrata (incasso da cliente)
    if (rigaUp.includes('BONIFICO A VOSTRO FAVORE')) {
      tipo = 'entrata';
    }

    const importoAbs = Math.abs(importoVal);

    // Descrizione: tutto ciò che non è data o importo
    const desc = tokens
      .filter(t => {
        if (RE_DATA.test(t)) return false;
        if (/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(t.trim())) return false;
        if (/^[+-]$/.test(t.trim())) return false;
        if (t.trim().length < 2) return false;
        return true;
      })
      .join(' ')
      .trim();

    if (!desc || importoAbs < 0.01) continue;

    const categoria = classificaTransazione(desc, tipo);
    const dataISO_str = dataISO(mData[1], mData[2], mData[3]);

    // Saldo progressivo: il valore assoluto massimo tra tutti gli importi trovati
    let saldo: number | undefined;
    if (allAmounts.length >= 2) {
      saldo = Math.max(...allAmounts.map(a => Math.abs(a.val)));
    }

    transazioni.push({
      data_valuta: dataISO_str,
      importo: importoAbs,
      tipo,
      categoria,
      descrizione: desc.substring(0, 200),
      saldo_progressivo: saldo,
    });
  }

  // Deduplicazione: rimuove duplicati esatti (stessa data + importo + descrizione)
  const seen = new Set<string>();
  const deduped = transazioni.filter(t => {
    const key = `${t.data_valuta}|${t.importo}|${t.descrizione.substring(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Outlier filter: se l'importo massimo è > 100× il secondo massimo, è quasi
  // certamente un saldo progressivo estratto erroneamente come importo transazione.
  // (es. MPS: riga con solo saldo 17.978.187.186,85 senza importo transazione separato)
  if (deduped.length >= 2) {
    const sortedDesc = [...deduped].sort((a, b) => b.importo - a.importo);
    const maxImporto = sortedDesc[0].importo;
    const secondoMassimo = sortedDesc[1].importo;
    if (secondoMassimo > 0 && maxImporto / secondoMassimo > 100) {
      return deduped.filter(t => t.importo <= secondoMassimo * 100);
    }
  }
  return deduped;
}

/* ─────────────────────────────────────────────
   KPI CALCULATION
───────────────────────────────────────────── */

function isIncassoCliente(categoria: string) {
  return categoria === 'incasso_cliente' || categoria === 'cliente';
}

function isAltroEntrata(categoria: string) {
  return categoria === 'altro_entrata' || categoria === 'altro';
}

function isAltroUscita(categoria: string) {
  return categoria === 'altro_uscita' || categoria === 'altro';
}

function calcolaKpi(transazioni: Transazione[]): Kpi {
  let totale_entrate = 0, totale_uscite = 0;
  let entrate_clienti = 0, uscite_stipendi = 0;
  let uscite_fornitori = 0, uscite_tributi = 0, uscite_altro = 0;
  let uscite_rate_finanziamenti = 0, uscite_spese_bancarie = 0, uscite_prelievi = 0;

  for (const t of transazioni) {
    if (t.tipo === 'entrata') {
      totale_entrate += t.importo;
      if (isIncassoCliente(t.categoria)) entrate_clienti += t.importo;
    } else {
      totale_uscite += t.importo;
      if (t.categoria === 'stipendio') uscite_stipendi += t.importo;
      else if (t.categoria === 'fornitore') uscite_fornitori += t.importo;
      else if (t.categoria === 'tributo') uscite_tributi += t.importo;
      else if (t.categoria === 'rata_finanziamento') uscite_rate_finanziamenti += t.importo;
      else if (t.categoria === 'spesa_bancaria') uscite_spese_bancarie += t.importo;
      else if (t.categoria === 'prelievo') uscite_prelievi += t.importo;
      else if (isAltroUscita(t.categoria)) uscite_altro += t.importo;
    }
  }

  return {
    totale_entrate,
    totale_uscite,
    entrate_clienti,
    uscite_stipendi,
    uscite_fornitori,
    uscite_tributi,
    uscite_rate_finanziamenti,
    uscite_spese_bancarie,
    uscite_prelievi,
    uscite_altro,
    saldo_netto: totale_entrate - totale_uscite,
    num_transazioni: transazioni.length,
    indice_liquidita: totale_uscite > 0 ? totale_entrate / totale_uscite : 0,
  };
}

function monthKeyFromDate(dateStr?: string) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function eachMonthKey(start: string, end: string): string[] {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const keys: string[] = [];
  const d = new Date(sy, sm - 1, 1);
  const endD = new Date(ey, em - 1, 1);
  while (d <= endD) {
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return keys;
}

function labelMese(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

function calcolaKpiMensili(transazioni: Transazione[]): KpiMensili | null {
  const validKeys = transazioni.map(t => monthKeyFromDate(t.data_valuta)).filter(Boolean) as string[];
  if (validKeys.length === 0) return null;
  const range = eachMonthKey(validKeys.sort()[0], validKeys.sort()[validKeys.length - 1]);
  const byMonth = new Map<string, { incassi: number; fornitori: number; rate: number; tributi: number; uscite: number }>();
  range.forEach(k => byMonth.set(k, { incassi: 0, fornitori: 0, rate: 0, tributi: 0, uscite: 0 }));

  for (const t of transazioni) {
    const key = monthKeyFromDate(t.data_valuta);
    if (!key || !byMonth.has(key)) continue;
    const m = byMonth.get(key)!;
    if (t.tipo === 'entrata' && isIncassoCliente(t.categoria)) m.incassi += t.importo;
    if (t.tipo === 'uscita') {
      m.uscite += t.importo;
      if (t.categoria === 'fornitore') m.fornitori += t.importo;
      else if (t.categoria === 'rata_finanziamento') m.rate += t.importo;
      else if (t.categoria === 'tributo') m.tributi += t.importo;
    }
  }

  const mesi = Math.max(1, range.length);
  const values = [...byMonth.entries()];
  const sum = (field: 'incassi' | 'fornitori' | 'rate' | 'tributi') => values.reduce((s, [, v]) => s + v[field], 0);
  const saldoOperativo = values.map(([mese, v]) => ({ mese, valore: v.incassi - v.fornitori - v.rate - v.tributi }));
  const incassiMax = values.reduce((best, cur) => cur[1].incassi > best[1].incassi ? cur : best, values[0]);
  const usciteMax = values.reduce((best, cur) => cur[1].uscite > best[1].uscite ? cur : best, values[0]);

  return {
    mesiAnalizzati: mesi,
    mediaIncassiClienti: sum('incassi') / mesi,
    mediaPagamentiFornitori: sum('fornitori') / mesi,
    mediaRateFinanziamenti: sum('rate') / mesi,
    mediaTributi: sum('tributi') / mesi,
    saldoOperativoMedio: saldoOperativo.reduce((s, v) => s + v.valore, 0) / mesi,
    mesiSaldoNegativo: saldoOperativo.filter(v => v.valore < 0).length,
    meseIncassiMassimi: incassiMax ? { mese: labelMese(incassiMax[0]), valore: incassiMax[1].incassi } : null,
    meseUsciteMassime: usciteMax ? { mese: labelMese(usciteMax[0]), valore: usciteMax[1].uscite } : null,
  };
}

/* ─────────────────────────────────────────────
   HELPERS UI
───────────────────────────────────────────── */

const fmt = (n: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);

const CATEGORIA_STYLE: Record<string, { label: string; cls: string }> = {
  incasso_cliente:     { label: 'Incasso cliente',       cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  anticipo_sbf:        { label: 'Anticipo SBF',          cls: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
  versamento:          { label: 'Versamento',            cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  altro_entrata:       { label: 'Altra entrata',         cls: 'bg-teal-100 text-teal-800 border-teal-200' },
  fornitore:           { label: 'Fornitore',             cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  rata_finanziamento:  { label: 'Rata finanziamento',    cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  tributo:             { label: 'Tributo',               cls: 'bg-red-100 text-red-800 border-red-200' },
  stipendio:           { label: 'Stipendio',             cls: 'bg-purple-100 text-purple-800 border-purple-200' },
  spesa_bancaria:      { label: 'Spesa bancaria',        cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  prelievo:            { label: 'Prelievo',              cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  altro_uscita:        { label: 'Altra uscita',          cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  // Compatibilità dati già salvati con le vecchie categorie
  cliente:             { label: 'Incasso cliente',       cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  altro:               { label: 'Altro (storico)',       cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

const CATEGORIE_FILTRO = [
  'tutti', 'incasso_cliente', 'anticipo_sbf', 'versamento', 'altro_entrata',
  'fornitore', 'rata_finanziamento', 'tributo', 'stipendio', 'spesa_bancaria',
  'prelievo', 'altro_uscita', 'cliente', 'altro',
] as const;

/* ─────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────── */

export function EstrattoConto({ practiceId }: Props) {
  const [transazioni, setTransazioni] = useState<Transazione[]>([]);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [kpiMensiliOpen, setKpiMensiliOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parsingCsv, setParsingCsv] = useState(false);
  const [filtroCategoria, setFiltroCategoria] = useState<string>('tutti');
  const [filtroTipo, setFiltroTipo] = useState<string>('tutti');
  const [dbAvailable, setDbAvailable] = useState<boolean | null>(null);
  const [fileNome, setFileNome] = useState<string>('');

  /* ── Load from DB ── */
  const loadFromDb = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('estratto_conto_transactions')
        .select('*')
        .eq('practice_id', practiceId)
        .order('data_valuta', { ascending: true });

      if (error) {
        // Tabella non ancora creata
        if (error.code === '42P01' || error.message?.includes('does not exist')) {
          setDbAvailable(false);
        } else {
          console.error('Errore caricamento estratto conto:', error);
        }
        setLoading(false);
        return;
      }
      setDbAvailable(true);
      if (data && data.length > 0) {
        setTransazioni(data as Transazione[]);
        setKpi(calcolaKpi(data as Transazione[]));
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [practiceId]);

  useEffect(() => { loadFromDb(); }, [loadFromDb]);

  /* ── Upload & Parse ── */
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Seleziona un file PDF');
      return;
    }

    setParsing(true);
    setFileNome(file.name);
    toast.info('Analisi estratto conto in corso…');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const righe = await estraiTestoPdf(arrayBuffer);
      const parsed = parseRighe(righe);

      if (parsed.length === 0) {
        toast.warning('Nessuna transazione rilevata. Il formato del PDF potrebbe non essere supportato.');
        setParsing(false);
        return;
      }

      // Aggiunge nome file e practice_id
      const withMeta = parsed.map(t => ({
        ...t,
        practice_id: practiceId,
        file_nome: file.name,
      }));

      setTransazioni(withMeta);
      setKpi(calcolaKpi(withMeta));
      toast.success(`Rilevate ${parsed.length} transazioni`);

      // Salva su DB
      if (dbAvailable !== false) {
        const { error: delErr } = await supabase
          .from('estratto_conto_transactions')
          .delete()
          .eq('practice_id', practiceId)
          .eq('file_nome', file.name);

        const { error: insErr } = await supabase
          .from('estratto_conto_transactions')
          .insert(withMeta);

        if (insErr) {
          if (insErr.code === '42P01') {
            setDbAvailable(false);
            toast.warning('Transazioni analizzate ma non salvate — applica la migration SQL dal Supabase Dashboard');
          } else {
            console.error('Errore salvataggio:', insErr);
            toast.warning('Analisi completata, ma salvataggio su DB non riuscito');
          }
        } else {
          setDbAvailable(true);
          toast.success('Transazioni salvate nel database');
        }
      }
    } catch (err) {
      console.error('Errore parsing PDF:', err);
      toast.error('Errore durante l\'analisi del PDF');
    }
    setParsing(false);
    // Reset input
    e.target.value = '';
  }, [practiceId, dbAvailable]);

  /* ── Upload CSV / XLS ── */
  const handleUploadCsv = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['csv', 'xls', 'xlsx', 'ods'].includes(ext)) {
      toast.error('Seleziona un file CSV, XLS o XLSX');
      return;
    }

    setParsingCsv(true);
    setFileNome(file.name);
    toast.info('Importazione CSV/XLS in corso…');

    try {
      const arrayBuffer = await file.arrayBuffer();
      let parsed: Transazione[] = [];

      if (ext === 'csv') {
        const text = new TextDecoder('utf-8').decode(arrayBuffer);
        parsed = parseCsvFile(text, file.name, practiceId);
      } else {
        parsed = parseXlsxFile(arrayBuffer, file.name, practiceId);
      }

      if (parsed.length === 0) {
        toast.warning('Nessuna transazione rilevata. Verifica che il file abbia intestazioni riconoscibili (es. Data, Descrizione, Dare/Avere o Importo).');
        setParsingCsv(false);
        return;
      }

      setTransazioni(parsed);
      setKpi(calcolaKpi(parsed));
      toast.success(`Importate ${parsed.length} transazioni da ${ext.toUpperCase()}`);

      // Salva su DB
      if (dbAvailable !== false) {
        await supabase.from('estratto_conto_transactions').delete().eq('practice_id', practiceId).eq('file_nome', file.name);
        const { error: insErr } = await supabase.from('estratto_conto_transactions').insert(parsed);
        if (insErr) {
          if (insErr.code === '42P01') {
            setDbAvailable(false);
            toast.warning('Importate ma non salvate — applica la migration SQL');
          } else {
            toast.warning('Importazione completata, salvataggio DB non riuscito');
          }
        } else {
          setDbAvailable(true);
          toast.success('Transazioni salvate nel database');
        }
      }
    } catch (err) {
      console.error('Errore importazione CSV/XLS:', err);
      toast.error('Errore durante l\'importazione del file');
    }
    setParsingCsv(false);
    e.target.value = '';
  }, [practiceId, dbAvailable]);

  /* ── Delete All ── */
  const handleDeleteAll = useCallback(async () => {
    if (!confirm('Eliminare tutte le transazioni per questa pratica?')) return;
    setLoading(true);
    if (dbAvailable) {
      await supabase
        .from('estratto_conto_transactions')
        .delete()
        .eq('practice_id', practiceId);
    }
    setTransazioni([]);
    setKpi(null);
    setLoading(false);
    toast.success('Transazioni eliminate');
  }, [practiceId, dbAvailable]);

  /* ── Filtered transactions ── */
  const transFiltered = transazioni.filter(t => {
    if (filtroCategoria !== 'tutti' && t.categoria !== filtroCategoria) return false;
    if (filtroTipo !== 'tutti' && t.tipo !== filtroTipo) return false;
    return true;
  });

  /* ── Health indicator ── */
  const salute = (): { label: string; cls: string; desc: string } => {
    if (!kpi) return { label: '—', cls: 'bg-gray-100 text-gray-500', desc: '' };
    const il = kpi.indice_liquidita;
    if (il >= 1.2) return { label: 'Buona', cls: 'bg-green-100 text-green-800', desc: 'Entrate superiori alle uscite' };
    if (il >= 0.9) return { label: 'Sufficiente', cls: 'bg-amber-100 text-amber-800', desc: 'Entrate vicine alle uscite' };
    return { label: 'Attenzione', cls: 'bg-red-100 text-red-800', desc: 'Uscite superiori alle entrate' };
  };

  const s = salute();
  const kpiMensili = calcolaKpiMensili(transazioni);

  /* ── RENDER ── */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Analisi Estratto Conto</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Carica il PDF oppure importa il CSV/XLS dall'area clienti della banca per rilevare incassi, anticipi SBF, fornitori, rate, tributi e spese bancarie
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadFromDb}
            disabled={loading}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Aggiorna
          </Button>
          {transazioni.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteAll}
              className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Cancella
            </Button>
          )}
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".csv,.xls,.xlsx,.ods"
              className="hidden"
              onChange={handleUploadCsv}
              disabled={parsingCsv || parsing}
            />
            <Button asChild size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={parsingCsv || parsing}>
              <span>
                {parsingCsv
                  ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Import…</>
                  : <><Upload className="h-3.5 w-3.5" /> CSV / XLS</>
                }
              </span>
            </Button>
          </label>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={handleUpload}
              disabled={parsing || parsingCsv}
            />
            <Button asChild size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700" disabled={parsing || parsingCsv}>
              <span>
                {parsing
                  ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Analisi…</>
                  : <><Upload className="h-3.5 w-3.5" /> PDF</>
                }
              </span>
            </Button>
          </label>
        </div>
      </div>

      {/* DB warning */}
      {dbAvailable === false && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-2 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <span className="font-medium">Tabella DB non trovata.</span>{' '}
            Applica il file <code className="bg-amber-100 px-1 rounded">supabase/migrations/20260614_estratto_conto.sql</code> dal{' '}
            <a href="https://supabase.com/dashboard/project/fhieppjqlefdlanvrpik/sql/new" target="_blank" rel="noreferrer" className="underline font-medium">
              Supabase SQL Editor
            </a>
            . I dati analizzati sono visibili ma non salvati.
          </div>
        </div>
      )}

      {/* Empty state */}
      {transazioni.length === 0 && !loading && !parsing && (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 py-12 text-center">
          <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Nessuna transazione caricata</p>
          <p className="text-xs text-gray-400 mt-1">Carica il PDF dell'estratto conto bancario</p>
        </div>
      )}

      {/* KPI cards */}
      {kpi && (
        <>
          {/* Stato di salute */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-600">Stato di salute:</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
            {s.desc && <span className="text-xs text-gray-400">{s.desc}</span>}
            <span className="text-xs text-gray-400 ml-auto">
              Indice liquidità: <span className="font-semibold text-gray-700">{kpi.indice_liquidita.toFixed(2)}</span>
              {fileNome && <> · <span className="text-blue-600">{fileNome}</span></>}
            </span>
          </div>

          {/* KPI cards row 1: entrate/uscite */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="border-green-100 bg-green-50">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-green-700 flex items-center gap-1">
                  <TrendingUp className="h-3.5 w-3.5" /> Totale Entrate
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-green-800">{fmt(kpi.totale_entrate)}</p>
                <p className="text-[10px] text-green-600">Da clienti: {fmt(kpi.entrate_clienti)}</p>
              </CardContent>
            </Card>

            <Card className="border-red-100 bg-red-50">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-red-700 flex items-center gap-1">
                  <TrendingDown className="h-3.5 w-3.5" /> Totale Uscite
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-red-800">{fmt(kpi.totale_uscite)}</p>
                <p className="text-[10px] text-red-600">{kpi.num_transazioni} transazioni</p>
              </CardContent>
            </Card>

            <Card className={`${kpi.saldo_netto >= 0 ? 'border-blue-100 bg-blue-50' : 'border-orange-100 bg-orange-50'}`}>
              <CardHeader className="py-2 px-3">
                <CardTitle className={`text-xs font-medium flex items-center gap-1 ${kpi.saldo_netto >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>
                  <Receipt className="h-3.5 w-3.5" /> Saldo Netto
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className={`text-lg font-bold ${kpi.saldo_netto >= 0 ? 'text-blue-800' : 'text-orange-800'}`}>
                  {fmt(kpi.saldo_netto)}
                </p>
                <p className="text-[10px] text-gray-500">Entrate − Uscite</p>
              </CardContent>
            </Card>

            <Card className="border-purple-100 bg-purple-50">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-purple-700 flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> Costo Personale
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-lg font-bold text-purple-800">{fmt(kpi.uscite_stipendi)}</p>
                <p className="text-[10px] text-purple-600">
                  {kpi.totale_uscite > 0 ? ((kpi.uscite_stipendi / kpi.totale_uscite) * 100).toFixed(1) : 0}% delle uscite
                </p>
              </CardContent>
            </Card>
          </div>

          {/* KPI cards row 2: breakdown uscite */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="border-orange-100 bg-orange-50">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-orange-700 flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" /> Fornitori
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-base font-bold text-orange-800">{fmt(kpi.uscite_fornitori)}</p>
                <p className="text-[10px] text-orange-600">
                  {kpi.totale_uscite > 0 ? ((kpi.uscite_fornitori / kpi.totale_uscite) * 100).toFixed(1) : 0}% delle uscite
                </p>
              </CardContent>
            </Card>

            <Card className="border-red-100 bg-red-50/60">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-red-700 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> Tributi / F24
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-base font-bold text-red-800">{fmt(kpi.uscite_tributi)}</p>
                <p className="text-[10px] text-red-600">
                  {kpi.totale_uscite > 0 ? ((kpi.uscite_tributi / kpi.totale_uscite) * 100).toFixed(1) : 0}% delle uscite
                </p>
              </CardContent>
            </Card>

            <Card className="border-gray-100 bg-gray-50">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-gray-600 flex items-center gap-1">
                  <HelpCircle className="h-3.5 w-3.5" /> Altro
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-base font-bold text-gray-700">{fmt(kpi.uscite_altro)}</p>
                <p className="text-[10px] text-gray-500">
                  {kpi.totale_uscite > 0 ? ((kpi.uscite_altro / kpi.totale_uscite) * 100).toFixed(1) : 0}% delle uscite
                </p>
              </CardContent>
            </Card>

            <Card className="border-blue-100 bg-blue-50/60">
              <CardHeader className="py-2 px-3">
                <CardTitle className="text-xs font-medium text-blue-700 flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> Entrate Clienti
                </CardTitle>
              </CardHeader>
              <CardContent className="py-1 px-3">
                <p className="text-base font-bold text-blue-800">{fmt(kpi.entrate_clienti)}</p>
                <p className="text-[10px] text-blue-600">
                  {kpi.totale_entrate > 0 ? ((kpi.entrate_clienti / kpi.totale_entrate) * 100).toFixed(1) : 0}% delle entrate
                </p>
              </CardContent>
            </Card>
          </div>

          {/* KPI Mensili collassabili */}
          {kpiMensili && (
            <Card className="border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => setKpiMensiliOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
              >
                <div>
                  <CardTitle className="text-sm text-slate-800">KPI Mensili</CardTitle>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Calcolati sull'intervallo date valuta: {kpiMensili.mesiAnalizzati} mesi analizzati
                  </p>
                </div>
                <span className="text-xs font-medium text-slate-500">{kpiMensiliOpen ? 'Nascondi' : 'Mostra'}</span>
              </button>
              {kpiMensiliOpen && (
                <CardContent className="px-4 pb-4 pt-0">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                      <p className="text-[11px] text-blue-600">Media mensile incassi clienti</p>
                      <p className="text-base font-bold text-blue-800">{fmt(kpiMensili.mediaIncassiClienti)}</p>
                    </div>
                    <div className="rounded-lg border border-orange-100 bg-orange-50 p-3">
                      <p className="text-[11px] text-orange-600">Media mensile pagamenti fornitori</p>
                      <p className="text-base font-bold text-orange-800">{fmt(kpiMensili.mediaPagamentiFornitori)}</p>
                    </div>
                    <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3">
                      <p className="text-[11px] text-indigo-600">Media mensile rate finanziamenti</p>
                      <p className="text-base font-bold text-indigo-800">{fmt(kpiMensili.mediaRateFinanziamenti)}</p>
                    </div>
                    <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                      <p className="text-[11px] text-red-600">Media mensile tributi</p>
                      <p className="text-base font-bold text-red-800">{fmt(kpiMensili.mediaTributi)}</p>
                    </div>
                    <div className={`rounded-lg border p-3 ${kpiMensili.saldoOperativoMedio >= 0 ? 'border-green-100 bg-green-50' : 'border-amber-100 bg-amber-50'}`}>
                      <p className={`text-[11px] ${kpiMensili.saldoOperativoMedio >= 0 ? 'text-green-600' : 'text-amber-600'}`}>Saldo netto operativo medio mensile</p>
                      <p className={`text-base font-bold ${kpiMensili.saldoOperativoMedio >= 0 ? 'text-green-800' : 'text-amber-800'}`}>{fmt(kpiMensili.saldoOperativoMedio)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] text-slate-600">Mesi con saldo netto negativo</p>
                      <p className="text-base font-bold text-slate-800">{kpiMensili.mesiSaldoNegativo}</p>
                    </div>
                    <div className="rounded-lg border border-blue-100 bg-white p-3">
                      <p className="text-[11px] text-blue-600">Mese con incassi massimi</p>
                      <p className="text-sm font-semibold text-blue-800">{kpiMensili.meseIncassiMassimi?.mese ?? '—'}</p>
                      <p className="text-[11px] text-blue-600">{fmt(kpiMensili.meseIncassiMassimi?.valore ?? 0)}</p>
                    </div>
                    <div className="rounded-lg border border-red-100 bg-white p-3">
                      <p className="text-[11px] text-red-600">Mese con uscite massime</p>
                      <p className="text-sm font-semibold text-red-800">{kpiMensili.meseUsciteMassime?.mese ?? '—'}</p>
                      <p className="text-[11px] text-red-600">{fmt(kpiMensili.meseUsciteMassime?.valore ?? 0)}</p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          <Separator />
        </>
      )}

      {/* Filtri */}
      {transazioni.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-medium text-gray-500">Filtra:</span>
          {(['tutti', 'entrata', 'uscita'] as const).map(v => (
            <button
              key={v}
              onClick={() => setFiltroTipo(v)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filtroTipo === v
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'
              }`}
            >
              {v === 'tutti' ? 'Tutti' : v === 'entrata' ? '↑ Entrate' : '↓ Uscite'}
            </button>
          ))}
          <span className="text-gray-300">|</span>
          {CATEGORIE_FILTRO.map(v => (
            <button
              key={v}
              onClick={() => setFiltroCategoria(v)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                filtroCategoria === v
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {v === 'tutti' ? 'Tutte' : CATEGORIA_STYLE[v]?.label ?? v}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-400">{transFiltered.length} di {transazioni.length}</span>
        </div>
      )}

      {/* Transaction table */}
      {transFiltered.length > 0 && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium w-24">Data</th>
                  <th className="text-left px-3 py-2 text-gray-600 font-medium">Descrizione</th>
                  <th className="text-center px-3 py-2 text-gray-600 font-medium w-28">Categoria</th>
                  <th className="text-right px-3 py-2 text-gray-600 font-medium w-28">Importo</th>
                  <th className="text-right px-3 py-2 text-gray-600 font-medium w-28">Saldo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transFiltered.map((t, i) => {
                  const cs = CATEGORIA_STYLE[t.categoria] ?? CATEGORIA_STYLE.altro;
                  return (
                    <tr key={t.id ?? i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                        {t.data_valuta
                          ? new Date(t.data_valuta).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 max-w-xs">
                        <p className="truncate" title={t.descrizione}>{t.descrizione || '—'}</p>
                        {t.beneficiario_ordinante && (
                          <p className="text-[10px] text-gray-400 truncate">{t.beneficiario_ordinante}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${cs.cls}`}>
                          {cs.label}
                        </span>
                      </td>
                      <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${
                        t.tipo === 'entrata' ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {t.tipo === 'entrata' ? '+' : '-'}{fmt(t.importo)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-400 whitespace-nowrap">
                        {t.saldo_progressivo != null ? fmt(t.saldo_progressivo) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer note */}
      {transazioni.length > 0 && (
        <p className="text-[10px] text-gray-400 text-center">
          La classificazione automatica è basata su parole chiave. Verifica le categorie prima dell'utilizzo.
        </p>
      )}
    </div>
  );
}

export default EstrattoConto;
