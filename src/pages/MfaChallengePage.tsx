import { useEffect, useState } from 'react';
import { KeyRound, Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { authenticatedHome, normalizeTotpCode } from '@/lib/mfa';

export default function MfaChallengePage() {
  const navigate = useNavigate();
  const {
    user,
    role,
    loading,
    mfaLoading,
    mfaRequired,
    refreshMfaStatus,
    signOut,
  } = useAuth();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [working, setWorking] = useState(false);
  const [factorError, setFactorError] = useState('');

  useEffect(() => {
    if (!user || mfaLoading || !mfaRequired) return;
    supabase.auth.mfa.listFactors().then(({ data, error }) => {
      if (error || data.totp.length === 0) {
        setFactorError('Nessun dispositivo Authenticator verificato è disponibile per questo account.');
        return;
      }
      setFactorId(data.totp[0].id);
    });
  }, [user, mfaLoading, mfaRequired]);

  if (loading || mfaLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 bg-muted/30 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Verifica autenticazione…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!mfaRequired) return <Navigate to={authenticatedHome(role)} replace />;

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!factorId || code.length !== 6) {
      toast.error('Inserisci il codice di 6 cifre.');
      return;
    }
    setWorking(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setWorking(false);
      toast.error('Codice non valido o scaduto. Attendi il nuovo codice e riprova.');
      return;
    }
    await refreshMfaStatus();
    await supabase.functions.invoke('log-access').catch(() => undefined);
    toast.success('Identità verificata.');
    navigate(authenticatedHome(role), { replace: true });
  };

  const cancel = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Verifica in due passaggi</CardTitle>
          <CardDescription>
            Inserisci il codice temporaneo mostrato dalla tua app Authenticator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {factorError ? (
            <div className="space-y-4">
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {factorError}
              </p>
              <Button variant="outline" className="w-full" onClick={cancel}>
                <LogOut className="mr-2 h-4 w-4" />
                Torna al login
              </Button>
            </div>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mfa-login-code">Codice di sicurezza</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="mfa-login-code"
                    value={code}
                    onChange={event => setCode(normalizeTotpCode(event.target.value))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="000000"
                    className="pl-10 text-center font-mono text-lg tracking-[0.35em]"
                  />
                </div>
              </div>
              <Button className="w-full" type="submit" disabled={working || !factorId || code.length !== 6}>
                {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Verifica e accedi
              </Button>
              <Button className="w-full" type="button" variant="ghost" onClick={cancel} disabled={working}>
                Annulla accesso
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
