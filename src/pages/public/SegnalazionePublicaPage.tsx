// @section: segnalazione-pubblica
// Pagina pubblica accessibile senza login.
// Chiunque può inviare una segnalazione aziendale al team Credifile.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Send, CheckCircle2, AlertCircle, Building2, User, Phone, Mail, FileText } from 'lucide-react';

export default function SegnalazionePublicaPage() {
  const [ragioneSociale, setRagioneSociale] = useState('');
  const [nomeReferente, setNomeReferente]   = useState('');
  const [emailReferente, setEmailReferente] = useState('');
  const [telefono, setTelefono]             = useState('');
  const [note, setNote]                     = useState('');

  const [sending, setSending] = useState(false);
  const [inviata, setInviata] = useState(false);
  const [errore,  setErrore]  = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ragioneSociale.trim()) { setErrore('Inserisci la ragione sociale.'); return; }
    setErrore('');
    setSending(true);
    try {
      const r = await fetch('/api/segnalazione-pubblica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ragione_sociale: ragioneSociale.trim(),
          nome_referente:  nomeReferente.trim()  || null,
          email_referente: emailReferente.trim() || null,
          telefono:        telefono.trim()       || null,
          note:            note.trim()           || null,
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

  // ── Conferma invio ─────────────────────────────────────────────────────────
  if (inviata) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Segnalazione Inviata!</h2>
          <p className="text-gray-500 text-sm">
            Grazie per la tua segnalazione. Il nostro team la esaminerà e ti contatterà
            al più presto per valutare le migliori soluzioni finanziarie disponibili.
          </p>
          <Button
            variant="outline"
            onClick={() => { setInviata(false); setRagioneSociale(''); setNomeReferente(''); setEmailReferente(''); setTelefono(''); setNote(''); }}
            className="mt-2"
          >
            Invia un'altra segnalazione
          </Button>
        </div>
      </div>
    );
  }

  // ── Form ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-6">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Segnala un'Azienda</h1>
              <p className="text-orange-100 text-xs mt-0.5">
                Il nostro team valuterà le soluzioni di finanziamento disponibili
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">

          {/* Ragione Sociale */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <Building2 className="w-3.5 h-3.5 text-orange-500" />
              Ragione Sociale <span className="text-red-500">*</span>
            </Label>
            <Input
              placeholder="Es. Acme S.r.l."
              value={ragioneSociale}
              onChange={e => setRagioneSociale(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Nome Referente */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <User className="w-3.5 h-3.5 text-orange-500" />
              Il Tuo Nome
            </Label>
            <Input
              placeholder="Mario Rossi"
              value={nomeReferente}
              onChange={e => setNomeReferente(e.target.value)}
              className="text-sm"
            />
          </div>

          {/* Contatti */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Phone className="w-3.5 h-3.5 text-orange-500" />
                Telefono
              </Label>
              <Input
                placeholder="+39 333 000 0000"
                value={telefono}
                onChange={e => setTelefono(e.target.value)}
                type="tel"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Mail className="w-3.5 h-3.5 text-orange-500" />
                Email
              </Label>
              <Input
                placeholder="nome@email.com"
                value={emailReferente}
                onChange={e => setEmailReferente(e.target.value)}
                type="email"
                className="text-sm"
              />
            </div>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <FileText className="w-3.5 h-3.5 text-orange-500" />
              Note aggiuntive
            </Label>
            <Textarea
              placeholder="Descrivi brevemente la situazione aziendale o le esigenze finanziarie..."
              value={note}
              onChange={e => setNote(e.target.value)}
              rows={3}
              className="text-sm resize-none"
            />
          </div>

          {/* Errore */}
          {errore && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {errore}
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            disabled={sending}
            className="w-full gap-2 bg-orange-500 hover:bg-orange-600 text-white"
          >
            {sending
              ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Invio in corso…</>
              : <><Send className="w-4 h-4" /> Invia Segnalazione</>
            }
          </Button>

          <p className="text-center text-xs text-gray-400 pt-1">
            I tuoi dati sono trattati in conformità con il GDPR.
            Non saranno condivisi con terze parti.
          </p>
        </form>
      </div>
    </div>
  );
}
