import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  BarChart3, FolderOpen, Users, CheckCircle, Clock, AlertCircle,
  TrendingUp, Timer, FileWarning, Activity, CalendarDays, Target,
  PieChart,
} from 'lucide-react';
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/types';

interface Practice {
  id: string; status: string; created_by: string; assigned_to: string | null;
  created_at: string; numero_pratica: string; importo_richiesto: number | null;
  clients?: { ragione_sociale: string };
}
interface DocStat { practice_id: string; status: string; }
interface UploadStat { practice_id: string; uploaded_at: string; }
interface AccessStat { practice_id: string; created_at: string; last_access: string | null; }

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}
function avg(arr: number[]) { return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0; }
function fmt(days: number) {
  if (days < 1) return '< 1g';
  if (days < 30) return `${Math.round(days)}g`;
  return `${Math.round(days / 30)}m ${Math.round(days % 30)}g`;
}

export default function StatistichePage() {
  const { user, isSuperAdmin, isSegreteria, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<{ id: string; nome: string; email: string }[]>([]);
  const [practices, setPractices] = useState<Practice[]>([]);
  const [docs, setDocs] = useState<DocStat[]>([]);
  const [uploads, setUploads] = useState<UploadStat[]>([]);
  const [accessCodes, setAccessCodes] = useState<AccessStat[]>([]);
  const [totaleClienti, setTotaleClienti] = useState(0);
  const [totaleBanche, setTotaleBanche] = useState(0);

  // Attende che l'auth sia pronta (role caricato) prima di caricare i dati
  useEffect(() => {
    if (!authLoading && user?.id) load();
  }, [user?.id, authLoading, isSegreteria, isSuperAdmin]);

  const load = async () => {
    setLoading(true);

    // Agenti visibili (segreteria → solo i propri, superadmin → tutti)
    let aids: string[] = [];
    if (isSegreteria) {
      const { data } = await supabase.from('segreteria_agent_assignments')
        .select('agent_user_id').eq('segreteria_user_id', user!.id);
      aids = (data ?? []).map((a: { agent_user_id: string }) => a.agent_user_id);
    } else if (isSuperAdmin) {
      const { data } = await supabase.from('admin_profiles').select('id').eq('ruolo', 'agente');
      aids = (data ?? []).map((a: { id: string }) => a.id);
    }
    setAgentIds(aids);

    // Profili agenti
    if (aids.length > 0) {
      const { data } = await supabase.from('admin_profiles').select('id,nome,email').in('id', aids);
      setAgentProfiles(data ?? []);
    }

    // Pratiche (filtrate per agenti visibili)
    let q = supabase.from('practices').select('id,status,created_by,assigned_to,created_at,numero_pratica,importo_richiesto,clients(ragione_sociale)');
    if (isSegreteria && aids.length > 0) q = q.in('created_by', aids);
    else if (!isSuperAdmin) q = q.eq('created_by', user!.id);
    const { data: pData } = await q.order('created_at', { ascending: false });
    const pList = (pData ?? []) as unknown as Practice[];
    setPractices(pList);

    if (pList.length === 0) { setLoading(false); return; }
    const pIds = pList.map(p => p.id);

    // Documenti per stato
    const { data: docData } = await supabase.from('practice_documents')
      .select('practice_id,status').in('practice_id', pIds);
    setDocs(docData ?? []);

    // Prima data upload per pratica
    const { data: upData } = await supabase.from('uploaded_files')
      .select('practice_id,uploaded_at').in('practice_id', pIds)
      .order('uploaded_at', { ascending: true });
    setUploads(upData ?? []);

    // Access codes (data creazione codice + ultimo accesso cliente)
    const { data: acData } = await supabase.from('practice_access_codes')
      .select('practice_id,created_at,last_access').in('practice_id', pIds);
    setAccessCodes(acData ?? []);

    // Totale clienti
    let cq = supabase.from('clients').select('id', { count: 'exact', head: true });
    if (isSegreteria && aids.length > 0) cq = cq.in('created_by', aids);
    const { count } = await cq;
    setTotaleClienti(count ?? 0);

    // Totale banche
    const { count: bCount } = await supabase.from('banks').select('id', { count: 'exact', head: true });
    setTotaleBanche(bCount ?? 0);

    setLoading(false);
  };

  // ── Metriche globali ──────────────────────────────────────────────────────
  const totale = practices.length;
  const byStatus: Record<string, number> = {};
  practices.forEach(p => { byStatus[p.status] = (byStatus[p.status] ?? 0) + 1; });

  const completate  = (byStatus['completata'] ?? 0) + (byStatus['approvata'] ?? 0);
  const inCorso     = (byStatus['raccolta_documenti'] ?? 0) + (byStatus['inviata_banca'] ?? 0) + (byStatus['integrazioni_richieste'] ?? 0);
  const bozze       = byStatus['bozza'] ?? 0;
  const rifiutate   = byStatus['rifiutata'] ?? 0;
  // Pratiche ancora aperte (qualsiasi stato non terminale)
  const daCompletare = totale - completate - rifiutate;
  const tasso       = totale > 0 ? Math.round((completate / totale) * 100) : 0;

  // Durata media pratiche attive (giorni da creazione)
  const durateAttive = practices
    .filter(p => !['completata','approvata','rifiutata'].includes(p.status))
    .map(p => daysBetween(p.created_at, new Date().toISOString()));
  const durataMediaAttiva = avg(durateAttive);

  // Durata media pratiche completate
  // (usiamo il last status_log ma non lo abbiamo; usiamo created_at come proxy)
  // Tempo medio risposta cliente: da created_at del codice accesso a primo upload
  const tempiRisposta: number[] = [];
  accessCodes.forEach(ac => {
    const firstUpload = uploads.find(u => u.practice_id === ac.practice_id);
    if (firstUpload) tempiRisposta.push(daysBetween(ac.created_at, firstUpload.uploaded_at));
  });
  const tempoMedioRisposta = avg(tempiRisposta);

  // Pratiche con documenti mancanti (richiesto o rifiutato)
  const praticheConDocMancanti = new Set(
    docs.filter(d => d.status === 'richiesto' || d.status === 'rifiutato').map(d => d.practice_id)
  ).size;

  // ── Stats per agente ───────────────────────────────────────────────────────
  const agentStats = agentProfiles.map(agent => {
    const agentPractices = practices.filter(p => p.created_by === agent.id || p.assigned_to === agent.id);
    const bs: Record<string, number> = {};
    agentPractices.forEach(p => { bs[p.status] = (bs[p.status] ?? 0) + 1; });
    const durateAgente = agentPractices
      .filter(p => !['completata','approvata','rifiutata'].includes(p.status))
      .map(p => daysBetween(p.created_at, new Date().toISOString()));
    const durata = avg(durateAgente);
    const tempi = agentPractices.flatMap(p => {
      const ac = accessCodes.find(a => a.practice_id === p.id);
      const fu = uploads.find(u => u.practice_id === p.id);
      return ac && fu ? [daysBetween(ac.created_at, fu.uploaded_at)] : [];
    });
    const completateAg = (bs['completata'] ?? 0) + (bs['approvata'] ?? 0);
    return {
      ...agent,
      totale: agentPractices.length,
      byStatus: bs,
      durataMedia: durata,
      tempoRisposta: avg(tempi),
      tasso: agentPractices.length > 0 ? Math.round((completateAg / agentPractices.length) * 100) : 0,
      docMancanti: agentPractices.filter(p =>
        docs.some(d => d.practice_id === p.id && (d.status === 'richiesto' || d.status === 'rifiutato'))
      ).length,
    };
  }).sort((a, b) => b.totale - a.totale);

  // ── Nuovi widget ──────────────────────────────────────────────────────────

  // 1. Pratiche per stato (per barre SVG)
  const statusBarData = Object.entries(byStatus).sort((a, b) => b[1] - a[1]);
  const maxStatusCount = statusBarData.length > 0 ? Math.max(...statusBarData.map(e => e[1])) : 1;

  // 2. Trend ultime 6 mesi
  const trendData: { label: string; count: number }[] = (() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label = d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' });
      const count = practices.filter(p => {
        const pd = new Date(p.created_at);
        return pd.getFullYear() === d.getFullYear() && pd.getMonth() === d.getMonth();
      }).length;
      return { label, count };
    });
  })();
  const maxTrend = trendData.length > 0 ? Math.max(...trendData.map(t => t.count), 1) : 1;

  // 3. Top 5 ATECO
  const atecoCounts: Record<string, number> = {};
  practices.forEach(p => {
    const ateco = (p as unknown as { codice_ateco?: string }).codice_ateco;
    if (ateco) atecoCounts[ateco] = (atecoCounts[ateco] ?? 0) + 1;
  });
  const topAteco = Object.entries(atecoCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // 4. Tasso conversione raccolta_documenti → approvata
  const inRaccolta = practices.filter(p => p.status === 'raccolta_documenti').length;
  const approvate = byStatus['approvata'] ?? 0;
  const totalePassaggioBase = inRaccolta + approvate + (byStatus['completata'] ?? 0) + (byStatus['inviata_banca'] ?? 0) + (byStatus['integrazioni_richieste'] ?? 0);
  const tassoConversione = totalePassaggioBase > 0 ? Math.round((approvate / totalePassaggioBase) * 100) : 0;

  // 5. Distribuzione importi
  const FASCE = [
    { label: '<50k',     min: 0,       max: 50000 },
    { label: '50–100k',  min: 50000,   max: 100000 },
    { label: '100–250k', min: 100000,  max: 250000 },
    { label: '250–500k', min: 250000,  max: 500000 },
    { label: '>500k',    min: 500000,  max: Infinity },
  ];
  const importiDistrib = FASCE.map(f => ({
    label: f.label,
    count: practices.filter(p => p.importo_richiesto != null && p.importo_richiesto >= f.min && p.importo_richiesto < f.max).length,
  }));
  const maxImporti = Math.max(...importiDistrib.map(f => f.count), 1);

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="w-6 h-6 text-primary" /> Statistiche
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {isSegreteria ? `Dati relativi ai tuoi ${agentIds.length} agenti assegnati` : 'Panoramica completa pratiche e attività'}
        </p>
      </div>

      {/* KPI principali */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <FolderOpen className="w-4 h-4 text-blue-600"/>, bg:'bg-blue-100', val: totale, label: 'Pratiche totali' },
          { icon: <Clock className="w-4 h-4 text-amber-600"/>, bg:'bg-amber-100', val: daCompletare, label: 'Da completare' },
          { icon: <CheckCircle className="w-4 h-4 text-green-600"/>, bg:'bg-green-100', val: completate, label: 'Completate' },
          { icon: <Users className="w-4 h-4 text-purple-600"/>, bg:'bg-purple-100', val: totaleClienti, label: 'Clienti' },
        ].map((k, i) => (
          <Card key={i}><CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg ${k.bg} flex items-center justify-center`}>{k.icon}</div>
              <div><p className="text-2xl font-bold">{k.val}</p><p className="text-xs text-muted-foreground">{k.label}</p></div>
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* Metriche di performance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <Target className="w-4 h-4 text-green-600"/>, bg:'bg-green-50 border-green-200', val:`${tasso}%`, label:'Tasso completamento' },
          { icon: <Timer className="w-4 h-4 text-blue-600"/>, bg:'bg-blue-50 border-blue-200', val: fmt(durataMediaAttiva), label:'Durata media (attive)' },
          { icon: <FileWarning className="w-4 h-4 text-red-600"/>, bg:'bg-red-50 border-red-200', val: praticheConDocMancanti, label:'Pratiche con doc mancanti' },
          { icon: <Activity className="w-4 h-4 text-violet-600"/>, bg:'bg-violet-50 border-violet-200', val: totaleBanche, label:'Banche disponibili' },
        ].map((k, i) => (
          <Card key={i} className={`border ${k.bg}`}><CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/70 flex items-center justify-center shadow-sm">{k.icon}</div>
              <div><p className="text-2xl font-bold">{k.val}</p><p className="text-xs text-muted-foreground">{k.label}</p></div>
            </div>
          </CardContent></Card>
        ))}
      </div>

      {/* Distribuzione per stato */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Distribuzione per stato
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(byStatus).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessuna pratica</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-3">
                    <Badge className={`${STATUS_COLORS[status as keyof typeof STATUS_COLORS] ?? 'bg-gray-100 text-gray-700'} text-xs w-44 justify-center shrink-0`}>
                      {STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status}
                    </Badge>
                    <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${totale > 0 ? (count / totale) * 100 : 0}%` }} />
                    </div>
                    <span className="text-sm font-semibold w-6 text-right">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Riepilogo rapido */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-primary" /> Riepilogo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              {[
                { label: 'Bozze da attivare', val: bozze, color: 'text-gray-600' },
                { label: 'In raccolta documenti', val: byStatus['raccolta_documenti'] ?? 0, color: 'text-amber-600' },
                { label: 'Inviate alla banca', val: byStatus['inviata_banca'] ?? 0, color: 'text-blue-600' },
                { label: 'Integrazioni richieste', val: byStatus['integrazioni_richieste'] ?? 0, color: 'text-orange-600' },
                { label: 'Completate / Approvate', val: completate, color: 'text-green-600' },
                { label: 'Rifiutate', val: rifiutate, color: 'text-red-600' },
                { label: 'Pratiche con doc mancanti', val: praticheConDocMancanti, color: 'text-rose-600' },
              ].map(r => (
                <div key={r.label} className="flex items-center justify-between py-1 border-b border-border last:border-0">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className={`font-bold ${r.color}`}>{r.val}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── NUOVI WIDGET ─────────────────────────────────────────────────── */}

      {/* Riga 1: Grafico barre per stato + Trend mensile */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Widget 1 — Grafico a barre per stato */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" /> Pratiche per Stato
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusBarData.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nessun dato</p>
            ) : (
              <svg viewBox={`0 0 320 ${Math.max(statusBarData.length * 30, 60)}`} className="w-full" style={{ maxHeight: 220 }}>
                {statusBarData.map(([status, count], i) => {
                  const barW = Math.max((count / maxStatusCount) * 220, 4);
                  const y = i * 30 + 4;
                  const colors: Record<string, string> = {
                    bozza: '#94a3b8', raccolta_documenti: '#3b82f6', inviata_banca: '#8b5cf6',
                    integrazioni_richieste: '#f59e0b', completata: '#22c55e', approvata: '#10b981',
                    rifiutata: '#ef4444', declinata: '#f43f5e',
                  };
                  const fill = colors[status] ?? '#6b7280';
                  return (
                    <g key={status}>
                      <rect x={80} y={y} width={barW} height={18} rx={3} fill={fill} opacity={0.85} />
                      <text x={76} y={y + 13} fontSize={9} textAnchor="end" fill="#6b7280">
                        {(STATUS_LABELS[status as keyof typeof STATUS_LABELS] ?? status).slice(0, 14)}
                      </text>
                      <text x={barW + 84} y={y + 13} fontSize={10} fill="#374151" fontWeight="600">{count}</text>
                    </g>
                  );
                })}
              </svg>
            )}
          </CardContent>
        </Card>

        {/* Widget 2 — Trend pratiche ultimi 6 mesi */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Trend ultimi 6 mesi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <svg viewBox="0 0 320 120" className="w-full">
              {/* Griglia */}
              {[0, 1, 2, 3].map(g => (
                <line key={g} x1={30} y1={10 + g * 25} x2={310} y2={10 + g * 25} stroke="#e5e7eb" strokeWidth={1} />
              ))}
              {/* Barre */}
              {trendData.map((t, i) => {
                const bw = 30;
                const gap = (280 - trendData.length * bw) / (trendData.length + 1);
                const x = 30 + gap + i * (bw + gap);
                const barH = maxTrend > 0 ? Math.max((t.count / maxTrend) * 75, t.count > 0 ? 4 : 0) : 0;
                const y = 85 - barH;
                return (
                  <g key={t.label}>
                    <rect x={x} y={y} width={bw} height={barH} rx={3} fill="#3b82f6" opacity={0.8} />
                    {t.count > 0 && (
                      <text x={x + bw / 2} y={y - 3} fontSize={9} textAnchor="middle" fill="#1d4ed8" fontWeight="600">{t.count}</text>
                    )}
                    <text x={x + bw / 2} y={100} fontSize={8} textAnchor="middle" fill="#9ca3af">{t.label}</text>
                  </g>
                );
              })}
            </svg>
          </CardContent>
        </Card>
      </div>

      {/* Riga 2: Top ATECO + Tasso conversione + Distribuzione importi */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Widget 3 — Top 5 ATECO */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <PieChart className="w-4 h-4 text-primary" /> Top ATECO
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topAteco.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Nessun codice ATECO</p>
            ) : (
              <div className="space-y-2">
                {topAteco.map(([code, cnt], i) => {
                  const palette = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'];
                  const fill = palette[i % palette.length];
                  const pct = totale > 0 ? Math.round((cnt / totale) * 100) : 0;
                  return (
                    <div key={code} className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold w-16 truncate" style={{ color: fill }}>{code}</span>
                      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: fill }} />
                      </div>
                      <span className="text-xs font-bold w-5 text-right" style={{ color: fill }}>{cnt}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Widget 4 — Tasso conversione */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Tasso Conversione
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 pt-1">
            <svg viewBox="0 0 120 120" className="w-28 h-28">
              {/* Cerchio sfondo */}
              <circle cx={60} cy={60} r={48} fill="none" stroke="#e5e7eb" strokeWidth={10} />
              {/* Arco conversione */}
              <circle
                cx={60} cy={60} r={48}
                fill="none"
                stroke="#10b981"
                strokeWidth={10}
                strokeDasharray={`${(tassoConversione / 100) * 301.6} 301.6`}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
              />
              <text x={60} y={55} textAnchor="middle" fontSize={22} fontWeight="700" fill="#10b981">{tassoConversione}%</text>
              <text x={60} y={72} textAnchor="middle" fontSize={9} fill="#9ca3af">approvate</text>
            </svg>
            <div className="text-center text-xs text-muted-foreground">
              <p><span className="font-semibold text-emerald-600">{approvate}</span> approvate su <span className="font-semibold">{totalePassaggioBase}</span> pratiche avanzate</p>
            </div>
          </CardContent>
        </Card>

        {/* Widget 5 — Distribuzione importi */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> Distribuzione Importi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <svg viewBox="0 0 240 100" className="w-full">
              {importiDistrib.map((f, i) => {
                const bw = 32;
                const gap = (240 - importiDistrib.length * bw) / (importiDistrib.length + 1);
                const x = gap + i * (bw + gap);
                const barH = maxImporti > 0 ? Math.max((f.count / maxImporti) * 60, f.count > 0 ? 4 : 0) : 0;
                const y = 70 - barH;
                const fills = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'];
                return (
                  <g key={f.label}>
                    <rect x={x} y={y} width={bw} height={barH} rx={3} fill={fills[i]} opacity={0.8} />
                    {f.count > 0 && (
                      <text x={x + bw / 2} y={y - 3} fontSize={9} textAnchor="middle" fill={fills[i]} fontWeight="600">{f.count}</text>
                    )}
                    <text x={x + bw / 2} y={84} fontSize={7} textAnchor="middle" fill="#9ca3af">{f.label}</text>
                  </g>
                );
              })}
            </svg>
          </CardContent>
        </Card>
      </div>

      {/* Tabella per agente */}
      {agentStats.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Performance per agente
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Agente</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs text-muted-foreground">Totale</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs text-muted-foreground">Tasso %</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs text-muted-foreground">Durata media</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs text-muted-foreground">Risp. cliente</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs text-muted-foreground">Doc mancanti</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-xs text-muted-foreground">Stati</th>
                  </tr>
                </thead>
                <tbody>
                  {agentStats.map((agent, i) => (
                    <tr key={agent.id} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{agent.nome || agent.email}</p>
                        <p className="text-xs text-muted-foreground">{agent.email}</p>
                      </td>
                      <td className="px-3 py-3 text-center font-bold text-primary">{agent.totale}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`font-semibold ${agent.tasso >= 50 ? 'text-green-600' : agent.tasso > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {agent.tasso}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center text-muted-foreground">{agent.durataMedia > 0 ? fmt(agent.durataMedia) : '—'}</td>
                      <td className="px-3 py-3 text-center text-muted-foreground">{agent.tempoRisposta > 0 ? fmt(agent.tempoRisposta) : '—'}</td>
                      <td className="px-3 py-3 text-center">
                        {agent.docMancanti > 0
                          ? <span className="text-red-600 font-semibold">{agent.docMancanti}</span>
                          : <span className="text-green-600">✓</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(agent.byStatus).sort((a,b)=>b[1]-a[1]).map(([s, c]) => (
                            <Badge key={s} className={`${STATUS_COLORS[s as keyof typeof STATUS_COLORS] ?? 'bg-gray-100 text-gray-700'} text-xs`}>
                              {STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s}: {c}
                            </Badge>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Storico pratiche recenti */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" /> Storico pratiche recenti
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {practices.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-6">Nessuna pratica</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Pratica</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-xs text-muted-foreground">Cliente</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs text-muted-foreground">Stato</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs text-muted-foreground">Età</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs text-muted-foreground">Doc</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-xs text-muted-foreground">Creata il</th>
                  </tr>
                </thead>
                <tbody>
                  {practices.map((p, i) => {
                    const pDocs = docs.filter(d => d.practice_id === p.id);
                    const mancanti = pDocs.filter(d => d.status === 'richiesto' || d.status === 'rifiutato').length;
                    const ok = pDocs.filter(d => d.status === 'approvato' || d.status === 'caricato').length;
                    const eta = daysBetween(p.created_at, new Date().toISOString());
                    return (
                      <tr key={p.id} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                        <td className="px-4 py-2.5">
                          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{p.numero_pratica}</code>
                        </td>
                        <td className="px-4 py-2.5 font-medium">{p.clients?.ragione_sociale ?? '—'}</td>
                        <td className="px-3 py-2.5 text-center">
                          <Badge className={`${STATUS_COLORS[p.status as keyof typeof STATUS_COLORS] ?? 'bg-gray-100 text-gray-700'} text-xs`}>
                            {STATUS_LABELS[p.status as keyof typeof STATUS_LABELS] ?? p.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-center text-muted-foreground">{fmt(eta)}</td>
                        <td className="px-3 py-2.5 text-center">
                          {mancanti > 0
                            ? <span className="text-red-600 text-xs font-medium">⚠ {mancanti} mancanti</span>
                            : ok > 0
                              ? <span className="text-green-600 text-xs">✓ {ok} ok</span>
                              : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString('it-IT')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {isSegreteria && agentIds.length === 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-5 pb-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-700">
              Nessun agente assegnato. Vai in <strong>Miei Agenti</strong> per aggiungerne.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
