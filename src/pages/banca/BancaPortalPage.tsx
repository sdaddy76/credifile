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
import { MapPin, BarChart2, Euro, TrendingUp, Clock, CheckCircle, XCircle, Send, Building, RefreshCw, LogOut, Building2 } from 'lucide-react';

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

interface AnonymousPractice {
  id: string;
  numero_pratica: string;
  importo_richiesto?: number;
  motivazione?: string;
  status: string;
  codice_ateco?: string;
  created_at: string;
  clients?: {
    citta?: string;
    cap?: string;
    codice_ateco?: string;
    settore?: string;
    forma_giuridica?: string;
    anno_costituzione?: string;
  };
  kpi?: {
    anno?: number;
    fatturato?: number;
    dscr?: number;
    pfn?: number;
    ebitda?: number;
    patrimonio_netto?: number;
  };
  myRequest?: { status: string; id: string };
}

const VISIBLE_STATUSES = ['raccolta_documenti', 'inviata_banca', 'integrazioni_richieste', 'completata', 'approvata'];

const STATUS_LABEL: Record<string, string> = {
  raccolta_documenti: 'Raccolta Documenti',
  inviata_banca: 'Inviata alla Banca',
  integrazioni_richieste: 'Integrazioni',
  completata: 'Completa',
  approvata: 'Approvata',
};

const fmt = (n?: number | null) =>
  n != null ? new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n) : '—';

const fmtN = (n?: number | null, decimals = 2) =>
  n != null ? n.toFixed(decimals) : '—';

export default function BancaPortalPage() {
  const { user } = useAuth();
  const [practices, setPractices] = useState<AnonymousPractice[]>([]);
  const [loading, setLoading] = useState(true);
  const [bankId, setBankId] = useState<string | null>(null);
  const [bankNome, setBankNome] = useState<string>('');
  const [selected, setSelected] = useState<AnonymousPractice | null>(null);
  const [notaBanca, setNotaBanca] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Carica bank_id dalla tabella banks tramite bank_user_id
  useEffect(() => {
    if (!user) return;
    supabase
      .from('banks')
      .select('id, nome')
      .eq('bank_user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) { setBankId(data.id); setBankNome(data.nome); }
      });
  }, [user]);

  const load = async () => {
    if (!bankId) return;
    setLoading(true);
    try {
      // Pratiche visibili
      const { data: pData } = await supabase
        .from('practices')
        .select('id, numero_pratica, importo_richiesto, motivazione, status, codice_ateco, created_at, clients(citta, cap, codice_ateco, settore, forma_giuridica, anno_costituzione)')
        .in('status', VISIBLE_STATUSES)
        .order('created_at', { ascending: false });

      const pList = (pData ?? []) as AnonymousPractice[];

      // KPI (bilanci_kpi) — prendo l'anno più recente per ogni practice
      const { data: kpiData } = await supabase
        .from('bilanci_kpi')
        .select('practice_id, anno, fatturato, dscr, pfn, ebitda, patrimonio_netto')
        .in('practice_id', pList.map(p => p.id))
        .order('anno', { ascending: false });

      // Mie richieste
      const { data: reqData } = await supabase
        .from('bank_interest_requests')
        .select('id, practice_id, status')
        .eq('bank_id', bankId);

      const kpiMap: Record<string, AnonymousPractice['kpi']> = {};
      (kpiData ?? []).forEach(k => {
        if (!kpiMap[k.practice_id]) kpiMap[k.practice_id] = k;
      });

      const reqMap: Record<string, { status: string; id: string }> = {};
      (reqData ?? []).forEach(r => { reqMap[r.practice_id] = { status: r.status, id: r.id }; });

      const enriched = pList.map(p => ({
        ...p,
        kpi: kpiMap[p.id],
        myRequest: reqMap[p.id],
      }));

      setPractices(enriched);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [bankId]);

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
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const RequestBadge = ({ req }: { req?: { status: string } }) => {
    if (!req) return null;
    const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
      in_attesa:  { label: 'Richiesta in attesa',  color: 'bg-amber-100 text-amber-800',   icon: <Clock className="w-3 h-3" /> },
      approvata:  { label: 'Documenti inviati',     color: 'bg-green-100 text-green-800',   icon: <CheckCircle className="w-3 h-3" /> },
      rifiutata:  { label: 'Richiesta rifiutata',   color: 'bg-red-100 text-red-800',       icon: <XCircle className="w-3 h-3" /> },
    };
    const s = map[req.status] ?? { label: req.status, color: 'bg-muted text-muted-foreground', icon: null };
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${s.color}`}>
        {s.icon}{s.label}
      </span>
    );
  };

  if (!bankId && !loading) {
    return (
      <BancaLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
          <Building className="w-12 h-12 text-slate-300" />
          <h2 className="text-xl font-semibold text-slate-700">Account non configurato</h2>
          <p className="text-slate-500 max-w-sm">Questo account non è ancora associato a nessuna banca. Contatta l'amministratore.</p>
        </div>
      </BancaLayout>
    );
  }

  return (
    <BancaLayout>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Pratiche Disponibili</h1>
            <p className="text-slate-500 mt-1 text-sm">
              {bankNome && <span className="font-medium text-blue-700">{bankNome}</span>} · I dati anagrafici delle aziende sono riservati. Richiedere i documenti per visualizzarli.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Aggiorna
          </Button>
        </div>
        <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 text-sm text-blue-700">
          ℹ️ Le informazioni aziendali (ragione sociale, P.IVA, indirizzo) sono visibili solo dopo l'invio dei documenti da parte della segreteria.
        </div>
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
            const ateco = p.clients?.codice_ateco || p.codice_ateco;
            const citta = p.clients?.citta;
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
                    <Badge variant="outline" className="text-xs shrink-0">
                      {STATUS_LABEL[p.status] ?? p.status}
                    </Badge>
                  </div>
                  {p.myRequest && (
                    <div className="mt-1">
                      <RequestBadge req={p.myRequest} />
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Dati geografici / settore */}
                  <div className="flex flex-wrap gap-2">
                    {citta && (
                      <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                        <MapPin className="w-3 h-3" /> {citta}
                      </span>
                    )}
                    {ateco && (
                      <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                        🏭 ATECO {ateco}
                      </span>
                    )}
                    {p.clients?.forma_giuridica && (
                      <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                        {p.clients.forma_giuridica}
                      </span>
                    )}
                  </div>

                  {/* Importo richiesto */}
                  {p.importo_richiesto && (
                    <div className="flex items-center gap-2 bg-blue-50 rounded-md px-3 py-2">
                      <Euro className="w-4 h-4 text-blue-500 shrink-0" />
                      <div>
                        <p className="text-xs text-blue-600 font-medium">Importo richiesto</p>
                        <p className="text-sm font-bold text-blue-800">{fmt(p.importo_richiesto)}</p>
                      </div>
                    </div>
                  )}

                  {/* KPI */}
                  {hasKpi && (
                    <div className="grid grid-cols-2 gap-2">
                      {p.kpi?.fatturato != null && (
                        <div className="bg-green-50 rounded-md px-3 py-2">
                          <p className="text-xs text-green-600">Fatturato</p>
                          <p className="text-sm font-bold text-green-800">{fmt(p.kpi.fatturato)}</p>
                          {p.kpi.anno && <p className="text-xs text-green-500">Anno {p.kpi.anno}</p>}
                        </div>
                      )}
                      {p.kpi?.ebitda != null && (
                        <div className="bg-emerald-50 rounded-md px-3 py-2">
                          <p className="text-xs text-emerald-600">EBITDA</p>
                          <p className="text-sm font-bold text-emerald-800">{fmt(p.kpi.ebitda)}</p>
                        </div>
                      )}
                      {p.kpi?.dscr != null && (
                        <div className="bg-purple-50 rounded-md px-3 py-2">
                          <p className="text-xs text-purple-600">DSCR</p>
                          <p className="text-sm font-bold text-purple-800">{fmtN(p.kpi.dscr)}</p>
                        </div>
                      )}
                      {p.kpi?.pfn != null && (
                        <div className="bg-orange-50 rounded-md px-3 py-2">
                          <p className="text-xs text-orange-600">PFN</p>
                          <p className="text-sm font-bold text-orange-800">{fmt(p.kpi.pfn)}</p>
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

                  {/* Pulsante */}
                  {!alreadyRequested ? (
                    <Button
                      className="w-full gap-1.5 bg-blue-600 hover:bg-blue-700"
                      size="sm"
                      onClick={() => { setSelected(p); setNotaBanca(''); }}>
                      <Send className="w-3.5 h-3.5" /> Richiedi Documenti
                    </Button>
                  ) : p.myRequest?.status === 'in_attesa' ? (
                    <div className="text-center text-xs text-amber-600 bg-amber-50 rounded-md py-2">
                      ⏳ Richiesta inviata — in attesa di approvazione segreteria
                    </div>
                  ) : p.myRequest?.status === 'approvata' ? (
                    <div className="text-center text-xs text-green-600 bg-green-50 rounded-md py-2">
                      ✅ Documenti inviati via email
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
              Dopo l'invio, la segreteria validerà la richiesta. Se approvata, riceverai i documenti completi all'email della tua banca.
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
