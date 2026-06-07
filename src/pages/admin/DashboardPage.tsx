import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FolderOpen, Users, Building2, Clock, CheckCircle2, AlertCircle, TrendingUp, ArrowRight, Bell, Send, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { STATUS_LABELS, STATUS_COLORS, type Practice } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

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

export default function DashboardPage() {
  const navigate = useNavigate();
  const { isSuperAdmin, isSegreteria } = useAuth();
  const [stats, setStats] = useState<Stats>({ totalPractices: 0, activeClients: 0, totalBanks: 0, byStatus: {} });
  const [recentPractices, setRecentPractices] = useState<Practice[]>([]);
  const [loading, setLoading] = useState(true);
  const [bankRequests, setBankRequests] = useState<BankRequest[]>([]);
  const [processingReq, setProcessingReq] = useState<string | null>(null);

  const canSeeBankRequests = isSuperAdmin || isSegreteria;

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
      // 1. Crea practice_banks se non esiste
      const { data: existing } = await supabase
        .from('practice_banks')
        .select('id')
        .eq('practice_id', req.practice_id)
        .eq('bank_id', req.bank_id)
        .maybeSingle();

      if (!existing) {
        await supabase.from('practice_banks').insert({
          practice_id: req.practice_id,
          bank_id: req.bank_id,
          status: 'assegnata',
        });
      }

      // 2. Invia email via send-to-bank
      const { data: sendResult, error: sendError } = await supabase.functions.invoke('send-to-bank', {
        body: { practice_id: req.practice_id, bank_id: req.bank_id, note: req.note_banca || null },
      });

      if (sendError || (sendResult && !sendResult.success)) {
        toast.error('Errore invio email: ' + (sendResult?.error ?? sendError?.message));
        return;
      }

      // 3. Aggiorna richiesta come approvata
      await supabase.from('bank_interest_requests')
        .update({ status: 'approvata', handled_by: (await supabase.auth.getUser()).data.user?.id })
        .eq('id', req.id);

      toast.success('Documenti inviati e richiesta approvata!');
      setBankRequests(prev => prev.filter(r => r.id !== req.id));
    } finally {
      setProcessingReq(null);
    }
  };

  const handleReject = async (reqId: string) => {
    setProcessingReq(reqId);
    try {
      await supabase.from('bank_interest_requests')
        .update({ status: 'rifiutata', handled_by: (await supabase.auth.getUser()).data.user?.id })
        .eq('id', reqId);
      toast.success('Richiesta rifiutata');
      setBankRequests(prev => prev.filter(r => r.id !== reqId));
    } finally {
      setProcessingReq(null);
    }
  };

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
                      <span className="text-sm text-slate-700 font-mono">
                        Pratica #{req.practices?.numero_pratica}
                      </span>
                    </div>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {req.practices?.clients?.citta && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">📍 {req.practices.clients.citta}</span>
                      )}
                      {req.practices?.clients?.codice_ateco && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">🏭 {req.practices.clients.codice_ateco}</span>
                      )}
                    </div>
                    {req.note_banca && (
                      <p className="text-xs text-slate-500 mt-1 italic">"{req.note_banca}"</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">{new Date(req.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700"
                      disabled={processingReq === req.id}
                      onClick={() => handleApprove(req)}>
                      <Send className="w-3 h-3" />
                      {processingReq === req.id ? 'Invio...' : 'Approva & Invia'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50"
                      disabled={processingReq === req.id}
                      onClick={() => handleReject(req.id)}>
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

