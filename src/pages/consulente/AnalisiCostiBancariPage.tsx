import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BarChart3, FileSearch, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { AnalisiCostiBancari } from '@/components/AnalisiCostiBancari';

interface PracticeOption {
  id: string;
  numero_pratica: string;
  status: string;
  clients?: { ragione_sociale?: string | null; email?: string | null } | null;
}

export default function AnalisiCostiBancariPage() {
  const navigate = useNavigate();
  const { user, profileNome } = useAuth();
  const [practices, setPractices] = useState<PracticeOption[]>([]);
  const [selectedPracticeId, setSelectedPracticeId] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data: ownedClients } = await supabase
      .from('consulente_clients')
      .select('email')
      .eq('consulente_id', user.id);
    const emails = Array.from(new Set(
      (ownedClients ?? [])
        .map(row => String(row.email ?? '').trim().toLowerCase())
        .filter(Boolean),
    ));

    if (emails.length === 0) {
      setPractices([]);
      setSelectedPracticeId('');
      setLoading(false);
      return;
    }

    const { data: clients } = await supabase
      .from('clients')
      .select('id,email')
      .in('email', emails);
    const clientIds = (clients ?? []).map(client => client.id);
    if (clientIds.length === 0) {
      setPractices([]);
      setSelectedPracticeId('');
      setLoading(false);
      return;
    }

    const { data: practiceRows } = await supabase
      .from('practices')
      .select('id,numero_pratica,status,clients(ragione_sociale,email)')
      .in('client_id', clientIds)
      .order('created_at', { ascending: false });
    const next = (practiceRows ?? []) as PracticeOption[];
    setPractices(next);
    setSelectedPracticeId(current => next.some(practice => practice.id === current) ? current : next[0]?.id ?? '');
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id]);

  const selectedPractice = practices.find(practice => practice.id === selectedPracticeId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50/40 to-slate-50">
      <header className="border-b bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => navigate('/consulente')}>
            <ArrowLeft className="h-4 w-4" /> Portale consulente
          </Button>
          <div className="h-5 w-px bg-slate-200" />
          <div>
            <p className="text-sm font-semibold text-slate-800">Analisi costi bancari</p>
            <p className="text-[11px] text-slate-500">{profileNome || user?.email}</p>
          </div>
          <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Aggiorna
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <Card className="border-teal-200 bg-teal-50/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <BarChart3 className="h-5 w-5" /> Seleziona una pratica
            </CardTitle>
            <p className="text-xs text-teal-800/80">
              Sono mostrate le pratiche collegate ai clienti del tuo portale tramite l’e-mail registrata.
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" /> Caricamento pratiche…</div>
            ) : practices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-teal-200 bg-white p-6 text-center">
                <FileSearch className="mx-auto h-8 w-8 text-teal-300" />
                <p className="mt-2 text-sm font-medium text-slate-700">Nessuna pratica collegata</p>
                <p className="mt-1 text-xs text-slate-500">Verifica che l’e-mail del cliente nel portale consulente coincida con quella della pratica.</p>
              </div>
            ) : (
              <select
                value={selectedPracticeId}
                onChange={event => setSelectedPracticeId(event.target.value)}
                className="h-10 w-full rounded-md border border-teal-200 bg-white px-3 text-sm text-slate-800"
              >
                {practices.map(practice => (
                  <option key={practice.id} value={practice.id}>
                    {practice.clients?.ragione_sociale ?? 'Cliente'} · {practice.numero_pratica} · {practice.status}
                  </option>
                ))}
              </select>
            )}
          </CardContent>
        </Card>

        {selectedPractice && <AnalisiCostiBancari practiceId={selectedPractice.id} />}
      </main>
    </div>
  );
}
