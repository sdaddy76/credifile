import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  MapPin, BarChart2, Euro, TrendingUp, Clock, CheckCircle, XCircle,
  Send, Building, RefreshCw, LogOut, Building2, Inbox, Search,
  FileText, User, Phone, Mail, Calendar, Hash, Landmark,
} from 'lucide-react';

/* ─── Layout ─── */
function BancaLayout({ children }: { children: React.ReactNode }) {
  const { signOut, profileNome } = useAuth();
  const navigate = useNavigate();
  const handleLogout = async () => { await signOut(); navigate('/login', { replace: true }); };
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-semibold text-slate-800">Credifile</span>
            <span className="text-xs text-slate-500 ml-2">· Portale Banche</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {profileNome && <span className="text-sm text-slate-600 font-medium">{profileNome}</span>}
          <Button variant="outline" size="sm" onClick={handleLogout} className="gap-1.5">
            <LogOut className="w-3.5 h-3.5" /> Esci
          </Button>
        </div>
      </header>
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">{children}</main>
    </div>
  );
}

/* ─── Types ─── */
interface AnonymousPractice {
  id: string;
  numero_pratica: string;
  importo_richiesto?: number;
  motivazione?: string;
  status: string;
  codice_ateco?: string;
  created_at: string;
  clients?: {
    indirizzo?: string;
    data_costituzione?: string;
  };
  kpi?: {
    anno_esercizio?: number;
    ricavi_vendite?: number;
    totale_patrimonio_netto?: number;
    fatturato?: number;
    ebitda?: number;
    dscr?: number;
    pfn?: number;
    patrimonio_netto?: number;
    kpi?: Record<string, number>;
  };
  myRequest?: { status: string; id: string };
}

interface ReceivedPractice {
  requestId: string;
  requestDate: string;
  approvedDate: string;
  noteBanca?: string;
  segreteriaNome?: string;
  segreteriaEmail?: string;
  practice: {
    id: string;
    numero_pratica: string;
    importo_richiesto?: number;
    motivazione?: string;
    status: string;
    created_at: string;
    clients?: {
      ragione_sociale?: string;
      piva?: string;
      codice_fiscale?: string;
      indirizzo?: string;
      telefono?: string;
      email?: string;
      data_costituzione?: string;
    };
    kpi?: {
      anno_esercizio?: number;
      ricavi_vendite?: number;
      totale_patrimonio_netto?: number;
      fatturato?: number;
      ebitda?: number;
      dscr?: number;
      pfn?: number;
      patrimonio_netto?: number;
      kpi?: Record<string, number>;
    };
  };
}

/* ─── Helpers ─── */
const VISIBLE_STATUSES = ['raccolta_documenti', 'inviata_banca', 'integrazioni_richieste', 'completata', 'approvata'];

const STATUS_LABEL: Record<string, string> = {
  raccolta_documenti: 'Raccolta Documenti',
  inviata_banca: 'Inviata alla Banca',
  integrazioni_richieste: 'Integrazioni',
  completata: 'Completa',
  approvata: 'Approvata',
  bozza: 'Bozza',
  rifiutata: 'Rifiutata',
  declinata: 'Declinata',
};

const STATUS_COLOR: Record<string, string> = {
  raccolta_documenti: 'bg-blue-100 text-blue-800',
  inviata_banca: 'bg-purple-100 text-purple-800',
  integrazioni_richieste: 'bg-amber-100 text-amber-800',
  completata: 'bg-green-100 text-green-800',
  approvata: 'bg-emerald-100 text-emerald-800',
  rifiutata: 'bg-red-100 text-red-800',
  declinata: 'bg-rose-100 text-rose-800',
  bozza: 'bg-slate-100 text-slate-600',
};

const fmt = (n?: number | null) =>
  n != null ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n) : '—';

const fmtN = (n?: unknown, decimals = 2) => {
  const num = Number(n);
  return n != null && !isNaN(num) ? num.toFixed(decimals) : '—';
};

/* ─── Component ─── */
export default function BancaPortalPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'disponibili' | 'ricevute'>('disponibili');
  const [practices, setPractices] = useState<AnonymousPractice[]>([]);
  const [received, setReceived] = useState<ReceivedPractice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingReceived, setLoadingReceived] = useState(false);
  const [bankId, setBankId] = useState<string | null>(null);
  const [bankNome, setBankNome] = useState<string>('');
  const [selected, setSelected] = useState<AnonymousPractice | null>(null);
  const [notaBanca, setNotaBanca] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);

  /* Carica bank_id dalla tabella banks */
  useEffect(() => {
    if (!user) return;
    supabase
      .from('banks')
      .select('id, nome')
      .eq('bank_user_id', user.id)
      .limit(1)
      .then(({ data, error }) => {
        const record = data?.[0] ?? null;
        if (record) {
          setBankId(record.id);
          setBankNome(record.nome);
        } else {
          // Nessuna banca trovata per questo utente — ferma lo spinner
          setLoading(false);
          if (error) {
            console.error('Errore caricamento banca:', error);
            setDebugInfo('Errore banca: ' + error.message);
          } else {
            setDebugInfo('Nessuna banca associata a user.id=' + user.id);
          }
        }
      });
  }, [user]);

  /* Pratiche disponibili (anonime) */
  const loadDisponibili = async () => {
    if (!bankId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: pData, error: pErr } = await supabase
        .from('practices')
        .select('id, numero_pratica, importo_richiesto, motivazione, status, codice_ateco, created_at, clients(indirizzo, data_costituzione)')
        .in('status', VISIBLE_STATUSES)
        .order('created_at', { ascending: false });

      if (pErr) { console.error('Errore practices:', pErr); setDebugInfo('Errore practices: ' + pErr.message); }

      const pList = (pData ?? []) as AnonymousPractice[];

      const { data: kpiData, error: kpiErr } = await supabase
        .from('bilanci_kpi')
        .select('practice_id, anno_esercizio, ricavi_vendite, totale_patrimonio_netto, kpi')
        .in('practice_id', pList.length ? pList.map(p => p.id) : ['00000000-0000-0000-0000-000000000000'])
        .order('anno_esercizio', { ascending: false });

      if (kpiErr) console.error('Errore bilanci_kpi:', kpiErr);

      const { data: reqData, error: reqErr } = await supabase
        .from('bank_interest_requests')
        .select('id, practice_id, status')
        .eq('bank_id', bankId);

      if (reqErr) console.error('Errore bank_interest_requests:', reqErr);

      const kpiMap: Record<string, AnonymousPractice['kpi']> = {};
      (kpiData ?? []).forEach(k => { if (!kpiMap[k.practice_id]) kpiMap[k.practice_id] = k; });

      const reqMap: Record<string, { status: string; id: string }> = {};
      (reqData ?? []).forEach(r => { reqMap[r.practice_id] = { status: r.status, id: r.id }; });

      setPractices(pList.map(p => ({ ...p, kpi: kpiMap[p.id], myRequest: reqMap[p.id] })));
    } finally {
      setLoading(false);
    }
  };

  /* Pratiche ricevute (dati completi) */
  const loadRicevute = async () => {
    if (!bankId) return;
    setLoadingReceived(true);
    try {
      // 1. Richieste approvate
      const { data: reqData } = await supabase
        .from('bank_interest_requests')
        .select('id, practice_id, note_banca, handled_by, created_at, updated_at')
        .eq('bank_id', bankId)
        .eq('status', 'approvata')
        .order('updated_at', { ascending: false });

      if (!reqData?.length) { setReceived([]); return; }

      const practiceIds = reqData.map(r => r.practice_id);
      const handledByIds = [...new Set(reqData.map(r => r.handled_by).filter(Boolean))];

      // 2. Pratiche con dati completi
      const { data: pData } = await supabase
        .from('practices')
        .select('id, numero_pratica, importo_richiesto, motivazione, status, codice_ateco, created_at, clients(ragione_sociale, piva, codice_fiscale, indirizzo, telefono, email, data_costituzione)')
        .in('id', practiceIds);

      // 3. KPI (anno più recente per pratica)
      const { data: kpiData } = await supabase
        .from('bilanci_kpi')
        .select('practice_id, anno_esercizio, ricavi_vendite, totale_patrimonio_netto, kpi')
        .in('practice_id', practiceIds)
        .order('anno_esercizio', { ascending: false });

      // 4. Profili segreteria
      const segMap: Record<string, { nome?: string; email?: string }> = {};
      if (handledByIds.length) {
        const { data: sData } = await supabase
          .from('admin_profiles')
          .select('id, nome, email')
          .in('id', handledByIds);
        (sData ?? []).forEach(s => { segMap[s.id] = { nome: s.nome, email: s.email }; });
      }

      const kpiMap: Record<string, typeof kpiData extends (infer T)[] | null ? T : never> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (kpiData ?? []).forEach((k: any) => { if (!kpiMap[k.practice_id]) kpiMap[k.practice_id] = k; });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pMap: Record<string, any> = {};
      (pData ?? []).forEach(p => { pMap[p.id] = p; });

      const result: ReceivedPractice[] = reqData.map(r => ({
        requestId: r.id,
        requestDate: r.created_at,
        approvedDate: r.updated_at,
        noteBanca: r.note_banca,
        segreteriaNome: segMap[r.handled_by]?.nome,
        segreteriaEmail: segMap[r.handled_by]?.email,
        practice: {
          ...pMap[r.practice_id],
          kpi: kpiMap[r.practice_id],
        },
      }));

      setReceived(result);
    } finally {
      setLoadingReceived(false);
    }
  };

  useEffect(() => { loadDisponibili(); }, [bankId]);
  useEffect(() => { if (activeTab === 'ricevute') loadRicevute(); }, [activeTab, bankId]);

  const handleRequest = async () => {
    if (!selected || !bankId || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('bank_interest_requests').insert({
        practice_id: selected.id,
        bank_id: bankId,
        requested_by: user.id,
        note_banca: notaBanca.trim() || null,
        status: 'in_attesa',
      });
      if (error) { toast.error('Errore: ' + error.message); return; }
      toast.success('Richiesta inviata! La segreteria riceverà una notifica.');
      setSelected(null);
      setNotaBanca('');
      loadDisponibili();
    } finally {
      setSubmitting(false);
    }
  };

  const RequestBadge = ({ req }: { req?: { status: string } }) => {
    if (!req) return null;
    const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
      in_attesa: { label: 'In attesa', color: 'bg-amber-100 text-amber-800', icon: <Clock className="w-3 h-3" /> },
      approvata: { label: 'Documenti inviati', color: 'bg-green-100 text-green-800', icon: <CheckCircle className="w-3 h-3" /> },
      rifiutata: { label: 'Rifiutata', color: 'bg-red-100 text-red-800', icon: <XCircle className="w-3 h-3" /> },
    };
    const s = map[req.status] ?? { label: req.status, color: 'bg-muted text-muted-foreground', icon: null };
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${s.color}`}>
        {s.icon}{s.label}
      </span>
    );
  };

  /* Account non configurato */
  if (!bankId && !loading) {
    return (
      <BancaLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
          <Building className="w-12 h-12 text-slate-300" />
          <h2 className="text-xl font-semibold text-slate-700">Account non configurato</h2>
          <p className="text-slate-500 max-w-sm">Questo account non è ancora associato a nessuna banca. Contatta l'amministratore.</p>
          {debugInfo && (
            <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2 max-w-sm font-mono break-all">
              {debugInfo}
            </p>
          )}
        </div>
      </BancaLayout>
    );
  }

  const ricevuteCount = received.length;

  return (
    <BancaLayout>
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              {bankNome && <span className="text-blue-700">{bankNome}</span>}
            </h1>
            <p className="text-slate-500 mt-0.5 text-sm">Portale pratiche finanziarie</p>
          </div>
          <Button
            variant="outline" size="sm"
            onClick={() => { if (activeTab === 'disponibili') loadDisponibili(); else loadRicevute(); }}
            className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 mb-6 gap-1">
        <button
          onClick={() => setActiveTab('disponibili')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'disponibili'
              ? 'border-blue-600 text-blue-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}>
          <Search className="w-4 h-4" />
          Pratiche Disponibili
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'disponibili' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
            {practices.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab('ricevute')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'ricevute'
              ? 'border-green-600 text-green-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}>
          <Inbox className="w-4 h-4" />
          Pratiche Ricevute
          {ricevuteCount > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'ricevute' ? 'bg-green-100 text-green-700' : 'bg-green-100 text-green-700'}`}>
              {ricevuteCount}
            </span>
          )}
        </button>
      </div>

      {/* ── TAB: Pratiche Disponibili ── */}
      {activeTab === 'disponibili' && (
        <>
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-700">
            ℹ️ I dati aziendali (ragione sociale, P.IVA) sono riservati. Richiedi i documenti per visualizzarli nella sezione <strong>Pratiche Ricevute</strong>.
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : practices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <BarChart2 className="w-10 h-10 text-slate-300" />
              <p className="text-slate-500">Nessuna pratica disponibile al momento.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {practices.map(p => {
                const ateco = p.codice_ateco;
                const indirizzo = p.clients?.indirizzo;
                const hasKpi = !!p.kpi;
                const alreadyRequested = !!p.myRequest;

                return (
                  <Card key={p.id} className="border border-slate-200 hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base font-semibold text-slate-700">
                            Pratica #{p.numero_pratica}
                          </CardTitle>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {new Date(p.created_at).toLocaleDateString('it-IT')}
                          </p>
                        </div>
                        <Badge variant="outline" className={`text-xs shrink-0 ${STATUS_COLOR[p.status] ?? ''}`}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                      </div>
                      {p.myRequest && (
                        <div className="mt-1"><RequestBadge req={p.myRequest} /></div>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {indirizzo && (
                          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                            <MapPin className="w-3 h-3" /> {indirizzo}
                          </span>
                        )}
                        {ateco && (
                          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                            🏭 ATECO {ateco}
                          </span>
                        )}
                      </div>

                      {p.importo_richiesto && (
                        <div className="flex items-center gap-2 bg-blue-50 rounded-md px-3 py-2">
                          <Euro className="w-4 h-4 text-blue-500 shrink-0" />
                          <div>
                            <p className="text-xs text-blue-600 font-medium">Importo richiesto</p>
                            <p className="text-sm font-bold text-blue-800">{fmt(p.importo_richiesto)}</p>
                          </div>
                        </div>
                      )}

                      {hasKpi && (
                        <div className="grid grid-cols-2 gap-2">
                          {p.kpi?.ricavi_vendite != null && (
                            <div className="bg-green-50 rounded-md px-3 py-2">
                              <p className="text-xs text-green-600">Fatturato</p>
                              <p className="text-sm font-bold text-green-800">{fmt(p.kpi.ricavi_vendite)}</p>
                              {p.kpi.anno_esercizio && <p className="text-xs text-green-500">Anno {p.kpi.anno_esercizio}</p>}
                            </div>
                          )}
                          {p.kpi?.totale_patrimonio_netto != null && (
                            <div className="bg-emerald-50 rounded-md px-3 py-2">
                              <p className="text-xs text-emerald-600">Patrimonio Netto</p>
                              <p className="text-sm font-bold text-emerald-800">{fmt(p.kpi.totale_patrimonio_netto)}</p>
                            </div>
                          )}
                          {p.kpi?.kpi?.redditivita != null && (
                            <div className="bg-purple-50 rounded-md px-3 py-2">
                              <p className="text-xs text-purple-600">Redditività</p>
                              <p className="text-sm font-bold text-purple-800">{fmtN(p.kpi.kpi.redditivita)}%</p>
                            </div>
                          )}
                          {p.kpi?.kpi?.indebitamento != null && (
                            <div className="bg-orange-50 rounded-md px-3 py-2">
                              <p className="text-xs text-orange-600">Indebitamento</p>
                              <p className="text-sm font-bold text-orange-800">{fmtN(p.kpi.kpi.indebitamento)}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {!hasKpi && (
                        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 rounded-md px-3 py-2">
                          <TrendingUp className="w-3 h-3" />
                          <span>Dati finanziari non ancora disponibili</span>
                        </div>
                      )}

                      {!alreadyRequested ? (
                        <Button
                          className="w-full gap-1.5 bg-blue-600 hover:bg-blue-700" size="sm"
                          onClick={() => { setSelected(p); setNotaBanca(''); }}>
                          <Send className="w-3.5 h-3.5" /> Richiedi Documenti
                        </Button>
                      ) : p.myRequest?.status === 'in_attesa' ? (
                        <div className="text-center text-xs text-amber-600 bg-amber-50 rounded-md py-2">
                          ⏳ In attesa di approvazione segreteria
                        </div>
                      ) : p.myRequest?.status === 'approvata' ? (
                        <div
                          className="text-center text-xs text-green-600 bg-green-50 rounded-md py-2 cursor-pointer hover:bg-green-100"
                          onClick={() => setActiveTab('ricevute')}
                          title="Vai a Pratiche Ricevute">
                          ✅ Documenti ricevuti — vedi in <strong>Pratiche Ricevute</strong>
                        </div>
                      ) : (
                        <div className="text-center text-xs text-red-600 bg-red-50 rounded-md py-2">
                          ❌ Richiesta rifiutata
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── TAB: Pratiche Ricevute ── */}
      {activeTab === 'ricevute' && (
        <>
          <div className="mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700">
            ✅ Le pratiche qui riportate sono state approvate e inviate dalla segreteria competente.
          </div>

          {loadingReceived ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : received.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <Inbox className="w-10 h-10 text-slate-300" />
              <p className="text-slate-600 font-medium">Nessuna pratica ricevuta ancora</p>
              <p className="text-slate-400 text-sm max-w-xs">Le pratiche appariranno qui dopo che la segreteria avrà approvato le tue richieste.</p>
              <Button variant="outline" size="sm" onClick={() => setActiveTab('disponibili')} className="mt-2 gap-1.5">
                <Search className="w-3.5 h-3.5" /> Sfoglia Pratiche Disponibili
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {received.map(r => {
                const c = r.practice?.clients;
                const kpi = r.practice?.kpi;
                return (
                  <Card key={r.requestId} className="border border-green-200 shadow-sm">
                    {/* Card header */}
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle className="text-base font-bold text-slate-800">
                              {c?.ragione_sociale ?? '—'}
                            </CardTitle>
                            <Badge variant="outline" className={`text-xs ${STATUS_COLOR[r.practice?.status] ?? ''}`}>
                              {STATUS_LABEL[r.practice?.status] ?? r.practice?.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-500 font-mono mt-0.5">#{r.practice?.numero_pratica}</p>
                        </div>
                        {/* Segreteria mittente */}
                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs">
                          <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <div>
                            <p className="text-slate-500">Inviata da</p>
                            <p className="font-semibold text-slate-700">{r.segreteriaNome ?? 'Segreteria'}</p>
                            {r.segreteriaEmail && <p className="text-slate-400">{r.segreteriaEmail}</p>}
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-slate-400 mt-1">
                        Ricevuta il {new Date(r.approvedDate).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </p>
                    </CardHeader>

                    <CardContent className="space-y-4">
                      {/* Dati aziendali */}
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Building className="w-3.5 h-3.5" /> Dati Aziendali
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                          {c?.piva && (
                            <div>
                              <p className="text-xs text-slate-400">P.IVA</p>
                              <p className="text-sm font-medium text-slate-700">{c.piva}</p>
                            </div>
                          )}
                          {c?.codice_fiscale && (
                            <div>
                              <p className="text-xs text-slate-400">Codice Fiscale</p>
                              <p className="text-sm font-medium text-slate-700">{c.codice_fiscale}</p>
                            </div>
                          )}
                          {c?.data_costituzione && (
                            <div>
                              <p className="text-xs text-slate-400">Data Costituzione</p>
                              <p className="text-sm font-medium text-slate-700">{new Date(c.data_costituzione).toLocaleDateString('it-IT')}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Sede */}
                      {c?.indirizzo && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" /> Sede
                          </p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
                            {c?.indirizzo && <span>{c.indirizzo}</span>}
                          </div>
                        </div>
                      )}

                      {/* Contatti */}
                      {(c?.telefono || c?.email) && (
                        <div className="flex flex-wrap gap-4">
                          {c?.telefono && (
                            <div className="flex items-center gap-1.5 text-sm text-slate-600">
                              <Phone className="w-3.5 h-3.5 text-slate-400" /> {c.telefono}
                            </div>
                          )}
                          {c?.email && (
                            <div className="flex items-center gap-1.5 text-sm text-slate-600">
                              <Mail className="w-3.5 h-3.5 text-slate-400" /> {c.email}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Pratica */}
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5" /> Pratica Finanziaria
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-2">
                          {r.practice?.importo_richiesto != null && (
                            <div className="bg-blue-50 rounded-md px-3 py-2">
                              <p className="text-xs text-blue-600">Importo Richiesto</p>
                              <p className="text-sm font-bold text-blue-800">{fmt(r.practice.importo_richiesto)}</p>
                            </div>
                          )}
                          <div>
                            <p className="text-xs text-slate-400 flex items-center gap-1"><Calendar className="w-3 h-3" /> Creata il</p>
                            <p className="text-sm font-medium text-slate-700">
                              {new Date(r.practice?.created_at).toLocaleDateString('it-IT')}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-400 flex items-center gap-1"><Hash className="w-3 h-3" /> Numero</p>
                            <p className="text-sm font-medium text-slate-700 font-mono">#{r.practice?.numero_pratica}</p>
                          </div>
                        </div>
                        {r.practice?.motivazione && (
                          <div className="mt-2 bg-slate-50 rounded-md px-3 py-2 text-sm text-slate-600">
                            <span className="text-xs text-slate-400 block mb-0.5">Motivazione</span>
                            {r.practice.motivazione}
                          </div>
                        )}
                      </div>

                      {/* KPI */}
                      {kpi && (
                        <div>
                          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1">
                            <Landmark className="w-3.5 h-3.5" /> KPI Finanziari
                            {kpi.anno_esercizio && <span className="text-slate-400 font-normal ml-1">(Anno {kpi.anno_esercizio})</span>}
                          </p>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {kpi.fatturato != null && (
                              <div className="bg-green-50 rounded-md px-3 py-2">
                                <p className="text-xs text-green-600">Fatturato</p>
                                <p className="text-sm font-bold text-green-800">{fmt(kpi.fatturato)}</p>
                              </div>
                            )}
                            {kpi.ebitda != null && (
                              <div className="bg-emerald-50 rounded-md px-3 py-2">
                                <p className="text-xs text-emerald-600">EBITDA</p>
                                <p className="text-sm font-bold text-emerald-800">{fmt(kpi.ebitda)}</p>
                              </div>
                            )}
                            {kpi.dscr != null && (
                              <div className="bg-purple-50 rounded-md px-3 py-2">
                                <p className="text-xs text-purple-600">DSCR</p>
                                <p className="text-sm font-bold text-purple-800">{fmtN(kpi.dscr)}</p>
                              </div>
                            )}
                            {kpi.pfn != null && (
                              <div className="bg-orange-50 rounded-md px-3 py-2">
                                <p className="text-xs text-orange-600">PFN</p>
                                <p className="text-sm font-bold text-orange-800">{fmt(kpi.pfn)}</p>
                              </div>
                            )}
                            {kpi.patrimonio_netto != null && (
                              <div className="bg-sky-50 rounded-md px-3 py-2">
                                <p className="text-xs text-sky-600">Patrimonio Netto</p>
                                <p className="text-sm font-bold text-sky-800">{fmt(kpi.patrimonio_netto)}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Note banca */}
                      {r.noteBanca && (
                        <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-xs text-slate-500 italic">
                          📝 Note richiesta: "{r.noteBanca}"
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Dialog conferma richiesta */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>📩 Richiedi Documenti</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              Stai richiedendo i documenti per la pratica <strong>#{selected?.numero_pratica}</strong>.
              La segreteria competente riceverà una notifica e valuterà l'invio.
            </p>
            <div className="space-y-2">
              <Label>Note alla segreteria (opzionale)</Label>
              <Textarea
                placeholder="Es. interesse per mutuo ipotecario, specificare eventuale prodotto..."
                rows={3}
                value={notaBanca}
                onChange={e => setNotaBanca(e.target.value)}
              />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500">
              Se approvata, la pratica apparirà nella sezione <strong>Pratiche Ricevute</strong> con tutti i dati aziendali.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Annulla</Button>
            <Button onClick={handleRequest} disabled={submitting} className="bg-blue-600 hover:bg-blue-700 gap-1.5">
              <Send className="w-3.5 h-3.5" />
              {submitting ? 'Invio...' : 'Invia Richiesta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BancaLayout>
  );
}
