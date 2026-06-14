// @section: report-page
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FileText, Mail, BarChart3, Search, RefreshCw,
  ChevronRight, Send, CheckCircle2, AlertCircle,
  Building2, User, Calendar, TrendingUp, Eye,
} from 'lucide-react';

// ── Tipi ──────────────────────────────────────────────────────────────────
interface EmailLog {
  id: string;
  created_at: string;
  practice_id: string;
  bank_nome: string | null;
  destinatari: string[] | null;
  oggetto: string | null;
  stato: string;
  sent_by_nome: string | null;
  practices?: { numero_pratica: string; clients?: { ragione_sociale: string } | null } | null;
}

interface PraticaReport {
  id: string;
  numero_pratica: string;
  importo_richiesto: number | null;
  status: string;
  created_at: string;
  clients: { ragione_sociale: string } | null;
  hasKpi: boolean;
  hasReputazione: boolean;
  emailCount: number;
}

const STATUS_LABEL: Record<string, string> = {
  bozza: 'Bozza', raccolta_documenti: 'Raccolta Doc.',
  analisi: 'Analisi', inviata_banca: 'Inviata Banca',
  approvata: 'Approvata', rifiutata: 'Rifiutata',
  integrazioni_richieste: 'Integrazioni',
};
const STATUS_COLOR: Record<string, string> = {
  bozza: 'bg-gray-100 text-gray-700',
  raccolta_documenti: 'bg-yellow-100 text-yellow-800',
  analisi: 'bg-blue-100 text-blue-800',
  inviata_banca: 'bg-purple-100 text-purple-800',
  approvata: 'bg-green-100 text-green-800',
  rifiutata: 'bg-red-100 text-red-800',
  integrazioni_richieste: 'bg-orange-100 text-orange-800',
};

// ── Componente principale ──────────────────────────────────────────────────
export default function ReportPage() {
  const navigate = useNavigate();
  const [tab, setTab]         = useState<'email' | 'pratiche'>('email');
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  const [emailLogs, setEmailLogs]         = useState<EmailLog[]>([]);
  const [praticheReport, setPraticheReport] = useState<PraticaReport[]>([]);
  const [stats, setStats] = useState({ emails: 0, pratiche: 0, kpi: 0, rep: 0 });

  const load = async () => {
    setLoading(true);
    try {
      // Email log
      const { data: logs } = await supabase
        .from('email_send_log')
        .select('*, practices(numero_pratica, clients(ragione_sociale))')
        .order('created_at', { ascending: false })
        .limit(200);

      // Pratiche con client
      const { data: pratiche } = await supabase
        .from('practices')
        .select('id, numero_pratica, importo_richiesto, status, created_at, clients(ragione_sociale)')
        .order('created_at', { ascending: false })
        .limit(200);

      // KPI disponibili
      const { data: kpiData } = await supabase
        .from('bilanci_kpi')
        .select('client_id');

      // Reputazione disponibile
      const { data: repData } = await supabase
        .from('reputational_analyses')
        .select('practice_id');

      // Email count per pratica
      const emailByPratica: Record<string, number> = {};
      for (const l of (logs ?? [])) {
        emailByPratica[l.practice_id] = (emailByPratica[l.practice_id] ?? 0) + 1;
      }

      // Set dei clientId con KPI
      const kpiClientSet = new Set((kpiData ?? []).map(k => k.client_id));
      const repPracticeSet = new Set((repData ?? []).map(r => r.practice_id));

      // Mappa clientId per pratica: recupero client_id da pratiche
      const { data: praticheClienti } = await supabase
        .from('practices')
        .select('id, client_id')
        .limit(500);
      const praticaClientMap: Record<string, string> = {};
      for (const pc of (praticheClienti ?? [])) {
        praticaClientMap[pc.id] = pc.client_id;
      }

      const enriched: PraticaReport[] = (pratiche ?? []).map(p => ({
        id: p.id,
        numero_pratica: p.numero_pratica,
        importo_richiesto: p.importo_richiesto,
        status: p.status,
        created_at: p.created_at,
        clients: p.clients as unknown as { ragione_sociale: string } | null,
        hasKpi:         kpiClientSet.has(praticaClientMap[p.id]),
        hasReputazione: repPracticeSet.has(p.id),
        emailCount:     emailByPratica[p.id] ?? 0,
      }));

      setEmailLogs(logs ?? []);
      setPraticheReport(enriched);
      setStats({
        emails:  (logs ?? []).length,
        pratiche: (pratiche ?? []).length,
        kpi:     kpiClientSet.size,
        rep:     repPracticeSet.size,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // ── Filtri ───────────────────────────────────────────────────────────────
  const q = search.toLowerCase();
  const filteredLogs = emailLogs.filter(l =>
    !q ||
    (l.practices?.clients?.ragione_sociale ?? '').toLowerCase().includes(q) ||
    (l.bank_nome ?? '').toLowerCase().includes(q) ||
    (l.practices?.numero_pratica ?? '').toLowerCase().includes(q) ||
    (l.oggetto ?? '').toLowerCase().includes(q)
  );
  const filteredPratiche = praticheReport.filter(p =>
    !q ||
    (p.numero_pratica ?? '').toLowerCase().includes(q) ||
    (p.clients?.ragione_sociale ?? '').toLowerCase().includes(q)
  );

  const fmt = (d: string) => new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fmtFull = (d: string) => new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-6">
      {/* @section: report-header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Report</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Storico email inviate e report automatici per pratica</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Aggiorna
        </Button>
      </div>

      {/* @section: report-stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Email inviate',          value: stats.emails,   icon: Mail,      color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Pratiche totali',         value: stats.pratiche, icon: FileText,  color: 'text-blue-600',   bg: 'bg-blue-50'   },
          { label: 'Analisi KPI disponibili', value: stats.kpi,      icon: BarChart3, color: 'text-green-600',  bg: 'bg-green-50'  },
          { label: 'Score reputazione',       value: stats.rep,      icon: TrendingUp,color: 'text-orange-600', bg: 'bg-orange-50' },
        ].map(s => (
          <Card key={s.label} className="border">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
                <s.icon className={`w-5 h-5 ${s.color}`} />
              </div>
              <div>
                <div className="text-xl font-bold text-foreground">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* @section: report-tabs */}
      <div className="flex gap-1 border-b border-border">
        {([
          { key: 'email',    label: 'Email inviate alle banche', icon: Mail },
          { key: 'pratiche', label: 'Report per pratica',        icon: FileText },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
            {t.key === 'email' && stats.emails > 0 && (
              <span className="ml-1 bg-purple-100 text-purple-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                {stats.emails}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* @section: report-search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Cerca pratica, cliente, banca…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* @section: tab-email */}
      {tab === 'email' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="w-4 h-4 text-purple-600" />
              Storico Email inviate alle Banche
              <span className="ml-auto text-xs font-normal text-muted-foreground">{filteredLogs.length} invii</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Caricamento…</div>
            ) : filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                {search ? 'Nessun risultato per la ricerca.' : 'Nessuna email inviata ancora.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data/Ora</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cliente</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Pratica</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Banca</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Destinatario</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Stato</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Inviato da</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredLogs.map((log, i) => (
                      <tr key={log.id} className={`hover:bg-muted/30 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Calendar className="w-3.5 h-3.5" />
                            {fmtFull(log.created_at)}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {log.practices?.clients?.ragione_sociale ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                            {log.practices?.numero_pratica ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
                            {log.bank_nome ?? '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-[160px] truncate">
                          {(log.destinatari ?? []).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {log.stato === 'inviata' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" /> Inviata
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                              <AlertCircle className="w-3 h-3" /> {log.stato}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {log.sent_by_nome ?? '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {log.practice_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => navigate(`/admin/pratiche/${log.practice_id}`)}
                            >
                              <Eye className="w-3.5 h-3.5" /> Pratica
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* @section: tab-pratiche */}
      {tab === 'pratiche' && (
        <div className="space-y-3">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Caricamento…</div>
          ) : filteredPratiche.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              {search ? 'Nessun risultato per la ricerca.' : 'Nessuna pratica trovata.'}
            </div>
          ) : (
            filteredPratiche.map(p => (
              <Card key={p.id} className="border hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Info pratica */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground truncate">
                          {p.clients?.ragione_sociale ?? '—'}
                        </span>
                        <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                          {p.numero_pratica}
                        </span>
                        <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_COLOR[p.status] ?? 'bg-gray-100 text-gray-700'}`}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {fmt(p.created_at)}
                        </span>
                        {p.importo_richiesto && (
                          <span className="font-medium text-foreground">
                            €{Number(p.importo_richiesto).toLocaleString('it-IT')}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Badge report disponibili */}
                    <div className="flex items-center gap-2 flex-wrap sm:shrink-0">
                      <ReportBadge
                        icon={BarChart3}
                        label="KPI Finanziari"
                        available={p.hasKpi}
                        color="blue"
                      />
                      <ReportBadge
                        icon={TrendingUp}
                        label="Reputazione"
                        available={p.hasReputazione}
                        color="orange"
                      />
                      <ReportBadge
                        icon={Mail}
                        label={`${p.emailCount} email`}
                        available={p.emailCount > 0}
                        color="purple"
                      />
                    </div>

                    {/* Azione */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={() => navigate(`/admin/pratiche/${p.id}`)}
                    >
                      Apri pratica <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Badge piccolo per report disponibile/mancante ─────────────────────────
function ReportBadge({
  icon: Icon, label, available, color,
}: {
  icon: React.ElementType;
  label: string;
  available: boolean;
  color: 'blue' | 'orange' | 'green' | 'purple';
}) {
  const colorMap = {
    blue:   { yes: 'bg-blue-50 text-blue-700 border-blue-200',     no: 'bg-muted text-muted-foreground border-muted' },
    orange: { yes: 'bg-orange-50 text-orange-700 border-orange-200', no: 'bg-muted text-muted-foreground border-muted' },
    green:  { yes: 'bg-green-50 text-green-700 border-green-200',  no: 'bg-muted text-muted-foreground border-muted' },
    purple: { yes: 'bg-purple-50 text-purple-700 border-purple-200', no: 'bg-muted text-muted-foreground border-muted' },
  };
  const cls = available ? colorMap[color].yes : colorMap[color].no;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border ${cls}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}
