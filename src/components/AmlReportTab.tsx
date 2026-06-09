import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ShieldCheck, ShieldAlert, AlertTriangle, FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Tipi ────────────────────────────────────────────────────────────────────

interface AmlAnswers {
  pep: 'si' | 'no';                         // 1
  comportamento: 'collaborativo' | 'parziale' | 'dissimulatorio'; // 2
  ammontare: 'coerente' | 'parziale' | 'incoerente'; // 3
  coerenza_attivita: 'coerente' | 'parziale' | 'non_coerente'; // 4
  area_operativita: 'nord_centro' | 'sud_isole'; // 5 AUTO
  settore_attivita: 'altro' | 'costruzioni' | 'rifiuti' | 'pa_difesa'; // 6 AUTO
  settore_note: string;                       // 6b
  rapporti_pa: 'si' | 'no';                 // 7
  pregiudizievoli: 'si' | 'no';             // 8 AUTO
  paesi_rischio: 'si' | 'no';               // 9
  dati_reddituali: 'si' | 'no';             // 10 AUTO
  soci_incoerenti: 'si' | 'no';             // 11
  fiduciarie_trust: 'si' | 'no';            // 12
  passaggi_quote: 'si' | 'no';              // 13
  variazioni_sedi: 'si' | 'no';             // 14
  addetti_coerenti: 'si' | 'no';            // 15 AUTO/manuale
  modalita_contatto: 'presenza_fisica' | 'videocall' | 'assenza'; // 16
}

/** Campi auto-compilati */
type AutoFields = Set<keyof AmlAnswers>;

interface AmlState {
  answers: AmlAnswers;
  autoFields: AutoFields;
  mailLegaleRapp: string;
  telefonoLegaleRapp: string;
  collaboratore: string;
  note: string;
}

// ─── Punteggi ────────────────────────────────────────────────────────────────

const SCORES: Record<string, number> = {
  // q1 PEP
  pep_si: 999, pep_no: 1,
  // q2 comportamento
  comportamento_collaborativo: 1, comportamento_parziale: 5, comportamento_dissimulatorio: 10,
  // q3 ammontare
  ammontare_coerente: 1, ammontare_parziale: 5, ammontare_incoerente: 10,
  // q4 coerenza attività
  coerenza_attivita_coerente: 1, coerenza_attivita_parziale: 5, coerenza_attivita_non_coerente: 10,
  // q5 area
  area_operativita_nord_centro: 1, area_operativita_sud_isole: 5,
  // q6 settore
  settore_attivita_altro: 1, settore_attivita_costruzioni: 5,
  settore_attivita_rifiuti: 10, settore_attivita_pa_difesa: 10,
  // q7 rapporti PA
  rapporti_pa_si: 5, rapporti_pa_no: 1,
  // q8 pregiudizievoli
  pregiudizievoli_si: 10, pregiudizievoli_no: 1,
  // q9 paesi rischio
  paesi_rischio_si: 10, paesi_rischio_no: 1,
  // q10 dati reddituali
  dati_reddituali_si: 1, dati_reddituali_no: 10,
  // q11 soci incoerenti
  soci_incoerenti_si: 10, soci_incoerenti_no: 1,
  // q12 fiduciarie
  fiduciarie_trust_si: 5, fiduciarie_trust_no: 1,
  // q13 passaggi quote
  passaggi_quote_si: 5, passaggi_quote_no: 1,
  // q14 variazioni sedi
  variazioni_sedi_si: 5, variazioni_sedi_no: 1,
  // q15 addetti coerenti
  addetti_coerenti_si: 1, addetti_coerenti_no: 10,
  // q16 modalità contatto
  modalita_contatto_presenza_fisica: 1, modalita_contatto_videocall: 5, modalita_contatto_assenza: 10,
};

function getScore(field: keyof AmlAnswers, value: string): number {
  const key = `${field}_${value}`;
  return SCORES[key] ?? 1;
}

function calcTotal(answers: AmlAnswers): { score: number; rischio: 'BASSO' | 'MEDIO' | 'ALTO' } {
  if (answers.pep === 'si') return { score: 999, rischio: 'ALTO' };
  const fields = Object.keys(answers) as (keyof AmlAnswers)[];
  let score = 0;
  for (const f of fields) {
    if (f === 'settore_note') continue;
    const val = answers[f] as string;
    score += getScore(f, val);
  }
  const rischio = score < 30 ? 'BASSO' : score <= 70 ? 'MEDIO' : 'ALTO';
  return { score, rischio };
}

// ─── Regioni Nord/Centro ─────────────────────────────────────────────────────

const NORD_CENTRO_REGIONI = [
  "valle d'aosta", "valle daosta", "liguria", "lombardia", "piemonte",
  "trentino", "veneto", "friuli", "emilia", "romagna", "toscana",
  "umbria", "marche", "lazio",
];

function isNordCentro(indirizzo?: string): boolean {
  if (!indirizzo) return true; // default nord/centro se non specificato
  const lower = indirizzo.toLowerCase();
  return NORD_CENTRO_REGIONI.some(r => lower.includes(r));
}

// ─── ATECO → settore ─────────────────────────────────────────────────────────

type SettoreKey = 'rifiuti' | 'costruzioni' | 'pa_difesa' | 'altro';

function atecoToSettore(ateco?: string | null): SettoreKey {
  if (!ateco) return 'altro';
  const clean = ateco.trim().replace(/[^0-9.]/g, '');
  const num = parseFloat(clean);
  if (!isNaN(num)) {
    if (num >= 38 && num < 39) return 'rifiuti';
    if (num >= 41 && num < 44) return 'costruzioni';
    if (num >= 84 && num < 85) return 'pa_difesa';
  }
  return 'altro';
}

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_ANSWERS: AmlAnswers = {
  pep: 'no',
  comportamento: 'collaborativo',
  ammontare: 'coerente',
  coerenza_attivita: 'coerente',
  area_operativita: 'nord_centro',
  settore_attivita: 'altro',
  settore_note: '',
  rapporti_pa: 'no',
  pregiudizievoli: 'no',
  paesi_rischio: 'no',
  dati_reddituali: 'si',
  soci_incoerenti: 'no',
  fiduciarie_trust: 'no',
  passaggi_quote: 'no',
  variazioni_sedi: 'no',
  addetti_coerenti: 'si',
  modalita_contatto: 'presenza_fisica',
};

// ─── Componente ──────────────────────────────────────────────────────────────

interface Props { practiceId: string }

export default function AmlReportTab({ practiceId }: Props) {
  const [state, setState] = useState<AmlState>({
    answers: { ...DEFAULT_ANSWERS },
    autoFields: new Set(),
    mailLegaleRapp: '',
    telefonoLegaleRapp: '',
    collaboratore: '',
    note: '',
  });
  const [ragioneSociale, setRagioneSociale] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // ── Caricamento dati ────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        // 1. Pratica + cliente + agente
        const { data: practice } = await supabase
          .from('practices')
          .select(`
            *,
            clients(ragione_sociale, email, telefono, indirizzo),
            assigned_agent:admin_profiles!practices_assigned_to_fkey(nome, email),
            codice_ateco
          `)
          .eq('id', practiceId)
          .single();

        // 2. Bilanci KPI (ultimo)
        const { data: bilanci } = await supabase
          .from('bilanci_kpi')
          .select('id')
          .eq('practice_id', practiceId)
          .limit(1);

        // 3. Reputational analyses (ultimo score)
        const { data: repData } = await supabase
          .from('reputational_analyses')
          .select('score_globale')
          .eq('practice_id', practiceId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!alive) return;

        const client = practice?.clients as {
          ragione_sociale?: string;
          email?: string;
          telefono?: string;
          indirizzo?: string;
        } | undefined;

        const agent = practice?.assigned_agent as {
          nome?: string;
          email?: string;
        } | undefined;

        const atecoCode: string | null = practice?.codice_ateco ?? null;
        const indirizzo: string | undefined = client?.indirizzo;

        const autoFields: AutoFields = new Set();
        const answers: AmlAnswers = { ...DEFAULT_ANSWERS };

        // Auto q5: area operatività
        answers.area_operativita = isNordCentro(indirizzo) ? 'nord_centro' : 'sud_isole';
        autoFields.add('area_operativita');

        // Auto q6: settore ATECO
        const settore = atecoToSettore(atecoCode);
        answers.settore_attivita = settore;
        answers.settore_note = atecoCode ?? '';
        autoFields.add('settore_attivita');

        // Auto q8: pregiudizievoli
        const repScore = repData?.score_globale ?? null;
        if (repScore !== null) {
          answers.pregiudizievoli = repScore < 50 ? 'si' : 'no';
          autoFields.add('pregiudizievoli');
        }

        // Auto q10: dati reddituali
        const hasBilanci = bilanci && bilanci.length > 0;
        answers.dati_reddituali = hasBilanci ? 'si' : 'no';
        autoFields.add('dati_reddituali');

        // Auto q15: addetti coerenti (se bilancio disponibile → SI)
        if (hasBilanci) {
          answers.addetti_coerenti = 'si';
          autoFields.add('addetti_coerenti');
        }

        setState({
          answers,
          autoFields,
          mailLegaleRapp: client?.email ?? '',
          telefonoLegaleRapp: client?.telefono ?? '',
          collaboratore: agent?.nome ?? agent?.email ?? '',
          note: '',
        });
        setRagioneSociale(client?.ragione_sociale ?? '');
      } catch (e) {
        toast.error('Errore caricamento dati AML: ' + String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [practiceId]);

  // ── Helper setState ────────────────────────────────────────────────────────

  const setAnswer = <K extends keyof AmlAnswers>(field: K, value: AmlAnswers[K]) => {
    setState(prev => ({
      ...prev,
      answers: { ...prev.answers, [field]: value },
    }));
  };

  const { score, rischio } = calcTotal(state.answers);
  const isPep = state.answers.pep === 'si';
  const today = new Date().toLocaleDateString('it-IT');

  // ── Export PDF ─────────────────────────────────────────────────────────────

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      let y = 15;

      // Intestazione
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('CREDIFILE – Scheda AML REV 12 – USO INTERNO', pageW / 2, y, { align: 'center' });
      y += 6;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(80, 80, 80);
      doc.text(`Confidenziale – stedasrls.it`, pageW / 2, y, { align: 'center' });
      y += 8;

      // Info pratica
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(`Azienda: ${ragioneSociale}`, 14, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.text(`Data: ${today}`, 14, y);
      doc.text(`Collaboratore: ${state.collaboratore || '—'}`, 80, y);
      y += 5;
      doc.text(`Email L.R.: ${state.mailLegaleRapp || '—'}`, 14, y);
      doc.text(`Tel. L.R.: ${state.telefonoLegaleRapp || '—'}`, 80, y);
      y += 8;

      // Separatore
      doc.setDrawColor(200, 200, 200);
      doc.line(14, y, pageW - 14, y);
      y += 5;

      // Tabella domande
      const questions = buildQuestionRows(state.answers, state.autoFields);

      autoTable(doc, {
        startY: y,
        head: [['#', 'Domanda', 'Risposta', 'Auto', 'Pt.']],
        body: questions.map(q => [q.num, q.domanda, q.risposta, q.auto ? '✓' : '', String(q.punteggio)]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 64, 175], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 95 },
          2: { cellWidth: 55 },
          3: { cellWidth: 10, halign: 'center' },
          4: { cellWidth: 12, halign: 'center' },
        },
        alternateRowStyles: { fillColor: [245, 247, 255] },
        didParseCell: (data) => {
          if (data.column.index === 3 && data.cell.raw === '✓') {
            data.cell.styles.textColor = [22, 163, 74];
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      y = (doc as any).lastAutoTable.finalY + 8;

      // Riquadro rischio
      const rischioColor: [number, number, number] =
        rischio === 'BASSO' ? [22, 163, 74] : rischio === 'MEDIO' ? [217, 119, 6] : [220, 38, 38];
      const rischioFill: [number, number, number] =
        rischio === 'BASSO' ? [240, 253, 244] : rischio === 'MEDIO' ? [255, 251, 235] : [254, 242, 242];

      doc.setFillColor(...rischioFill);
      doc.setDrawColor(...rischioColor);
      doc.roundedRect(14, y, pageW - 28, 14, 3, 3, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...rischioColor);
      const rischioText = isPep
        ? `RISCHIO ALTO AUTOMATICO (PEP)  —  Punteggio: n/a`
        : `TOT: ${score}  —  RISCHIO: ${rischio}  (<30 BASSO · 30–70 MEDIO · >70 ALTO)`;
      doc.text(rischioText, pageW / 2, y + 9, { align: 'center' });
      y += 20;

      // Note collaboratore
      if (state.note.trim()) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        doc.text('Note collaboratore:', 14, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        const noteLines = doc.splitTextToSize(state.note, pageW - 28);
        doc.text(noteLines, 14, y);
        y += noteLines.length * 4 + 4;
      }

      // Footer su ogni pagina
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const totalPages = (doc as any).internal.pages.length - 1;
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text('Confidenziale – stedasrls.it', 14, doc.internal.pageSize.getHeight() - 8);
        doc.text(`Pag. ${i}/${totalPages}`, pageW - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
      }

      const fileName = `AML_REV12_${ragioneSociale.replace(/\s+/g, '_')}_${today.replace(/\//g, '-')}.pdf`;
      doc.save(fileName);
      toast.success('PDF esportato: ' + fileName);
    } catch (e) {
      toast.error('Errore export PDF: ' + String(e));
    } finally {
      setExporting(false);
    }
  };

  // ── UI ─────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Caricamento dati AML…</span>
      </div>
    );
  }

  const AutoBadge = () => (
    <Badge className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 border-green-300">Auto</Badge>
  );

  const rischioStyle =
    isPep || rischio === 'ALTO' ? 'bg-red-100 text-red-800 border-red-300' :
    rischio === 'MEDIO' ? 'bg-amber-100 text-amber-800 border-amber-300' :
    'bg-green-100 text-green-800 border-green-300';

  const RischioIcon = isPep || rischio === 'ALTO' ? AlertTriangle :
    rischio === 'MEDIO' ? ShieldAlert : ShieldCheck;

  return (
    <div className="space-y-5 max-w-3xl">

      {/* Titolo */}
      <div>
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          🛡️ Scheda Valutazione Rischio AML – REV 12
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {ragioneSociale} — {today}
        </p>
      </div>

      {/* Score banner */}
      <Card className={`border ${rischioStyle}`}>
        <CardContent className="py-4 px-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <RischioIcon className={`w-6 h-6 ${isPep || rischio === 'ALTO' ? 'text-red-600' : rischio === 'MEDIO' ? 'text-amber-600' : 'text-green-600'}`} />
            <div>
              <p className="text-xs text-muted-foreground">Punteggio totale</p>
              <p className="text-2xl font-bold text-foreground">{isPep ? 'n/a' : score}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-1">Livello di rischio</p>
            <Badge className={`text-sm px-3 py-1 ${rischioStyle}`}>
              {isPep ? '⚠ ALTO automatico (PEP)' : rischio}
            </Badge>
          </div>
          <p className="w-full text-xs text-muted-foreground">&lt;30 BASSO · 30–70 MEDIO · &gt;70 ALTO</p>
        </CardContent>
      </Card>

      {/* Domande */}
      <div className="grid md:grid-cols-2 gap-4">

        {/* Q1 – PEP */}
        <Card className="border-border md:col-span-2 border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              1. Persona Politicamente Esposta (PEP)?
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BoolQuestion
              field="pep"
              value={state.answers.pep}
              onChange={(v) => setAnswer('pep', v as AmlAnswers['pep'])}
              yesScore={999}
              noScore={1}
              isAuto={false}
            />
            {isPep && (
              <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-3 py-2 font-medium">
                ⚠ RISCHIO ALTO AUTOMATICO
              </p>
            )}
          </CardContent>
        </Card>

        {/* Q2 – Comportamento */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <MultiQuestion
              label="2. Comportamento nel contatto"
              field="comportamento"
              value={state.answers.comportamento}
              isAuto={false}
              options={[
                { label: 'Collaborativo', value: 'collaborativo', score: 1 },
                { label: 'Parzialmente collaborativo', value: 'parziale', score: 5 },
                { label: 'Comportamenti dissimulatòri', value: 'dissimulatorio', score: 10 },
              ]}
              onChange={(v) => setAnswer('comportamento', v as AmlAnswers['comportamento'])}
            />
          </CardContent>
        </Card>

        {/* Q3 – Ammontare */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <MultiQuestion
              label="3. Ammontare / ragionevolezza operazione"
              field="ammontare"
              value={state.answers.ammontare}
              isAuto={false}
              options={[
                { label: 'Coerente con profilo eco-patrimoniale', value: 'coerente', score: 1 },
                { label: 'Parzialmente coerente', value: 'parziale', score: 5 },
                { label: 'Incoerente', value: 'incoerente', score: 10 },
              ]}
              onChange={(v) => setAnswer('ammontare', v as AmlAnswers['ammontare'])}
            />
          </CardContent>
        </Card>

        {/* Q4 – Coerenza attività */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <MultiQuestion
              label="4. Coerenza con attività svolta"
              field="coerenza_attivita"
              value={state.answers.coerenza_attivita}
              isAuto={false}
              options={[
                { label: 'Coerente', value: 'coerente', score: 1 },
                { label: 'Parzialmente coerente', value: 'parziale', score: 5 },
                { label: 'Non coerente', value: 'non_coerente', score: 10 },
              ]}
              onChange={(v) => setAnswer('coerenza_attivita', v as AmlAnswers['coerenza_attivita'])}
            />
          </CardContent>
        </Card>

        {/* Q5 – Area operatività (AUTO) */}
        <Card className={`border-border ${state.autoFields.has('area_operativita') ? 'border-green-300 bg-green-50/30' : ''}`}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <p className="text-sm font-medium text-foreground">5. Area prevalente operatività</p>
              {state.autoFields.has('area_operativita') && <AutoBadge />}
            </div>
            <RadioGroup
              value={state.answers.area_operativita}
              onValueChange={(v) => setAnswer('area_operativita', v as AmlAnswers['area_operativita'])}
              className="space-y-1"
            >
              {[
                { label: 'Nord/Centro Italia', value: 'nord_centro', score: 1 },
                { label: 'Sud Italia – Isole', value: 'sud_isole', score: 5 },
              ].map(o => (
                <div key={o.value} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:border-primary/30">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value={o.value} id={`area-${o.value}`} />
                    <Label htmlFor={`area-${o.value}`} className="cursor-pointer text-sm">{o.label}</Label>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">+{o.score}</span>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Q6 – Settore ATECO (AUTO) */}
        <Card className={`border-border ${state.autoFields.has('settore_attivita') ? 'border-green-300 bg-green-50/30' : ''}`}>
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground">6. Settore attività economica (ATECO)</p>
              {state.autoFields.has('settore_attivita') && <AutoBadge />}
            </div>
            <RadioGroup
              value={state.answers.settore_attivita}
              onValueChange={(v) => setAnswer('settore_attivita', v as AmlAnswers['settore_attivita'])}
              className="space-y-1"
            >
              {[
                { label: 'Altro (basso rischio)', value: 'altro', score: 1 },
                { label: 'Costruzioni (ATECO 41-43.x)', value: 'costruzioni', score: 5 },
                { label: 'Gestione rifiuti (ATECO 38.x)', value: 'rifiuti', score: 10 },
                { label: 'PA e Difesa (ATECO 84.x)', value: 'pa_difesa', score: 10 },
              ].map(o => (
                <div key={o.value} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:border-primary/30">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value={o.value} id={`settore-${o.value}`} />
                    <Label htmlFor={`settore-${o.value}`} className="cursor-pointer text-sm">{o.label}</Label>
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">+{o.score}</span>
                </div>
              ))}
            </RadioGroup>
            {state.answers.settore_note && (
              <p className="text-xs text-muted-foreground bg-muted rounded px-2 py-1">
                ATECO: <span className="font-mono font-medium">{state.answers.settore_note}</span>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Q7 – Rapporti PA */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQuestion
              label="7. Rapporti con la Pubblica Amministrazione?"
              field="rapporti_pa"
              value={state.answers.rapporti_pa}
              onChange={(v) => setAnswer('rapporti_pa', v as AmlAnswers['rapporti_pa'])}
              yesScore={5}
              noScore={1}
              isAuto={false}
            />
          </CardContent>
        </Card>

        {/* Q8 – Pregiudizievoli (AUTO) */}
        <Card className={`border-border ${state.autoFields.has('pregiudizievoli') ? 'border-green-300 bg-green-50/30' : ''}`}>
          <CardContent className="pt-4">
            <BoolQuestion
              label="8. Pregiudizievoli / Informazioni negative?"
              field="pregiudizievoli"
              value={state.answers.pregiudizievoli}
              onChange={(v) => setAnswer('pregiudizievoli', v as AmlAnswers['pregiudizievoli'])}
              yesScore={10}
              noScore={1}
              isAuto={state.autoFields.has('pregiudizievoli')}
            />
          </CardContent>
        </Card>

        {/* Q9 – Paesi rischio */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQuestion
              label="9. Opera con Paesi a rischio (GAFI)?"
              field="paesi_rischio"
              value={state.answers.paesi_rischio}
              onChange={(v) => setAnswer('paesi_rischio', v as AmlAnswers['paesi_rischio'])}
              yesScore={10}
              noScore={1}
              isAuto={false}
            />
          </CardContent>
        </Card>

        {/* Q10 – Dati reddituali (AUTO) */}
        <Card className={`border-border ${state.autoFields.has('dati_reddituali') ? 'border-green-300 bg-green-50/30' : ''}`}>
          <CardContent className="pt-4">
            <BoolQuestion
              label="10. Dati reddituali confermati da documentazione?"
              field="dati_reddituali"
              value={state.answers.dati_reddituali}
              onChange={(v) => setAnswer('dati_reddituali', v as AmlAnswers['dati_reddituali'])}
              yesScore={1}
              noScore={10}
              isAuto={state.autoFields.has('dati_reddituali')}
            />
          </CardContent>
        </Card>

        {/* Q11 – Soci incoerenti */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQuestion
              label="11. Soci/esponenti con profilo incoerente?"
              field="soci_incoerenti"
              value={state.answers.soci_incoerenti}
              onChange={(v) => setAnswer('soci_incoerenti', v as AmlAnswers['soci_incoerenti'])}
              yesScore={10}
              noScore={1}
              isAuto={false}
            />
          </CardContent>
        </Card>

        {/* Q12 – Fiduciarie/Trust */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQuestion
              label="12. Fiduciarie o Trust nella compagine?"
              field="fiduciarie_trust"
              value={state.answers.fiduciarie_trust}
              onChange={(v) => setAnswer('fiduciarie_trust', v as AmlAnswers['fiduciarie_trust'])}
              yesScore={5}
              noScore={1}
              isAuto={false}
            />
          </CardContent>
        </Card>

        {/* Q13 – Passaggi quote */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQuestion
              label="13. Passaggi quote ultimi 3 anni?"
              field="passaggi_quote"
              value={state.answers.passaggi_quote}
              onChange={(v) => setAnswer('passaggi_quote', v as AmlAnswers['passaggi_quote'])}
              yesScore={5}
              noScore={1}
              isAuto={false}
            />
          </CardContent>
        </Card>

        {/* Q14 – Variazioni sedi */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQuestion
              label="14. Variazioni sedi legali ultimi 3 anni?"
              field="variazioni_sedi"
              value={state.answers.variazioni_sedi}
              onChange={(v) => setAnswer('variazioni_sedi', v as AmlAnswers['variazioni_sedi'])}
              yesScore={5}
              noScore={1}
              isAuto={false}
            />
          </CardContent>
        </Card>

        {/* Q15 – Addetti/sedi coerenti (AUTO se bilancio) */}
        <Card className={`border-border ${state.autoFields.has('addetti_coerenti') ? 'border-green-300 bg-green-50/30' : ''}`}>
          <CardContent className="pt-4">
            <BoolQuestion
              label="15. N. addetti/sedi coerenti con fatturato?"
              field="addetti_coerenti"
              value={state.answers.addetti_coerenti}
              onChange={(v) => setAnswer('addetti_coerenti', v as AmlAnswers['addetti_coerenti'])}
              yesScore={1}
              noScore={10}
              isAuto={state.autoFields.has('addetti_coerenti')}
            />
          </CardContent>
        </Card>

        {/* Q16 – Modalità contatto */}
        <Card className="border-border md:col-span-2">
          <CardContent className="pt-4">
            <MultiQuestion
              label="16. Modalità di svolgimento del contatto"
              field="modalita_contatto"
              value={state.answers.modalita_contatto}
              isAuto={false}
              options={[
                { label: 'Presenza fisica del cliente', value: 'presenza_fisica', score: 1 },
                { label: 'Riconoscimento tramite videocall', value: 'videocall', score: 5 },
                { label: 'Assenza del cliente (identificazione non diretta)', value: 'assenza', score: 10 },
              ]}
              onChange={(v) => setAnswer('modalita_contatto', v as AmlAnswers['modalita_contatto'])}
            />
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Dati legale rappresentante */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Dati Legale Rappresentante</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mail Legale Rapp.</Label>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{state.mailLegaleRapp || '—'}</p>
              <Badge className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700">Auto</Badge>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Telefono Legale Rapp.</Label>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{state.telefonoLegaleRapp || '—'}</p>
              <Badge className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700">Auto</Badge>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Collaboratore incaricato</Label>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{state.collaboratore || '—'}</p>
              <Badge className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700">Auto</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Note collaboratore */}
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Note Collaboratore</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Eventuali note aggiuntive per la valutazione AML…"
            value={state.note}
            onChange={e => setState(prev => ({ ...prev, note: e.target.value }))}
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Riquadro totale */}
      <Card className={`border-2 ${rischioStyle}`}>
        <CardContent className="py-4 px-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <RischioIcon className={`w-8 h-8 ${isPep || rischio === 'ALTO' ? 'text-red-600' : rischio === 'MEDIO' ? 'text-amber-600' : 'text-green-600'}`} />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Totale punteggio</p>
              <p className="text-3xl font-bold">{isPep ? 'n/a' : score}</p>
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Livello rischio</p>
            <p className={`text-2xl font-extrabold ${isPep || rischio === 'ALTO' ? 'text-red-700' : rischio === 'MEDIO' ? 'text-amber-700' : 'text-green-700'}`}>
              {isPep ? 'ALTO (PEP)' : rischio}
            </p>
          </div>
          <p className="text-xs text-muted-foreground w-full">&lt;30 BASSO · 30–70 MEDIO · &gt;70 ALTO</p>
        </CardContent>
      </Card>

      {/* Export PDF */}
      <Button
        className="w-full gap-2 bg-blue-700 hover:bg-blue-800 text-white"
        size="lg"
        onClick={handleExportPdf}
        disabled={exporting}
      >
        {exporting
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Generazione PDF…</>
          : <><FileDown className="w-4 h-4" /> 📥 Esporta PDF – Scheda AML REV 12</>
        }
      </Button>
    </div>
  );
}

// ─── Sottocomponenti ──────────────────────────────────────────────────────────

interface BoolQProps {
  label?: string;
  field: string;
  value: 'si' | 'no';
  onChange: (v: string) => void;
  yesScore: number;
  noScore: number;
  isAuto: boolean;
}

function BoolQuestion({ label, field, value, onChange, yesScore, noScore, isAuto }: BoolQProps) {
  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {isAuto && (
            <Badge className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 border-green-300">Auto</Badge>
          )}
        </div>
      )}
      <RadioGroup value={value} onValueChange={onChange} className="flex gap-3">
        {[
          { v: 'si', l: 'Sì', s: yesScore },
          { v: 'no', l: 'No', s: noScore },
        ].map(o => (
          <div key={o.v} className="flex items-center justify-between flex-1 rounded-lg border border-border px-3 py-2 has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:border-primary/30">
            <div className="flex items-center gap-2">
              <RadioGroupItem value={o.v} id={`${field}-${o.v}`} />
              <Label htmlFor={`${field}-${o.v}`} className="cursor-pointer text-sm">{o.l}</Label>
            </div>
            <span className="text-xs text-muted-foreground font-mono">+{o.s}</span>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

interface MultiQProps {
  label: string;
  field: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string; score: number }[];
  isAuto: boolean;
}

function MultiQuestion({ label, field, value, onChange, options, isAuto }: MultiQProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {isAuto && (
          <Badge className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 border-green-300">Auto</Badge>
        )}
      </div>
      <RadioGroup value={value} onValueChange={onChange} className="space-y-1">
        {options.map(o => (
          <div key={o.value} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:border-primary/30">
            <div className="flex items-center gap-2">
              <RadioGroupItem value={o.value} id={`${field}-${o.value}`} />
              <Label htmlFor={`${field}-${o.value}`} className="cursor-pointer text-sm">{o.label}</Label>
            </div>
            <span className="text-xs text-muted-foreground font-mono">+{o.score}</span>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

// ─── Helper per tabella PDF ───────────────────────────────────────────────────

interface QuestionRow {
  num: string;
  domanda: string;
  risposta: string;
  auto: boolean;
  punteggio: number;
}

function buildQuestionRows(answers: AmlAnswers, autoFields: AutoFields): QuestionRow[] {
  const LABEL_MAP: Record<string, Record<string, string>> = {
    pep: { si: 'Sì', no: 'No' },
    comportamento: { collaborativo: 'Collaborativo', parziale: 'Parzialmente collaborativo', dissimulatorio: 'Comportamento dissimulatorio' },
    ammontare: { coerente: 'Coerente', parziale: 'Parzialmente coerente', incoerente: 'Incoerente' },
    coerenza_attivita: { coerente: 'Coerente', parziale: 'Parzialmente coerente', non_coerente: 'Non coerente' },
    area_operativita: { nord_centro: 'Nord/Centro Italia', sud_isole: 'Sud Italia – Isole' },
    settore_attivita: { altro: 'Altro', costruzioni: 'Costruzioni', rifiuti: 'Gestione rifiuti', pa_difesa: 'PA e Difesa' },
    rapporti_pa: { si: 'Sì', no: 'No' },
    pregiudizievoli: { si: 'Sì', no: 'No' },
    paesi_rischio: { si: 'Sì', no: 'No' },
    dati_reddituali: { si: 'Sì', no: 'No' },
    soci_incoerenti: { si: 'Sì', no: 'No' },
    fiduciarie_trust: { si: 'Sì', no: 'No' },
    passaggi_quote: { si: 'Sì', no: 'No' },
    variazioni_sedi: { si: 'Sì', no: 'No' },
    addetti_coerenti: { si: 'Sì', no: 'No' },
    modalita_contatto: { presenza_fisica: 'Presenza fisica', videocall: 'Videocall', assenza: 'Assenza del cliente' },
  };

  const rows: QuestionRow[] = [
    { num: '1', domanda: 'Persona Politicamente Esposta (PEP)?', risposta: LABEL_MAP.pep[answers.pep] ?? answers.pep, auto: false, punteggio: answers.pep === 'si' ? 999 : 1 },
    { num: '2', domanda: 'Comportamento nel contatto', risposta: LABEL_MAP.comportamento[answers.comportamento] ?? answers.comportamento, auto: false, punteggio: getScore('comportamento', answers.comportamento) },
    { num: '3', domanda: 'Ammontare / ragionevolezza operazione', risposta: LABEL_MAP.ammontare[answers.ammontare] ?? answers.ammontare, auto: false, punteggio: getScore('ammontare', answers.ammontare) },
    { num: '4', domanda: 'Coerenza con attività svolta', risposta: LABEL_MAP.coerenza_attivita[answers.coerenza_attivita] ?? answers.coerenza_attivita, auto: false, punteggio: getScore('coerenza_attivita', answers.coerenza_attivita) },
    { num: '5', domanda: 'Area prevalente operatività', risposta: LABEL_MAP.area_operativita[answers.area_operativita] ?? answers.area_operativita, auto: autoFields.has('area_operativita'), punteggio: getScore('area_operativita', answers.area_operativita) },
    { num: '6', domanda: `Settore attività economica${answers.settore_note ? ` (ATECO: ${answers.settore_note})` : ''}`, risposta: LABEL_MAP.settore_attivita[answers.settore_attivita] ?? answers.settore_attivita, auto: autoFields.has('settore_attivita'), punteggio: getScore('settore_attivita', answers.settore_attivita) },
    { num: '7', domanda: 'Rapporti con la PA?', risposta: LABEL_MAP.rapporti_pa[answers.rapporti_pa] ?? answers.rapporti_pa, auto: false, punteggio: getScore('rapporti_pa', answers.rapporti_pa) },
    { num: '8', domanda: 'Pregiudizievoli / Informazioni negative?', risposta: LABEL_MAP.pregiudizievoli[answers.pregiudizievoli] ?? answers.pregiudizievoli, auto: autoFields.has('pregiudizievoli'), punteggio: getScore('pregiudizievoli', answers.pregiudizievoli) },
    { num: '9', domanda: 'Opera con Paesi a rischio (GAFI)?', risposta: LABEL_MAP.paesi_rischio[answers.paesi_rischio] ?? answers.paesi_rischio, auto: false, punteggio: getScore('paesi_rischio', answers.paesi_rischio) },
    { num: '10', domanda: 'Dati reddituali confermati da documentazione?', risposta: LABEL_MAP.dati_reddituali[answers.dati_reddituali] ?? answers.dati_reddituali, auto: autoFields.has('dati_reddituali'), punteggio: getScore('dati_reddituali', answers.dati_reddituali) },
    { num: '11', domanda: 'Soci/esponenti con profilo incoerente?', risposta: LABEL_MAP.soci_incoerenti[answers.soci_incoerenti] ?? answers.soci_incoerenti, auto: false, punteggio: getScore('soci_incoerenti', answers.soci_incoerenti) },
    { num: '12', domanda: 'Fiduciarie o Trust nella compagine?', risposta: LABEL_MAP.fiduciarie_trust[answers.fiduciarie_trust] ?? answers.fiduciarie_trust, auto: false, punteggio: getScore('fiduciarie_trust', answers.fiduciarie_trust) },
    { num: '13', domanda: 'Passaggi quote ultimi 3 anni?', risposta: LABEL_MAP.passaggi_quote[answers.passaggi_quote] ?? answers.passaggi_quote, auto: false, punteggio: getScore('passaggi_quote', answers.passaggi_quote) },
    { num: '14', domanda: 'Variazioni sedi legali ultimi 3 anni?', risposta: LABEL_MAP.variazioni_sedi[answers.variazioni_sedi] ?? answers.variazioni_sedi, auto: false, punteggio: getScore('variazioni_sedi', answers.variazioni_sedi) },
    { num: '15', domanda: 'N. addetti/sedi coerenti con fatturato?', risposta: LABEL_MAP.addetti_coerenti[answers.addetti_coerenti] ?? answers.addetti_coerenti, auto: autoFields.has('addetti_coerenti'), punteggio: getScore('addetti_coerenti', answers.addetti_coerenti) },
    { num: '16', domanda: 'Modalità di svolgimento del contatto', risposta: LABEL_MAP.modalita_contatto[answers.modalita_contatto] ?? answers.modalita_contatto, auto: false, punteggio: getScore('modalita_contatto', answers.modalita_contatto) },
  ];

  return rows;
}
