// @section: segnalazione-pubblica
// Pagina pubblica accessibile senza login — identica a NuovaSegnalazionePage.
// I file vengono convertiti in base64 e inviati all'API che li carica su Storage.

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Upload, X, FileText, Send, Plus, Loader2, CheckCircle2 } from 'lucide-react';

interface FileItem {
  id: string;
  file: File;
  nome: string;
}

// Converte un File in base64
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function SegnalazionePublicaPage() {
  // Campi cliente
  const [ragioneSociale, setRagioneSociale] = useState('');
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
  const [errore,   setErrore]   = useState('');

  // ── Gestione visura ────────────────────────────────────────────────────────
  const handleVisura = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { setErrore('La visura deve essere un PDF'); return; }
    if (f.size > 30 * 1024 * 1024)   { setErrore('File troppo grande (max 30 MB)'); return; }
    setErrore('');
    setVisura(f);
    e.target.value = '';
  };

  // ── Gestione altri documenti ───────────────────────────────────────────────
  const handleAltriDocs = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const nuovi: FileItem[] = files.map(f => ({
      id:   crypto.randomUUID(),
      file: f,
      nome: f.name.replace(/\.[^.]+$/, ''),
    }));
    setAltriDocs(prev => [...prev, ...nuovi]);
    e.target.value = '';
  };

  const removeAltro = (id: string) => setAltriDocs(prev => prev.filter(d => d.id !== id));
  const updateNome  = (id: string, nome: string) =>
    setAltriDocs(prev => prev.map(d => d.id === id ? { ...d, nome } : d));

  // ── Invio segnalazione ─────────────────────────────────────────────────────
  const handleInvia = async () => {
    if (!ragioneSociale.trim()) { setErrore('Inserisci la ragione sociale'); return; }
    if (!visura)                { setErrore('Carica la visura camerale (PDF)'); return; }
    setErrore('');
    setSending(true);

    try {
      // Converti visura in base64
      const visuraB64 = await fileToBase64(visura);

      // Converti altri documenti in base64
      const altriB64 = await Promise.all(
        altriDocs.map(async doc => ({
          name:            doc.file.name,
          type:            doc.file.type || 'application/octet-stream',
          nomeDescrittivo: doc.nome || doc.file.name,
          data:            await fileToBase64(doc.file),
        }))
      );

      const r = await fetch('/api/segnalazione-pubblica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ragione_sociale: ragioneSociale.trim(),
          nome_referente:  null,
          email_referente: emailCliente.trim() || null,
          telefono:        cellulare.trim()    || null,
          note:            note.trim()         || null,
          visura: {
            name: visura.name,
            type: visura.type,
            data: visuraB64,
          },
          altri_docs: altriB64,
        }),
      });

      const json = await r.json();
      if (!r.ok || !json.success) throw new Error(json.error ?? 'Errore invio');
      setInviata(true);

    } catch (err) {
      setErrore('Errore durante l\'invio. Riprova tra qualche minuto.');
    } finally {
      setSending(false);
    }
  };

  const handleNuova = () => {
    setRagioneSociale(''); setCellulare(''); setEmailCliente(''); setNote('');
    setVisura(null); setAltriDocs([]); setInviata(false); setErrore('');
  };

  // ── Schermata successo ─────────────────────────────────────────────────────
  if (inviata) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-6 max-w-md w-full text-center">
          <div className="rounded-full bg-emerald-50 p-6">
            <CheckCircle2 className="w-12 h-12 text-emerald-600" />
          </div>
          <div className="space-y-1">
            <h2 className="text-2xl font-bold">Segnalazione inviata!</h2>
            <p className="text-muted-foreground text-sm">
              La documentazione è stata caricata e il team è stato notificato.<br />
              Sarai contattato al più presto.
            </p>
          </div>
          <Button onClick={handleNuova} className="gap-2">
            <Plus className="w-4 h-4" /> Nuova segnalazione
          </Button>
        </div>
      </div>
    );
  }

  // ── Form (identico a NuovaSegnalazionePage) ────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6 pb-10">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Send className="w-6 h-6 text-orange-500" /> Nuova Segnalazione
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Carica la visura, inserisci i recapiti del cliente e invia la segnalazione.
          </p>
        </div>

        {/* Dati cliente */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">👤 Dati Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
            <CardTitle className="text-sm font-semibold">
              📄 Visura Camerale <span className="text-red-500">*</span>
            </CardTitle>
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
              <CardTitle className="text-sm font-semibold">
                📎 Altri Documenti <span className="text-muted-foreground font-normal">(opzionali)</span>
              </CardTitle>
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
            <CardTitle className="text-sm font-semibold">📝 Note aggiuntive</CardTitle>
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

        {/* Bottone invio */}
        <Button
          className="w-full gap-2 bg-orange-600 hover:bg-orange-700 h-12 text-base"
          onClick={handleInvia}
          disabled={sending || !ragioneSociale.trim() || !visura}
        >
          {sending
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Invio in corso...</>
            : <><Send className="w-4 h-4" /> Invia Segnalazione</>}
        </Button>

        <p className="text-xs text-muted-foreground text-center -mt-2">
          I tuoi dati sono trattati in conformità con il GDPR. Non saranno condivisi con terze parti.
        </p>

      </div>
    </div>
  );
}
