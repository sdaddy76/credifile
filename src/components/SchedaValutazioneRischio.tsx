import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ShieldCheck, ShieldAlert, Save, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';

interface Scheda {
  id?: string;
  practice_id: string;
  pep: boolean;
  comportamento: string;
  ammontare: string;
  coerenza_attivita: string;
  area_operativita: string;
  settore_attivita: string;
  settore_note: string;
  rapporti_pa: boolean;
  pregiudizievoli: boolean;
  paesi_rischio: boolean;
  paesi_rischio_note: string;
  dati_reddituali_confermati: boolean;
  soci_incoerenti: boolean;
  fiduciarie_trust: boolean;
  passaggi_quote: boolean;
  variazioni_sedi: boolean;
  addetti_coerenti: boolean;
  modalita_contatto: string;
  videocall_effettuata: boolean | null;
  mail_legale_rapp: string;
  cell_legale_rapp: string;
  note_collaboratore: string;
  validazione_backoffice: string;
  luogo: string;
  data_compilazione: string;
}

const EMPTY: Omit<Scheda, 'practice_id'> = {
  pep: false,
  comportamento: 'collaborativo',
  ammontare: 'coerente',
  coerenza_attivita: 'coerente',
  area_operativita: 'nord_centro',
  settore_attivita: 'altro',
  settore_note: '',
  rapporti_pa: false,
  pregiudizievoli: false,
  paesi_rischio: false,
  paesi_rischio_note: '',
  dati_reddituali_confermati: true,
  soci_incoerenti: false,
  fiduciarie_trust: false,
  passaggi_quote: false,
  variazioni_sedi: false,
  addetti_coerenti: true,
  modalita_contatto: 'presenza_fisica',
  videocall_effettuata: null,
  mail_legale_rapp: '',
  cell_legale_rapp: '',
  note_collaboratore: '',
  validazione_backoffice: '',
  luogo: '',
  data_compilazione: new Date().toISOString().split('T')[0],
};

function calcScore(s: Omit<Scheda, 'practice_id'>): { score: number; rischio: string; autoAlto: boolean } {
  if (s.pep) return { score: 999, rischio: 'ALTO', autoAlto: true };
  if (s.modalita_contatto === 'distanza' && s.videocall_effettuata === false)
    return { score: 999, rischio: 'ALTO', autoAlto: true };

  let score = 0;
  const m: Record<string, number> = { basso: 1, medio: 5, alto: 10, coerente: 1, parziale: 5, incoerente: 10,
    collaborativo: 1, parzialmente: 5, dissimulatorio: 10,
    nord_centro: 1, sud_ue: 5, no_ue: 10,
    altro: 1, costruzioni: 5, rifiuti: 10, pa_difesa: 10,
    presenza_fisica: 1, videocall: 5, assenza: 10 };

  score += m[s.comportamento] ?? 1;
  score += m[s.ammontare] ?? 1;
  score += m[s.coerenza_attivita] ?? 1;
  score += m[s.area_operativita] ?? 1;
  score += m[s.settore_attivita] ?? 1;
  score += s.rapporti_pa ? 5 : 1;
  score += s.pregiudizievoli ? 10 : 1;
  score += s.paesi_rischio ? 10 : 1;
  score += s.dati_reddituali_confermati ? 1 : 10;
  score += s.soci_incoerenti ? 10 : 1;
  score += s.fiduciarie_trust ? 5 : 1;
  score += s.passaggi_quote ? 5 : 1;
  score += s.variazioni_sedi ? 5 : 1;
  score += s.addetti_coerenti ? 1 : 10;
  score += m[s.modalita_contatto] ?? 1;

  const rischio = score < 30 ? 'BASSO' : score <= 70 ? 'MEDIO' : 'ALTO';
  return { score, rischio, autoAlto: false };
}

const RISCHIO_STYLE: Record<string, string> = {
  BASSO: 'bg-green-100 text-green-800',
  MEDIO: 'bg-amber-100 text-amber-800',
  ALTO:  'bg-red-100 text-red-800',
};

interface Props { practiceId: string }

export default function SchedaValutazioneRischio({ practiceId }: Props) {
  const { isAgente, canApprove, user } = useAuth();
  const [scheda, setScheda] = useState<Scheda>({ ...EMPTY, practice_id: practiceId });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('schede_valutazione_rischio').select('*').eq('practice_id', practiceId).maybeSingle()
      .then(({ data }) => {
        if (data) setScheda({ ...EMPTY, ...data, practice_id: practiceId });
        setLoading(false);
      });
  }, [practiceId]);

  const set = (k: keyof Scheda, v: unknown) => setScheda(p => ({ ...p, [k]: v }));

  const { score, rischio, autoAlto } = calcScore(scheda);

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...scheda, punteggio_totale: autoAlto ? null : score, livello_rischio: rischio, agente_id: user?.id };
    const { error } = await supabase.from('schede_valutazione_rischio').upsert(payload, { onConflict: 'practice_id' });
    if (error) toast.error('Errore salvataggio: ' + error.message);
    else toast.success('Scheda salvata');
    setSaving(false);
  };

  if (loading) return <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const ro = !isAgente && !canApprove; // readonly per chi non può modificare

  const RadioQ = ({ label, field, options }: { label: string; field: keyof Scheda; options: { label: string; value: string; score: number }[] }) => (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <RadioGroup value={String(scheda[field])} onValueChange={v => set(field, v)} disabled={ro} className="space-y-1">
        {options.map(o => (
          <div key={o.value} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:border-primary/30">
            <div className="flex items-center gap-2">
              <RadioGroupItem value={o.value} id={`${String(field)}-${o.value}`} />
              <Label htmlFor={`${String(field)}-${o.value}`} className="cursor-pointer text-sm">{o.label}</Label>
            </div>
            <span className="text-xs text-muted-foreground font-mono">+{o.score}</span>
          </div>
        ))}
      </RadioGroup>
    </div>
  );

  const BoolQ = ({ label, field, yesScore, noScore }: { label: string; field: keyof Scheda; yesScore: number; noScore: number }) => (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <RadioGroup value={scheda[field] ? 'si' : 'no'} onValueChange={v => set(field, v === 'si')} disabled={ro} className="flex gap-3">
        <div className="flex items-center justify-between flex-1 rounded-lg border border-border px-3 py-2 has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:border-primary/30">
          <div className="flex items-center gap-2"><RadioGroupItem value="si" id={`${String(field)}-si`} /><Label htmlFor={`${String(field)}-si`} className="cursor-pointer text-sm">Sì</Label></div>
          <span className="text-xs text-muted-foreground font-mono">+{yesScore}</span>
        </div>
        <div className="flex items-center justify-between flex-1 rounded-lg border border-border px-3 py-2 has-[[data-state=checked]]:bg-primary/5 has-[[data-state=checked]]:border-primary/30">
          <div className="flex items-center gap-2"><RadioGroupItem value="no" id={`${String(field)}-no`} /><Label htmlFor={`${String(field)}-no`} className="cursor-pointer text-sm">No</Label></div>
          <span className="text-xs text-muted-foreground font-mono">+{noScore}</span>
        </div>
      </RadioGroup>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Score banner */}
      <Card className="border-border">
        <CardContent className="py-4 px-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {rischio === 'BASSO' ? <ShieldCheck className="w-6 h-6 text-green-600" /> :
             rischio === 'MEDIO' ? <ShieldAlert className="w-6 h-6 text-amber-600" /> :
             <AlertTriangle className="w-6 h-6 text-red-600" />}
            <div>
              <p className="text-xs text-muted-foreground">Punteggio totale</p>
              <p className="text-2xl font-bold text-foreground">{autoAlto ? '—' : score}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-1">Livello di rischio</p>
            <Badge className={`text-sm px-3 py-1 ${RISCHIO_STYLE[rischio]}`}>{autoAlto ? '⚠ ALTO (automatico)' : rischio}</Badge>
          </div>
          <p className="w-full text-xs text-muted-foreground">&lt;30 BASSO · 30–70 MEDIO · &gt;70 ALTO</p>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {/* PEP */}
        <Card className="border-border md:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Persone Politicamente Esposte (PEP)</CardTitle></CardHeader>
          <CardContent>
            <BoolQ label="Tra i soggetti vi è una Persona Politicamente Esposta?" field="pep" yesScore={999} noScore={0} />
            {scheda.pep && <p className="mt-2 text-xs text-red-600 bg-red-50 rounded px-3 py-2 font-medium">⚠ RISCHIO ALTO AUTOMATICO</p>}
          </CardContent>
        </Card>

        {/* Comportamento */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <RadioQ label="Comportamento tenuto" field="comportamento" options={[
              { label: 'Collaborativo', value: 'collaborativo', score: 1 },
              { label: 'Parzialmente collaborativo', value: 'parzialmente', score: 5 },
              { label: 'Comportamenti di natura dissimulatoria', value: 'dissimulatorio', score: 10 },
            ]} />
          </CardContent>
        </Card>

        {/* Ammontare */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <RadioQ label="Ammontare e ragionevolezza operazione" field="ammontare" options={[
              { label: 'Coerente con il profilo economico-patrimoniale', value: 'coerente', score: 1 },
              { label: 'Parzialmente coerente', value: 'parziale', score: 5 },
              { label: 'Incoerente', value: 'incoerente', score: 10 },
            ]} />
          </CardContent>
        </Card>

        {/* Coerenza attività */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <RadioQ label="Coerenza rispetto all'attività svolta" field="coerenza_attivita" options={[
              { label: 'Coerente', value: 'coerente', score: 1 },
              { label: 'Parzialmente coerente', value: 'parziale', score: 5 },
              { label: 'Non coerente', value: 'incoerente', score: 10 },
            ]} />
          </CardContent>
        </Card>

        {/* Area operatività */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <RadioQ label="Area prevalente operatività" field="area_operativita" options={[
              { label: 'Nord e Centro Italia', value: 'nord_centro', score: 1 },
              { label: 'Sud Italia – Isole – Paese UE', value: 'sud_ue', score: 5 },
              { label: 'Paese No UE – Paese Off Shore', value: 'no_ue', score: 10 },
            ]} />
          </CardContent>
        </Card>

        {/* Settore */}
        <Card className="border-border">
          <CardContent className="pt-4 space-y-3">
            <RadioQ label="Settore Attività Economica" field="settore_attivita" options={[
              { label: 'Altro (basso rischio)', value: 'altro', score: 1 },
              { label: 'Costruzioni', value: 'costruzioni', score: 5 },
              { label: 'Gestione dei rifiuti e risanamento', value: 'rifiuti', score: 10 },
              { label: 'Pubblica Amministrazione e Difesa', value: 'pa_difesa', score: 10 },
            ]} />
            <div className="space-y-1">
              <Label className="text-xs">Specificare settore (se Altro)</Label>
              <Input placeholder="es. Commercio al dettaglio..." value={scheda.settore_note} onChange={e => set('settore_note', e.target.value)} disabled={ro} />
            </div>
          </CardContent>
        </Card>

        {/* Rapporti PA */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQ label="La società ha rapporti con la Pubblica Amministrazione?" field="rapporti_pa" yesScore={5} noScore={1} />
          </CardContent>
        </Card>

        {/* Pregiudizievoli */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQ label="Pregiudizievoli/Informazioni negative da fonti pubbliche (Google, social, stampa)?" field="pregiudizievoli" yesScore={10} noScore={1} />
          </CardContent>
        </Card>

        {/* Paesi rischio */}
        <Card className="border-border">
          <CardContent className="pt-4 space-y-3">
            <BoolQ label="Il cliente opera/ha operato con Paesi a Rischio (liste GAFI)?" field="paesi_rischio" yesScore={10} noScore={1} />
            {scheda.paesi_rischio && (
              <div className="space-y-1">
                <Label className="text-xs">Specificare motivo della relazione</Label>
                <Textarea placeholder="Paese, motivo, documentazione richiesta..." value={scheda.paesi_rischio_note} onChange={e => set('paesi_rischio_note', e.target.value)} disabled={ro} rows={2} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dati reddituali */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQ label="I dati reddituali sono confermati da documentazione sull'Origine dei Fondi?" field="dati_reddituali_confermati" yesScore={1} noScore={10} />
          </CardContent>
        </Card>

        {/* Soci incoerenti */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQ label="Ci sono soci/esponenti con profilo non coerente con la partecipazione/ruolo?" field="soci_incoerenti" yesScore={10} noScore={1} />
          </CardContent>
        </Card>

        {/* Fiduciarie */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQ label="Sono presenti Fiduciarie o Trust nella compagine sociale?" field="fiduciarie_trust" yesScore={5} noScore={1} />
          </CardContent>
        </Card>

        {/* Passaggi quote */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQ label="Negli ultimi 3 anni ci sono stati passaggi di quote/azioni societarie?" field="passaggi_quote" yesScore={5} noScore={1} />
          </CardContent>
        </Card>

        {/* Variazioni sedi */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQ label="Negli ultimi 3 anni si sono verificate variazioni delle sedi legali?" field="variazioni_sedi" yesScore={5} noScore={1} />
          </CardContent>
        </Card>

        {/* Addetti coerenti */}
        <Card className="border-border">
          <CardContent className="pt-4">
            <BoolQ label="Il numero degli addetti e le sedi operative sono coerenti con l'attività e il fatturato?" field="addetti_coerenti" yesScore={1} noScore={10} />
          </CardContent>
        </Card>

        {/* Modalità contatto */}
        <Card className="border-border md:col-span-2">
          <CardContent className="pt-4 space-y-3">
            <RadioQ label="Modalità di svolgimento del contatto" field="modalita_contatto" options={[
              { label: 'Presenza fisica del cliente (o rappresentante)', value: 'presenza_fisica', score: 1 },
              { label: 'Riconoscimento tramite videocall', value: 'videocall', score: 5 },
              { label: 'Assenza del cliente (identificazione non diretta)', value: 'assenza', score: 10 },
            ]} />
            {scheda.modalita_contatto === 'distanza' || scheda.modalita_contatto === 'assenza' ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">In caso di onboarding a distanza: videocall effettuata?</p>
                <RadioGroup value={scheda.videocall_effettuata === null ? '' : scheda.videocall_effettuata ? 'si' : 'no'} onValueChange={v => set('videocall_effettuata', v === 'si')} disabled={ro} className="flex gap-3">
                  {[{v:'si',l:'Sì (+1)'},{v:'no',l:'No (Rischio ALTO automatico)'}].map(o => (
                    <div key={o.v} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                      <RadioGroupItem value={o.v} id={`vc-${o.v}`} /><Label htmlFor={`vc-${o.v}`} className="cursor-pointer text-sm">{o.l}</Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Dati legale rappresentante */}
        <Card className="border-border md:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Dati Legale Rappresentante</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Email Legale Rappresentante</Label>
              <Input placeholder="email@azienda.it" value={scheda.mail_legale_rapp} onChange={e => set('mail_legale_rapp', e.target.value)} disabled={ro} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cellulare Legale Rappresentante</Label>
              <Input placeholder="+39 333 1234567" value={scheda.cell_legale_rapp} onChange={e => set('cell_legale_rapp', e.target.value)} disabled={ro} />
            </div>
          </CardContent>
        </Card>

        {/* Note collaboratore */}
        <Card className="border-border md:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Note del Collaboratore</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea placeholder="Ulteriori note..." value={scheda.note_collaboratore} onChange={e => set('note_collaboratore', e.target.value)} disabled={ro} rows={3} />
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Luogo</Label>
                <Input placeholder="Roma" value={scheda.luogo} onChange={e => set('luogo', e.target.value)} disabled={ro} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data compilazione</Label>
                <Input type="date" value={scheda.data_compilazione} onChange={e => set('data_compilazione', e.target.value)} disabled={ro} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Validazione back office — solo segreteria/super_admin */}
        {canApprove && (
          <Card className="border-border md:col-span-2 border-teal-200">
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ClipboardCheck className="w-4 h-4 text-teal-600" />Validazione Back Office</CardTitle></CardHeader>
            <CardContent>
              <Select value={scheda.validazione_backoffice} onValueChange={v => set('validazione_backoffice', v)}>
                <SelectTrigger><SelectValue placeholder="Seleziona validazione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="coerente">✅ Coerente</SelectItem>
                  <SelectItem value="parzialmente">⚠ Parzialmente coerente</SelectItem>
                  <SelectItem value="non_coerente">❌ Non coerente</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        )}
      </div>

      {(isAgente || canApprove) && (
        <Button className="w-full gap-2" onClick={handleSave} disabled={saving}>
          <Save className="w-4 h-4" />{saving ? 'Salvataggio...' : 'Salva Scheda Valutazione Rischio'}
        </Button>
      )}
    </div>
  );
}
