import { useState, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import * as pdfjs from 'pdfjs-dist';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { generateReportPdf } from '@/lib/generateReportPdf';
import jsPDF from 'jspdf';
import { Document, Paragraph, TextRun, HeadingLevel, Packer } from 'docx';
import { parseCentraleRischi } from '@/lib/parseCentraleRischi';
import type {
  KpiScore,
  AiSuggerimento,
  ReportData,
  FinanziamentoItem,
  BalanceAnomalyAnalysis,
} from '@/lib/generateReportPdf';
import {
  KPI_SCORING_CONFIG,
  buildBankabilityAssessment,
  type KpiResult,
} from '@/lib/bankabilityScoring';
import {
  SECTOR_BENCHMARK_UPDATED_AT,
  getAtecoBenchmark,
  getAtecoBenchmarkKey,
} from '@/lib/sectorBenchmarks';
import {
  Upload, CheckCircle, Loader2, ArrowLeft, ArrowRight,
  FileText, BarChart2, Brain, Send, Download, ShieldCheck, Clock, Mail,
  PlusCircle, Trash2, Banknote, Save,
} from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

async function extractPdfTextWizard(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const ct = await pg.getTextContent();
    pages.push(ct.items.map((it: unknown) => (it as { str?: string }).str ?? '').join(' '));
  }
  return pages.join('\n');
}

const TIPI_FINANZIAMENTO = ['Mutuo','Leasing','Apertura credito','Factoring','Finanziamento chirografario','Altro'];


type RelazioneAnswers = Record<string, string>;

type RelazioneDomanda = { id: string; testo: string; tipo: 'text' | 'textarea'; obbligatoria?: boolean };
type RelazioneSezione = { id: string; titolo: string; domande: RelazioneDomanda[] };

const RELAZIONE_SEZIONI: RelazioneSezione[] = [
  { id: 'presentazione_azienda', titolo: 'Presentazione Azienda', domande: [
    { id: 'presentazione_storia', tipo: 'textarea', testo: 'Sintesi della storia imprenditoriale e dei soci/amministratori. Indicare chi ha funzioni chiave nel business.' },
    { id: 'presentazione_continuita', tipo: 'textarea', testo: 'Eventuale presenza in azienda della famiglia per continuità aziendale. Temi successori.' },
    { id: 'presentazione_trasformazioni', tipo: 'textarea', testo: 'Eventuali trasformazioni societarie avvenute nella storia della società.' },
    { id: 'presentazione_attivita', tipo: 'textarea', testo: 'Precisa descrizione dell’attività svolta, prodotti, mercati/settori di sbocco e clienti di riferimento.' },
    { id: 'presentazione_competitors', tipo: 'textarea', testo: 'Principali competitors e vantaggi competitivi dell’azienda.' },
  ]},
  { id: 'analisi_reputazionale', titolo: 'Analisi Qualitativa / Reputazionale', domande: [
    { id: 'rep_compagine', tipo: 'textarea', testo: 'La società è stata costituita dagli attuali soci o si rileva un cambio nella compagine societaria?' },
    { id: 'rep_precedente', tipo: 'textarea', testo: 'L’attuale attività è stata rilevata da una società precedente? Come andava? Eventuali fallimenti/concordati?' },
    { id: 'rep_acquisizioni', tipo: 'textarea', testo: 'La società ha mai acquisito/affittato rami d’azienda di altre società?' },
    { id: 'rep_quote_terze', tipo: 'textarea', testo: 'Quote dirette o indirette in società terze riconducibili ai soci. Fatturato e rapporti con la richiedente.' },
    { id: 'rep_conservatorie', tipo: 'textarea', testo: 'Eventuali eventi di conservatoria sulle persone fisiche legate alla società.' },
    { id: 'rep_collegate', tipo: 'textarea', testo: 'Le società collegate/controllate sono attive? Problematiche relative a liquidazioni o procedure?' },
    { id: 'rep_negativita', tipo: 'textarea', testo: 'Analisi reputazionale soci/amministratori. Pregiudizievoli, decreti ingiuntivi, protesti, procedure concorsuali.' },
    { id: 'rep_gruppo', tipo: 'textarea', testo: 'Eventuale presenza di gruppo giuridico/economico. Altre società degli stessi UBO (es. immobiliare di famiglia).' },
  ]},
  { id: 'clienti_mercati', titolo: 'Clienti e Mercati', domande: [
    { id: 'clienti_descrizione', tipo: 'textarea', testo: 'Descrizione clienti, concentrazioni con % rilevante (dal 10% in su), modalità e tempi di incasso.' },
    { id: 'clienti_settori', tipo: 'textarea', testo: 'Principali settori serviti. Per aziende su commessa: portafoglio ordini.' },
    { id: 'clienti_export', tipo: 'textarea', testo: '% export e Paesi con indicazione % dei più rilevanti (dal 10% in su).' },
  ]},
  { id: 'fornitori', titolo: 'Fornitori', domande: [
    { id: 'fornitori_concentrazioni', tipo: 'textarea', testo: 'Concentrazioni rilevanti lato fornitori (dal 10% in su). Dipendenza da materie prime specifiche.' },
    { id: 'fornitori_pagamento', tipo: 'textarea', testo: 'Modalità e tempi medi di pagamento fornitori.' },
    { id: 'fornitori_import', tipo: 'textarea', testo: '% quota import con indicazione Paesi principali.' },
  ]},
  { id: 'finalita_operazione', titolo: 'Finalità dell’Operazione', domande: [
    { id: 'finalita_descrizione', tipo: 'textarea', testo: 'Descrizione precisa della finalità (liquidità/investimento). Se investimento: importo totale, parte finanziata, copertura.' },
    { id: 'finalita_vantaggio', tipo: 'textarea', testo: 'Descrizione del vantaggio dell’investimento e volumi/redditività attesi.' },
    { id: 'finalita_coerenza', tipo: 'textarea', testo: 'L’investimento è coerente con il piano di crescita? Capacità di generazione di cassa per il servizio del debito?' },
    { id: 'finalita_commissioni', tipo: 'text', testo: 'Commissioni di mediazione applicate (% e importo €).' },
  ]},
  { id: 'aspetti_bilancio', titolo: 'Aspetti Rilevanti di Bilancio', domande: [
    { id: 'bilancio_analisi', tipo: 'textarea', testo: 'Breve analisi dell’ultimo bilancio. Voci più significative e variazioni di fatturato nell’ultimo triennio.' },
    { id: 'bilancio_sede', tipo: 'text', testo: 'La sede produttiva/commerciale è di proprietà, in leasing o in affitto?' },
    { id: 'bilancio_crediti_debiti', tipo: 'textarea', testo: 'In caso di bilancio abbreviato: dettaglio delle voci di crediti e debiti.' },
  ]},
  { id: 'eventi_straordinari', titolo: 'Eventi Straordinari', domande: [
    { id: 'straordinari_operazioni', tipo: 'textarea', testo: 'Eventuali operazioni straordinarie sul capitale o modifiche societarie previste dalla proprietà.' },
    { id: 'straordinari_investimenti', tipo: 'textarea', testo: 'Eventuali futuri investimenti di rilievo (immobili, impianti) con modalità di finanziamento.' },
  ]},
  { id: 'impegni_finanziari_tributari', titolo: 'Impegni Finanziari e Tributari', domande: [
    { id: 'finanziario_impegni', tipo: 'textarea', testo: 'Voci significative a livello di impegni finanziari: prestiti obbligazionari soci, finanziamenti soci, crediti/debiti tributari.' },
    { id: 'finanziario_tributario', tipo: 'textarea', testo: 'Debiti tributari: accertamenti, rateizzazioni in essere, situazione con l’Agenzia delle Entrate.' },
    { id: 'finanziario_banche', tipo: 'textarea', testo: 'Dettaglio banche e affidamenti in essere: fidi a breve e medio-lungo termine, garanzie rilasciate.' },
  ]},
  { id: 'note_visita', titolo: 'Note Relative alla Visita', domande: [
    { id: 'visita_sede', tipo: 'textarea', testo: 'Indicazione sintetica della sede: dove si trova, se produzione e commerciale sono nello stesso posto, sedi secondarie.' },
    { id: 'visita_stato_immobile', tipo: 'textarea', testo: 'Stato dell’immobile o delle unità immobiliari.' },
    { id: 'visita_logistica', tipo: 'textarea', testo: 'Situazione logistica. Zone industriali, snodi stradali/ferroviari.' },
    { id: 'visita_disponibilita', tipo: 'text', testo: 'Disponibilità dell’imprenditore a fornire informazioni.' },
  ]},
  { id: 'esperienza_pregressa', titolo: 'Esperienza Pregressa con il Cliente', domande: [
    { id: 'pregressa_contatti', tipo: 'textarea', testo: 'Eventuali contatti precedenti con il mediatore e/o la banca. Richieste pregresse ed esito.' },
    { id: 'pregressa_erogati', tipo: 'textarea', testo: 'Finanziamenti già erogati: se ancora in essere o chiusi, andamentale.' },
  ]},
  { id: 'foto_aziendali', titolo: 'Foto Aziendali (opzionale)', domande: [
    { id: 'foto_note', tipo: 'textarea', testo: 'Note sulle foto aziendali allegate. Descrivere brevemente cosa mostrano (NO foto da siti web).' },
  ]},
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function NuovoReportWizard() {
  const { clientId } = useParams<{ clientId: string }>();
  const { user, profileNome } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 0: dati cliente & anno
  const [annoStr, setAnnoStr] = useState(String(new Date().getFullYear() - 1));

  // Step 1: Consenso CR
  const [crConsentId,     setCrConsentId]     = useState<string | null>(null);
  const [crConsentStatus, setCrConsentStatus] = useState<'none' | 'pending' | 'accepted' | 'declined'>('none');
  const [crClientEmail,   setCrClientEmail]   = useState('');
  const [sendingConsent,  setSendingConsent]  = useState(false);

  // Step 2: bilancio XBRL o PDF
  const bilancioRef = useRef<HTMLInputElement>(null);
  const [bilancioFile, setBilancioFile]   = useState<File | null>(null);
  const [bilancioFileType, setBilancioFileType] = useState<'xbrl' | 'pdf' | null>(null);
  const [analyzingBil, setAnalyzingBil]   = useState(false);
  const [kpiResult,    setKpiResult]      = useState<KpiResult | null>(null);
  const [annoEsercizio, setAnnoEsercizio] = useState<number | null>(null);
  const [ragSociale,   setRagSociale]     = useState('');
  const [anomalyAnalysis, setAnomalyAnalysis] = useState<BalanceAnomalyAnalysis | null>(null);

  // Step 2.5: Finanziamenti
  const crFileInputRef = useRef<HTMLInputElement>(null);
  const [importandoCR, setImportandoCR] = useState(false);
  const [recalculatingScores, setRecalculatingScores] = useState(false);
  const [finanziamenti, setFinanziamenti] = useState<FinanziamentoItem[]>([]);
  const addFinanziamento = () => setFinanziamenti(prev => [...prev, { istituto: '', tipo: 'Mutuo', importo_residuo: 0, rata_mensile: null, scadenza: null, fonte: 'dichiarato' }]);
  const removeFinanziamento = (i: number) => setFinanziamenti(prev => prev.filter((_, idx) => idx !== i));
  const updateFinanziamento = (i: number, field: keyof FinanziamentoItem, value: string | number | null) =>
    setFinanziamenti(prev => prev.map((f, idx) => idx === i ? { ...f, [field]: value } : f));

  // Step 3: calcolo scores + benchmark
  const [kpiScores,     setKpiScores]     = useState<KpiScore[]>([]);
  const [indice,        setIndice]        = useState<number | null>(null);
  const [benchmarkData, setBenchmarkData] = useState<{
    settore_label: string;
    kpi_data: Record<string, number | null>;
    aggiornato_il: string;
    commento_settore: string | null;
    last_checked_at?: string | null;
    source_dataset?: string | null;
    source_version?: string | null;
    effective_period?: string | null;
    last_update_status?: string | null;
  } | null>(null);
  const [ratingBancabile, setRatingBancabile] = useState<'bancabile' | 'attenzione' | 'non_bancabile' | null>(null);
  const [motiviRating,    setMotiviRating]    = useState<string[]>([]);
  const [dscrMetodo, setDscrMetodo] = useState<'finanziamenti' | 'approssimato'>('approssimato');
  const [servizioDebitoAnnuo, setServizioDebitoAnnuo] = useState(0);

  // Step 4: AI suggestions
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSugg,    setAiSugg]   = useState<AiSuggerimento[]>([]);

  // Step 5: genera PDF & invia
  const [generating,  setGenerating]  = useState(false);
  const [pdfBlob,     setPdfBlob]     = useState<Blob | null>(null);
  const [pdfBase64,   setPdfBase64]   = useState<string>('');
  const [sendEmail,   setSendEmail]   = useState('');
  const [sending,     setSending]     = useState(false);
  const [reportSaved, setReportSaved] = useState(false);
  const [reportId,    setReportId]    = useState<string | null>(null);

  // Step 6: relazione commerciale opzionale
  const [bilancioTestoRelazione, setBilancioTestoRelazione] = useState('');
  const [crTestoRelazione, setCrTestoRelazione] = useState('');
  const [relazioneLoading, setRelazioneLoading] = useState(false);
  const [relazioneAnswers, setRelazioneAnswers] = useState<RelazioneAnswers>({});
  const [relazionePdfBlob, setRelazionePdfBlob] = useState<Blob | null>(null);
  const [relazioneDocxBlob, setRelazioneDocxBlob] = useState<Blob | null>(null);

  // Carica info cliente
  const [client, setClient] = useState<{
    ragione_sociale: string; email: string | null; partita_iva: string | null;
    codice_ateco: string | null; settore: string | null; indirizzo: string | null
  } | null>(null);
  const [clientLoaded, setClientLoaded] = useState(false);
  if (!clientLoaded && clientId) {
    setClientLoaded(true);
    supabase.from('consulente_clients').select('*').eq('id', clientId).maybeSingle().then(({ data }) => {
      if (data) {
        setClient(data as typeof client);
        setRagSociale(data.ragione_sociale);
        setSendEmail(data.email ?? '');
        setCrClientEmail(data.email ?? '');
      }
    });
    if (user) {
      supabase.from('consulente_cr_consents')
        .select('id, status').eq('consulente_id', user.id).eq('client_id', clientId).eq('status', 'accepted')
        .limit(1).maybeSingle()
        .then(({ data: c }) => { if (c) { setCrConsentId(c.id); setCrConsentStatus('accepted'); } });
    }
  }

  // Logo consulente
  const [logoUrl,    setLogoUrl]    = useState<string | null>(null);
  const [logoLoaded, setLogoLoaded] = useState(false);
  if (!logoLoaded && user) {
    setLogoLoaded(true);
    supabase.from('admin_profiles').select('logo_url').eq('id', user.id).maybeSingle().then(({ data }) => {
      setLogoUrl(data?.logo_url ?? null);
    });
  }

  // ── STEP 1: Richiedi consenso CR ────────────────────────────────────
  const richiediConsenso = async () => {
    if (!crClientEmail.trim()) { toast.error('Inserisci email del cliente'); return; }
    setSendingConsent(true);
    try {
      const { data, error } = await supabase.functions.invoke('richiedi-consenso-cr', {
        body: {
          consulente_id: user?.id,
          consulente_nome: profileNome ?? user?.email ?? 'Il Consulente',
          client_id: clientId ?? null,
          client_name: ragSociale || client?.ragione_sociale || 'Cliente',
          client_email: crClientEmail.trim().toLowerCase(),
        }
      });
      if (error || !data?.success) { toast.error(data?.error ?? 'Errore invio richiesta'); return; }
      setCrConsentId(data.consent_id);
      setCrConsentStatus('pending');
      toast.success(`Richiesta inviata a ${crClientEmail}`);
    } finally { setSendingConsent(false); }
  };

  const verificaConsenso = async () => {
    if (!crConsentId) return;
    const { data } = await supabase.from('consulente_cr_consents').select('status').eq('id', crConsentId).maybeSingle();
    if      (data?.status === 'accepted') { setCrConsentStatus('accepted'); toast.success('Consenso ricevuto!'); }
    else if (data?.status === 'declined') { setCrConsentStatus('declined'); toast.error('Consenso rifiutato.'); }
    else    toast.info('Consenso ancora in attesa...');
  };

  // ── STEP 2: analizza bilancio ────────────────────────────────────────
  const analizzaBilancio = async () => {
    if (!bilancioFile) { toast.error('Seleziona il file bilancio'); return; }
    setAnalyzingBil(true);
    try {
      let bilancioTesto: string;
      const isPdf = bilancioFile.name.toLowerCase().endsWith('.pdf');

      if (isPdf) {
        // Estrazione testo da PDF con pdfjs
        bilancioTesto = await extractPdfTextWizard(bilancioFile);
        if (bilancioTesto.trim().length < 100) {
          toast.error('PDF non leggibile o scansionato: impossibile estrarre testo');
          return;
        }
      } else {
        // File XBRL / XML: leggi come testo
        bilancioTesto = await bilancioFile.text();
      }

      setBilancioTestoRelazione(bilancioTesto);

      const { data, error } = await supabase.functions.invoke('analizza-bilancio', {
        body: {
          bilancio_testo: bilancioTesto,
          codice_ateco: client?.codice_ateco ?? null,
        }
      });
      if (error || !data?.success) { toast.error(data?.error ?? 'Errore analisi bilancio'); return; }
      setKpiResult(data.kpi as KpiResult);
      setAnomalyAnalysis((data.anomaly_analysis as BalanceAnomalyAnalysis | undefined) ?? null);
      setAnnoEsercizio(data.anno_esercizio ?? parseInt(annoStr));
      if (data.ragione_sociale) setRagSociale(data.ragione_sociale);
      toast.success('Bilancio analizzato con successo');
      setStep(2.5 as never); // step finanziamenti
    } finally { setAnalyzingBil(false); }
  };

  // ── STEP 2.5: gestione finanziamenti ────────────────────────────────
  const importaDaCR = async (file: File) => {
    setImportandoCR(true);
    try {
      const testo = await extractPdfTextWizard(file);
      if (testo.trim().length < 100) {
        toast.error('PDF Centrale Rischi non leggibile o scansionato');
        return;
      }

      setCrTestoRelazione(testo);
      const crResult = parseCentraleRischi(testo);
      const finanziamentiCR: FinanziamentoItem[] = crResult.righe
        .filter(riga => riga.utilizzato > 0)
        .map(riga => {
          const categoria = (riga.categoria ?? '').toLowerCase();
          const tipo = categoria.includes('leasing')
            ? 'Leasing'
            : categoria.includes('mutuo') || categoria.includes('scadenza')
              ? 'Mutuo'
              : 'Apertura credito';

          return {
            istituto: riga.banca,
            tipo,
            importo_residuo: riga.utilizzato,
            rata_mensile: null as number | null,
            scadenza: null as string | null,
            fonte: 'centrale_rischi',
          };
        });

      setFinanziamenti(prev => {
        const importedInstitutes = new Set(finanziamentiCR.map(f => f.istituto.trim().toLowerCase()));
        const keepExisting = prev.filter(f => f.fonte !== 'centrale_rischi' || !importedInstitutes.has(f.istituto.trim().toLowerCase()));
        return [...keepExisting, ...finanziamentiCR];
      });

      toast.success(`Importati ${finanziamentiCR.length} finanziamenti dalla Centrale Rischi`);
    } catch (error) {
      console.error('Errore import Centrale Rischi', error);
      toast.error('Errore durante l’importazione della Centrale Rischi');
    } finally {
      setImportandoCR(false);
    }
  };

  const stepFinanziamentiNext = async () => {
    if (!kpiResult) {
      toast.error('Analizza prima il bilancio');
      return;
    }

    const activeFinancing = finanziamenti.filter(finanziamento => finanziamento.istituto.trim() !== '');
    const missingResidualDebt = activeFinancing.find(finanziamento => !finanziamento.importo_residuo || finanziamento.importo_residuo <= 0);
    if (missingResidualDebt) {
      toast.error(`Inserisci il debito residuo del finanziamento ${missingResidualDebt.istituto} per calcolare correttamente PFN e indice`);
      return;
    }
    const missingInstallment = activeFinancing.find(finanziamento => !finanziamento.rata_mensile || finanziamento.rata_mensile <= 0);
    if (missingInstallment) {
      toast.error(`Inserisci la rata mensile del finanziamento ${missingInstallment.istituto} per calcolare correttamente il DSCR`);
      return;
    }

    setRecalculatingScores(true);
    try {
      let recalculatedKpi = kpiResult;
      if (bilancioTestoRelazione) {
        const financingPayload = activeFinancing.map(finanziamento => ({
          rata: finanziamento.rata_mensile ?? 0,
          debito_residuo: finanziamento.importo_residuo,
          durata_mesi: 0,
          tipologia: finanziamento.tipo,
        }));
        const { data, error } = await supabase.functions.invoke('analizza-bilancio', {
          body: {
            bilancio_testo: bilancioTestoRelazione,
            financing: financingPayload,
            codice_ateco: client?.codice_ateco ?? null,
          },
        });
        if (error || !data?.success) {
          throw new Error(data?.error ?? error?.message ?? 'Errore ricalcolo KPI');
        }
        recalculatedKpi = data.kpi as KpiResult;
        setKpiResult(recalculatedKpi);
        setAnomalyAnalysis((data.anomaly_analysis as BalanceAnomalyAnalysis | undefined) ?? null);
        setDscrMetodo(data.dscr_source === 'finanziamenti' ? 'finanziamenti' : 'approssimato');
        setServizioDebitoAnnuo(Number(data.servizio_debito_annuo) || 0);
      }

      await computeScores(recalculatedKpi);
      setStep(3);
    } catch (error) {
      toast.error(`Impossibile ricalcolare DSCR e indice: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRecalculatingScores(false);
    }
  };

  // ── STEP 3: calcola scores + carica benchmark ────────────────────────
  const computeScores = async (kpi: KpiResult) => {
    const assessment = buildBankabilityAssessment(kpi);
    setKpiScores(assessment.scores);
    setIndice(assessment.indice);
    setRatingBancabile(assessment.rating);
    setMotiviRating(assessment.motivi);

    // Carica benchmark dal DB
    const atecoBenchKey = getAtecoBenchmarkKey(client?.codice_ateco ?? null);
    const fallbackBenchmark = getAtecoBenchmark(client?.codice_ateco ?? null);
    try {
      const { data: benchRow } = await supabase
        .from('sector_benchmarks')
        .select('kpi_data, aggiornato_il, commento_settore, ateco_label, last_checked_at, source_dataset, source_version, effective_period, last_update_status')
        .eq('ateco_macro', atecoBenchKey)
        .maybeSingle();

      if (benchRow) {
        setBenchmarkData({
          settore_label:   benchRow.ateco_label,
          kpi_data:        benchRow.kpi_data as Record<string, number | null>,
          aggiornato_il:   benchRow.aggiornato_il,
          commento_settore: benchRow.commento_settore ?? null,
          last_checked_at: benchRow.last_checked_at ?? null,
          source_dataset: benchRow.source_dataset ?? null,
          source_version: benchRow.source_version ?? null,
          effective_period: benchRow.effective_period ?? null,
          last_update_status: benchRow.last_update_status ?? null,
        });
      } else {
        setBenchmarkData({
          settore_label: fallbackBenchmark.label,
          kpi_data: fallbackBenchmark.kpi,
          aggiornato_il: SECTOR_BENCHMARK_UPDATED_AT,
          commento_settore: null,
        });
      }
    } catch {
      setBenchmarkData({
        settore_label: fallbackBenchmark.label,
        kpi_data: fallbackBenchmark.kpi,
        aggiornato_il: SECTOR_BENCHMARK_UPDATED_AT,
        commento_settore: null,
      });
    }
  };

  // ── STEP 4: AI suggestions ───────────────────────────────────────────
  const generaSuggerimenti = async () => {
    const sorted = [...kpiScores].filter(k => k.score !== null).sort((a, b) => (a.score ?? 99) - (b.score ?? 99));
    const worst3 = sorted.slice(0, 3);
    setAiLoading(true);
    try {
      const { data } = await supabase.functions.invoke('genera-suggerimenti-kpi', {
        body: {
          worst_kpis: worst3.map(k => ({
            kpi_key: k.kpi_key, kpi_label: k.kpi_label, valore: k.valore,
            score: k.score, soglia_ottimo: k.benchmark, soglia_suff: null as number | null,
            inverso: k.inverso, formatted: k.formatted,
          })),
          ragione_sociale: ragSociale,
          settore: client?.settore ?? '',
          codice_ateco: client?.codice_ateco ?? '',
          anno_bilancio: annoEsercizio ?? parseInt(annoStr),
        }
      });
      setAiSugg(data?.suggerimenti ?? []);
      toast.success(`Suggerimenti generati (fonte: ${data?.source ?? 'AI'})`);
    } catch { toast.error('Errore generazione suggerimenti'); }
    finally { setAiLoading(false); }
  };

  // ── STEP 5: genera PDF ───────────────────────────────────────────────
  const generaPdf = async () => {
    setGenerating(true);
    try {
      const sorted = [...kpiScores].filter(k => k.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const top3    = sorted.slice(0, 3);
      const bottom3 = [...sorted].reverse().slice(0, 3);

      const reportData: ReportData = {
        ragione_sociale: ragSociale,
        partita_iva:     client?.partita_iva ?? undefined,
        codice_ateco:    client?.codice_ateco ?? undefined,
        settore:         client?.settore ?? undefined,
        indirizzo:       client?.indirizzo ?? undefined,
        anno_bilancio:   annoEsercizio ?? parseInt(annoStr),
        indice_bancabilita: indice,
        kpi_scores:   kpiScores,
        top3, bottom3,
        ai_suggerimenti: aiSugg,
        consulente_nome:  profileNome ?? user?.email ?? 'Consulente',
        consulente_email: user?.email ?? undefined,
        consulente_logo_url: logoUrl,
        // Nuovi campi
        settore_label:       benchmarkData?.settore_label,
        benchmark_settore:   benchmarkData?.kpi_data,
        benchmark_aggiornato_il: benchmarkData?.aggiornato_il,
        commento_settore:    benchmarkData?.commento_settore ?? undefined,
        finanziamenti:       finanziamenti.filter(f => f.istituto.trim() !== ''),
        rating_bancabile:    ratingBancabile ?? undefined,
        motivi_rating:       motiviRating.length ? motiviRating : undefined,
        kpi_disponibili:     kpiScores.filter(kpi => kpi.score !== null).length,
        kpi_totali:          KPI_SCORING_CONFIG.length,
        dscr_metodo:         dscrMetodo,
        servizio_debito_annuo: servizioDebitoAnnuo || undefined,
        anomaly_analysis:      anomalyAnalysis,
      };

      const { pdfBlob: blob, base64 } = await generateReportPdf(reportData);
      setPdfBlob(blob);
      setPdfBase64(base64);

      if (user) {
        const { data: saved, error } = await supabase.from('consulente_reports').insert({
          consulente_id:   user.id,
          client_id:       clientId ?? null,
          client_name:     ragSociale,
          client_email:    sendEmail || null,
          anno_bilancio:   annoEsercizio ?? parseInt(annoStr),
          kpi_data:        kpiResult,
          kpi_scores:      kpiScores,
          ai_suggestions:  aiSugg,
          indice_bancabilita: indice,
          top3_kpi:        top3,
          bottom3_kpi:     bottom3,
          anomaly_analysis: anomalyAnalysis,
          anomaly_score:    anomalyAnalysis?.score ?? null,
          anomaly_level:    anomalyAnalysis?.level ?? null,
        }).select('id').single();
        if (!error && saved) { setReportId(saved.id); setReportSaved(true); }
      }
      toast.success('Report PDF generato!');
    } finally { setGenerating(false); }
  };

  const scaricaPdf = () => {
    if (!pdfBlob) return;
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a'); a.href = url;
    a.download = `Report_Bancabilita_${ragSociale.replace(/\s+/g, '_')}_${annoEsercizio ?? annoStr}.pdf`;
    a.click(); URL.revokeObjectURL(url);
  };

  const inviaEmail = async () => {
    if (!sendEmail) { toast.error('Inserisci email destinatario'); return; }
    setSending(true);
    try {
      await supabase.functions.invoke('send-report-consulente', {
        body: {
          to_email: sendEmail, to_name: ragSociale,
          consulente_nome: profileNome ?? user?.email,
          consulente_email: user?.email,
          report_id: reportId,
          client_name: ragSociale,
          anno_bilancio: annoEsercizio ?? parseInt(annoStr),
          indice_bancabilita: indice,
          pdf_base64: pdfBase64,
        }
      });
      if (reportId) await supabase.from('consulente_reports').update({ sent_at: new Date().toISOString() }).eq('id', reportId);
      toast.success(`Report inviato a ${sendEmail}`);
    } finally { setSending(false); }
  };


  const updateRelazioneAnswer = (id: string, value: string) => {
    setRelazioneAnswers(prev => ({ ...prev, [id]: value }));
    setRelazionePdfBlob(null);
    setRelazioneDocxBlob(null);
  };

  const generaRelazioneAI = async () => {
    setRelazioneLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('genera-relazione-ai', {
        body: {
          consulente_mode: true,
          ragione_sociale: ragSociale || client?.ragione_sociale,
          piva: client?.partita_iva ?? undefined,
          ateco: client?.codice_ateco ?? undefined,
          importo: undefined,
          finalita: undefined,
          kpi_scores: kpiScores,
          finanziamenti: finanziamenti.filter(f => f.istituto.trim() !== ''),
          bilancio_testo: bilancioTestoRelazione,
          cr_testo: crTestoRelazione,
        }
      });
      if (error) throw error;
      if (data?.answers) {
        setRelazioneAnswers(data.answers as RelazioneAnswers);
        toast.success('Relazione commerciale compilata con AI. Controlla e integra le risposte prima di scaricare.');
      } else {
        toast.error(data?.error ?? 'Nessuna risposta AI ricevuta');
      }
    } catch (error: any) {
      toast.error(`Errore generazione relazione: ${error.message ?? error}`);
    } finally {
      setRelazioneLoading(false);
    }
  };

  const buildRelazioneDocx = async () => {
    const children: any[] = [
      new Paragraph({ text: 'RELAZIONE COMMERCIALE', heading: HeadingLevel.TITLE }),
      new Paragraph({ children: [new TextRun({ text: `${ragSociale || client?.ragione_sociale || 'Cliente'} — ${new Date().toLocaleDateString('it-IT')}`, italics: true })] }),
    ];
    RELAZIONE_SEZIONI.forEach(section => {
      children.push(new Paragraph({ text: section.titolo, heading: HeadingLevel.HEADING_1 }));
      section.domande.forEach(q => {
        children.push(new Paragraph({ text: q.testo, heading: HeadingLevel.HEADING_2 }));
        children.push(new Paragraph({ children: [new TextRun(relazioneAnswers[q.id]?.trim() || 'Non fornito')] }));
      });
    });
    return Packer.toBlob(new Document({ sections: [{ properties: {}, children }] }));
  };

  const buildRelazionePdf = () => {
    const doc = new jsPDF();
    let y = 18;
    const addPageIfNeeded = (needed = 10) => { if (y + needed > 280) { doc.addPage(); y = 18; } };
    const addText = (text: string, size = 10, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text || ' ', 180);
      addPageIfNeeded(lines.length * 5 + 4);
      doc.text(lines, 15, y);
      y += lines.length * 5 + 3;
    };
    addText('RELAZIONE COMMERCIALE', 17, true);
    addText(`${ragSociale || client?.ragione_sociale || 'Cliente'} — ${new Date().toLocaleDateString('it-IT')}`, 10);
    RELAZIONE_SEZIONI.forEach(section => {
      addText(section.titolo, 14, true);
      section.domande.forEach(q => {
        addText(q.testo, 11, true);
        addText(relazioneAnswers[q.id]?.trim() || 'Non fornito', 10);
      });
    });
    return doc.output('blob');
  };

  const preparaDownloadRelazione = async () => {
    const docx = await buildRelazioneDocx();
    const pdf = buildRelazionePdf();
    setRelazioneDocxBlob(docx);
    setRelazionePdfBlob(pdf);
    if (user && reportId) {
      await supabase.from('relazioni_commerciali').insert({
        consulente_report_id: reportId,
        status: 'generata',
        risposte: relazioneAnswers,
      });
    }
    toast.success('Relazione pronta per il download');
  };

  // ── STEPS UI ─────────────────────────────────────────────────────────
  // step numerico: 0-1-2-2.5-3-4-5-6 → mappa su indice stepper 0-7
  const stepperIndex = step === (2.5 as never) ? 3 : step > 2 ? (step as number) + 1 : step as number;
  const steps = ['Dati cliente', 'Consenso CR', 'Bilancio XBRL/PDF', 'Finanziamenti', 'Score KPI', 'AI', 'Report', 'Relazione'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50/40 to-slate-50">
      {/* Header */}
      <div className="bg-teal-700 text-white px-6 py-3 flex items-center gap-3">
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={() => navigate('/consulente')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Torna alla dashboard
        </Button>
        <span className="text-teal-200 text-sm">|</span>
        <span className="text-sm font-medium">Nuovo Report Bancabilità {client ? `— ${client.ragione_sociale}` : ''}</span>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Progress stepper */}
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all
                ${i < stepperIndex ? 'bg-teal-600 text-white' : i === stepperIndex ? 'bg-teal-700 text-white ring-2 ring-teal-300' : 'bg-slate-200 text-slate-400'}`}>
                {i < stepperIndex ? <CheckCircle className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${i === stepperIndex ? 'text-teal-700' : 'text-slate-400'}`}>{s}</span>
              {i < steps.length - 1 && <div className={`flex-1 h-0.5 ${i < stepperIndex ? 'bg-teal-500' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>

        {/* ── STEP 0: Dati cliente ── */}
        {step === 0 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><FileText className="w-4 h-4 text-teal-600" /> Dati cliente</h2>
            {client ? (
              <div className="bg-teal-50 rounded-lg p-4 space-y-1 text-sm">
                <p className="font-semibold text-teal-800">{client.ragione_sociale}</p>
                {client.partita_iva && <p className="text-slate-600">P.IVA: {client.partita_iva}</p>}
                {client.codice_ateco && <p className="text-slate-600">ATECO: {client.codice_ateco} {client.settore && `— ${client.settore}`}</p>}
              </div>
            ) : (
              <div>
                <label className="text-xs font-semibold text-slate-600">Ragione sociale</label>
                <input className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5" value={ragSociale} onChange={e => setRagSociale(e.target.value)} />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-600">Anno bilancio da analizzare</label>
              <input type="number" min="2018" max={new Date().getFullYear()}
                className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5"
                value={annoStr} onChange={e => setAnnoStr(e.target.value)} />
            </div>
            <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={() => setStep(1)}>
              Continua <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ── STEP 1: Consenso CR ── */}
        {step === 1 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-teal-600" /> Autorizzazione Centrale dei Rischi
            </h2>
            <p className="text-sm text-slate-500">Prima di caricare i dati CR è necessaria l'autorizzazione esplicita del cliente (GDPR Reg. UE 2016/679).</p>

            {crConsentStatus === 'none' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-slate-600">Email del cliente</label>
                  <input type="email" className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5 focus:ring-2 ring-teal-400 outline-none"
                    placeholder="cliente@azienda.it" value={crClientEmail} onChange={e => setCrClientEmail(e.target.value)} />
                </div>
                <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={richiediConsenso} disabled={sendingConsent || !crClientEmail.trim()}>
                  {sendingConsent ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Invio...</> : <><Mail className="w-4 h-4 mr-2" />Invia richiesta autorizzazione</>}
                </Button>
                <Button variant="outline" className="w-full text-slate-500" onClick={() => setStep(2)}>
                  Salta (consenso già ottenuto) <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            )}

            {crConsentStatus === 'pending' && (
              <div className="space-y-3">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                  <Clock className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">In attesa di risposta</p>
                    <p className="text-xs text-amber-700 mt-0.5">Email inviata a <strong>{crClientEmail}</strong>. Link valido 30 giorni.</p>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={verificaConsenso}>🔄 Verifica stato consenso</Button>
                <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={() => setStep(2)}>Procedi al bilancio <ArrowRight className="w-4 h-4 ml-1" /></Button>
              </div>
            )}

            {crConsentStatus === 'accepted' && (
              <div className="space-y-3">
                <div className="bg-teal-50 border border-teal-300 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-teal-800">Autorizzazione confermata ✓</p>
                    <p className="text-xs text-teal-700 mt-0.5">Il cliente ha autorizzato il trattamento dei dati CR.</p>
                  </div>
                </div>
                <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={() => setStep(2)}>Procedi al bilancio <ArrowRight className="w-4 h-4 ml-1" /></Button>
              </div>
            )}

            {crConsentStatus === 'declined' && (
              <div className="space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-red-700">Autorizzazione rifiutata</p>
                  <p className="text-xs text-red-600 mt-1">Non è possibile caricare la Centrale dei Rischi.</p>
                </div>
                <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={() => setStep(2)}>Procedi comunque (senza CR) <ArrowRight className="w-4 h-4 ml-1" /></Button>
              </div>
            )}

            <Button variant="outline" onClick={() => setStep(0)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
          </div>
        )}

        {/* ── STEP 2: Upload bilancio ── */}
        {step === 2 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><Upload className="w-4 h-4 text-teal-600" /> Carica Bilancio</h2>
            <p className="text-sm text-slate-500">Carica il bilancio in formato XBRL (.xbrl, .xml) oppure PDF (.pdf) per l'analisi automatica dei KPI.</p>
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-teal-400 transition-colors cursor-pointer"
              onClick={() => bilancioRef.current?.click()}>
              <Upload className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              {bilancioFile ? (
                <div>
                  <p className="text-sm font-medium text-teal-700">✅ {bilancioFile.name}</p>
                  {bilancioFileType === 'pdf' && (
                    <p className="text-xs text-blue-600 mt-1">📄 PDF — analisi testuale</p>
                  )}
                  {bilancioFileType === 'xbrl' && (
                    <p className="text-xs text-teal-600 mt-1">📊 XBRL — analisi strutturata</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Clicca per selezionare il file XBRL o PDF</p>
              )}
              <input ref={bilancioRef} type="file" accept=".xbrl,.xml,.pdf" className="hidden" onChange={e => {
                const f = e.target.files?.[0] ?? null;
                setBilancioFile(f);
                if (f) {
                  setBilancioFileType(f.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'xbrl');
                } else {
                  setBilancioFileType(null);
                }
              }} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={analizzaBilancio} disabled={!bilancioFile || analyzingBil}>
                {analyzingBil ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analisi in corso...</> : 'Analizza bilancio'}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 2.5: Finanziamenti ── */}
        {step === (2.5 as never) && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <Banknote className="w-4 h-4 text-teal-600" /> Finanziamenti in Essere
            </h2>
            <p className="text-sm text-slate-500">
              Inserisci manualmente i finanziamenti attivi dell'azienda (mutui, leasing, fidi, ecc.).
              Questi dati verranno inclusi nel report finale. Il DSCR viene ricalcolato come rapporto tra EBITDA
              e somma annuale di tutte le rate mensili inserite.
            </p>

            <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4 space-y-3">
              <div>
                <p className="text-sm font-bold text-teal-900">📄 Importa da Centrale Rischi</p>
                <p className="text-xs text-teal-700 mt-1">
                  Carica il PDF della CR per importare automaticamente i finanziamenti in essere.
                </p>
              </div>
              <input
                ref={crFileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={async e => {
                  const file = e.target.files?.[0] ?? null;
                  e.target.value = '';
                  if (file) await importaDaCR(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="border-teal-300 text-teal-700 hover:bg-teal-100"
                onClick={() => crFileInputRef.current?.click()}
                disabled={importandoCR}
              >
                {importandoCR ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analisi CR in corso...</>
                ) : (
                  <>🔄 Importa Centrale Rischi (PDF)</>
                )}
              </Button>
            </div>

            {finanziamenti.length === 0 && (
              <div className="border border-dashed border-slate-200 rounded-xl p-4 text-center text-sm text-slate-400">
                Nessun finanziamento inserito. Aggiungine uno o passa allo step successivo se non ci sono finanziamenti.
              </div>
            )}

            <div className="space-y-3">
              {finanziamenti.map((f, i) => (
                <div key={i} className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-teal-700">Finanziamento #{i + 1}</span>
                      {f.fonte === 'centrale_rischi' ? (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">📊 CR</span>
                      ) : (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">✏️ Dichiarato</span>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-600 h-7 w-7 p-0" onClick={() => removeFinanziamento(i)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Istituto bancario</label>
                      <input className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" placeholder="es. UniCredit"
                        value={f.istituto} onChange={e => updateFinanziamento(i, 'istituto', e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Tipo</label>
                      <select className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5 bg-white"
                        value={f.tipo} onChange={e => updateFinanziamento(i, 'tipo', e.target.value)}>
                        {TIPI_FINANZIAMENTO.map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Debito residuo (€) *</label>
                      <input type="number" className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" placeholder="0"
                        value={f.importo_residuo || ''} onChange={e => updateFinanziamento(i, 'importo_residuo', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Rata mensile (€) *</label>
                      <input type="number" className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5" placeholder="—"
                        value={f.rata_mensile ?? ''} onChange={e => updateFinanziamento(i, 'rata_mensile', e.target.value ? parseFloat(e.target.value) : null)} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-500">Scadenza</label>
                      <input type="date" className="w-full border rounded-lg px-2 py-1.5 text-sm mt-0.5"
                        value={f.scadenza ?? ''} onChange={e => updateFinanziamento(i, 'scadenza', e.target.value || null)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button variant="outline" className="w-full border-dashed border-teal-300 text-teal-700 hover:bg-teal-50" onClick={addFinanziamento}>
              <PlusCircle className="w-4 h-4 mr-2" /> Aggiungi finanziamento
            </Button>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={stepFinanziamentiNext} disabled={recalculatingScores}>
                {recalculatingScores
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Ricalcolo DSCR e 14 KPI...</>
                  : <>Calcola score su 14 KPI <ArrowRight className="w-4 h-4 ml-1" /></>}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: KPI Scores ── */}
        {step === 3 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><BarChart2 className="w-4 h-4 text-teal-600" /> Score KPI</h2>

            {indice !== null && (
              <div className="text-center py-3 bg-gradient-to-br from-teal-50 to-slate-50 rounded-xl border">
                <div className="text-4xl font-black text-teal-700">{Math.round(indice)}<span className="text-xl text-slate-400">/100</span></div>
                <div className="text-sm font-semibold text-teal-600 mt-1">Indice di Bancabilità</div>
                <div className="text-xs text-slate-500 mt-1">
                  Calcolato su {kpiScores.filter(kpi => kpi.score !== null).length}/{KPI_SCORING_CONFIG.length} KPI disponibili
                </div>
                {ratingBancabile && (
                  <div className={`inline-block mt-2 px-3 py-1 rounded-full text-xs font-bold ${ratingBancabile === 'bancabile' ? 'bg-green-100 text-green-700' : ratingBancabile === 'attenzione' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                    {ratingBancabile === 'bancabile' ? '✅ BANCABILE' : ratingBancabile === 'attenzione' ? '⚠️ ATTENZIONE' : '❌ NON BANCABILE'}
                  </div>
                )}
              </div>
            )}

            {kpiScores.some(kpi => kpi.kpi_key === 'dscr' && kpi.score !== null) && (
              <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
                <strong>DSCR:</strong>{' '}
                {dscrMetodo === 'finanziamenti'
                  ? `calcolato includendo € ${servizioDebitoAnnuo.toLocaleString('it-IT', { maximumFractionDigits: 0 })} di rate annue complessive.`
                  : 'calcolo approssimato su EBITDA e interessi passivi perché non risultano finanziamenti con rate mensili.'}
              </div>
            )}

            {benchmarkData && (
              <div className="bg-blue-50 rounded-lg px-3 py-2 text-xs text-blue-700 border border-blue-200">
                📊 Benchmark settore: <strong>{benchmarkData.settore_label}</strong> — aggiornati al {new Date(benchmarkData.aggiornato_il).toLocaleDateString('it-IT')}
                {benchmarkData.effective_period ? <> · periodo dati {benchmarkData.effective_period}</> : null}
                {benchmarkData.last_checked_at
                  ? <> · fonte controllata il {new Date(benchmarkData.last_checked_at).toLocaleDateString('it-IT')}</>
                  : null}
                {benchmarkData.source_dataset ? <> · {benchmarkData.source_dataset}</> : null}
              </div>
            )}

            {anomalyAnalysis && (
              <div className={`rounded-xl border p-4 ${
                anomalyAnalysis.level === 'critico'
                  ? 'border-red-300 bg-red-50'
                  : anomalyAnalysis.level === 'elevato'
                    ? 'border-orange-300 bg-orange-50'
                    : anomalyAnalysis.level === 'attenzione'
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-green-200 bg-green-50'
              }`}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Anomalie e poste da verificare</h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {anomalyAnalysis.findings.length} segnalazioni · livello {anomalyAnalysis.level}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black text-slate-800">{anomalyAnalysis.score}<span className="text-sm text-slate-400">/100</span></div>
                    <div className="text-[10px] uppercase font-semibold text-slate-500">rischio anomalie</div>
                  </div>
                </div>
                {anomalyAnalysis.findings.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {anomalyAnalysis.findings.slice(0, 5).map(finding => (
                      <div key={finding.id} className="rounded-lg border border-white/80 bg-white/70 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                            finding.severity === 'alta'
                              ? 'bg-red-100 text-red-700'
                              : finding.severity === 'media'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-600'
                          }`}>{finding.severity}</span>
                          <span className="text-xs font-semibold text-slate-800">{finding.title}</span>
                        </div>
                        <p className="text-[11px] text-slate-600 mt-1">{finding.evidence.join(' · ')}</p>
                      </div>
                    ))}
                    {anomalyAnalysis.findings.length > 5 && (
                      <p className="text-[11px] text-slate-500">
                        Altre {anomalyAnalysis.findings.length - 5} segnalazioni saranno incluse nel PDF.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-green-700">Nessuna anomalia significativa rilevata dai controlli automatici.</p>
                )}
                <p className="mt-3 text-[10px] leading-relaxed text-slate-500 italic">{anomalyAnalysis.disclaimer}</p>
              </div>
            )}

            <div className="space-y-2">
              {kpiScores.filter(k => k.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map(k => (
                <div key={k.kpi_key} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 font-medium text-slate-700 text-xs">{k.kpi_label}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${k.score! >= 70 ? 'bg-green-500' : k.score! >= 40 ? 'bg-yellow-400' : 'bg-red-500'}`}
                      style={{ width: `${k.score}%` }} />
                  </div>
                  <span className="w-10 text-right text-[10px] font-semibold text-slate-400">{k.peso}%</span>
                  <span className="w-12 text-right text-xs font-bold tabular-nums text-slate-600">{k.score}/100</span>
                  <span className="text-xs text-slate-400 w-16 text-right">{k.formatted}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2.5 as never)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={() => { setStep(4); generaSuggerimenti(); }}>
                Genera suggerimenti AI <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 4: AI Suggerimenti ── */}
        {step === 4 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><Brain className="w-4 h-4 text-teal-600" /> Raccomandazioni AI</h2>
            {aiLoading ? (
              <div className="py-10 text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-600 mb-3" />
                <p className="text-sm text-slate-500">AI sta elaborando le raccomandazioni...</p>
              </div>
            ) : aiSugg.length === 0 ? (
              <div className="text-center py-6 text-sm text-slate-400">Nessun suggerimento generato</div>
            ) : (
              <div className="space-y-4">
                {aiSugg.map((s, i) => (
                  <div key={s.kpi_key} className="border border-amber-200 rounded-xl p-4 bg-amber-50/40">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-6 h-6 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <span className="font-semibold text-amber-900">{s.kpi_label}</span>
                    </div>
                    <p className="text-xs text-slate-600 italic mb-2">{s.diagnosi}</p>
                    <ul className="space-y-1">
                      {s.azioni.map((az, j) => (
                        <li key={j} className="text-xs text-slate-700 flex items-start gap-1.5">
                          <span className="text-teal-600 font-bold mt-0.5">→</span> {az}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 text-xs text-teal-700 bg-teal-50 rounded px-2 py-1 border border-teal-200">
                      💡 {s.impatto_atteso}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(3)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
              <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={() => setStep(5)} disabled={aiLoading}>
                Genera report PDF <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 5: Report finale ── */}
        {step === 5 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><FileText className="w-4 h-4 text-teal-600" /> Report finale</h2>
            {!pdfBlob ? (
              <div className="text-center py-6">
                <div className="bg-teal-50 rounded-xl p-4 text-left mb-4 space-y-1 text-xs text-teal-800 border border-teal-200">
                  <p className="font-bold">Il report includerà:</p>
                  <p>📄 Copertina con gauge bancabilità e badge rating</p>
                  <p>📊 14 KPI ponderati vs benchmark settore {benchmarkData ? `(${benchmarkData.settore_label})` : ''}</p>
                  <p>🏦 DSCR ricalcolato sulle rate annue complessive dei finanziamenti</p>
                  <p>🌐 Commento situazione settore</p>
                  <p>📋 Top 3 / Bottom 3 KPI con barre visive</p>
                  {finanziamenti.filter(f => f.istituto).length > 0 && <p>🏦 {finanziamenti.filter(f => f.istituto).length} finanziamenti in essere</p>}
                  <p>🎯 {aiSugg.length} raccomandazioni AI</p>
                </div>
                <Button size="lg" className="bg-teal-600 hover:bg-teal-700" onClick={generaPdf} disabled={generating}>
                  {generating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generazione PDF...</> : '📄 Genera PDF'}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 text-center">
                  <CheckCircle className="w-8 h-8 text-teal-600 mx-auto mb-2" />
                  <p className="font-semibold text-teal-800">Report PDF generato{reportSaved ? ' e salvato' : ''}!</p>
                  <p className="text-xs text-teal-600 mt-1">Report bancabilità completo con benchmark {benchmarkData?.settore_label ?? 'settore'}</p>
                </div>
                <Button className="w-full" variant="outline" onClick={scaricaPdf}>
                  <Download className="w-4 h-4 mr-2" /> Scarica PDF
                </Button>
                <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => setStep(6)}>
                  📄 Relazione Commerciale opzionale <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
                <div className="border-t pt-4 space-y-2">
                  <label className="text-xs font-semibold text-slate-600">Invia via email a:</label>
                  <div className="flex gap-2">
                    <input type="email" className="flex-1 border rounded-lg px-3 py-2 text-sm focus:ring-2 ring-teal-400 outline-none"
                      placeholder="email@cliente.it" value={sendEmail} onChange={e => setSendEmail(e.target.value)} />
                    <Button className="bg-teal-600 hover:bg-teal-700" onClick={inviaEmail} disabled={sending || !sendEmail}>
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={() => navigate('/consulente')}>
                  ← Torna alla dashboard
                </Button>
              </div>
            )}
            {!pdfBlob && (
              <Button variant="outline" onClick={() => setStep(4)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
            )}
          </div>
        )}


        {/* ── STEP 6: Relazione Commerciale opzionale ── */}
        {step === 6 && (
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-800 flex items-center gap-2"><FileText className="w-4 h-4 text-purple-600" /> Relazione Commerciale (opzionale)</h2>
            <p className="text-sm text-slate-500">
              Genera una relazione commerciale professionale da allegare al report o da inviare alla banca. L’AI compilerà automaticamente le sezioni dai dati elaborati.
            </p>
            <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-xs text-purple-800 space-y-1">
              <p><strong>Output:</strong> PDF e DOCX scaricabili dal consulente.</p>
              <p><strong>Foto aziendale:</strong> sezione opzionale; usare solo foto fornite dall’azienda, non immagini prese da siti web.</p>
            </div>

            {Object.keys(relazioneAnswers).length === 0 ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <Button className="flex-1 bg-purple-600 hover:bg-purple-700" onClick={generaRelazioneAI} disabled={relazioneLoading}>
                  {relazioneLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analisi in corso...</> : '🤖 Genera con AI'}
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => navigate('/consulente')}>Salta</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {RELAZIONE_SEZIONI.map(section => (
                    <details key={section.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3" open={section.id === 'presentazione_azienda'}>
                      <summary className="cursor-pointer text-sm font-bold text-slate-800">{section.titolo}</summary>
                      <div className="mt-3 space-y-3">
                        {section.domande.map(q => (
                          <div key={q.id}>
                            <label className="text-xs font-semibold text-slate-600">{q.testo}</label>
                            {q.tipo === 'textarea' ? (
                              <textarea className="mt-1 min-h-[92px] w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                                value={relazioneAnswers[q.id] ?? ''} onChange={e => updateRelazioneAnswer(q.id, e.target.value)} />
                            ) : (
                              <input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                                value={relazioneAnswers[q.id] ?? ''} onChange={e => updateRelazioneAnswer(q.id, e.target.value)} />
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  <Button variant="outline" onClick={preparaDownloadRelazione}>
                    <Save className="w-4 h-4 mr-2" /> Prepara PDF + DOCX
                  </Button>
                  <Button variant="outline" onClick={generaRelazioneAI} disabled={relazioneLoading}>
                    {relazioneLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Brain className="w-4 h-4 mr-2" />} Rigenera con AI
                  </Button>
                  <Button disabled={!relazionePdfBlob} onClick={() => relazionePdfBlob && downloadBlob(relazionePdfBlob, `Relazione_Commerciale_${(ragSociale || 'Cliente').replace(/\s+/g, '_')}.pdf`)}>
                    <Download className="w-4 h-4 mr-2" /> Scarica PDF Relazione
                  </Button>
                  <Button disabled={!relazioneDocxBlob} onClick={() => relazioneDocxBlob && downloadBlob(relazioneDocxBlob, `Relazione_Commerciale_${(ragSociale || 'Cliente').replace(/\s+/g, '_')}.docx`)}>
                    <Download className="w-4 h-4 mr-2" /> Scarica DOCX
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep(5)}><ArrowLeft className="w-4 h-4 mr-1" /> Indietro</Button>
              <Button variant="outline" className="flex-1" onClick={() => navigate('/consulente')}>Fine</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
