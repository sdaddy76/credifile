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
import { toast } from 'sonner';
import { Download, FileText, Loader2, Plus, Save, Trash2 } from 'lucide-react';

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

  const activeRelazione = useMemo(
    () => relazioni.find(r => r.id === activeRelazioneId) ?? relazioni[0] ?? null,
    [relazioni, activeRelazioneId]
  );

  const activeTemplate = activeRelazione?.relazione_templates ?? templates.find(t => t.id === activeRelazione?.template_id) ?? null;

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
      const [{ data: tpl, error: tplErr }, { data: rel, error: relErr }, { data: client }, { data: practice }] = await Promise.all([
        supabase.from('relazione_templates').select('*').eq('attivo', true).order('nome'),
        supabase.from('relazioni_commerciali').select('*, relazione_templates(*)').eq('practice_id', practiceId).order('updated_at', { ascending: false }),
        clientId ? supabase.from('clients').select('ragione_sociale,codice_fiscale,piva,indirizzo,codice_ateco').eq('id', clientId).maybeSingle() : Promise.resolve({ data: null, error: null } as any),
        supabase.from('practices').select('importo_richiesto').eq('id', practiceId).maybeSingle(),
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
      setAutoData({
        ragione_sociale: c.ragione_sociale ?? '',
        cf: c.codice_fiscale ?? '',
        piva: c.piva ?? '',
        ateco: c.codice_ateco ?? '',
        indirizzo: ((c.indirizzo ?? '').split(/[\n\r]/)[0].trim()).substring(0, 150),
        importo: p.importo_richiesto ?? null,
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

  const saveDraft = async (silent = false) => {
    if (!activeRelazione) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('relazioni_commerciali')
        .update({ risposte: answers, updated_at: new Date().toISOString(), status: activeRelazione.status === 'generata' ? 'generata' : 'bozza' })
        .eq('id', activeRelazione.id);
      if (error) throw error;
      setRelazioni(prev => prev.map(r => r.id === activeRelazione.id ? { ...r, risposte: answers, updated_at: new Date().toISOString() } : r));
      if (!silent) toast.success('Bozza salvata');
    } catch (error: any) {
      console.error(error);
      toast.error(`Errore salvataggio: ${error.message ?? error}`);
      throw error;
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
      if (data?.answers) {
        setAnswers(prev => ({ ...prev, ...data.answers }));
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
  const buildDocChildren = (template: RelazioneTemplate) => {
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

    template.sezioni.forEach(section => {
      children.push(new Paragraph({ text: section.titolo, heading: HeadingLevel.HEADING_1 }));
      section.domande.forEach(question => {
        const raw = answers[question.id];
        if (raw === NA_VALUE) return;
        const value = typeof raw === 'string' && raw.trim() ? raw.trim() : 'Non fornito';
        children.push(new Paragraph({ text: question.testo, heading: HeadingLevel.HEADING_2 }));
        children.push(new Paragraph({ children: [new TextRun(value)] }));
      });
    });
    return children;
  };

  const generatePdfBlob = (template: RelazioneTemplate) => {
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

    template.sezioni.forEach(section => {
      addText(section.titolo, 14, true);
      section.domande.forEach(question => {
        const raw = answers[question.id];
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
      await saveDraft(true);
      const doc = new Document({ sections: [{ properties: {}, children: buildDocChildren(activeTemplate) }] });
      const docxBlob = await Packer.toBlob(doc);
      const pdfBlob = generatePdfBlob(activeTemplate);
      const basePath = `${practiceId}/relazioni/${activeRelazione.id}`;
      const docxPath = `${basePath}/relazione.docx`;
      const pdfPath = `${basePath}/relazione.pdf`;

      const { error: docxErr } = await supabase.storage.from('practice-files').upload(docxPath, docxBlob, {
        upsert: true,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      if (docxErr) throw docxErr;
      const { error: pdfErr } = await supabase.storage.from('practice-files').upload(pdfPath, pdfBlob, {
        upsert: true,
        contentType: 'application/pdf',
      });
      if (pdfErr) throw pdfErr;
      const { error: updErr } = await supabase
        .from('relazioni_commerciali')
        .update({ docx_url: docxPath, pdf_url: pdfPath, status: 'generata', updated_at: new Date().toISOString(), risposte: answers })
        .eq('id', activeRelazione.id);
      if (updErr) throw updErr;
      setRelazioni(prev => prev.map(r => r.id === activeRelazione.id ? { ...r, docx_url: docxPath, pdf_url: pdfPath, status: 'generata', risposte: answers } : r));
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
