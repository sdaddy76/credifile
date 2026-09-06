// @section: segnalazione-pubblica
// Pagina pubblica accessibile senza login — identica a NuovaSegnalazionePage.
// I file vengono convertiti in base64 e inviati all'API che li carica su Storage.

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Upload, X, FileText, Send, Plus, Loader2, CheckCircle2, ShieldCheck, BadgeEuro } from 'lucide-react';
import { extractPdfText, parseVisuraCompleta } from '@/lib/parseVisura';
import { supabase } from '@/lib/supabase';
import PublicSiteLayout from '@/components/public/PublicSiteLayout';
import { usePageMeta } from '@/lib/pageMeta';

const PRIVACY_CONSENT_VERSION = '2026-09-05-v1';
const PRIVACY_CONSENT_TEXT = `Dichiaro di aver preso visione dell’informativa privacy e, in qualità di interessato e/o legale rappresentante della società, autorizzo Credifile e il consulente o intermediario incaricato a raccogliere e trattare i dati e i documenti trasmessi con questa richiesta. Autorizzo inoltre la successiva trasmissione alle banche e agli intermediari finanziari coinvolti, esclusivamente per la valutazione della bancabilità, l’istruttoria e l’eventuale perfezionamento di una richiesta di finanziamento. Dichiaro di essere autorizzato a comunicare eventuali dati di terzi contenuti nei documenti.`;
const PAYMENT_DISCLAIMER_VERSION = '2026-09-05-v1';
const PAYMENT_DISCLAIMER_TEXT = `Il servizio di analisi e ricerca di soluzioni finanziarie è a pagamento. L’eventuale attività di mediazione creditizia sarà svolta esclusivamente previa stipula di un apposito contratto di mediazione, con compenso regolato secondo il modello success fee e subordinato al buon esito dell’operazione, secondo le condizioni contrattuali sottoscritte.`;

interface FileItem {
  id: string;
  file: File;
  nome: string;
}

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 12;

export default function SegnalazionePublicaPage() {
  usePageMeta({
    title: 'Richiedi una valutazione di bancabilità — Credifile',
    description: 'Carica la visura e i documenti disponibili per richiedere un’analisi documentale e finanziaria della tua impresa.',
    path: '/richiedi-valutazione',
  });

  // Campi cliente
  const [ragioneSociale, setRagioneSociale] = useState('');
  const [piva,            setPiva]            = useState('');
  const [cellulare,      setCellulare]      = useState('');
  const [emailCliente,   setEmailCliente]   = useState('');
  const [note,           setNote]           = useState('');

  // Visura (obbligatoria)
  const [visura,    setVisura]    = useState<File | null>(null);
  const visuraRef                 = useRef<HTMLInputElement>(null);

  // Altri documenti (opzionali)
  const [altriDocs, setAltriDocs] = useState<FileItem[]>([]);
  const altriRef                  = useRef<HTMLInputElement>(null);

  // Stato invio
  const [sending,  setSending]  = useState(false);
  const [inviata,  setInviata]  = useState(false);
  const [praticaEsistente, setPraticaEsistente] = useState<{ numero_pratica: string; status: string } | null>(null);
  const [errore,   setErrore]   = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [website, setWebsite] = useState('');
  const [formStartedAt, setFormStartedAt] = useState(() => Date.now());
  const [privacyConsentChecked, setPrivacyConsentChecked] = useState(false);
  const [paymentDisclaimerChecked, setPaymentDisclaimerChecked] = useState(false);

  // ── Gestione visura ────────────────────────────────────────────────────────
  const handleVisura = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { setErrore('La visura deve essere un PDF'); return; }
    if (f.size > 30 * 1024 * 1024)   { setErrore('File troppo grande (max 30 MB)'); return; }
    if (f.size + altriDocs.reduce((sum, item) => sum + item.file.size, 0) > MAX_TOTAL_BYTES) {
      setErrore('La dimensione complessiva dei documenti supera 100 MB.');
      return;
    }
    setErrore('');
    setVisura(f);
    e.target.value = '';
    // La visura è la fonte primaria per i dati identificativi. Se il PDF
    // contiene testo, precompiliamo ragione sociale e P.IVA evitando che il
    // cliente debba riscriverle e riducendo il rischio di disallineamenti.
    try {
      const parsed = parseVisuraCompleta(await extractPdfText(await f.arrayBuffer()));
      if (parsed.ragione_sociale) setRagioneSociale(parsed.ragione_sociale);
      if (parsed.piva) setPiva(parsed.piva);
      if (parsed.ragione_sociale || parsed.piva) {
        setErrore('');
      } else {
        setErrore('Non è stato possibile leggere i dati identificativi: verifica ragione sociale e P.IVA.');
      }
    } catch {
      // Il file resta selezionato: per PDF scansionati l’utente può inserire
      // manualmente i dati, mentre l’agente potrà usare OCR/import visura.
      setErrore('Visura caricata. Inserisci ragione sociale e P.IVA se non vengono rilevate automaticamente.');
    }
  };

  // ── Gestione altri documenti ───────────────────────────────────────────────
  const handleAltriDocs = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (altriDocs.length + files.length + 1 > MAX_FILES) {
      setErrore(`Puoi caricare al massimo ${MAX_FILES} documenti, inclusa la visura.`);
      e.target.value = '';
      return;
    }
    const tooLarge = files.find(file => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setErrore(`${tooLarge.name} supera il limite di 30 MB.`);
      e.target.value = '';
      return;
    }
    const totalBytes = (visura?.size ?? 0) + altriDocs.reduce((sum, item) => sum + item.file.size, 0) + files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      setErrore('La dimensione complessiva dei documenti supera 100 MB.');
      e.target.value = '';
      return;
    }
    const nuovi: FileItem[] = files.map(f => ({
      id:   crypto.randomUUID(),
      file: f,
      nome: f.name.replace(/\.[^.]+$/, ''),
    }));
    setErrore('');
    setAltriDocs(prev => [...prev, ...nuovi]);
    e.target.value = '';
  };

  const removeAltro = (id: string) => setAltriDocs(prev => prev.filter(d => d.id !== id));
  const updateNome  = (id: string, nome: string) =>
    setAltriDocs(prev => prev.map(d => d.id === id ? { ...d, nome } : d));

  // ── Invio segnalazione ─────────────────────────────────────────────────────
  const handleInvia = async () => {
    if (!ragioneSociale.trim()) { setErrore('Inserisci la ragione sociale'); return; }
    const normalizedPiva = piva.replace(/\D/g, '');
    if (!/^\d{11}$/.test(normalizedPiva)) { setErrore('Inserisci una P.IVA italiana di 11 cifre'); return; }
    if (!visura)                { setErrore('Carica la visura camerale (PDF)'); return; }
    if (!privacyConsentChecked) { setErrore('Accetta l’autorizzazione privacy e alla trasmissione dei documenti'); return; }
    if (!paymentDisclaimerChecked) { setErrore('Accetta l’avviso relativo al servizio a pagamento'); return; }
    if (Date.now() - formStartedAt < 2500) {
      setErrore('Attendi qualche secondo prima di inviare la richiesta.');
      return;
    }
    setErrore('');
    setSending(true);
    setUploadStatus('Preparazione del caricamento sicuro...');

    try {
      const fileDescriptors = [
        {
          client_id: 'visura',
          name: visura.name,
          type: visura.type || 'application/pdf',
          size: visura.size,
          role: 'visura',
          nome_descrittivo: 'Visura Camerale',
        },
        ...altriDocs.map(doc => ({
          client_id: doc.id,
          name: doc.file.name,
          type: doc.file.type || 'application/octet-stream',
          size: doc.file.size,
          role: 'allegato',
          nome_descrittivo: doc.nome || doc.file.name,
        })),
      ];

      const prepareResponse = await fetch('/api/segnalazione-pubblica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'prepare_uploads',
          piva: normalizedPiva,
          files: fileDescriptors,
          website,
          form_started_at: formStartedAt,
          privacy_consent: privacyConsentChecked,
          privacy_consent_version: PRIVACY_CONSENT_VERSION,
          payment_disclaimer: paymentDisclaimerChecked,
          payment_disclaimer_version: PAYMENT_DISCLAIMER_VERSION,
        }),
      });
      const prepareJson = await prepareResponse.json();
      if (!prepareResponse.ok || !prepareJson.success) {
        throw new Error(prepareJson.error ?? 'Impossibile preparare il caricamento');
      }

      const localFiles = new Map<string, File>([
        ['visura', visura],
        ...altriDocs.map(doc => [doc.id, doc.file] as [string, File]),
      ]);
      const uploads = Array.isArray(prepareJson.uploads) ? prepareJson.uploads : [];

      for (const [index, upload] of uploads.entries()) {
        const file = localFiles.get(upload.client_id);
        if (!file) throw new Error('Documento locale non trovato');
        setUploadStatus(`Caricamento documento ${index + 1} di ${uploads.length}: ${file.name}`);
        const { error: uploadError } = await supabase.storage
          .from('practice-files')
          .uploadToSignedUrl(upload.path, upload.token, file, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
          });
        if (uploadError) throw uploadError;
      }

      setUploadStatus('Registrazione della richiesta...');
      const r = await fetch('/api/segnalazione-pubblica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ragione_sociale: ragioneSociale.trim(),
          piva: normalizedPiva,
          nome_referente:  null,
          email_referente: emailCliente.trim() || null,
          telefono:        cellulare.trim()    || null,
          note:            note.trim()         || null,
          submission_token: prepareJson.submission_token,
          uploaded_files: uploads.map(upload => ({
            client_id: upload.client_id,
            path: upload.path,
          })),
          website,
          form_started_at: formStartedAt,
          privacy_consent: privacyConsentChecked,
          privacy_consent_version: PRIVACY_CONSENT_VERSION,
          payment_disclaimer: paymentDisclaimerChecked,
          payment_disclaimer_version: PAYMENT_DISCLAIMER_VERSION,
        }),
      });

      const json = await r.json();
      if (!r.ok || !json.success) throw new Error(json.error ?? 'Errore invio');
      if (json.already_in_progress && json.existing_practice) {
        setPraticaEsistente(json.existing_practice);
      }
      setInviata(true);

    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setErrore(message || 'Errore durante l\'invio. Riprova tra qualche minuto.');
    } finally {
      setSending(false);
      setUploadStatus('');
    }
  };

  const handleNuova = () => {
    setRagioneSociale(''); setPiva(''); setCellulare(''); setEmailCliente(''); setNote('');
    setVisura(null); setAltriDocs([]); setInviata(false); setErrore('');
    setPraticaEsistente(null);
    setWebsite(''); setFormStartedAt(Date.now());
    setPrivacyConsentChecked(false); setPaymentDisclaimerChecked(false);
    setUploadStatus('');
  };

  // ── Schermata successo ─────────────────────────────────────────────────────
  if (inviata) {
    return (
      <PublicSiteLayout>
        <main className="min-h-[70vh] bg-gray-50 flex items-center justify-center p-4">
          <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">
            <div className="rounded-full bg-emerald-50 p-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-600" />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold">
                {praticaEsistente ? 'Richiesta collegata' : 'Richiesta inviata!'}
              </h1>
              <p className="text-muted-foreground text-sm">
                {praticaEsistente ? (
                  <>
                    Abbiamo trovato una pratica già in lavorazione per questa P.IVA:
                    <br /><strong>{praticaEsistente.numero_pratica}</strong>.
                    <br />Non è stata aperta una seconda pratica. Usa il link del portale già ricevuto o attendi il contatto del tuo agente.
                  </>
                ) : (
                  <>
                    La richiesta è stata registrata e il team è stato notificato.<br />
                    Sarai contattato al più presto.
                  </>
                )}
              </p>
            </div>
            <Button onClick={handleNuova} className="gap-2">
              <Plus className="w-4 h-4" /> Nuova segnalazione
            </Button>
          </div>
        </main>
      </PublicSiteLayout>
    );
  }

  return (
    <PublicSiteLayout>
      <main className="min-h-screen bg-gray-50 py-10 px-4">
        <div className="max-w-2xl mx-auto space-y-6 pb-10">

          {/* Header */}
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Richiesta iniziale</p>
            <h1 className="mt-2 text-2xl font-bold flex items-center gap-2">
              <Send className="w-6 h-6 text-orange-700" /> Richiedi una valutazione di bancabilità
            </h1>
            <p className="text-sm text-muted-foreground mt-2">
              Carica la visura camerale e i documenti disponibili. Credifile registrerà la richiesta e ti contatterà per i passaggi successivi.
            </p>
          </div>

        {/* Dati cliente */}
        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold">👤 Dati Cliente</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>P.IVA <span className="text-red-500">*</span></Label>
              <Input
                placeholder="Es. 01234567890"
                value={piva}
                onChange={e => setPiva(e.target.value.replace(/\D/g, '').slice(0, 11))}
                inputMode="numeric"
                maxLength={11}
              />
              <p className="text-xs text-muted-foreground">Serve per verificare se esiste già una pratica in lavorazione.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Ragione Sociale <span className="text-red-500">*</span></Label>
              <Input
                placeholder="Es. Acme S.r.l."
                value={ragioneSociale}
                onChange={e => setRagioneSociale(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Cellulare</Label>
                <Input
                  placeholder="+39 333 000 0000"
                  value={cellulare}
                  onChange={e => setCellulare(e.target.value)}
                  type="tel"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  placeholder="cliente@email.com"
                  value={emailCliente}
                  onChange={e => setEmailCliente(e.target.value)}
                  type="email"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Visura camerale */}
        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold">
              📄 Visura Camerale <span className="text-red-500">*</span>
            </h2>
          </CardHeader>
          <CardContent>
            {visura ? (
              <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/30">
                <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{visura.name}</p>
                  <p className="text-xs text-muted-foreground">{(visura.size / 1024).toFixed(0)} KB</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setVisura(null)} className="shrink-0">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <label className="cursor-pointer">
                <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-orange-400 hover:bg-orange-50 transition-colors">
                  <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                  <p className="text-sm font-medium text-muted-foreground">Clicca per caricare la visura (PDF)</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">Max 30 MB</p>
                </div>
                <input ref={visuraRef} type="file" accept="application/pdf" className="hidden" onChange={handleVisura} />
              </label>
            )}
          </CardContent>
        </Card>

        {/* Altri documenti */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">
                📎 Altri Documenti <span className="text-muted-foreground font-normal">(opzionali)</span>
              </h2>
              <label className="cursor-pointer">
                <Button size="sm" variant="outline" className="gap-1.5 pointer-events-none" asChild>
                  <span><Plus className="w-3.5 h-3.5" /> Aggiungi</span>
                </Button>
                <input ref={altriRef} type="file" multiple className="hidden" onChange={handleAltriDocs} />
              </label>
            </div>
          </CardHeader>
          <CardContent>
            {altriDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nessun documento aggiunto. Usa il pulsante sopra per allegare file aggiuntivi.
              </p>
            ) : (
              <div className="space-y-2">
                {altriDocs.map(doc => (
                  <div key={doc.id} className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input
                      value={doc.nome}
                      onChange={e => updateNome(doc.id, e.target.value)}
                      className="flex-1 h-8 text-sm"
                      placeholder="Nome documento..."
                    />
                    <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[100px]">{doc.file.name}</span>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => removeAltro(doc.id)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Note */}
        <Card>
          <CardHeader className="pb-3">
            <h2 className="text-sm font-semibold">📝 Note aggiuntive</h2>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Aggiungi eventuali informazioni utili sull'operazione, richiesta del cliente, tipo di finanziamento..."
              rows={4}
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Errore */}
        {errore && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <span className="shrink-0">⚠️</span> {errore}
          </div>
        )}

        <Card className="border-teal-200 bg-teal-50/40">
          <CardHeader className="pb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-teal-950">
              <ShieldCheck className="h-4 w-4 text-teal-700" />
              Autorizzazione privacy e trasmissione documenti
            </h2>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-teal-950">
              <Checkbox
                checked={privacyConsentChecked}
                onCheckedChange={checked => setPrivacyConsentChecked(checked === true)}
                className="mt-0.5"
              />
              <span>
                {PRIVACY_CONSENT_TEXT}
                <span className="mt-1 block text-xs text-teal-800">Versione {PRIVACY_CONSENT_VERSION} · Accettazione obbligatoria prima dell’invio.</span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader className="pb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-950">
              <BadgeEuro className="h-4 w-4 text-amber-700" />
              Servizio a pagamento e mediazione
            </h2>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-amber-950">
              <Checkbox
                checked={paymentDisclaimerChecked}
                onCheckedChange={checked => setPaymentDisclaimerChecked(checked === true)}
                className="mt-0.5"
              />
              <span>
                {PAYMENT_DISCLAIMER_TEXT}
                <span className="mt-1 block text-xs text-amber-800">Versione {PAYMENT_DISCLAIMER_VERSION} · Presa visione obbligatoria.</span>
              </span>
            </label>
          </CardContent>
        </Card>

        {/* Campo honeypot anti-bot: resta invisibile agli utenti reali */}
        <div
          aria-hidden="true"
          className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
        >
          <label htmlFor="website">Lascia vuoto</label>
          <Input
            id="website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={e => setWebsite(e.target.value)}
          />
        </div>

        {/* Bottone invio */}
        <Button
          className="w-full gap-2 bg-orange-700 hover:bg-orange-800 h-12 text-base"
          onClick={handleInvia}
          disabled={sending || !ragioneSociale.trim() || !/^\d{11}$/.test(piva) || !visura || !privacyConsentChecked || !paymentDisclaimerChecked}
        >
          {sending
            ? <><Loader2 className="w-4 h-4 animate-spin" /> {uploadStatus || 'Invio in corso...'}</>
            : <><Send className="w-4 h-4" /> Invia richiesta di valutazione</>}
        </Button>

        <p className="text-xs text-muted-foreground text-center -mt-2">
          I dati vengono trattati per gestire la richiesta e, solo nei limiti dell’autorizzazione accettata, potranno essere trasmessi agli intermediari coinvolti nella valutazione.
        </p>

        </div>
      </main>
    </PublicSiteLayout>
  );
}
