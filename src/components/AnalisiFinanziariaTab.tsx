import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { TrendingUp, Upload, RefreshCw, AlertCircle, CheckCircle2, Building2, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';

interface Props { practiceId: string }

interface KpiEntry { valore: number | null; formatted: string; semaforo: 'verde' | 'giallo' | 'rosso' | 'nd'; label: string }
interface KpiResult {
  liquidita: Record<string, KpiEntry>;
  solidita: Record<string, KpiEntry>;
  redditivita: Record<string, KpiEntry>;
  indebitamento: Record<string, KpiEntry>;
  efficienza: Record<string, KpiEntry>;
  copertura: Record<string, KpiEntry>;
}
interface BilancioRecord {
  id: string;
  anno_esercizio: number;
  ragione_sociale: string;
  is_holding: boolean;
  totale_attivo: number;
  totale_patrimonio_netto: number;
  totale_debiti: number;
  ricavi_vendite: number;
  utile_netto: number;
  kpi: KpiResult;
  created_at: string;
}

const SEMAFORO_COLOR: Record<string, string> = {
  verde: 'bg-green-100 text-green-800 border-green-200',
  giallo: 'bg-amber-100 text-amber-800 border-amber-200',
  rosso: 'bg-red-100 text-red-800 border-red-200',
  nd: 'bg-gray-100 text-gray-500 border-gray-200',
};
const SEMAFORO_DOT: Record<string, string> = {
  verde: 'bg-green-500', giallo: 'bg-amber-400', rosso: 'bg-red-500', nd: 'bg-gray-300',
};

const AREA_LABELS: Record<keyof KpiResult, string> = {
  liquidita: '💧 Liquidità',
  solidita: '🏛️ Solidità Patrimoniale',
  redditivita: '📈 Redditività',
  indebitamento: '💳 Indebitamento',
  efficienza: '⚙️ Efficienza Operativa',
  copertura: '🛡️ Copertura',
};

function fmt(n: number | null, isEur = false) {
  if (n === null) return 'N/D';
  if (isEur) return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  return new Intl.NumberFormat('it-IT').format(n);
}

function KpiCard({ entry }: { entry: KpiEntry }) {
  const sem = entry.semaforo ?? 'nd';
  return (
    <div className={`flex items-center justify-between p-2.5 rounded-lg border text-sm ${SEMAFORO_COLOR[sem]}`}>
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${SEMAFORO_DOT[sem]}`} />
        <span className="font-medium">{entry.label}</span>
      </div>
      <span className="font-bold tabular-nums">{entry.formatted}</span>
    </div>
  );
}

function KpiSection({ title, entries }: { title: string; entries: Record<string, KpiEntry> }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{title}</p>
      <div className="space-y-1.5">
        {Object.values(entries).map(e => <KpiCard key={e.label} entry={e} />)}
      </div>
    </div>
  );
}

// Estrae testo da un PDF usando pdfjs-dist caricato dinamicamente
async function extractPdfText(file: File): Promise<string> {
  // Carica pdfjs-dist in modo lazy per evitare impatti sul bundle iniziale
  const pdfjsLib = await import('pdfjs-dist');
  // Workaround worker: usa un fake worker inline per evitare problemi con Vite
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: { str?: string }) => item.str ?? '')
      .join(' ')
      .replace(/\s{2,}/g, ' ');
    fullText += `\n<!-- Page: ${i} -->\n` + pageText;
  }
  return fullText;
}

export default function AnalisiFinanziariaTab({ practiceId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [bilanci, setBilanci] = useState<BilancioRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedBilancio, setSelectedBilancio] = useState<BilancioRecord | null>(null);

  const loadBilanci = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('bilanci_kpi')
      .select('*')
      .eq('practice_id', practiceId)
      .order('anno_esercizio', { ascending: false });
    const list = (data ?? []) as BilancioRecord[];
    setBilanci(list);
    if (list.length > 0 && !selectedBilancio) setSelectedBilancio(list[0]);
    setLoading(false);
  };

  useEffect(() => { loadBilanci(); }, [practiceId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') { toast.error('Seleziona un file PDF'); return; }

    setAnalyzing(true);
    toast.info('Estrazione testo dal PDF in corso...');

    try {
      // 1. Prima carica il file su storage practice-files
      const storagePath = `bilanci/${practiceId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from('practice-files').upload(storagePath, file);
      if (upErr) { toast.error('Errore upload: ' + upErr.message); setAnalyzing(false); return; }

      // 2. Registra in uploaded_files
      const { data: ufRow } = await supabase.from('uploaded_files').insert({
        practice_id: practiceId,
        nome_file: file.name,
        storage_path: storagePath,
        mime_type: 'application/pdf',
        dimensione: file.size,
      }).select('id').single();

      // 3. Estrai testo dal PDF (client-side con pdfjs-dist)
      toast.info('Analisi XBRL e calcolo KPI...');
      const pdfText = await extractPdfText(file);

      // 4. Invia all'edge function
      const { data: result, error: fnErr } = await supabase.functions.invoke('analizza-bilancio', {
        body: { practice_id: practiceId, pdf_text: pdfText, uploaded_file_id: ufRow?.id ?? null },
      });

      if (fnErr || result?.error) {
        toast.error('Errore analisi: ' + (fnErr?.message ?? result?.error));
        setAnalyzing(false);
        return;
      }

      toast.success(`Bilancio ${result.anno ?? ''} analizzato — KPI calcolati`);
      await loadBilanci();
    } catch (err: unknown) {
      toast.error('Errore durante l\'analisi: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAnalyzing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Conteggio semafori
  const countSemafori = (b: BilancioRecord) => {
    if (!b.kpi) return { verde: 0, giallo: 0, rosso: 0 };
    const all = Object.values(b.kpi).flatMap(area => Object.values(area as Record<string, KpiEntry>));
    return {
      verde: all.filter(k => k.semaforo === 'verde').length,
      giallo: all.filter(k => k.semaforo === 'giallo').length,
      rosso: all.filter(k => k.semaforo === 'rosso').length,
    };
  };

  if (loading) return <div className="py-8 text-center text-muted-foreground text-sm">Caricamento analisi...</div>;

  return (
    <div className="space-y-4">
      {/* Header azione */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Analisi Finanziaria
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Carica il PDF del bilancio civilistico per calcolare automaticamente i KPI bancari
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadBilanci} disabled={analyzing}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Aggiorna
          </Button>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={analyzing}>
            {analyzing
              ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Analisi in corso...</>
              : <><Upload className="w-3.5 h-3.5 mr-1.5" /> Carica Bilancio PDF</>}
          </Button>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
        </div>
      </div>

      {bilanci.length === 0 ? (
        <div className="py-12 text-center border rounded-lg bg-muted/30">
          <TrendingUp className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium text-foreground">Nessun bilancio analizzato</p>
          <p className="text-sm text-muted-foreground mt-1">
            Carica il PDF del bilancio di esercizio per calcolare i KPI bancari
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Lista bilanci (sidebar) */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bilanci analizzati</p>
            {bilanci.map(b => {
              const s = countSemafori(b);
              const isSelected = selectedBilancio?.id === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedBilancio(b)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${isSelected ? 'bg-primary/5 border-primary' : 'bg-card border-border hover:border-muted-foreground/50'}`}
                >
                  <div className="font-semibold text-sm">{b.anno_esercizio ?? '—'}</div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">{b.ragione_sociale}</div>
                  {b.is_holding && <Badge variant="outline" className="text-xs mt-1.5 py-0">Holding</Badge>}
                  <div className="flex gap-2 mt-2 text-xs">
                    <span className="text-green-700">🟢 {s.verde}</span>
                    <span className="text-amber-600">🟡 {s.giallo}</span>
                    <span className="text-red-600">🔴 {s.rosso}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Dashboard KPI */}
          {selectedBilancio && (
            <div className="lg:col-span-2 space-y-4">
              {/* Info azienda */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    {selectedBilancio.ragione_sociale}
                    {selectedBilancio.is_holding && (
                      <Badge variant="secondary" className="text-xs">Holding</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Totale Attivo</p>
                      <p className="font-semibold">{fmt(selectedBilancio.totale_attivo, true)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Patrimonio Netto</p>
                      <p className="font-semibold">{fmt(selectedBilancio.totale_patrimonio_netto, true)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Totale Debiti</p>
                      <p className="font-semibold">{fmt(selectedBilancio.totale_debiti, true)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Utile Esercizio</p>
                      <p className={`font-semibold ${(selectedBilancio.utile_netto ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {fmt(selectedBilancio.utile_netto, true)}
                      </p>
                    </div>
                  </div>

                  {selectedBilancio.is_holding && (
                    <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Azienda holding: nessun ricavo operativo, i proventi derivano da partecipazioni. I KPI di redditività operativa (ROI, ROS) non sono significativi.</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* KPI per area */}
              {selectedBilancio.kpi && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      Scheda KPI Bancari — Esercizio {selectedBilancio.anno_esercizio}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(Object.entries(AREA_LABELS) as [keyof KpiResult, string][]).map(([area, label]) => {
                      const entries = selectedBilancio.kpi[area];
                      if (!entries) return null;
                      return (
                        <div key={area}>
                          <KpiSection title={label} entries={entries} />
                          {area !== 'copertura' && <Separator className="mt-3" />}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
