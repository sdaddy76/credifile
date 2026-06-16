import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Upload, X, FileText, Send, Plus, Loader2, CheckCircle2 } from 'lucide-react';

interface FileItem {
  id: string;
  file: File;
  nome: string; // nome descrittivo
}

export default function NuovaSegnalazionePage() {
  const { user } = useAuth();

  // Campi cliente
  const [ragioneSociale, setRagioneSociale] = useState('');
  const [cellulare, setCellulare]           = useState('');
  const [emailCliente, setEmailCliente]     = useState('');
  const [note, setNote]                     = useState('');

  // Visura (obbligatoria)
  const [visura,    setVisura]    = useState<File | null>(null);
  const visuraRef                 = useRef<HTMLInputElement>(null);

  // Altri documenti (opzionali)
  const [altriDocs, setAltriDocs] = useState<FileItem[]>([]);
  const altriRef                  = useRef<HTMLInputElement>(null);

  // Stato invio
  const [sending, setSending]   = useState(false);
  const [inviata, setInviata]   = useState(false);

  // ── Gestione visura ────────────────────────────────────────────────────────
  const handleVisura = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { toast.error('La visura deve essere un PDF'); return; }
    if (f.size > 30 * 1024 * 1024) { toast.error('File troppo grande (max 30 MB)'); return; }
    setVisura(f);
    e.target.value = '';
  };

  // ── Gestione altri documenti ───────────────────────────────────────────────
  const handleAltriDocs = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const nuovi: FileItem[] = files.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      nome: f.name.replace(/\.[^.]+$/, ''), // nome senza estensione come default
    }));
    setAltriDocs(prev => [...prev, ...nuovi]);
    e.target.value = '';
  };

  const removeAltro = (id: string) => setAltriDocs(prev => prev.filter(d => d.id !== id));
  const updateNome  = (id: string, nome: string) =>
    setAltriDocs(prev => prev.map(d => d.id === id ? { ...d, nome } : d));

  // ── Upload file su Supabase Storage ───────────────────────────────────────
  const uploadFile = async (file: File, path: string): Promise<string | null> => {
    const { error } = await supabase.storage
      .from('practice-files')
      .upload(path, file, { upsert: true });
    if (error) { console.error('Upload error:', error); return null; }

    // Genera URL firmato lungo (10 anni)
    const { data } = await supabase.storage
      .from('practice-files')
      .createSignedUrl(path, 315360000);
    return data?.signedUrl ?? null;
  };

  // ── Invio segnalazione ─────────────────────────────────────────────────────
  const handleInvia = async () => {
    if (!ragioneSociale.trim()) { toast.error('Inserisci la ragione sociale'); return; }
    if (!visura)                { toast.error('Carica la visura camerale (PDF)'); return; }
    if (!user?.id)              { toast.error('Sessione scaduta, ricarica la pagina'); return; }

    setSending(true);
    try {
      const ts   = Date.now();
      const base = `segnalazioni/${user.id}/${ts}`;

      // Upload visura
      const visuraUrl = await uploadFile(visura, `${base}/visura_${visura.name}`);
      if (!visuraUrl) throw new Error('Errore upload visura');

      // Upload altri documenti
      const fileUrls: { nome: string; url: string }[] = [
        { nome: `Visura Camerale — ${visura.name}`, url: visuraUrl },
      ];
      for (const doc of altriDocs) {
        const url = await uploadFile(doc.file, `${base}/${doc.file.name}`);
        if (url) fileUrls.push({ nome: doc.nome || doc.file.name, url });
      }

      // Invia notifica email via API
      const r = await fetch('/api/notifica-segnalazione', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segnalatore_id: user.id,
          ragione_sociale: ragioneSociale.trim(),
          cellulare:       cellulare.trim() || null,
          email_cliente:   emailCliente.trim() || null,
          note:            note.trim() || null,
          file_urls:       fileUrls,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.success) throw new Error(json.error ?? 'Errore invio notifica');

      toast.success(`Segnalazione inviata a ${json.sent_to} (${json.destinatario_ruolo})!`);
      setInviata(true);

    } catch (e) {
      toast.error('Errore: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
    }
  };

  const handleNuova = () => {
    setRagioneSociale(''); setCellulare(''); setEmailCliente(''); setNote('');
    setVisura(null); setAltriDocs([]); setInviata(false);
  };

  // ── Successo ───────────────────────────────────────────────────────────────
  if (inviata) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-6">
        <div className="rounded-full bg-emerald-50 p-6">
          <CheckCircle2 className="w-12 h-12 text-emerald-600" />
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-2xl font-bold text-foreground">Segnalazione inviata!</h2>
          <p className="text-muted-foreground text-sm">
            La documentazione è stata caricata e il referente è stato notificato via email.
          </p>
        </div>
        <Button onClick={handleNuova} className="gap-2">
          <Plus className="w-4 h-4" /> Nuova segnalazione
        </Button>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Send className="w-6 h-6 text-orange-500" /> Nuova Segnalazione
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Carica la visura, inserisci i recapiti del cliente e invia all'agente di riferimento.
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
          <CardTitle className="text-sm font-semibold">📄 Visura Camerale <span className="text-red-500">*</span></CardTitle>
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
            <CardTitle className="text-sm font-semibold">📎 Altri Documenti <span className="text-muted-foreground font-normal">(opzionali)</span></CardTitle>
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
                  <span className="text-xs text-muted-foreground shrink-0">{doc.file.name}</span>
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
          <CardTitle className="text-sm font-semibold">📝 Note per l'Agente</CardTitle>
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

      {/* Pulsante invio */}
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
        La segnalazione verrà inviata al tuo agente di riferimento (o alla segreteria).
      </p>
    </div>
  );
}
