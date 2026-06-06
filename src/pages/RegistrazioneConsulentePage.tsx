import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { UserCheck, Eye, EyeOff } from 'lucide-react';

export default function RegistrazioneConsulentePage() {
  const [step, setStep]         = useState<'form' | 'done'>('form');
  const [nome, setNome]         = useState('');
  const [email, setEmail]       = useState('');
  const [pwd, setPwd]           = useState('');
  const [pwd2, setPwd2]         = useState('');
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim() || !email.trim() || !pwd) return;
    if (pwd !== pwd2) { toast.error('Le password non coincidono'); return; }
    if (pwd.length < 8) { toast.error('Password minimo 8 caratteri'); return; }

    setLoading(true);
    try {
      // Registra tramite edge function (service role, nessuna conferma email)
      const { data, error } = await supabase.functions.invoke('registra-consulente', {
        body: { email: email.trim().toLowerCase(), password: pwd, nome: nome.trim() }
      });
      if (error || !data?.success) {
        toast.error(data?.error ?? error?.message ?? 'Errore registrazione');
        return;
      }
      // Auto-login immediato
      const { error: loginErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(), password: pwd
      });
      if (loginErr) {
        // login fallito ma account creato: mostra schermata di successo con link
        setStep('done');
      } else {
        // login ok: redirect al portale consulente
        window.location.hash = '/consulente';
      }
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <UserCheck className="w-8 h-8 text-teal-700" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Registrazione completata!</h2>
        <p className="text-slate-500 text-sm">
          Controlla la tua casella email per confermare l'indirizzo, poi accedi dal link sottostante.
        </p>
        <a href="#/login" className="mt-6 inline-block bg-teal-600 text-white font-semibold px-6 py-3 rounded-lg hover:bg-teal-700 transition-colors">
          Vai al login
        </a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <div className="mb-6 text-center">
          <div className="w-14 h-14 bg-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <UserCheck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">Registrati come Consulente</h1>
          <p className="text-sm text-slate-500 mt-1">Credifile — Portale Consulenti/Commercialisti</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Nome e Cognome / Studio</label>
            <input required className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 ring-teal-400 outline-none"
              placeholder="Es. Mario Rossi" value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
            <input required type="email" className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 ring-teal-400 outline-none"
              placeholder="mario.rossi@studio.it" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Password (min. 8 caratteri)</label>
            <div className="relative">
              <input required type={showPwd ? 'text' : 'password'} minLength={8}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 ring-teal-400 outline-none pr-10"
                value={pwd} onChange={e => setPwd(e.target.value)} />
              <button type="button" className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                onClick={() => setShowPwd(s => !s)}>
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Conferma password</label>
            <input required type={showPwd ? 'text' : 'password'} minLength={8}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 ring-teal-400 outline-none"
              value={pwd2} onChange={e => setPwd2(e.target.value)} />
          </div>
          <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={loading}>
            {loading ? 'Registrazione...' : 'Crea account Consulente'}
          </Button>
        </form>
        <p className="text-xs text-slate-400 text-center mt-4">
          Hai già un account? <a href="#/login" className="text-teal-600 hover:underline">Accedi</a>
        </p>
      </div>
    </div>
  );
}
