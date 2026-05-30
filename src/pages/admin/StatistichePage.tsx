import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BarChart3, FolderOpen, Users, CheckCircle, Clock, XCircle, AlertCircle, TrendingUp } from 'lucide-react';
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/types';

interface AgentStats {
  agentId: string;
  agentEmail: string;
  agentNome: string;
  totale: number;
  byStatus: Record<string, number>;
}

export default function StatistichePage() {
  const { user, isSuperAdmin, isSegreteria } = useAuth();
  const [loading, setLoading] = useState(true);
  const [totalePratiche, setTotalePratiche] = useState(0);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [totaleClienti, setTotaleClienti] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    loadStats();
  }, [user?.id]);

  const loadStats = async () => {
    setLoading(true);

    // Recupera ID agenti assegnati (per segreteria)
    let agentIds: string[] = [];
    if (isSegreteria) {
      const { data: assignments } = await supabase
        .from('segreteria_agent_assignments')
        .select('agent_user_id')
        .eq('segreteria_user_id', user!.id);
      agentIds = (assignments ?? []).map((a: { agent_user_id: string }) => a.agent_user_id);
    }

    // Query pratiche
    let practicesQuery = supabase.from('practices').select('id, status, created_by');
    if (isSegreteria && agentIds.length > 0) {
      practicesQuery = practicesQuery.in('created_by', agentIds);
    } else if (!isSuperAdmin) {
      practicesQuery = practicesQuery.eq('created_by', user!.id);
    }
    const { data: practices } = await practicesQuery;
    const pList = practices ?? [];

    // Totale e per stato
    setTotalePratiche(pList.length);
    const statusCount: Record<string, number> = {};
    pList.forEach((p: { status: string }) => {
      statusCount[p.status] = (statusCount[p.status] ?? 0) + 1;
    });
    setByStatus(statusCount);

    // Clienti
    if (isSegreteria && agentIds.length > 0) {
      const { count } = await supabase.from('clients').select('id', { count: 'exact', head: true })
        .in('created_by', agentIds);
      setTotaleClienti(count ?? 0);
    } else if (isSuperAdmin) {
      const { count } = await supabase.from('clients').select('id', { count: 'exact', head: true });
      setTotaleClienti(count ?? 0);
    }

    // Stats per agente (solo segreteria/superadmin)
    if ((isSegreteria || isSuperAdmin) && agentIds.length > 0) {
      const { data: profiles } = await supabase
        .from('admin_profiles')
        .select('id, email, nome')
        .in('id', agentIds);

      const stats: AgentStats[] = (profiles ?? []).map((p: { id: string; email: string; nome: string }) => {
        const agentPractices = pList.filter((pr: { created_by: string }) => pr.created_by === p.id);
        const bs: Record<string, number> = {};
        agentPractices.forEach((pr: { status: string }) => { bs[pr.status] = (bs[pr.status] ?? 0) + 1; });
        return { agentId: p.id, agentEmail: p.email, agentNome: p.nome ?? p.email, totale: agentPractices.length, byStatus: bs };
      });
      setAgentStats(stats.sort((a, b) => b.totale - a.totale));
    }

    setLoading(false);
  };

  const completate = (byStatus['completata'] ?? 0) + (byStatus['approvata'] ?? 0);
  const inCorso = (byStatus['raccolta_documenti'] ?? 0) + (byStatus['inviata_banca'] ?? 0) + (byStatus['integrazioni_richieste'] ?? 0);
  const bozze = byStatus['bozza'] ?? 0;
  const rifiutate = byStatus['rifiutata'] ?? 0;

  if (loading) return (
    <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="w-6 h-6 text-primary" />Statistiche</h1>
        <p className="text-muted-foreground text-sm mt-1">Panoramica pratiche e attività</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center"><FolderOpen className="w-4 h-4 text-blue-600" /></div>
              <div><p className="text-2xl font-bold">{totalePratiche}</p><p className="text-xs text-muted-foreground">Pratiche Totali</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center"><CheckCircle className="w-4 h-4 text-green-600" /></div>
              <div><p className="text-2xl font-bold">{completate}</p><p className="text-xs text-muted-foreground">Completate</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center"><Clock className="w-4 h-4 text-amber-600" /></div>
              <div><p className="text-2xl font-bold">{inCorso}</p><p className="text-xs text-muted-foreground">In Corso</p></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center"><Users className="w-4 h-4 text-purple-600" /></div>
              <div><p className="text-2xl font-bold">{totaleClienti}</p><p className="text-xs text-muted-foreground">Clienti</p></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Distribuzione per stato */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" />Distribuzione per Stato</CardTitle></CardHeader>
        <CardContent>
          {Object.keys(byStatus).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna pratica</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                <div key={status} className="flex items-center gap-3">
                  <Badge className={`${STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? 'bg-gray-100 text-gray-700'} text-xs w-40 justify-center`}>
                    {STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}
                  </Badge>
                  <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${totalePratiche > 0 ? (count / totalePratiche) * 100 : 0}%` }} />
                  </div>
                  <span className="text-sm font-semibold w-6 text-right">{count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats per agente */}
      {agentStats.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Users className="w-4 h-4 text-primary" />Pratiche per Agente</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {agentStats.map(agent => (
                <div key={agent.agentId} className="border border-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-medium text-sm">{agent.agentNome}</p>
                      <p className="text-xs text-muted-foreground">{agent.agentEmail}</p>
                    </div>
                    <span className="text-lg font-bold text-primary">{agent.totale}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(agent.byStatus).map(([status, count]) => (
                      <Badge key={status} className={`${STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? 'bg-gray-100 text-gray-700'} text-xs`}>
                        {STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Avviso se no agenti */}
      {isSegreteria && agentStats.length === 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-5 pb-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-700">Nessun agente assegnato. Vai in <strong>Miei Agenti</strong> per aggiungerne.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
