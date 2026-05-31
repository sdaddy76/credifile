import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FileText, Lock, Mail, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [waitingForAuth, setWaitingForAuth] = useState(false);

  // Recupera password
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [sendingRecovery, setSendingRecovery] = useState(false);

  // Se già loggato (es. refresh con sessione attiva) → redirect diretto
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/admin/dashboard', { replace: true });
    }
  }, [authLoading, user]);

  // Naviga SOLO quando onAuthStateChange ha aggiornato user
  // Evita la race condition su mobile (navigate() prima che user sia nel state)
  useEffect(() => {
    if (waitingForAuth && user) {
      navigate('/admin/dashboard', { replace: true });
      supabase.functions.invoke('log-access').catch(() => {/* silent */});
    }
  }, [waitingForAuth, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      toast.error('Credenziali non valide. Riprova.');
    } else {
      toast.success('Accesso effettuato');
      if (remember) localStorage.setItem('credifile_remember', email);
      else localStorage.removeItem('credifile_remember');
      // Non navigare subito: aspetta che onAuthStateChange aggiorni user
      // Risolve la race condition su mobile (Safari/Android)
      setWaitingForAuth(true);
    }
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recoveryEmail.trim()) { toast.error('Inserisci la tua email'); return; }
    setSendingRecovery(true);
    const { data, error } = await supabase.functions.invoke('reset-password', {
      body: { email: recoveryEmail.trim().toLowerCase() },
    });
    setSendingRecovery(false);
    if (error || !data?.success) {
      toast.error('Errore invio email: ' + (error?.message ?? data?.error ?? 'Errore sconosciuto'));
    } else {
      toast.success('Email di recupero inviata! Controlla la tua casella.');
      setShowRecovery(false);
    }
  };

  // Schermata recupero password
  if (showRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4 shadow-lg">
              <FileText className="w-7 h-7 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Credifile</h1>
            <p className="text-muted-foreground text-sm mt-1">Recupero Password</p>
          </div>
          <Card className="border-border shadow-md">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Recupera Password</CardTitle>
              <CardDescription>Inserisci la tua email e ti invieremo un link per reimpostare la password</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleRecovery} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="recovery-email">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="recovery-email"
                      type="email"
                      placeholder="la-tua@email.it"
                      className="pl-9"
                      value={recoveryEmail}
                      onChange={e => setRecoveryEmail(e.target.value)}
                      required
                      autoComplete="email"
                    />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={sendingRecovery}>
                  {sendingRecovery ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      Invio in corso...
                    </span>
                  ) : 'Invia Email di Recupero'}
                </Button>
                <Button type="button" variant="ghost" className="w-full gap-2" onClick={() => setShowRecovery(false)}>
                  <ArrowLeft className="w-4 h-4" /> Torna al Login
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4 shadow-lg">
            <FileText className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Credifile</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestione Pratiche Finanziarie</p>
        </div>

        <Card className="border-border shadow-md">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Accesso</CardTitle>
            <CardDescription>Inserisci le tue credenziali per accedere al pannello</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="agente@esempio.it"
                    className="pl-9"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => { setRecoveryEmail(email); setShowRecovery(true); }}
                  >
                    Recupera password
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    className="pl-9"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={v => setRemember(v === true)}
                />
                <Label htmlFor="remember" className="text-sm font-normal cursor-pointer">
                  Ricorda login
                </Label>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Accesso in corso...
                  </span>
                ) : 'Accedi'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Area riservata agli agenti autorizzati
        </p>
      </div>
    </div>
  );
}
