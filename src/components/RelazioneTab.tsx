import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, Packer } from 'docx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toast } from 'sonner';
import { BarChart3, Download, FileText, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import {
  buildBankabilityAssessment,
  type KpiResult,
} from '@/lib/bankabilityScoring';
import type { KpiScore } from '@/lib/generateReportPdf';
import {
  SECTOR_BENCHMARK_UPDATED_AT,
  getAtecoBenchmark,
  getAtecoBenchmarkKey,
} from '@/lib/sectorBenchmarks';
import {
  buildKpiBenchmarkComparisons,
  type KpiBenchmarkComparison,
  type KpiBenchmarkTone,
} from '@/lib/kpiBenchmarkComments';

/* @section: relazione-commerciale-types */
type Domanda = {
  id: string;
  testo: string;
  tipo: 'text' | 'textarea' | 'number';
  obbligatoria: boolean;
  auto_field?: string;
};

type Sezione = {
  id: string;
  titolo: string;
  domande: Domanda[];
};

type RelazioneTemplate = {
  id: string;
  nome: string;
  bank_id: string | null;
  sezioni: Sezione[];
  attivo: boolean;
};

type RelazioneCommerciale = {
  id: string;
  practice_id: string;
  template_id: string | null;
  bank_id: string | null;
  status: 'bozza' | 'completata' | 'generata' | string;
  risposte: Record<string, string | null>;
  docx_url: string | null;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
  relazione_templates?: RelazioneTemplate | null;
};

type AutoData = {
  ragione_sociale: string;
  cf: string;
  piva: string;
  ateco: string;
  indirizzo: string;
  importo: number | null;
};

type BenchmarkInfo = {
  settoreLabel: string;
  kpiData: Record<string, number | null>;
  aggiornatoIl: string;
  fonte: string;
  periodoDati: string | null;
  annoBilancio: number | null;
};

type Props = {
  practiceId: string;
  clientId: string;
  canEdit: boolean;
  role: string;
};

const NA_VALUE = '__na__';

/* @section: relazione-commerciale-helpers */
const formatEuro = (value?: number | null) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/D';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value));
};

const statusBadge = (status: string) => {
  if (status === 'generata') return { label: '🔵 Generata', className: 'bg-blue-100 text-blue-800 border-blue-200' };
  if (status === 'completata') return { label: '🟢 Completata', className: 'bg-green-100 text-green-800 border-green-200' };
  return { label: '🟡 Bozza', className: 'bg-amber-100 text-amber-800 border-amber-200' };
};

const cell = (text: string, bold = false) => new TableCell({
  borders: {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
  },
  children: [new Paragraph({ children: [new TextRun({ text, bold })] })],
});

const commentCell = (text: string) => new TableCell({
  columnSpan: 5,
  borders: {
    top: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
    left: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
    right: { style: BorderStyle.SINGLE, size: 1, color: 'D9E2EC' },
  },
  children: [new Paragraph({
    children: [
      new TextRun({ text: 'Commento: ', bold: true }),
      new TextRun(text),
    ],
  })],
});

const toneClassName: Record<KpiBenchmarkTone, string> = {
  positive: 'bg-green-100 text-green-800 border-green-200',
  neutral: 'bg-blue-100 text-blue-800 border-blue-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  critical: 'bg-red-100 text-red-800 border-red-200',
  unavailable: 'bg-slate-100 text-slate-600 border-slate-200',
};

const benchmarkSourceLabel = (benchmark: BenchmarkInfo | null) => {
  if (!benchmark) return 'Benchmark settoriale non disponibile';
  const date = new Date(benchmark.aggiornatoIl).toLocaleDateString('it-IT');
  const period = benchmark.periodoDati ? ` · periodo dati ${benchmark.periodoDati}` : '';
  const year = benchmark.annoBilancio ? ` · bilancio ${benchmark.annoBilancio}` : '';
  return `${benchmark.settoreLabel} · ${benchmark.fonte} · aggiornato al ${date}${period}${year}`;
};

export default function RelazioneTab({ practiceId, clientId, canEdit, role }: Props) {
  const [templates, setTemplates] = useState<RelazioneTemplate[]>([]);
  const [relazioni, setRelazioni] = useState<RelazioneCommerciale[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [activeRelazioneId, setActiveRelazioneId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [autoData, setAutoData] = useState<AutoData>({ ragione_sociale: '', cf: '', piva: '', ateco: '', indirizzo: '', importo: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [compilingAi, setCompilingAi] = useState(false);
  const [kpiScores, setKpiScores] = useState<KpiScore[]>([]);
  const [benchmarkInfo, setBenchmarkInfo] = useState<BenchmarkInfo | null>(null);

  const activeRelazione = useMemo(
    () => relazioni.find(r => r.id === activeRelazioneId) ?? relazioni[0] ?? null,
    [relazioni, activeRelazioneId]
  );

  const activeTemplate = activeRelazione?.relazione_templates ?? templates.find(t => t.id === activeRelazione?.template_id) ?? null;
  const kpiComparisons = useMemo(
    () => buildKpiBenchmarkComparisons(kpiScores, benchmarkInfo?.kpiData),
    [benchmarkInfo?.kpiData, kpiScores]
  );

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceId, clientId]);

  useEffect(() => {
    if (activeRelazione) setAnswers(activeRelazione.risposte ?? {});
  }, [activeRelazione?.id]);

  /* @section: relazione-commerciale-load */
  const loadAll = async () => {
    setLoading(true);
    try {
      const [
        { data: tpl, error: tplErr },
        { data: rel, error: relErr },
        { data: client },
        { data: practice },
        { data: latestBilancio },
      ] = await Promise.all([
        supabase.from('relazione_templates').select('*').eq('attivo', true).order('nome'),
        supabase.from('relazioni_commerciali').select('*, relazione_templates(*)').eq('practice_id', practiceId).order('updated_at', { ascending: false }),
        clientId ? supabase.from('clients').select('ragione_sociale,codice_fiscale,piva,indirizzo,codice_ateco').eq('id', clientId).maybeSingle() : Promise.resolve({ data: null, error: null } as any),
        supabase.from('practices').select('importo_richiesto').eq('id', practiceId).maybeSingle(),
        supabase.from('bilanci_kpi').select('anno_esercizio,kpi').eq('practice_id', practiceId).order('anno_esercizio', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (tplErr) throw tplErr;
      if (relErr) throw relErr;
      setTemplates(((tpl ?? []) as any[]).map(t => ({ ...t, sezioni: Array.isArray(t.sezioni) ? t.sezioni : [] })) as RelazioneTemplate[]);
      const normalizedRel = ((rel ?? []) as any[]).map(r => ({
        ...r,
        risposte: r.risposte ?? {},
        relazione_templates: r.relazione_templates ? { ...r.relazione_templates, sezioni: Array.isArray(r.relazione_templates.sezioni) ? r.relazione_templates.sezioni : [] } : null,
      })) as RelazioneCommerciale[];
      setRelazioni(normalizedRel);
      setActiveRelazioneId(prev => prev ?? normalizedRel[0]?.id ?? null);
      const c: any = client ?? {};
      const p: any = practice ?? {};
      const latestKpi = latestBilancio?.kpi as KpiResult | null | undefined;
      setKpiScores(latestKpi ? buildBankabilityAssessment(latestKpi).scores : []);
      setAutoData({
        ragione_sociale: c.ragione_sociale ?? '',
        cf: c.codice_fiscale ?? '',
        piva: c.piva ?? '',
        ateco: c.codice_ateco ?? '',
        indirizzo: ((c.indirizzo ?? '').split(/[\n\r]/)[0].trim()).substring(0, 150),
        importo: p.importo_richiesto ?? null,
      });

      const benchmarkKey = getAtecoBenchmarkKey(c.codice_ateco ?? null);
      const fallback = getAtecoBenchmark(c.codice_ateco ?? null);
      const { data: benchmarkRow } = await supabase
        .from('sector_benchmarks')
        .select('ateco_label,kpi_data,aggiornato_il,fonte,source_dataset,effective_period')
        .eq('ateco_macro', benchmarkKey)
        .maybeSingle();
      setBenchmarkInfo({
        settoreLabel: benchmarkRow?.ateco_label ?? fallback.label,
        kpiData: (benchmarkRow?.kpi_data as Record<string, number | null> | null) ?? fallback.kpi as Record<string, number | null>,
        aggiornatoIl: benchmarkRow?.aggiornato_il ?? SECTOR_BENCHMARK_UPDATED_AT,
        fonte: benchmarkRow?.source_dataset ?? benchmarkRow?.fonte ?? 'Banca d’Italia / Mediobanca',
        periodoDati: benchmarkRow?.effective_period ?? null,
        annoBilancio: latestBilancio?.anno_esercizio ?? null,
      });
    } catch (error: any) {
      console.error(error);
      toast.error(`Errore caricamento relazione: ${error.message ?? error}`);
    } finally {
      setLoading(false);
    }
  };

  /* @section: relazione-commerciale-create-save */
  const createRelazione = async () => {
    if (!selectedTemplate) return toast.error('Seleziona un template');
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('relazioni_commerciali')
        .insert({ practice_id: practiceId, template_id: selectedTemplate, risposte: {}, status: 'bozza' })
        .select('*, relazione_templates(*)')
        .single();
      if (error) throw error;
      const normalized = { ...data, risposte: data.risposte ?? {}, relazione_templates: { ...data.relazione_templates, sezioni: data.relazione_templates?.sezioni ?? [] } } as RelazioneCommerciale;
      setRelazioni(prev => [normalized, ...prev]);
      setActiveRelazioneId(normalized.id);
      setSelectedTemplate('');
      toast.success('Relazione commerciale creata');
    } catch (error: any) {
      console.error(error);
      toast.error(`Errore creazione relazione: ${error.message ?? error}`);
    } finally {
      setSaving(false);
    }
  };

  const saveDraftWithAnswers = async (answersToSave: Record<string, string | null>, silent = true) => {
    if (!activeRelazione) return;
    const updatedAt = new Date().toISOString();
    try {
      const { error } = await supabase
        .from('relazioni_commerciali')
        .update({
          risposte: answersToSave,
          updated_at: updatedAt,
          status: activeRelazione.status === 'generata' ? 'generata' : 'bozza',
        })
        .eq('id', activeRelazione.id);
      if (error) throw error;
      setRelazioni(prev => prev.map(r =>
        r.id === activeRelazione.id
          ? { ...r, risposte: answersToSave, updated_at: updatedAt }
          : r
      ));
      if (!silent) toast.success('Bozza salvata');
    } catch (error: any) {
      console.error('Errore salvataggio draft AI:', error);
      if (!silent) toast.error(`Errore salvataggio: ${error.message ?? error}`);
      throw error;
    }
  };

  const saveDraft = async (silent = false) => {
    if (!activeRelazione) return;
    setSaving(true);
    try {
      await saveDraftWithAnswers(answers, silent);
    } finally {
      setSaving(false);
    }
  };

  const setAnswer = (id: string, value: string | null) => setAnswers(prev => ({ ...prev, [id]: value }));

  const compilaConAI = async () => {
    if (!activeRelazione || !activeTemplate) return toast.error('Crea o seleziona una relazione prima di usare l’AI');
    setCompilingAi(true);
    try {
      const { data, error } = await supabase.functions.invoke('genera-relazione-ai', {
        body: { practice_id: practiceId }
      });
      if (error) throw error;
      if (data?.answers && typeof data.answers === 'object') {
        console.log('[AI] answers ricevute:', Object.keys(data.answers).length, 'campi');
        console.log('[AI] primo campo:', Object.entries(data.answers)[0]);
        const normalizedAnswers = Object.entries(data.answers).reduce<Record<string, string | null>>((acc, [key, value]) => {
          if (value === null || value === undefined) {
            acc[key] = null;
          } else if (typeof value === 'string') {
            acc[key] = value;
          } else {
            acc[key] = JSON.stringify(value);
          }
          return acc;
        }, {});
        const newAnswers = { ...answers, ...normalizedAnswers };
        setAnswers(newAnswers);
        await saveDraftWithAnswers(newAnswers);
        toast.success('Relazione compilata con AI! Verifica e completa le sezioni mancanti.');
      } else {
        toast.error(data?.error ?? 'Nessuna risposta AI ricevuta');
      }
    } catch (e: any) {
      toast.error('Errore compilazione AI: ' + (e.message ?? e));
    } finally {
      setCompilingAi(false);
    }
  };

  const handleDeleteRelazione = async (id: string) => {
    if (!window.confirm('Eliminare questa relazione commerciale?')) return;
    try {
      const { error } = await supabase.from('relazioni_commerciali').delete().eq('id', id);
      if (error) throw error;
      setRelazioni(prev => prev.filter(r => r.id !== id));
      if (activeRelazioneId === id) setActiveRelazioneId(null);
      toast.success('Relazione eliminata');
    } catch (error: any) {
      console.error(error);
      toast.error(`Errore eliminazione: ${error.message ?? error}`);
    }
  };

  const countAnswered = (section: Sezione) => {
    const total = section.domande.length;
    const done = section.domande.filter(d => {
      const v = answers[d.id];
      return v === NA_VALUE || (typeof v === 'string' && v.trim().length > 0);
    }).length;
    return `${done}/${total}`;
  };

  /* @section: relazione-commerciale-documents */
  const buildDocChildren = (template: RelazioneTemplate, answersSnapshot = answers) => {
    const rows = [
      ['Richiedente', autoData.ragione_sociale || 'N/D'],
      ['CF/PIVA', `${autoData.cf || 'N/D'} / ${autoData.piva || 'N/D'}`],
      ['Attività ATECO', autoData.ateco || 'N/D'],
      ['Sede Legale', autoData.indirizzo || 'N/D'],
      ['Importo Richiesto', formatEuro(autoData.importo)],
    ];

    const children: any[] = [
      new Paragraph({ text: `RELAZIONE COMMERCIALE - ${template.nome}`, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
      new Paragraph({ children: [new TextRun({ text: `Pratica: ${autoData.ragione_sociale || 'N/D'} | Data: ${new Date().toLocaleDateString('it-IT')}`, italics: true })], alignment: AlignmentType.CENTER }),
      new Paragraph({ text: 'Dati automatici pratica', heading: HeadingLevel.HEADING_1 }),
      new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, true), cell(v)] })) }),
    ];

    children.push(new Paragraph({ text: 'Indicatori finanziari e confronto settoriale', heading: HeadingLevel.HEADING_1 }));
    if (kpiComparisons.length > 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: benchmarkSourceLabel(benchmarkInfo), italics: true })],
      }));
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              cell('Indicatore', true),
              cell('Azienda', true),
              cell('Benchmark', true),
              cell('Scostamento', true),
              cell('Giudizio', true),
            ],
          }),
          ...kpiComparisons.flatMap(comparison => [
            new TableRow({
              children: [
                cell(`${comparison.label} (${comparison.areaLabel})`, true),
                cell(comparison.valueFormatted),
                cell(comparison.benchmarkFormatted),
                cell(`${comparison.deltaFormatted} / ${comparison.deltaPercentFormatted}`),
                cell(comparison.judgement, true),
              ],
            }),
            new TableRow({ children: [commentCell(comparison.comment)] }),
          ]),
        ],
      }));
    } else {
      children.push(new Paragraph({
        children: [new TextRun('KPI non disponibili. Analizzare il bilancio prima di generare la relazione commerciale.')],
      }));
    }

    template.sezioni.forEach(section => {
      children.push(new Paragraph({ text: section.titolo, heading: HeadingLevel.HEADING_1 }));
      section.domande.forEach(question => {
        const raw = answersSnapshot[question.id];
        if (raw === NA_VALUE) return;
        const value = typeof raw === 'string' && raw.trim() ? raw.trim() : 'Non fornito';
        children.push(new Paragraph({ text: question.testo, heading: HeadingLevel.HEADING_2 }));
        children.push(new Paragraph({ children: [new TextRun(value)] }));
      });
    });
    return children;
  };

  const generatePdfBlob = (template: RelazioneTemplate, answersSnapshot = answers) => {
    const doc = new jsPDF();
    const header = `${autoData.ragione_sociale || 'N/D'} — ${template.nome}`;
    let y = 18;
    const addPageIfNeeded = (needed = 10) => {
      if (y + needed > 270) {
        doc.addPage();
        y = 18;
        doc.setFontSize(9);
        doc.text(header, 15, 10);
      }
    };
    const addText = (text: string, size = 10, bold = false) => {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text || ' ', 180);
      addPageIfNeeded(lines.length * 5 + 2);
      doc.text(lines, 15, y);
      y += lines.length * 5 + 3;
    };

    doc.setFontSize(9);
    doc.text(header, 15, 10);
    addText(`RELAZIONE COMMERCIALE - ${template.nome}`, 16, true);
    addText(`Pratica: ${autoData.ragione_sociale || 'N/D'} | Data: ${new Date().toLocaleDateString('it-IT')}`, 10);
    addText('Dati automatici pratica', 14, true);
    addText(`Richiedente: ${autoData.ragione_sociale || 'N/D'}`);
    addText(`CF/PIVA: ${autoData.cf || 'N/D'} / ${autoData.piva || 'N/D'}`);
    addText(`Attività ATECO: ${autoData.ateco || 'N/D'}`);
    addText(`Sede Legale: ${autoData.indirizzo || 'N/D'}`);
    addText(`Importo Richiesto: ${formatEuro(autoData.importo)}`);

    addText('Indicatori finanziari e confronto settoriale', 14, true);
    if (kpiComparisons.length > 0) {
      addText(benchmarkSourceLabel(benchmarkInfo), 8);
      autoTable(doc, {
        startY: y,
        head: [['Indicatore', 'Area', 'Azienda', 'Benchmark', 'Scostamento', 'Giudizio', 'Commento']],
        body: kpiComparisons.map(comparison => [
          comparison.label,
          comparison.areaLabel,
          comparison.valueFormatted,
          comparison.benchmarkFormatted,
          `${comparison.deltaFormatted}\n${comparison.deltaPercentFormatted}`,
          comparison.judgement,
          comparison.comment,
        ]),
        margin: { left: 15, right: 15 },
        styles: { fontSize: 6.4, cellPadding: 1.5, overflow: 'linebreak', valign: 'top' },
        headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 25, fontStyle: 'bold' },
          1: { cellWidth: 18 },
          2: { cellWidth: 18, halign: 'right' },
          3: { cellWidth: 18, halign: 'right' },
          4: { cellWidth: 20, halign: 'right' },
          5: { cellWidth: 23, fontStyle: 'bold' },
          6: { cellWidth: 58 },
        },
        didParseCell(data) {
          if (data.section !== 'body' || data.column.index !== 5) return;
          const comparison = kpiComparisons[data.row.index];
          if (!comparison) return;
          if (comparison.tone === 'positive') {
            data.cell.styles.fillColor = [220, 252, 231];
            data.cell.styles.textColor = [22, 101, 52];
          } else if (comparison.tone === 'neutral') {
            data.cell.styles.fillColor = [219, 234, 254];
            data.cell.styles.textColor = [30, 64, 175];
          } else if (comparison.tone === 'warning') {
            data.cell.styles.fillColor = [254, 243, 199];
            data.cell.styles.textColor = [146, 64, 14];
          } else if (comparison.tone === 'critical') {
            data.cell.styles.fillColor = [254, 226, 226];
            data.cell.styles.textColor = [185, 28, 28];
          } else {
            data.cell.styles.fillColor = [241, 245, 249];
            data.cell.styles.textColor = [71, 85, 105];
          }
        },
      });
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    } else {
      addText('KPI non disponibili. Analizzare il bilancio prima di generare la relazione commerciale.', 10);
    }

    template.sezioni.forEach(section => {
      addText(section.titolo, 14, true);
      section.domande.forEach(question => {
        const raw = answersSnapshot[question.id];
        if (raw === NA_VALUE) return;
        const value = typeof raw === 'string' && raw.trim() ? raw.trim() : 'Non fornito';
        addText(question.testo, 12, true);
        addText(value, 10);
      });
    });
    return doc.output('blob');
  };

  const generaDocumento = async () => {
    if (!activeRelazione || !activeTemplate) return;
    setGenerating(true);
    try {
      const answersToGenerate = { ...answers };
      await saveDraftWithAnswers(answersToGenerate);
      const doc = new Document({ sections: [{ properties: {}, children: buildDocChildren(activeTemplate, answersToGenerate) }] });
      const docxBlob = await Packer.toBlob(doc);
      const pdfBlob = generatePdfBlob(activeTemplate, answersToGenerate);
      const basePath = `${practiceId}/relazioni/${activeRelazione.id}`;
      const docxPath = `${basePath}/relazione.docx`;
      const pdfPath = `${basePath}/relazione.pdf`;

      const { error: docxErr } = await supabase.storage.from('practice-files').upload(docxPath, docxBlob, {
        upsert: true,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      if (docxErr) throw new Error(`Salvataggio DOCX: ${docxErr.message}`);
      const { error: pdfErr } = await supabase.storage.from('practice-files').upload(pdfPath, pdfBlob, {
        upsert: true,
        contentType: 'application/pdf',
      });
      if (pdfErr) throw new Error(`Salvataggio PDF: ${pdfErr.message}`);
      const { error: updErr } = await supabase
        .from('relazioni_commerciali')
        .update({ docx_url: docxPath, pdf_url: pdfPath, status: 'generata', updated_at: new Date().toISOString(), risposte: answersToGenerate })
        .eq('id', activeRelazione.id);
      if (updErr) throw new Error(`Aggiornamento relazione: ${updErr.message}`);
      setRelazioni(prev => prev.map(r => r.id === activeRelazione.id ? { ...r, docx_url: docxPath, pdf_url: pdfPath, status: 'generata', risposte: answersToGenerate } : r));
      toast.success('DOCX e PDF generati');
    } catch (error: any) {
      console.error(error);
      toast.error(`Errore generazione documento: ${error.message ?? error}`);
    } finally {
      setGenerating(false);
    }
  };

  const downloadGenerated = async (path: string | null) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from('practice-files').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) return toast.error('Impossibile generare il link di download');
    window.open(data.signedUrl, '_blank');
  };

  /* @section: relazione-commerciale-render */
  if (loading) {
    return <Card><CardContent className="py-8 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Caricamento relazione commerciale...</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" />Relazione Commerciale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Crea una relazione configurabile per banca, salva le risposte dell’agente e genera l’output in Word e PDF. Le domande non pertinenti possono essere escluse.
          </p>
          {canEdit && (
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                <SelectTrigger className="sm:max-w-md"><SelectValue placeholder="Seleziona template relazione" /></SelectTrigger>
                <SelectContent>
                  {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={createRelazione} disabled={saving || !selectedTemplate} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}Nuova Relazione Commerciale
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {relazioni.length > 0 && (
        <div className="grid md:grid-cols-[150px_1fr] gap-4">
          <div className="space-y-2">
            {relazioni.map(rel => {
              const badge = statusBadge(rel.status);
              return (
                <div
                  key={rel.id}
                  className={`relative rounded-lg border transition ${activeRelazione?.id === rel.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveRelazioneId(rel.id)}
                    className="w-full text-left p-3"
                  >
                    <div className="font-medium text-sm pr-5">{rel.relazione_templates?.nome ?? 'Template relazione'}</div>
                    <Badge className={`mt-2 ${badge.className}`}>{badge.label}</Badge>
                    <div className="text-xs text-muted-foreground mt-2">Aggiornata: {new Date(rel.updated_at).toLocaleString('it-IT')}</div>
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleDeleteRelazione(rel.id); }}
                      className="absolute top-2 right-2 text-muted-foreground hover:text-destructive transition"
                      title="Elimina relazione"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {activeRelazione && activeTemplate && (
            <Card>
              <CardHeader className="space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                  <div>
                    <CardTitle>{activeTemplate.nome}</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">Ruolo: {role || 'utente'} · Le risposte vuote vengono riportate come “Non fornito”.</p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {activeRelazione.docx_url && <Button size="sm" variant="outline" onClick={() => downloadGenerated(activeRelazione.docx_url)}><Download className="w-4 h-4 mr-1" />DOCX</Button>}
                    {activeRelazione.pdf_url && <Button size="sm" variant="outline" onClick={() => downloadGenerated(activeRelazione.pdf_url)}><Download className="w-4 h-4 mr-1" />PDF</Button>}
                    {canEdit && <Button size="sm" variant="outline" onClick={() => saveDraft()} disabled={saving}><Save className="w-4 h-4 mr-1" />Salva</Button>}
                    {canEdit && activeTemplate && (
                      <Button size="sm" variant="outline" onClick={compilaConAI} disabled={compilingAi} className="gap-2 border-purple-200 text-purple-700 hover:bg-purple-50">
                        {compilingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <span>🤖</span>}
                        {compilingAi ? 'Analisi in corso...' : 'Compila con AI'}
                      </Button>
                    )}
                    {canEdit && <Button size="sm" onClick={generaDocumento} disabled={generating}>{generating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}Genera DOCX + PDF</Button>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-4 rounded-lg border bg-slate-50 p-4">
                  <div className="text-sm font-semibold mb-3">Dati automatici pratica</div>
                  <div className="grid md:grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground">Richiedente:</span> <b>{autoData.ragione_sociale || 'N/D'}</b></div>
                    <div><span className="text-muted-foreground">CF/PIVA:</span> <b>{autoData.cf || 'N/D'} / {autoData.piva || 'N/D'}</b></div>
                    <div><span className="text-muted-foreground">ATECO:</span> <b>{autoData.ateco || 'N/D'}</b></div>
                    <div><span className="text-muted-foreground">Importo:</span> <b>{formatEuro(autoData.importo)}</b></div>
                    <div className="md:col-span-2"><span className="text-muted-foreground">Sede Legale:</span> <b>{autoData.indirizzo || 'N/D'}</b></div>
                  </div>
                </div>

                <div className="mb-4 rounded-lg border bg-white">
                  <div className="flex flex-col gap-2 border-b bg-teal-50/70 p-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-teal-900">
                        <BarChart3 className="h-4 w-4" />
                        Indicatori finanziari e confronto settoriale
                      </div>
                      <p className="mt-1 text-xs text-teal-800">
                        Ogni commento considera il valore aziendale, il benchmark e la direzione economica corretta dell’indicatore.
                      </p>
                    </div>
                    {benchmarkInfo && (
                      <Badge variant="outline" className="w-fit border-teal-200 bg-white text-teal-800">
                        {benchmarkInfo.settoreLabel}
                      </Badge>
                    )}
                  </div>
                  {kpiComparisons.length > 0 ? (
                    <div className="divide-y">
                      {kpiComparisons.map((comparison: KpiBenchmarkComparison) => (
                        <div key={comparison.key} className="p-4">
                          <div className="grid gap-3 lg:grid-cols-[minmax(150px,1.1fr)_repeat(3,minmax(90px,0.6fr))_auto] lg:items-center">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{comparison.label}</p>
                              <p className="text-[11px] text-muted-foreground">{comparison.areaLabel}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Azienda</p>
                              <p className="text-sm font-bold tabular-nums">{comparison.valueFormatted}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Benchmark</p>
                              <p className="text-sm font-medium tabular-nums">{comparison.benchmarkFormatted}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Scostamento</p>
                              <p className="text-sm font-medium tabular-nums">
                                {comparison.deltaFormatted}
                                <span className="ml-1 text-xs text-muted-foreground">({comparison.deltaPercentFormatted})</span>
                              </p>
                            </div>
                            <Badge className={toneClassName[comparison.tone]}>{comparison.judgement}</Badge>
                          </div>
                          <p className="mt-3 text-xs leading-relaxed text-slate-600">{comparison.comment}</p>
                          {comparison.score !== null && (
                            <p className="mt-1 text-[10px] text-muted-foreground">Score interno di bancabilità: {comparison.score}/100</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-sm text-muted-foreground">
                      KPI non disponibili. Analizza il bilancio nella scheda “Analisi Finanziaria” per attivare il confronto.
                    </div>
                  )}
                  <div className="border-t bg-slate-50 px-4 py-2 text-[10px] text-muted-foreground">
                    {benchmarkSourceLabel(benchmarkInfo)}
                  </div>
                </div>

                <Accordion type="multiple" defaultValue={[activeTemplate.sezioni[0]?.id].filter(Boolean)} className="w-full">
                  {activeTemplate.sezioni.map(section => (
                    <AccordionItem value={section.id} key={section.id}>
                      <AccordionTrigger>
                        <span>{section.titolo}</span>
                        <Badge variant="outline" className="ml-2">{countAnswered(section)} risposte</Badge>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4 pt-2">
                          {section.domande.map(question => {
                            const isNa = answers[question.id] === NA_VALUE;
                            return (
                              <div key={question.id} className="rounded-lg border p-3 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <Label htmlFor={question.id} className="text-sm font-medium leading-snug">
                                    {question.testo} {question.obbligatoria && <span className="text-red-500">*</span>}
                                  </Label>
                                  <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                                    <Checkbox checked={isNa} disabled={!canEdit} onCheckedChange={checked => setAnswer(question.id, checked ? NA_VALUE : '')} />
                                    Non pertinente
                                  </label>
                                </div>
                                {question.tipo === 'textarea' ? (
                                  <Textarea id={question.id} rows={5} disabled={!canEdit || isNa} value={isNa ? '' : (answers[question.id] ?? '')} onChange={e => setAnswer(question.id, e.target.value)} placeholder={isNa ? 'Domanda esclusa dalla relazione' : 'Inserisci risposta...'} className="resize-y min-h-[100px]" />
                                ) : (
                                  <Input id={question.id} type={question.tipo === 'number' ? 'number' : 'text'} disabled={!canEdit || isNa} value={isNa ? '' : (answers[question.id] ?? '')} onChange={e => setAnswer(question.id, e.target.value)} placeholder={isNa ? 'Domanda esclusa dalla relazione' : 'Inserisci risposta...'} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {relazioni.length === 0 && (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Nessuna relazione commerciale presente. Crea una nuova relazione partendo da un template.</CardContent></Card>
      )}
    </div>
  );
}
