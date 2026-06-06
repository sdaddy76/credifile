import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Clock, ShieldCheck } from 'lucide-react';

const CONSENT_TEXT = `Autorizzo il trattamento dei miei dati personali della Centrale dei Rischi della Banca d'Italia (esposizioni creditizie, affidamenti, utilizzi e relativi andamentali), ai soli fini dell'elaborazione di un'analisi di bancabilità da parte del consulente indicato. Il trattamento avverrà in conformità al Regolamento UE 2016/679 (GDPR). Il consenso è revocabile in qualsiasi momento.`;

interface Consent {
  id: string; token: string; status: string;
  client_name: string; consulente_nome: string;
  expires_at: string; accepted_at: string | null;
}

export default function ConsensoCrePage() {
  const { token } = useParams<{ token: string }>();
  const [consent,  setConsent]  = useState<Consent | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [acting,   setActing]   = useState(false);
  const [done,     setDone]     = useState<'accepted' | 'declined' | null>(null);
  const [error,    setError]    = useState('');

  useEffect(() => {
    if (!token) { setError('Link non valido'); setLoading(false); return; }
    supabase.functions.invoke('gestisci-consenso-cr', { body: { action: 'get', token } })
      .then(({ data }) => {
        if (data?.success) setConsent(data.consent);
        else setError(data?.error ?? 'Consenso non trovato o scaduto');
      })
      .finally(() => setLoading(false));
  }, [token]);

  const act = async (action: 'accept' | 'decline') => {
    setActing(true);
    const { data } = await supabase.functions.invoke('gestisci-consenso-cr', {
      body: { action, token }
    });
    setActing(false);
    if (data?.success) setDone(action === 'accept' ? 'accepted' : 'declined');
    else setError(data?.error ?? 'Errore durante l\'operazione');
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <XCircle className="w-14 h-14 text-red-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-700 mb-2">Link non valido</h2>
        <p className="text-sm text-slate-500">{error}</p>
      </div>
    </div>
  );

  if (done === 'accepted') return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-700 mb-2">Autorizzazione confermata</h2>
        <p className="text-sm text-slate-500">Il consulente <strong>{consent?.consulente_nome}</strong> è ora autorizzato a trattare i Suoi dati della Centrale dei Rischi ai fini dell'analisi di bancabilità.</p>
        <p className="text-xs text-slate-400 mt-4">Data: {new Date().toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' })}</p>
      </div>
    </div>
  );

  if (done === 'declined') return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <XCircle className="w-14 h-14 text-slate-400 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-700 mb-2">Autorizzazione rifiutata</h2>
        <p className="text-sm text-slate-500">Ha rifiutato il trattamento dei dati della Centrale dei Rischi. Il consulente verrà notificato.</p>
      </div>
    </div>
  );

  if (consent?.status === 'accepted') return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
        <CheckCircle className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-slate-700 mb-2">Autorizzazione già confermata</h2>
        <p className="text-sm text-slate-500">Il {new Date(consent.accepted_at!).toLocaleDateString('it-IT')} ha già autorizzato il trattamento.</p>
      </div>
    </div>
  );

  const expired = consent && new Date(consent.expires_at) < new Date();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-lg font-bold text-slate-800">Richiesta di Autorizzazione</h1>
          <p className="text-sm text-slate-500 mt-1">Centrale dei Rischi — Banca d'Italia</p>
        </div>

        <div className="bg-teal-50 rounded-xl p-4 mb-5 text-sm space-y-1">
          <p><span className="font-semibold text-slate-700">Richiedente:</span> {consent?.consulente_nome}</p>
          <p><span className="font-semibold text-slate-700">Intestatario dati:</span> {consent?.client_name}</p>
          {expired && (
            <div className="flex items-center gap-1.5 text-amber-600 mt-2 text-xs">
              <Clock className="w-3.5 h-3.5" /> Richiesta scaduta il {new Date(consent!.expires_at).toLocaleDateString('it-IT')}
            </div>
          )}
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 text-xs text-slate-600 leading-relaxed">
          <p className="font-semibold text-slate-700 mb-2">📋 Testo del consenso:</p>
          {CONSENT_TEXT}
        </div>

        {!expired ? (
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => act('decline')} disabled={acting}>
              <XCircle className="w-4 h-4 mr-1.5" /> Rifiuto
            </Button>
            <Button className="flex-1 bg-teal-600 hover:bg-teal-700"
              onClick={() => act('accept')} disabled={acting}>
              <CheckCircle className="w-4 h-4 mr-1.5" />
              {acting ? 'Conferma...' : 'Autorizzo'}
            </Button>
          </div>
        ) : (
          <p className="text-center text-sm text-amber-600">Questa richiesta è scaduta. Contatti il consulente per una nuova richiesta.</p>
        )}

        <p className="text-xs text-slate-400 text-center mt-4">
          Powered by Credifile · In conformità al GDPR (Reg. UE 2016/679)
        </p>
      </div>
    </div>
  );
}
