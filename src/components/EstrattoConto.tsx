import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Upload, Trash2, RefreshCw, TrendingUp, TrendingDown, AlertCircle, FileText, Users, Building2, Receipt, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';
import {
  classificaTransazioneConConfidenza,
  type ConfidenzaClassificazione,
} from '@/lib/classificaTransazione';
import { analyzeBankStatement } from '@/lib/bankStatementAnalysis';
import {
  parseBankStatementPdfRows,
  type PositionedPdfRow,
} from '@/lib/parseBankStatementPdf';

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
    if (col.importo === undefined && col.dare === undefined && col.avere === undefined &&
        (h === 'importo' || h === 'importo (eur)' || h === 'importo eur' || h === 'amount' || h === 'valore' || h.startsWith('importo'))) col.importo = i;

    // Saldo
    if (col.saldo === undefined && (h.includes('saldo') || h === 'balance')) col.saldo = i;
  });

  return col;
}

/** Converte un importo testuale italiano ("1.234,56" o "-1234.56") in numero */
function parseNum(s: string): number {
  if (!s) return 0;
  let t = String(s).trim();
  const parenthesizedNegative = /^\(.*\)$/.test(t);
  t = t.replace(/[()€$£\s]/g, '').replace(/'/g, '');
  if (!t) return 0;

  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // L'ultimo separatore è quello decimale: 1.234,56 oppure 1,234.56.
    if (lastComma > lastDot) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = t.length - lastComma - 1;
    t = decimals === 2 ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const decimals = t.length - lastDot - 1;
    if (decimals !== 2) t = t.replace(/\./g, '');
  }

  const n = parseFloat(t);
  if (isNaN(n)) return 0;
  return parenthesizedNegative ? -Math.abs(n) : n;
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
      const mIT = /(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/.exec(rawDate);
      const mISO = /(\d{4})[.-](\d{2})[.-](\d{2})/.exec(rawDate);
      if (mISO) dataStr = `${mISO[1]}-${mISO[2]}-${mISO[3]}`;
      else if (mIT) {
        const a = mIT[3].length === 2 ? `20${mIT[3]}` : mIT[3];
        dataStr = `${a}-${mIT[2].padStart(2,'0')}-${mIT[1].padStart(2,'0')}`;
      }
    }

    // Importo e tipo
    let importoAbs = 0;
    let tipo: 'entrata' | 'uscita';

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
      // Fallback prudente: evita date e sceglie l'ultimo valore monetario plausibile.
      const candidates = row
        .filter((_, index) => index !== col.date && index !== col.date2 && index !== col.saldo)
        .filter(cell => !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(cell.trim()))
        .map(cell => parseNum(cell))
        .filter(value => Math.abs(value) > 0.005);
      for (const v of candidates.reverse()) {
        if (Math.abs(v) > 0.005) { importoAbs = Math.abs(v); tipo = v >= 0 ? 'entrata' : 'uscita'; break; }
      }
      if (importoAbs === 0) continue;
    }

    // Saldo
    const saldoRaw = col.saldo !== undefined ? parseNum(row[col.saldo] ?? '') : 0;
    const saldo = saldoRaw !== 0 ? saldoRaw : undefined;

    const classificazione = classificaTransazioneConConfidenza(desc, tipo);
    const parseConfidence: ConfidenzaClassificazione =
      dataStr && col.desc !== undefined && (col.importo !== undefined || col.dare !== undefined || col.avere !== undefined)
        ? 'alta'
        : dataStr ? 'media' : 'bassa';

    result.push({
      practice_id: practiceId,
      data_valuta: dataStr,
      importo: importoAbs,
      tipo,
      categoria: classificazione.categoria,
      descrizione: desc.substring(0, 200),
      saldo_progressivo: saldo,
      file_nome: fileName,
      classification_confidence: classificazione.confidenza,
      classification_rule: classificazione.regola,
      parse_confidence: parseConfidence,
      source_format: fileName.split('.').pop()?.toLowerCase() ?? 'tabellare',
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

interface PracticeStatementFile {
  id: string;
  nome_file: string;
  storage_path: string;
  mime_type?: string | null;
  created_at: string;
}

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
  classification_confidence?: ConfidenzaClassificazione;
  classification_rule?: string;
  parse_confidence?: ConfidenzaClassificazione;
  source_format?: string;
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
  transazioni_da_verificare: number;
  importo_da_verificare: number;
  saldo_medio: number | null;
  saldo_minimo: number | null;
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
   PDF PARSING
───────────────────────────────────────────── */

/** Estrae testo dal PDF ricostruendo righe per coordinata Y */
async function estraiTestoPdf(arrayBuffer: ArrayBuffer): Promise<PositionedPdfRow[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const allLines: PositionedPdfRow[] = [];

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
    for (const [y, tokObjs] of sorted) {
      tokObjs.sort((a, b) => a.x - b.x); // sinistra → destra garantisce: data | desc | importo | saldo
      const tokens = tokObjs.map(t => t.str);
      const line = tokens.join(' ').trim();
      if (line) {
        allLines.push({
          tokens,
          positionedTokens: tokObjs.map(token => ({ value: token.str, x: token.x })),
          page: p,
          y,
        });
      }
    }
  }
  return allLines;
}

/* ─────────────────────────────────────────────
   KPI CALCULATION
───────────────────────────────────────────── */

function isIncassoCliente(categoria: string) {
  return categoria === 'incasso_cliente' || categoria === 'cliente';
}

function isAltroUscita(categoria: string) {
  return categoria === 'altro_uscita' || categoria === 'altro';
}

function calcolaKpi(transazioni: Transazione[]): Kpi {
  let totale_entrate = 0, totale_uscite = 0;
  let entrate_clienti = 0, uscite_stipendi = 0;
  let uscite_fornitori = 0, uscite_tributi = 0, uscite_altro = 0;
  let uscite_rate_finanziamenti = 0, uscite_spese_bancarie = 0, uscite_prelievi = 0;
  let transazioni_da_verificare = 0, importo_da_verificare = 0;

  for (const t of transazioni) {
    if (t.classification_confidence === 'bassa' || t.parse_confidence === 'bassa') {
      transazioni_da_verificare++;
      importo_da_verificare += t.importo;
    }
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

  const saldi = transazioni
    .map(t => t.saldo_progressivo)
    .filter((saldo): saldo is number => typeof saldo === 'number' && Number.isFinite(saldo));

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
    transazioni_da_verificare,
    importo_da_verificare,
    saldo_medio: saldi.length > 0 ? saldi.reduce((sum, saldo) => sum + saldo, 0) / saldi.length : null,
    saldo_minimo: saldi.length > 0 ? Math.min(...saldi) : null,
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

const SUPPORTED_STATEMENT_EXTENSIONS = new Set(['pdf', 'csv', 'xls', 'xlsx', 'ods']);

function fileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function isLikelyStatement(fileName: string): boolean {
  return /estratt|conto|movimenti|scalare/i.test(fileName);
}

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
  const [practiceFiles, setPracticeFiles] = useState<PracticeStatementFile[]>([]);
  const [selectedPracticeFileId, setSelectedPracticeFileId] = useState('');
  const [loadingPracticeFiles, setLoadingPracticeFiles] = useState(false);
  const [downloadingPracticeFile, setDownloadingPracticeFile] = useState(false);

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
        const sourceFiles = Array.from(new Set(
          (data as Transazione[]).map(transaction => transaction.file_nome).filter(Boolean)
        ));
        setFileNome(sourceFiles.length === 1 ? sourceFiles[0] ?? '' : `${sourceFiles.length} documenti`);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, [practiceId]);

  const loadPracticeFiles = useCallback(async () => {
    setLoadingPracticeFiles(true);
    try {
      const { data, error } = await supabase
        .from('uploaded_files')
        .select('id,nome_file,storage_path,mime_type,created_at')
        .eq('practice_id', practiceId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const compatible = ((data ?? []) as PracticeStatementFile[])
        .filter(file => SUPPORTED_STATEMENT_EXTENSIONS.has(fileExtension(file.nome_file)))
        .sort((a, b) => {
          const statementPriority = Number(isLikelyStatement(b.nome_file)) - Number(isLikelyStatement(a.nome_file));
          if (statementPriority !== 0) return statementPriority;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
      setPracticeFiles(compatible);
      setSelectedPracticeFileId(current =>
        compatible.some(file => file.id === current)
          ? current
          : compatible.find(file => isLikelyStatement(file.nome_file))?.id ?? compatible[0]?.id ?? ''
      );
    } catch (error) {
      console.error('Errore caricamento documenti pratica:', error);
      toast.error('Impossibile caricare i documenti già presenti nella pratica');
    } finally {
      setLoadingPracticeFiles(false);
    }
  }, [practiceId]);

  useEffect(() => {
    loadFromDb();
    loadPracticeFiles();
  }, [loadFromDb, loadPracticeFiles]);

  const saveParsedTransactions = useCallback(async (
    parsed: Transazione[],
    fileName: string,
    successMessage: string,
  ) => {
    const withMeta = parsed.map(transaction => ({
      ...transaction,
      practice_id: practiceId,
      file_nome: fileName,
    }));

    setTransazioni(withMeta);
    setKpi(calcolaKpi(withMeta));
    setFileNome(fileName);
    toast.success(successMessage);

    if (dbAvailable === false) return;

    await supabase
      .from('estratto_conto_transactions')
      .delete()
      .eq('practice_id', practiceId);

    const { error: insertError } = await supabase
      .from('estratto_conto_transactions')
      .insert(withMeta);

    if (insertError) {
      if (insertError.code === '42P01') {
        setDbAvailable(false);
        toast.warning('Transazioni analizzate ma non salvate — applica la migration SQL dal Supabase Dashboard');
      } else {
        console.error('Errore salvataggio:', insertError);
        toast.warning('Analisi completata, ma salvataggio su DB non riuscito');
      }
      return;
    }

    setDbAvailable(true);
    toast.success('Transazioni salvate nel database');
  }, [dbAvailable, practiceId]);

  const analyzePdfFile = useCallback(async (file: File) => {
    setParsing(true);
    setFileNome(file.name);
    toast.info('Analisi estratto conto in corso…');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const righe = await estraiTestoPdf(arrayBuffer);
      const parsed = parseBankStatementPdfRows(righe);

      if (parsed.length === 0) {
        toast.warning('Nessuna transazione rilevata. Il formato del PDF potrebbe non essere supportato.');
        return;
      }

      await saveParsedTransactions(parsed, file.name, `Rilevate ${parsed.length} transazioni`);
    } catch (error) {
      console.error('Errore parsing PDF:', error);
      toast.error('Errore durante l’analisi del PDF');
    } finally {
      setParsing(false);
    }
  }, [saveParsedTransactions]);

  const analyzeTabularFile = useCallback(async (file: File) => {
    const extension = fileExtension(file.name);
    setParsingCsv(true);
    setFileNome(file.name);
    toast.info('Importazione CSV/XLS in corso…');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const parsed = extension === 'csv'
        ? parseCsvFile(new TextDecoder('utf-8').decode(arrayBuffer), file.name, practiceId)
        : parseXlsxFile(arrayBuffer, file.name, practiceId);

      if (parsed.length === 0) {
        toast.warning('Nessuna transazione rilevata. Verifica che il file abbia intestazioni riconoscibili (es. Data, Descrizione, Dare/Avere o Importo).');
        return;
      }

      await saveParsedTransactions(
        parsed,
        file.name,
        `Importate ${parsed.length} transazioni da ${extension.toUpperCase()}`,
      );
    } catch (error) {
      console.error('Errore importazione CSV/XLS:', error);
      toast.error('Errore durante l’importazione del file');
    } finally {
      setParsingCsv(false);
    }
  }, [practiceId, saveParsedTransactions]);

  /* ── Upload & Parse ── */
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Seleziona un file PDF');
      return;
    }
    await analyzePdfFile(file);
    e.target.value = '';
  }, [analyzePdfFile]);

  /* ── Upload CSV / XLS ── */
  const handleUploadCsv = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!['csv', 'xls', 'xlsx', 'ods'].includes(ext)) {
      toast.error('Seleziona un file CSV, XLS o XLSX');
      return;
    }

    await analyzeTabularFile(file);
    e.target.value = '';
  }, [analyzeTabularFile]);

  const handleAnalyzePracticeFile = useCallback(async () => {
    const selectedFile = practiceFiles.find(file => file.id === selectedPracticeFileId);
    if (!selectedFile) {
      toast.error('Seleziona un documento della pratica');
      return;
    }

    const extension = fileExtension(selectedFile.nome_file);
    if (!SUPPORTED_STATEMENT_EXTENSIONS.has(extension)) {
      toast.error('Il formato del documento non è supportato');
      return;
    }

    setDownloadingPracticeFile(true);
    try {
      const { data: signedData, error: signedError } = await supabase.storage
        .from('practice-files')
        .createSignedUrl(selectedFile.storage_path, 120);
      if (signedError || !signedData?.signedUrl) {
        throw signedError ?? new Error('URL del documento non disponibile');
      }

      const response = await fetch(signedData.signedUrl);
      if (!response.ok) throw new Error(`Download fallito (${response.status})`);
      const blob = await response.blob();
      const file = new File([blob], selectedFile.nome_file, {
        type: selectedFile.mime_type || blob.type,
      });

      if (extension === 'pdf') await analyzePdfFile(file);
      else await analyzeTabularFile(file);
    } catch (error) {
      console.error('Errore analisi documento pratica:', error);
      toast.error(`Impossibile analizzare il documento selezionato: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDownloadingPracticeFile(false);
    }
  }, [analyzePdfFile, analyzeTabularFile, practiceFiles, selectedPracticeFileId]);

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
  const percentualeDaVerificare = kpi && kpi.num_transazioni > 0
    ? (kpi.transazioni_da_verificare / kpi.num_transazioni) * 100
    : 0;
  const advancedAnalysis = analyzeBankStatement(transazioni);

  /* ── RENDER ── */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Analisi Estratto Conto</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Usa un estratto conto già presente nei documenti della pratica oppure carica un PDF, CSV o XLS per rilevare incassi, anticipi SBF, fornitori, rate, tributi e spese bancarie
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              loadFromDb();
              loadPracticeFiles();
            }}
            disabled={loading || loadingPracticeFiles}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading || loadingPracticeFiles ? 'animate-spin' : ''}`} />
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

      <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="practice-statement-file" className="text-xs font-semibold text-blue-900">
              Usa un documento già caricato nella pratica
            </label>
            <p className="mb-2 mt-0.5 text-[11px] text-blue-700">
              Sono mostrati i documenti PDF, CSV, XLS, XLSX e ODS. Gli estratti conto riconosciuti dal nome vengono proposti per primi.
            </p>
            <select
              id="practice-statement-file"
              value={selectedPracticeFileId}
              onChange={event => setSelectedPracticeFileId(event.target.value)}
              disabled={loadingPracticeFiles || downloadingPracticeFile || parsing || parsingCsv || practiceFiles.length === 0}
              className="h-9 w-full rounded-md border border-blue-200 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-300"
            >
              {practiceFiles.length === 0 ? (
                <option value="">
                  {loadingPracticeFiles ? 'Caricamento documenti…' : 'Nessun documento compatibile presente'}
                </option>
              ) : practiceFiles.map(file => (
                <option key={file.id} value={file.id}>
                  {isLikelyStatement(file.nome_file) ? 'Estratto conto · ' : ''}{file.nome_file}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 bg-blue-700 hover:bg-blue-800"
            onClick={handleAnalyzePracticeFile}
            disabled={!selectedPracticeFileId || loadingPracticeFiles || downloadingPracticeFile || parsing || parsingCsv}
          >
            {downloadingPracticeFile || parsing || parsingCsv ? (
              <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Analisi…</>
            ) : (
              <><FileText className="h-3.5 w-3.5" /> Analizza documento</>
            )}
          </Button>
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
          <p className="text-xs text-gray-400 mt-1">Seleziona un documento della pratica oppure carica un nuovo estratto conto</p>
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

          {kpi.transazioni_da_verificare > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex gap-2 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <span className="font-medium">
                  {kpi.transazioni_da_verificare} transazioni da verificare ({percentualeDaVerificare.toFixed(1)}%)
                </span>
                {' '}perché il formato o la causale non consentono una classificazione affidabile.
                Valore complessivo coinvolto: {fmt(kpi.importo_da_verificare)}.
              </div>
            </div>
          )}

          <Card className="border-indigo-200 bg-indigo-50/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-indigo-900">Analisi avanzata dei movimenti</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-md border border-indigo-100 bg-white p-2">
                  <p className="text-[10px] uppercase text-indigo-600">Periodo coperto</p>
                  <p className="text-sm font-bold text-indigo-900">{advancedAnalysis.monthsAnalyzed} mesi</p>
                </div>
                <div className="rounded-md border border-indigo-100 bg-white p-2">
                  <p className="text-[10px] uppercase text-indigo-600">Lettura affidabile</p>
                  <p className="text-sm font-bold text-indigo-900">{advancedAnalysis.reliablePercentage.toFixed(1)}%</p>
                </div>
                <div className="rounded-md border border-indigo-100 bg-white p-2">
                  <p className="text-[10px] uppercase text-indigo-600">Rate ricorrenti</p>
                  <p className="text-sm font-bold text-indigo-900">{advancedAnalysis.recurringFinancingPayments.length}</p>
                </div>
                <div className="rounded-md border border-indigo-100 bg-white p-2">
                  <p className="text-[10px] uppercase text-indigo-600">Concentrazione incassi</p>
                  <p className="text-sm font-bold text-indigo-900">
                    {advancedAnalysis.customerReceiptConcentration === null
                      ? 'N/D'
                      : `${advancedAnalysis.customerReceiptConcentration.toFixed(1)}%`}
                  </p>
                </div>
              </div>

              {advancedAnalysis.recurringFinancingPayments.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase text-indigo-700">Addebiti finanziari ricorrenti</p>
                  <div className="space-y-1">
                    {advancedAnalysis.recurringFinancingPayments.slice(0, 5).map(movement => (
                      <div key={movement.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-indigo-100 bg-white px-2.5 py-2 text-xs">
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={movement.label}>{movement.label}</span>
                        <span className="text-slate-500">{movement.occurrences} addebiti / {movement.months} mesi</span>
                        <span className="font-semibold text-indigo-800">media {fmt(movement.averageAmount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {advancedAnalysis.insights.length > 0 ? (
                <div className="space-y-2">
                  {advancedAnalysis.insights.map(insight => (
                    <div
                      key={insight.id}
                      className={`rounded-md border p-3 ${
                        insight.severity === 'alta'
                          ? 'border-red-200 bg-red-50'
                          : insight.severity === 'media'
                            ? 'border-amber-200 bg-amber-50'
                            : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs font-semibold text-slate-900">{insight.title}</p>
                        <span className="text-[10px] uppercase text-slate-500">confidenza {insight.confidence}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600">{insight.explanation}</p>
                      <p className="mt-1 text-[11px] font-medium text-slate-700">{insight.evidence.join(' · ')}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-indigo-700">Nessun elemento rilevante emerso nelle verifiche avanzate disponibili.</p>
              )}
            </CardContent>
          </Card>

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

          {(kpi.saldo_medio !== null || kpi.saldo_minimo !== null) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card className="border-slate-200 bg-slate-50">
                <CardContent className="p-3">
                  <p className="text-[11px] text-slate-600">Saldo medio rilevato</p>
                  <p className="text-base font-bold text-slate-800">{fmt(kpi.saldo_medio ?? 0)}</p>
                </CardContent>
              </Card>
              <Card className={`${(kpi.saldo_minimo ?? 0) < 0 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                <CardContent className="p-3">
                  <p className={`text-[11px] ${(kpi.saldo_minimo ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>Saldo minimo rilevato</p>
                  <p className={`text-base font-bold ${(kpi.saldo_minimo ?? 0) < 0 ? 'text-red-800' : 'text-emerald-800'}`}>{fmt(kpi.saldo_minimo ?? 0)}</p>
                </CardContent>
              </Card>
            </div>
          )}

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
                  <th className="text-center px-3 py-2 text-gray-600 font-medium w-24">Affidabilità</th>
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
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                            t.classification_confidence === 'alta' && t.parse_confidence !== 'bassa'
                              ? 'bg-green-50 text-green-700 border-green-200'
                              : t.classification_confidence === 'bassa' || t.parse_confidence === 'bassa'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}
                          title={`Regola: ${t.classification_rule ?? 'dato storico'} · Parsing: ${t.parse_confidence ?? 'non disponibile'}`}
                        >
                          {t.classification_confidence === 'alta' && t.parse_confidence !== 'bassa'
                            ? 'Alta'
                            : t.classification_confidence === 'bassa' || t.parse_confidence === 'bassa'
                              ? 'Da verificare'
                              : 'Media'}
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
          La classificazione automatica è basata su formato, segno e parole chiave. Le righe a bassa affidabilità restano separate e devono essere verificate.
        </p>
      )}
    </div>
  );
}

export default EstrattoConto;
