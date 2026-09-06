import { useCallback, useEffect, useState } from 'react';
import type { Factor } from '@supabase/supabase-js';
import {
  CheckCircle2,
  Clock3,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  Monitor,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  describeUserAgent,
  normalizeTotpCode,
  totpQrSource,
} from '@/lib/mfa';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AccessLog {
  id: string;
  ip_address: string;
  user_agent: string;
  is_new_ip: boolean;
  created_at: string;
}

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export default function AccountSecurityPanel() {
  const {
    user,
    session,
    currentAal,
    refreshMfaStatus,
  } = useAuth();
  const [factors, setFactors] = useState<Factor<'totp', 'verified'>[]>([]);
  const [accessLogs, setAccessLogs] = useState<AccessLog[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const loadSecurityData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [factorResult, logsResult] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase
        .from('user_access_logs')
        .select('id,ip_address,user_agent,is_new_ip,created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    if (factorResult.error) {
      toast.error(`Impossibile leggere la configurazione MFA: ${factorResult.error.message}`);
    } else {
      setFactors(factorResult.data.totp);
    }
    setAccessLogs((logsResult.data ?? []) as AccessLog[]);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    loadSecurityData();
  }, [loadSecurityData]);

  const startEnrollment = async () => {
    setWorking(true);
    const existing = await supabase.auth.mfa.listFactors();
    if (!existing.error) {
      for (const factor of existing.data.all.filter(item =>
        item.factor_type === 'totp' && item.status === 'unverified'
      )) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
    }

    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Credifile ${new Date().toLocaleDateString('it-IT')}`,
    });
    setWorking(false);
    if (error) {
      toast.error(`Impossibile avviare l’attivazione: ${error.message}`);
      return;
    }

    setEnrollment({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
    setCode('');
  };

  const verifyEnrollment = async () => {
    if (!enrollment || code.length !== 6) {
      toast.error('Inserisci il codice di 6 cifre generato dall’app.');
      return;
    }
    setWorking(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code,
    });
    setWorking(false);
    if (error) {
      toast.error('Codice non valido o scaduto. Attendi il nuovo codice e riprova.');
      return;
    }

    setEnrollment(null);
    setCode('');
    await refreshMfaStatus();
    await loadSecurityData();
    toast.success('Autenticazione a due fattori attivata.');
  };

  const cancelEnrollment = async () => {
    if (enrollment) {
      await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    }
    setEnrollment(null);
    setCode('');
  };

  const disableFactor = async (factor: Factor<'totp', 'verified'>) => {
    if (!window.confirm('Disattivare l’autenticazione a due fattori per questo dispositivo?')) return;
    setWorking(true);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    setWorking(false);
    if (error) {
      toast.error(`Impossibile disattivare il fattore: ${error.message}`);
      return;
    }
    await refreshMfaStatus();
    await loadSecurityData();
    toast.success('Autenticazione a due fattori disattivata.');
  };

  const copySecret = async () => {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      toast.success('Chiave copiata.');
    } catch {
      toast.error('Copia non disponibile: seleziona manualmente la chiave.');
    }
  };

  const closeOtherSessions = async () => {
    setWorking(true);
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setWorking(false);
    if (error) {
      toast.error(`Impossibile chiudere le altre sessioni: ${error.message}`);
      return;
    }
    toast.success('Tutte le altre sessioni sono state revocate.');
  };

  const closeAllSessions = async () => {
    if (!window.confirm('Uscire da Credifile su tutti i dispositivi, compreso questo?')) return;
    setWorking(true);
    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) {
      setWorking(false);
      toast.error(`Impossibile terminare le sessioni: ${error.message}`);
      return;
    }
    window.location.hash = '#/login';
    window.location.reload();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Verifica sicurezza account…
      </div>
    );
  }

  const mfaEnabled = factors.length > 0;

  return (
    <div className="space-y-5">
      <Card className={mfaEnabled ? 'border-emerald-200' : 'border-amber-200'}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                {mfaEnabled
                  ? <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  : <ShieldOff className="h-5 w-5 text-amber-600" />}
                Autenticazione a due fattori
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Protegge l’account con un codice temporaneo generato da Google Authenticator,
                Microsoft Authenticator o app compatibili.
              </p>
            </div>
            <Badge className={mfaEnabled
              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
              : 'bg-amber-100 text-amber-800 hover:bg-amber-100'}>
              {mfaEnabled ? 'Attiva' : 'Non attiva'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {factors.map(factor => (
            <div key={factor.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center gap-3">
                <Smartphone className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium">{factor.friendly_name || 'App Authenticator'}</p>
                  <p className="text-xs text-muted-foreground">
                    Attivata il {new Date(factor.created_at).toLocaleDateString('it-IT')}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={working}
                onClick={() => disableFactor(factor)}
              >
                Disattiva
              </Button>
            </div>
          ))}

          {enrollment ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <div className="grid gap-5 md:grid-cols-[180px_1fr]">
                <div className="flex items-center justify-center rounded-lg border bg-white p-3">
                  <img
                    src={totpQrSource(enrollment.qrCode)}
                    alt="QR code per configurare l’app Authenticator"
                    className="h-36 w-36"
                  />
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold">1. Scansiona il QR code</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      In alternativa inserisci manualmente questa chiave nell’app.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all rounded border bg-white px-3 py-2 text-xs">
                        {enrollment.secret}
                      </code>
                      <Button variant="outline" size="icon" onClick={copySecret} aria-label="Copia chiave MFA">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mfa-enrollment-code">2. Inserisci il codice di verifica</Label>
                    <Input
                      id="mfa-enrollment-code"
                      value={code}
                      onChange={event => setCode(normalizeTotpCode(event.target.value))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      className="max-w-48 text-center font-mono text-lg tracking-[0.35em]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={verifyEnrollment} disabled={working || code.length !== 6}>
                      {working && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Conferma e attiva
                    </Button>
                    <Button variant="ghost" onClick={cancelEnrollment} disabled={working}>
                      Annulla
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <Button onClick={startEnrollment} disabled={working} variant={mfaEnabled ? 'outline' : 'default'}>
              {working
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <KeyRound className="mr-2 h-4 w-4" />}
              {mfaEnabled ? 'Aggiungi un altro Authenticator' : 'Attiva autenticazione a due fattori'}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Monitor className="h-5 w-5 text-primary" />
            Sessioni account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sessione corrente</p>
              <p className="mt-1 text-sm font-semibold">{user?.email}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Livello: {currentAal === 'aal2' ? 'password + MFA' : 'password'}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scadenza token</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <Clock3 className="h-4 w-4 text-muted-foreground" />
                {session?.expires_at
                  ? new Date(session.expires_at * 1000).toLocaleString('it-IT')
                  : 'Non disponibile'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={closeOtherSessions} disabled={working}>
              Chiudi le altre sessioni
            </Button>
            <Button variant="destructive" onClick={closeAllSessions} disabled={working}>
              <LogOut className="mr-2 h-4 w-4" />
              Esci da tutti i dispositivi
            </Button>
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            I token di accesso già emessi possono restare validi fino alla loro scadenza; vengono revocati i token di rinnovo.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Accessi recenti
          </CardTitle>
        </CardHeader>
        <CardContent>
          {accessLogs.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">Nessun accesso registrato.</p>
          ) : (
            <div className="space-y-2">
              {accessLogs.map(log => (
                <div
                  key={log.id}
                  className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${
                    log.is_new_ip ? 'border-amber-200 bg-amber-50/60' : 'bg-muted/20'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold">{log.ip_address}</span>
                      {log.is_new_ip && (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">IP nuovo</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {describeUserAgent(log.user_agent || '')}
                    </p>
                  </div>
                  <time className="shrink-0 text-right text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString('it-IT', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </time>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
