import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function ClientAccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [codice, setCodice] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  // Pre-fill practice ID from URL if present
  const practiceIdFromUrl = searchParams.get('p');

  const handleAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codice.trim() || !email.trim()) { toast.error('Inserisci codice e email'); return; }
    setLoading(true);

    const { data: accessRecord, error } = await supabase
      .from('practice_access_codes')
      .select('*, practices(id, numero_pratica, status)')
      .eq('codice', codice.trim().toUpperCase())
      .eq('email_cliente', email.trim().toLowerCase())
      .maybeSingle();

    if (error || !accessRecord) {
      toast.error('Codice o email non validi. Controlla i dati e riprova.');
      setLoading(false);
      return;
    }

    // Controlla scadenza
    if (accessRecord.scadenza && new Date(accessRecord.scadenza) < new Date()) {
      toast.error('Il codice di accesso è scaduto. Contatta il tuo agente per un nuovo link.');
      setLoading(false);
      return;
    }

    // Aggiorna last_access
    await supabase.from('practice_access_codes')
      .update({ last_access: new Date().toISOString() })
      .eq('id', accessRecord.id);

    toast.success('Accesso effettuato');
    setLoading(false);

    // Salva sessione in sessionStorage
    sessionStorage.setItem('docflow_client', JSON.stringify({
      practiceId: accessRecord.practice_id,
      codice: accessRecord.codice,
      email: accessRecord.email_cliente,
    }));

    navigate(`/portale/${accessRecord.practice_id}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4 shadow-lg">
            <FileText className="w-7 h-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Portale Documenti</h1>
          <p className="text-muted-foreground text-sm mt-1 text-center">
            Accedi alla tua pratica per caricare i documenti richiesti
          </p>
        </div>

        <Card className="border-border shadow-md">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Accedi alla tua Pratica</CardTitle>
            <CardDescription>
              Inserisci il codice e l'email forniti dal tuo agente finanziario
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAccess} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="codice">Codice Accesso</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="codice"
                    placeholder="Es. AB1C2D"
                    className="pl-9 font-mono uppercase tracking-widest"
                    value={codice}
                    onChange={e => setCodice(e.target.value.toUpperCase())}
                    maxLength={10}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="la-tua@email.it"
                    className="pl-9"
                    value={email}
                    onChange={e => setEmail(e.target.value.toLowerCase())}
                    required
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Verifica in corso...
                  </span>
                ) : 'Accedi alla Pratica'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Security note */}
        <div className="flex items-start gap-2 mt-4 px-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            La tua connessione è sicura e i tuoi documenti sono protetti. Hai ricevuto il codice dal tuo agente finanziario via email.
          </p>
        </div>
      </div>
    </div>
  );
}
