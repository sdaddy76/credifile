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
  categoria: 'cliente' | 'stipendio' | 'fornitore' | 'tributo' | 'altro';
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
  uscite_altro: number;
  saldo_netto: number;
  num_transazioni: number;
  indice_liquidita: number;
}

/* ─────────────────────────────────────────────
   CONSTANTS / CLASSIFICATION RULES
───────────────────────────────────────────── */

const KW_STIPENDI = [
  'STIPEND', 'SALARIO', 'RETRIBUZ', 'CEDOLINO', 'PAGHE', 'EMOLUMENT',
  'COMPENSO DIPEND', 'COLLABORATORE', 'COLLABOR', 'F24 PAGHE', 'LAVORO DIPEND',
  'BUSTA PAGA', 'PAGA MENSILE', 'ACCREDITO STIPEND',
];

const KW_TRIBUTI = [
  'F24', 'ERARIO', 'AGENZIA ENTRATE', 'AGENZIA DELLE ENTRATE',
  'INPS', 'INAIL', 'IRPEF', 'IVA', 'IRES', 'IMU', 'TARI', 'TASSE',
  'CONTRIBUTI PREV', 'CONTRIBUTI INPS', 'DELEGA F24', 'MOD. F24',
  'IMPOSTE', 'TRIBUTO', 'EQUITALIA', 'RISCOSSIONE',
];

const KW_FORNITORI = [
  'FATT', 'FATTURA', 'FT N', 'FORNITORE', 'PRESTAZ', 'SERVIZIO',
  'CONSULENZ', 'LAVORI', 'APPALTO', 'CANONE', 'NOLEGGIO', 'LOCAZIONE',
  'AFFITTO', 'UTENZA', 'ENEL', 'ENI', 'A2A', 'IREN', 'HERA', 'LUCE',
  'GAS', 'ACQUA', 'TELEFONIA', 'TIM', 'VODAFONE', 'WIND', 'FASTWEB',
  'ASSICURAZ', 'PREMI ASS', 'LEASING', 'MUTUO', 'RATA',
];

const KW_CLIENTI_ENTRATA = [
  'ACCREDITO', 'VERSAMENTO', 'INCASSO', 'RIMESSA', 'PAGAMENTO RIC',
  'BONIFICO IN ENTRATA', 'GIROACCREDITO', 'ACCREDITAMENTO',
];

/** Classifica una transazione in base a parole chiave nella descrizione */
function classificaTransazione(
  descrizione: string,
  tipo: 'entrata' | 'uscita',
): Transazione['categoria'] {
  const d = descrizione.toUpperCase();

  // Stipendi → sempre uscita (o riaccredito)
  if (KW_STIPENDI.some(k => d.includes(k))) return 'stipendio';

  // Tributi → quasi sempre uscita
  if (KW_TRIBUTI.some(k => d.includes(k))) return 'tributo';

  // Fornitori → uscita
  if (tipo === 'uscita' && KW_FORNITORI.some(k => d.includes(k))) return 'fornitore';

  // Entrate da clienti
  if (tipo === 'entrata') {
    if (KW_CLIENTI_ENTRATA.some(k => d.includes(k))) return 'cliente';
    // Genericamente entrate non classificate = clienti (caso comune)
    return 'cliente';
  }

  // Uscite non classificate
  if (tipo === 'uscita') {
    if (KW_FORNITORI.some(k => d.includes(k))) return 'fornitore';
    return 'altro';
  }

  return 'altro';
}

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

    // Raggruppa token per coordinata Y (tolleranza 3pt)
    const byY: Map<number, string[]> = new Map();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round((item as any).transform[5] / 3) * 3;
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push((item as any).str);
    }
    // Ordina per Y decrescente (top→bottom)
    const sorted = [...byY.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, tokens] of sorted) {
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

    // Prende il primo importo trovato come importo transazione
    const importoRaw = importiMatch[0][1].replace(/\s/g, '');
    const importoVal = parseImporto(importoRaw);
    if (importoVal === null || importoVal === 0) continue;

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

    // Saldo progressivo: prende l'ultimo importo se ce ne sono ≥2
    let saldo: number | undefined;
    if (importiMatch.length >= 2) {
      saldo = Math.abs(parseImporto(importiMatch[importiMatch.length - 1][1].replace(/\s/g, '')) ?? 0);
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
  return transazioni.filter(t => {
    const key = `${t.data_valuta}|${t.importo}|${t.descrizione.substring(0, 40)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/* ─────────────────────────────────────────────
   KPI CALCULATION
───────────────────────────────────────────── */

function calcolaKpi(transazioni: Transazione[]): Kpi {
  let totale_entrate = 0, totale_uscite = 0;
  let entrate_clienti = 0, uscite_stipendi = 0;
  let uscite_fornitori = 0, uscite_tributi = 0, uscite_altro = 0;

  for (const t of transazioni) {
    if (t.tipo === 'entrata') {
      totale_entrate += t.importo;
      if (t.categoria === 'cliente') entrate_clienti += t.importo;
    } else {
      totale_uscite += t.importo;
      if (t.categoria === 'stipendio') uscite_stipendi += t.importo;
      else if (t.categoria === 'fornitore') uscite_fornitori += t.importo;
      else if (t.categoria === 'tributo') uscite_tributi += t.importo;
      else uscite_altro += t.importo;
    }
  }

  return {
    totale_entrate,
    totale_uscite,
    entrate_clienti,
    uscite_stipendi,
    uscite_fornitori,
    uscite_tributi,
    uscite_altro,
    saldo_netto: totale_entrate - totale_uscite,
    num_transazioni: transazioni.length,
    indice_liquidita: totale_uscite > 0 ? totale_entrate / totale_uscite : 0,
  };
}

/* ─────────────────────────────────────────────
   HELPERS UI
───────────────────────────────────────────── */

const fmt = (n: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);

const CATEGORIA_STYLE: Record<string, { label: string; cls: string }> = {
  cliente:   { label: 'Cliente',    cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  stipendio: { label: 'Stipendio',  cls: 'bg-purple-100 text-purple-800 border-purple-200' },
  fornitore: { label: 'Fornitore',  cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  tributo:   { label: 'Tributo',    cls: 'bg-red-100 text-red-800 border-red-200' },
  altro:     { label: 'Altro',      cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};

/* ─────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────── */

export function EstrattoConto({ practiceId }: Props) {
  const [transazioni, setTransazioni] = useState<Transazione[]>([]);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(false);
  const [parsing, setParsing] = useState(false);
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

  /* ── RENDER ── */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-800">Analisi Estratto Conto</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Carica il PDF dell'estratto conto per rilevare bonifici clienti, stipendi, fornitori e tributi
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
              accept=".pdf"
              className="hidden"
              onChange={handleUpload}
              disabled={parsing}
            />
            <Button asChild size="sm" className="gap-1.5 bg-blue-600 hover:bg-blue-700" disabled={parsing}>
              <span>
                {parsing
                  ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Analisi…</>
                  : <><Upload className="h-3.5 w-3.5" /> Carica PDF</>
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
          {(['tutti', 'cliente', 'stipendio', 'fornitore', 'tributo', 'altro'] as const).map(v => (
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
