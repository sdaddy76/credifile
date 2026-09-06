import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldAlert, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function RegistrazioneSegnalPage() {
  const navigate = useNavigate();

  // Supporta sia il nuovo URL pulito sia i vecchi inviti con route hash.
  const token = new URLSearchParams(window.location.search).get('token')
    ?? new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('token')
    ?? '';

  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState<'ok' | 'used' | 'expired' | 'invalid' | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');

  const [nome,    setNome]    = useState('');
  const [pwd,     setPwd]     = useState('');
  const [pwd2,    setPwd2]    = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [done,    setDone]    = useState(false);

  // Valida il token leggendo l'invito
  useEffect(() => {
    if (!token) { setTokenValid('invalid'); setValidating(false); return; }
    supabase
      .from('segnalatore_invites')
      .select('email, used, expires_at')
      .eq('token', token)
      .maybeSingle()
      .then(({ data }) => {
        if (!data)                          { setTokenValid('invalid'); }
        else if (data.used)                 { setTokenValid('used'); }
        else if (new Date(data.expires_at) < new Date()) { setTokenValid('expired'); }
        else                                { setTokenValid('ok'); setInviteEmail(data.email); }
        setValidating(false);
      });
  }, [token]);

  const handleSubmit = async () => {
    if (!nome.trim()) { toast.error('Inserisci il tuo nome'); return; }
    if (pwd.length < 6) { toast.error('Password minimo 6 caratteri'); return; }
    if (pwd !== pwd2)  { toast.error('Le password non coincidono'); return; }
    setSaving(true);

    const { data, error } = await supabase.functions.invoke('register-segnalatore', {
      body: { token, nome: nome.trim(), password: pwd },
    });

    setSaving(false);
    if (error || !data?.success) {
      toast.error(data?.error ?? error?.message ?? 'Errore nella registrazione');
      return;
    }
    setDone(true);
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Verifica del link in corso…</p>
        </div>
      </div>
    );
  }

  if (tokenValid === 'used') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6 space-y-3">
            <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
            <h2 className="text-lg font-semibold">Link già utilizzato</h2>
            <p className="text-sm text-muted-foreground">Questo link di invito è già stato usato per creare un account.</p>
            <Button className="w-full mt-2" onClick={() => navigate('/login')}>Vai al Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tokenValid === 'expired') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6 space-y-3">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
            <h2 className="text-lg font-semibold">Link scaduto</h2>
            <p className="text-sm text-muted-foreground">Il link di invito era valido per 7 giorni ed è scaduto. Chiedi all'agente di inviarti un nuovo invito.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (tokenValid === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6 space-y-3">
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
            <h2 className="text-lg font-semibold">Link non valido</h2>
            <p className="text-sm text-muted-foreground">Il link non è valido o è stato rimosso.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-8 pb-6 space-y-3">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <h2 className="text-lg font-semibold">Registrazione completata!</h2>
            <p className="text-sm text-muted-foreground">
              Il tuo account è pronto. Accedi con <strong>{inviteEmail}</strong> e la password che hai scelto.
            </p>
            <Button className="w-full mt-2" onClick={() => navigate('/login')}>Vai al Login</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Credifile</h1>
          <p className="text-muted-foreground text-sm">Completa la registrazione come Segnalatore</p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Il tuo account</CardTitle>
            <p className="text-xs text-muted-foreground">Email: <strong>{inviteEmail}</strong></p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome e Cognome *</Label>
              <Input placeholder="Mario Rossi" value={nome} onChange={e => setNome(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Password *</Label>
              <div className="relative">
                <Input
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Minimo 6 caratteri"
                  value={pwd}
                  onChange={e => setPwd(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPwd(v => !v)}
                >
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Conferma Password *</Label>
              <Input
                type="password"
                placeholder="Ripeti la password"
                value={pwd2}
                onChange={e => setPwd2(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              />
              {pwd2 && pwd !== pwd2 && (
                <p className="text-xs text-destructive">Le password non coincidono</p>
              )}
            </div>

            <Button className="w-full mt-1" onClick={handleSubmit} disabled={saving}>
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Registrazione…</> : 'Crea Account'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
