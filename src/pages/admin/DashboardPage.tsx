import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FolderOpen, Users, Building2, Clock, CheckCircle2, AlertCircle, TrendingUp, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { STATUS_LABELS, STATUS_COLORS, type Practice } from '@/lib/types';

interface Stats {
  totalPractices: number;
  activeClients: number;
  totalBanks: number;
  byStatus: Record<string, number>;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ totalPractices: 0, activeClients: 0, totalBanks: 0, byStatus: {} });
  const [recentPractices, setRecentPractices] = useState<Practice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [pratiche, clienti, banche] = await Promise.all([
        supabase.from('practices').select('*, clients(ragione_sociale), banks(nome)').order('created_at', { ascending: false }).limit(50),
        supabase.from('clients').select('id'),
        supabase.from('banks').select('id').eq('attiva', true),
      ]);

      const practices = pratiche.data ?? [];
      const byStatus: Record<string, number> = {};
      practices.forEach(p => { byStatus[p.status] = (byStatus[p.status] ?? 0) + 1; });

      setStats({
        totalPractices: practices.length,
        activeClients: clienti.data?.length ?? 0,
        totalBanks: banche.data?.length ?? 0,
        byStatus,
      });
      setRecentPractices(practices.slice(0, 8) as Practice[]);
      setLoading(false);
    }
    load();
  }, []);

  const statCards = [
    { label: 'Pratiche Totali', value: stats.totalPractices, icon: FolderOpen, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Clienti', value: stats.activeClients, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Banche Attive', value: stats.totalBanks, icon: Building2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Da Completare', value: (stats.byStatus['raccolta_documenti'] ?? 0) + (stats.byStatus['integrazioni_richieste'] ?? 0), icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  const priorityStatuses = ['integrazioni_richieste', 'raccolta_documenti', 'inviata_banca'];

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Panoramica generale delle pratiche</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="border-border">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{label}</p>
                  <p className="text-3xl font-bold text-foreground mt-1">{value}</p>
                </div>
                <div className={`p-2.5 rounded-xl ${bg}`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* State breakdown */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Distribuzione Stati
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {Object.entries(STATUS_LABELS).map(([status, label]) => {
              const count = stats.byStatus[status] ?? 0;
              const pct = stats.totalPractices > 0 ? Math.round((count / stats.totalPractices) * 100) : 0;
              return (
                <div key={status} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold text-foreground">{count}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Urgenti */}
        <Card className="border-border lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500" /> Pratiche Recenti
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => navigate('/admin/pratiche')}>
              Vedi tutte <ArrowRight className="w-3 h-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {recentPractices.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Nessuna pratica presente
              </div>
            ) : (
              <div className="space-y-2">
                {recentPractices.filter(p => priorityStatuses.includes(p.status)).concat(
                  recentPractices.filter(p => !priorityStatuses.includes(p.status))
                ).slice(0, 6).map(p => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent cursor-pointer transition-colors"
                    onClick={() => navigate(`/admin/pratiche/${p.id}`)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {(p as Practice & { clients?: { ragione_sociale: string } }).clients?.ragione_sociale ?? 'Cliente'}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{p.numero_pratica}</p>
                    </div>
                    <Badge className={`text-xs shrink-0 ${STATUS_COLORS[p.status]}`}>
                      {STATUS_LABELS[p.status]}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
