import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { invokeSendToBank } from '@/lib/sendToBank';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FolderOpen, Users, Building2, Clock, CheckCircle2, AlertCircle, TrendingUp, ArrowRight, Bell, Send, XCircle, Calendar, CheckSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { STATUS_LABELS, STATUS_COLORS, type Practice } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Cell } from 'recharts';

interface Stats {
  totalPractices: number;
  activeClients: number;
  totalBanks: number;
  byStatus: Record<string, number>;
}

interface BankRequest {
  id: string;
  practice_id: string;
  bank_id: string;
  status: string;
  note_banca?: string;
  created_at: string;
  banks?: { nome: string };
  practices?: { numero_pratica: string; clients?: { citta?: string; codice_ateco?: string } };
}

const STATUS_BAR_COLOR: Record<string, string> = {
  bozza:                  '#94a3b8',
  raccolta_documenti:     '#3b82f6',
  inviata_banca:          '#a855f7',
  integrazioni_richieste: '#f59e0b',
  approvata:              '#10b981',
  declinata:              '#f43f5e',
  rifiutata:              '#ef4444',
  completata:             '#22c55e',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const { isSuperAdmin, isSegreteria } = useAuth();
  const [stats, setStats] = useState<Stats>({ totalPractices: 0, activeClients: 0, totalBanks: 0, byStatus: {} });
  const [recentPractices, setRecentPractices] = useState<Practice[]>([]);
  const [loading, setLoading] = useState(true);
  const [bankRequests, setBankRequests] = useState<BankRequest[]>([]);
  const [processingReq, setProcessingReq] = useState<string | null>(null);
  const [monthlyData, setMonthlyData] = useState<{ mese: string; pratiche: number }[]>([]);
  const [pendingTasks, setPendingTasks] = useState(0);
  const [upcomingDeadlines, setUpcomingDeadlines] = useState(0);

  const canSeeBankRequests = isSuperAdmin || isSegreteria;

  useEffect(() => {
    async function load() {
      const [pratiche, clienti, banche] = await Promise.all([
        supabase.from('practices').select('*, clients(ragione_sociale), banks(nome)').order('created_at', { ascending: false }).limit(200),
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

      // Dati per grafico mensile (ultimi 6 mesi)
      const now = new Date();
      const monthly: { mese: string; pratiche: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
        const start = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
        const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString();
        const count = practices.filter(p => p.created_at >= start && p.created_at <= end).length;
        monthly.push({ mese: label, pratiche: count });
      }
      setMonthlyData(monthly);
      setLoading(false);
    }
    load();

    // Task e scadenze pendenti
    const tomorrow14 = new Date();
    tomorrow14.setDate(tomorrow14.getDate() + 14);
    supabase.from('practice_tasks').select('id', { count: 'exact', head: true }).in('stato', ['aperta','in_corso']).then(({ count }) => setPendingTasks(count ?? 0));
    supabase.from('document_deadlines').select('id', { count: 'exact', head: true }).lte('data_scadenza', tomorrow14.toISOString().split('T')[0]).gte('data_scadenza', new Date().toISOString().split('T')[0]).then(({ count }) => setUpcomingDeadlines(count ?? 0));
  }, []);

  useEffect(() => {
    if (!canSeeBankRequests) return;
    supabase
      .from('bank_interest_requests')
      .select('id, practice_id, bank_id, status, note_banca, created_at, banks(nome), practices(numero_pratica, clients(citta, codice_ateco))')
      .eq('status', 'in_attesa')
      .order('created_at', { ascending: false })
      .then(({ data }) => setBankRequests((data ?? []) as unknown as BankRequest[]));
  }, [canSeeBankRequests]);

  const handleApprove = async (req: BankRequest) => {
    setProcessingReq(req.id);
    try {
      const { data: existing } = await supabase.from('practice_banks').select('id').eq('practice_id', req.practice_id).eq('bank_id', req.bank_id).maybeSingle();
      if (!existing) await supabase.from('practice_banks').insert({ practice_id: req.practice_id, bank_id: req.bank_id, status: 'assegnata' });
      const { data: sendResult, error: sendError } = await invokeSendToBank({ practice_id: req.practice_id, bank_id: req.bank_id, note: req.note_banca || null });
      if (sendError || (sendResult && !sendResult.success)) { toast.error('Errore invio email: ' + (sendResult?.error ?? sendError?.message)); return; }
      await supabase.from('bank_interest_requests').update({ status: 'approvata', handled_by: (await supabase.auth.getUser()).data.user?.id }).eq('id', req.id);
      toast.success('Documenti inviati e richiesta approvata!');
      setBankRequests(prev => prev.filter(r => r.id !== req.id));
    } finally { setProcessingReq(null); }
  };

  const handleReject = async (reqId: string) => {
    setProcessingReq(reqId);
    try {
      await supabase.from('bank_interest_requests').update({ status: 'rifiutata', handled_by: (await supabase.auth.getUser()).data.user?.id }).eq('id', reqId);
      toast.success('Richiesta rifiutata');
      setBankRequests(prev => prev.filter(r => r.id !== reqId));
    } finally { setProcessingReq(null); }
  };

  // Dati grafico stati
  const statusChartData = Object.entries(STATUS_LABELS).map(([status, label]) => ({
    status,
    label: label.length > 14 ? label.slice(0, 12) + '…' : label,
    count: stats.byStatus[status] ?? 0,
    fill: STATUS_BAR_COLOR[status] ?? '#94a3b8',
  })).filter(d => d.count > 0);

  const statCards = [
    { label: 'Pratiche Totali', value: stats.totalPractices, icon: FolderOpen, color: 'text-blue-600', bg: 'bg-blue-50', link: '/admin/pratiche' },
    { label: 'Clienti', value: stats.activeClients, icon: Users, color: 'text-purple-600', bg: 'bg-purple-50', link: '/admin/clienti' },
    { label: 'Banche Attive', value: stats.totalBanks, icon: Building2, color: 'text-emerald-600', bg: 'bg-emerald-50', link: '/admin/banche' },
    { label: 'Task Aperti', value: pendingTasks, icon: CheckSquare, color: 'text-indigo-600', bg: 'bg-indigo-50', link: '/admin/tasks' },
    { label: 'Scadenze 14gg', value: upcomingDeadlines, icon: Calendar, color: 'text-amber-600', bg: 'bg-amber-50', link: '/admin/calendario' },
    { label: 'Da Completare', value: (stats.byStatus['raccolta_documenti'] ?? 0) + (stats.byStatus['integrazioni_richieste'] ?? 0), icon: Clock, color: 'text-orange-600', bg: 'bg-orange-50', link: '/admin/pratiche' },
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

      {/* Richieste banche in attesa */}
      {canSeeBankRequests && bankRequests.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2 text-amber-800">
              <Bell className="w-4 h-4 text-amber-600" />
              Richieste Documenti dalle Banche
              <Badge className="bg-amber-200 text-amber-800 ml-1">{bankRequests.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {bankRequests.map(req => (
              <div key={req.id} className="bg-white rounded-lg border border-amber-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-800">🏦 {req.banks?.nome ?? 'Banca'}</span>
                      <span className="text-xs text-slate-500">→</span>
                      <span className="text-sm text-slate-700 font-mono">Pratica #{req.practices?.numero_pratica}</span>
                    </div>
                    {req.note_banca && <p className="text-xs text-slate-500 mt-1 italic">"{req.note_banca}"</p>}
                    <p className="text-xs text-slate-400 mt-1">{new Date(req.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700" disabled={processingReq === req.id} onClick={() => handleApprove(req)}>
                      <Send className="w-3 h-3" />{processingReq === req.id ? 'Invio...' : 'Approva & Invia'}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50" disabled={processingReq === req.id} onClick={() => handleReject(req.id)}>
                      <XCircle className="w-3 h-3" /> Rifiuta
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg, link }) => (
          <Card key={label} className="border-border cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(link)}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium leading-tight">{label}</p>
                  <p className="text-3xl font-bold text-foreground mt-1">{value}</p>
                </div>
                <div className={`p-2 rounded-xl ${bg}`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Grafici */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* BarChart stati */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Pratiche per Stato
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nessuna pratica presente</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={statusChartData} margin={{ top: 4, right: 4, left: -20, bottom: 32 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip formatter={(v) => [v, 'Pratiche']} labelFormatter={(l) => l} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {statusChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* LineChart mensile */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Pratiche Aperte — Ultimi 6 Mesi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={monthlyData} margin={{ top: 4, right: 4, left: -20, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="mese" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip formatter={(v) => [v, 'Pratiche']} />
                <Line type="monotone" dataKey="pratiche" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Pratiche recenti */}
      <Card className="border-border">
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
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-30" />Nessuna pratica presente
            </div>
          ) : (
            <div className="space-y-2">
              {recentPractices.filter(p => priorityStatuses.includes(p.status)).concat(
                recentPractices.filter(p => !priorityStatuses.includes(p.status))
              ).slice(0, 6).map(p => (
                <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent cursor-pointer transition-colors" onClick={() => navigate(`/admin/pratiche/${p.id}`)}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {(p as Practice & { clients?: { ragione_sociale: string } }).clients?.ragione_sociale ?? 'Cliente'}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">{p.numero_pratica}</p>
                  </div>
                  <Badge className={`text-xs shrink-0 ${STATUS_COLORS[p.status]}`}>{STATUS_LABELS[p.status]}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
