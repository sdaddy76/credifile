import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Lock, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

type Mode = 'invite' | 'recovery' | 'loading' | 'error';

export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [userName, setUserName] = useState('');

  useEffect(() => {
    const init = async () => {
      // Leggi parametri salvati da main.tsx
      const stored = sessionStorage.getItem('sb_callback');
      if (!stored) {
        // Controlla se c'è già una sessione attiva (utente già loggato che vuole cambiare password)
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setMode('recovery');
          setUserName(session.user.email ?? '');
        } else {
          setMode('error');
        }
        return;
      }

      const params = new URLSearchParams(stored);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const type = params.get('type');
      sessionStorage.removeItem('sb_callback');

      if (!accessToken || !refreshToken) { setMode('error'); return; }

      // Imposta la sessione con i token ricevuti
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error || !data.session) { setMode('error'); return; }

      setUserName(data.session.user.email ?? '');
      setMode(type === 'recovery' ? 'recovery' : 'invite');
    };

    init();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error('La password deve essere di almeno 8 caratteri'); return; }
    if (password !== confirm) { toast.error('Le password non coincidono'); return; }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);

    if (error) {
      toast.error('Errore: ' + error.message);
      return;
    }

    setDone(true);
    toast.success('Password impostata con successo!');
    setTimeout(() => navigate('/admin/dashboard'), 2000);
  };

  // ── Schermata caricamento ──
  if (mode === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Verifica in corso...</p>
        </div>
      </div>
    );
  }

  // ── Errore token non valido ──
  if (mode === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold">Link non valido o scaduto</h2>
          <p className="text-muted-foreground text-sm">Il link di attivazione è scaduto (validità 24 ore) o non è valido.<br/>Contatta il tuo supervisore per ricevere un nuovo invito.</p>
          <Button onClick={() => navigate('/login')}>Vai al Login</Button>
        </div>
      </div>
    );
  }

  // ── Password impostata con successo ──
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <div className="w-full max-w-md text-center space-y-4">
          <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
          <h2 className="text-xl font-bold">Password impostata!</h2>
          <p className="text-muted-foreground text-sm">Accesso in corso al pannello...</p>
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    );
  }

  // ── Form imposta password ──
  const isInvite = mode === 'invite';
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4 shadow-lg">
            <FileText className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Credifile</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isInvite ? 'Completa la registrazione' : 'Reimposta la password'}
          </p>
        </div>

        <Card className="border-border shadow-md">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">
              {isInvite ? '👋 Benvenuto su Credifile!' : '🔒 Nuova Password'}
            </CardTitle>
            <CardDescription>
              {isInvite
                ? `Ciao! Imposta la tua password per completare la registrazione${userName ? ` (${userName})` : ''}.`
                : `Inserisci la nuova password per il tuo account${userName ? ` (${userName})` : ''}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">
                  {isInvite ? 'Scegli una password' : 'Nuova password'}
                </Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="Minimo 8 caratteri"
                    className="pl-9 pr-10"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoFocus
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPwd(v => !v)}>
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm">Conferma password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="confirm"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="Ripeti la password"
                    className="pl-9 pr-10"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowConfirm(v => !v)}>
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirm && password !== confirm && (
                  <p className="text-xs text-destructive">Le password non coincidono</p>
                )}
                {confirm && password === confirm && confirm.length >= 8 && (
                  <p className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Password corrispondente</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={saving || password.length < 8 || password !== confirm}>
                {saving ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Salvataggio...
                  </span>
                ) : isInvite ? 'Completa Registrazione' : 'Salva Nuova Password'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {isInvite && (
          <p className="text-center text-xs text-muted-foreground mt-6">
            Dopo la registrazione potrai accedere sempre da{' '}
            <a href="https://credifile-eosin.vercel.app" className="text-primary hover:underline">credifile-eosin.vercel.app</a>
          </p>
        )}
      </div>
    </div>
  );
}
