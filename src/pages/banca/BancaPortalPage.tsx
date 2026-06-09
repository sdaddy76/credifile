import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  MapPin, BarChart2, Euro, TrendingUp, Clock, CheckCircle, XCircle,
  Send, Building, RefreshCw, LogOut, Building2, Inbox, Search,
  FileText, User, Phone, Mail, Calendar, Hash, Landmark, Heart,
  SlidersHorizontal, GitCompare, X as XIcon, Settings, Save, Loader2,
} from 'lucide-react';
import { jsPDF } from 'jspdf';

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
interface KpiEntry { valore: number | null; formatted: string; semaforo: string; label: string }
interface KpiAreas {
  liquidita?:     Record<string, KpiEntry>;
  solidita?:      Record<string, KpiEntry>;
  redditivita?:   Record<string, KpiEntry>;
  indebitamento?: Record<string, KpiEntry>;
  efficienza?:    Record<string, KpiEntry>;
  copertura?:     Record<string, KpiEntry>;
}

interface AnonymousPractice {
  id: string;
  numero_pratica: string;
  importo_richiesto?: number;
  motivazione?: string;
  status: string;
  codice_ateco?: string;
  created_at: string;
  clients?: { indirizzo?: string };
  kpi?: {
    anno_esercizio?: number;
    ricavi_vendite?: number;
    totale_patrimonio_netto?: number;
    kpi?: KpiAreas;
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

/** Estrae solo la città dall'indirizzo visura (formato: "ROMA (RM) VIA...") */
function extractCity(indirizzo?: string): string | null {
  if (!indirizzo) return null;
  // La città è all'inizio, prima della sigla provincia tra parentesi
  const m = indirizzo.match(/^([A-ZÀÈÉÌÒÙA-Za-zÀÈÉÌÒÙàèéìòù][A-Za-zÀÈÉÌÒÙàèéìòù\s\-']{1,40}?)\s*\([A-Z]{2}\)/);
  if (m?.[1]) return m[1].trim();
  return null;
}

/** Estrae il codice ATECO dall'indirizzo visura (formato: "Codice ATECO 68.11.00" o "Codice: 68.11.00") */
function extractAteco(indirizzo?: string, fallback?: string): string | null {
  if (fallback) return fallback;
  if (!indirizzo) return null;
  const m = indirizzo.match(/(?:ATECO|attivit[àa])[^\d]*(\d{2}[.\-]\d{2}(?:[.\-]\d{1,2})?)/i);
  if (m?.[1]) return m[1];
  return null;
}

const SEMAFORO_STYLE: Record<string, string> = {
  verde:  'bg-green-50 text-green-800 border-green-200',
  giallo: 'bg-amber-50 text-amber-800 border-amber-200',
  rosso:  'bg-red-50 text-red-800 border-red-200',
  nd:     'bg-slate-50 text-slate-500 border-slate-200',
};
const SEMAFORO_DOT: Record<string, string> = {
  verde: 'bg-green-500', giallo: 'bg-amber-400', rosso: 'bg-red-500', nd: 'bg-slate-300',
};
const AREA_LABEL: Record<string, string> = {
  liquidita:     '💧 Liquidità',
  solidita:      '🏛️ Solidità',
  redditivita:   '📈 Redditività',
  indebitamento: '💳 Indebitamento',
  efficienza:    '⚙️ Efficienza',
  copertura:     '🛡️ Copertura',
};

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

/* ─── NotifSettings interface (fuori dal componente per evitare problemi Vite) ─── */
interface NotifSettings {
  notifica_nuove: boolean;
  email: string;
  importo_min: string;
  importo_max: string;
  ateco_filter: string;
}

/* ─── Component ─── */
export default function BancaPortalPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'disponibili' | 'ricevute' | 'preferiti'>('disponibili');
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

  /* ── Impostazioni Notifiche ── */
  const [notifSettings, setNotifSettings] = useState<NotifSettings>({
    notifica_nuove: true,
    email: '',
    importo_min: '',
    importo_max: '',
    ateco_filter: '',
  });
  const [notifSettingsId, setNotifSettingsId] = useState<string | null>(null);
  const [savingNotif, setSavingNotif] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  /* ── Filtri ── */
  const [filters, setFilters] = useState({ city: '', ateco: '', importoMin: 0, soloConKpi: 'tutti' });

  /* ── Watchlist ── */
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());

  /* ── Confronto ── */
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

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
        .select('id, numero_pratica, importo_richiesto, motivazione, status, codice_ateco, created_at, clients(indirizzo)')
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

  /* ── Carica impostazioni notifiche ── */
  const loadNotifSettings = async () => {
    if (!bankId) return;
    try {
      const { data, error } = await supabase
        .from('bank_notification_settings')
        .select('*')
        .eq('bank_id', bankId)
        .maybeSingle();
      if (error) {
        console.error('Errore caricamento impostazioni notifiche:', error);
        return;
      }
      if (data) {
        setNotifSettingsId(data.id);
        setNotifSettings({
          notifica_nuove: data.notifica_nuove ?? true,
          email: data.email ?? user?.email ?? '',
          importo_min: data.importo_min != null ? String(data.importo_min) : '',
          importo_max: data.importo_max != null ? String(data.importo_max) : '',
          ateco_filter: Array.isArray(data.ateco_filter) ? data.ateco_filter.join(', ') : (data.ateco_filter ?? ''),
        });
      } else {
        // Nessuna impostazione: pre-popola email utente
        setNotifSettings(prev => ({ ...prev, email: user?.email ?? '' }));
      }
    } catch (err) {
      console.error('Eccezione in loadNotifSettings:', err);
    }
  };

  useEffect(() => { if (bankId) loadNotifSettings(); }, [bankId]);

  const saveNotifSettings = async () => {
    if (!bankId) return;
    setSavingNotif(true);
    try {
      const atecoArr = notifSettings.ateco_filter
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const payload = {
        bank_id: bankId,
        notifica_nuove: notifSettings.notifica_nuove,
        email: notifSettings.email.trim() || null,
        importo_min: notifSettings.importo_min !== '' ? Number(notifSettings.importo_min) : null,
        importo_max: notifSettings.importo_max !== '' ? Number(notifSettings.importo_max) : null,
        ateco_filter: atecoArr.length > 0 ? atecoArr : null,
      };
      let error;
      if (notifSettingsId) {
        ({ error } = await supabase
          .from('bank_notification_settings')
          .update(payload)
          .eq('id', notifSettingsId));
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from('bank_notification_settings')
          .insert(payload)
          .select('id')
          .single();
        error = insertErr;
        if (inserted?.id) setNotifSettingsId(inserted.id);
      }
      if (error) { toast.error('Errore salvataggio: ' + error.message); return; }
      toast.success('Impostazioni notifiche salvate');
    } finally {
      setSavingNotif(false);
    }
  };

  /* ── Carica watchlist al mount ── */
  useEffect(() => {
    if (!bankId) return;
    supabase
      .from('bank_watchlist')
      .select('practice_id')
      .eq('bank_id', bankId)
      .then(({ data }) => {
        if (data) setWatchlist(new Set(data.map((r: { practice_id: string }) => r.practice_id)));
      });
  }, [bankId]);

  /* ── Toggle watchlist ── */
  const toggleWatchlist = async (practiceId: string) => {
    if (!bankId) return;
    const isInList = watchlist.has(practiceId);
    if (isInList) {
      await supabase.from('bank_watchlist').delete().eq('bank_id', bankId).eq('practice_id', practiceId);
      setWatchlist(prev => { const next = new Set(prev); next.delete(practiceId); return next; });
    } else {
      await supabase.from('bank_watchlist').insert({ bank_id: bankId, practice_id: practiceId });
      setWatchlist(prev => new Set([...prev, practiceId]));
    }
  };

  /* ── Pratiche filtrate (useMemo) ── */
  const filteredPractices = useMemo(() => {
    return practices.filter(p => {
      const city  = extractCity(p.clients?.indirizzo) ?? '';
      const ateco = extractAteco(p.clients?.indirizzo, p.codice_ateco ?? undefined) ?? '';
      if (filters.city  && !city.toLowerCase().includes(filters.city.toLowerCase()))  return false;
      if (filters.ateco && !ateco.toLowerCase().includes(filters.ateco.toLowerCase())) return false;
      if (filters.importoMin > 0 && (p.importo_richiesto ?? 0) < filters.importoMin)   return false;
      if (filters.soloConKpi === 'con'  && !p.kpi)  return false;
      if (filters.soloConKpi === 'senza' && !!p.kpi) return false;
      return true;
    });
  }, [practices, filters]);

  /* ── Pratiche preferiti ── */
  const favoritePractices = useMemo(() => practices.filter(p => watchlist.has(p.id)), [practices, watchlist]);

  /* ── Toggle confronto ── */
  const toggleCompare = (id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 3) { toast.warning('Puoi confrontare al massimo 3 pratiche.'); return prev; }
      return [...prev, id];
    });
  };

  /* ── Export PDF scheda anonima ── */
  const handleExportPdf = (p: AnonymousPractice) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 15;

    // Intestazione
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageW, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Credifile - Scheda Pratica Anonima', pageW / 2, 13, { align: 'center' });
    y = 30;

    // Info pratica
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`Pratica #${p.numero_pratica}`, 14, y); y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Data: ${new Date(p.created_at).toLocaleDateString('it-IT')}`, 14, y);
    doc.text(`Stato: ${STATUS_LABEL[p.status] ?? p.status}`, 80, y); y += 6;

    const city  = extractCity(p.clients?.indirizzo);
    const ateco = extractAteco(p.clients?.indirizzo, p.codice_ateco ?? undefined);
    if (city)  { doc.text(`Città: ${city}`,          14, y); y += 6; }
    if (ateco) { doc.text(`Codice ATECO: ${ateco}`,  14, y); y += 6; }
    if (p.importo_richiesto != null) {
      doc.text(`Importo richiesto: ${fmt(p.importo_richiesto)}`, 14, y); y += 6;
    }

    // KPI per area con semaforo
    if (p.kpi?.kpi) {
      y += 4;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('KPI Finanziari', 14, y); y += 6;
      const areas = p.kpi.kpi as KpiAreas;
      const SEMAFORO_SYMBOLS: Record<string, string> = { verde: '●', giallo: '◑', rosso: '○', nd: '–' };
      (Object.keys(AREA_LABEL) as (keyof KpiAreas)[]).forEach(areaKey => {
        const area = areas[areaKey];
        if (!area) return;
        const entries = Object.values(area).filter(e => e.valore !== null);
        if (!entries.length) return;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.text(AREA_LABEL[areaKey].replace(/[^\w\s]/gu, '').trim(), 14, y); y += 5;
        doc.setFont('helvetica', 'normal');
        entries.forEach(e => {
          const sym = SEMAFORO_SYMBOLS[e.semaforo] ?? '–';
          const colorMap: Record<string, [number, number, number]> = {
            verde: [22, 163, 74], giallo: [217, 119, 6], rosso: [220, 38, 38], nd: [148, 163, 184],
          };
          const [r2, g, b] = colorMap[e.semaforo] ?? colorMap.nd;
          doc.setTextColor(r2, g, b);
          doc.text(`${sym} ${e.label}: ${e.formatted}`, 20, y);
          doc.setTextColor(30, 41, 59);
          y += 5;
          if (y > 270) { doc.addPage(); y = 15; }
        });
      });
    }

    // Footer anonimato
    y += 6;
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Documento anonimo - ragione sociale, P.IVA e CF non inclusi per tutela della riservatezza.', 14, y);

    doc.save(`scheda-pratica-${p.numero_pratica}.pdf`);
  };

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
          onClick={() => setActiveTab('preferiti')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'preferiti'
              ? 'border-red-500 text-red-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}>
          <Heart className="w-4 h-4" />
          Preferiti
          {favoritePractices.length > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === 'preferiti' ? 'bg-red-100 text-red-600' : 'bg-red-100 text-red-600'}`}>
              {favoritePractices.length}
            </span>
          )}
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

          {/* ── Barra filtri ── */}
          <div className="mb-4 bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-wrap gap-3 items-end">
            <SlidersHorizontal className="w-4 h-4 text-slate-400 self-center shrink-0" />
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-slate-500">Città</Label>
              <Input
                placeholder="Es. Milano"
                value={filters.city}
                onChange={e => setFilters(f => ({ ...f, city: e.target.value }))}
                className="h-8 w-36 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-slate-500">ATECO</Label>
              <Input
                placeholder="Es. 68.11"
                value={filters.ateco}
                onChange={e => setFilters(f => ({ ...f, ateco: e.target.value }))}
                className="h-8 w-32 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-slate-500">Importo min</Label>
              <Select
                value={String(filters.importoMin)}
                onValueChange={v => setFilters(f => ({ ...f, importoMin: Number(v) }))}>
                <SelectTrigger className="h-8 w-36 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Tutti</SelectItem>
                  <SelectItem value="50000">&gt; 50.000 €</SelectItem>
                  <SelectItem value="100000">&gt; 100.000 €</SelectItem>
                  <SelectItem value="250000">&gt; 250.000 €</SelectItem>
                  <SelectItem value="500000">&gt; 500.000 €</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs text-slate-500">KPI</Label>
              <Select
                value={filters.soloConKpi}
                onValueChange={v => setFilters(f => ({ ...f, soloConKpi: v }))}>
                <SelectTrigger className="h-8 w-40 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tutti">Tutti</SelectItem>
                  <SelectItem value="con">Solo con KPI</SelectItem>
                  <SelectItem value="senza">Solo senza KPI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline" size="sm"
              onClick={() => setFilters({ city: '', ateco: '', importoMin: 0, soloConKpi: 'tutti' })}
              className="h-8 gap-1.5">
              <XIcon className="w-3.5 h-3.5" /> Reset filtri
            </Button>
            <span className="text-xs text-slate-400 self-center ml-auto">
              {filteredPractices.length} / {practices.length} pratiche
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredPractices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <BarChart2 className="w-10 h-10 text-slate-300" />
              <p className="text-slate-500">Nessuna pratica corrisponde ai filtri selezionati.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredPractices.map(p => {
                const city  = extractCity(p.clients?.indirizzo);
                const ateco = extractAteco(p.clients?.indirizzo, p.codice_ateco ?? undefined);
                const hasKpi = !!p.kpi;
                const alreadyRequested = !!p.myRequest;
                const isWatchlisted = watchlist.has(p.id);
                const isCompared = compareIds.includes(p.id);

                return (
                  <Card key={p.id} className={`border transition-shadow hover:shadow-md ${isCompared ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200'}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          {/* Checkbox confronto */}
                          <input
                            type="checkbox"
                            checked={isCompared}
                            onChange={() => toggleCompare(p.id)}
                            className="mt-1 accent-indigo-600 shrink-0 cursor-pointer"
                            title="Aggiungi al confronto"
                          />
                          <div className="min-w-0">
                            <CardTitle className="text-base font-semibold text-slate-700">
                              Pratica #{p.numero_pratica}
                            </CardTitle>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {new Date(p.created_at).toLocaleDateString('it-IT')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="outline" className={`text-xs ${STATUS_COLOR[p.status] ?? ''}`}>
                            {STATUS_LABEL[p.status] ?? p.status}
                          </Badge>
                          {/* Pulsante cuore watchlist */}
                          <button
                            onClick={() => toggleWatchlist(p.id)}
                            className="p-1 rounded-full hover:bg-slate-100 transition-colors"
                            title={isWatchlisted ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}>
                            <Heart
                              className={`w-4 h-4 transition-colors ${isWatchlisted ? 'fill-red-500 text-red-500' : 'text-slate-300 hover:text-red-400'}`}
                            />
                          </button>
                        </div>
                      </div>
                      {p.myRequest && (
                        <div className="mt-1"><RequestBadge req={p.myRequest} /></div>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Città + ATECO + Importo */}
                      <div className="flex flex-wrap gap-2">
                        {city && (
                          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                            <MapPin className="w-3 h-3" /> {city}
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

                      {/* KPI sintetici (fatturato + patrimonio) */}
                      {hasKpi && (p.kpi?.ricavi_vendite != null || p.kpi?.totale_patrimonio_netto != null) && (
                        <div className="grid grid-cols-2 gap-2">
                          {p.kpi?.ricavi_vendite != null && (
                            <div className="bg-blue-50 rounded-md px-3 py-2">
                              <p className="text-xs text-blue-600">Fatturato</p>
                              <p className="text-sm font-bold text-blue-800">{fmt(p.kpi.ricavi_vendite)}</p>
                              {p.kpi.anno_esercizio && <p className="text-[10px] text-blue-400">Anno {p.kpi.anno_esercizio}</p>}
                            </div>
                          )}
                          {p.kpi?.totale_patrimonio_netto != null && (
                            <div className="bg-slate-50 rounded-md px-3 py-2">
                              <p className="text-xs text-slate-600">Patrimonio Netto</p>
                              <p className="text-sm font-bold text-slate-800">{fmt(p.kpi.totale_patrimonio_netto)}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Tutti i KPI per area con semaforo */}
                      {hasKpi && p.kpi?.kpi && (() => {
                        const areas = p.kpi.kpi as KpiAreas;
                        const areaKeys = (Object.keys(AREA_LABEL) as (keyof KpiAreas)[]).filter(k => {
                          const area = areas[k];
                          return area && Object.values(area).some(e => e.valore !== null);
                        });
                        if (!areaKeys.length) return null;
                        return (
                          <div className="space-y-2 border-t border-slate-100 pt-2">
                            {areaKeys.map(areaKey => {
                              const area = areas[areaKey]!;
                              const entries = Object.values(area).filter(e => e.valore !== null);
                              return (
                                <div key={areaKey}>
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                                    {AREA_LABEL[areaKey]}
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {entries.map((e, i) => (
                                      <span key={i}
                                        className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border font-medium ${SEMAFORO_STYLE[e.semaforo] ?? SEMAFORO_STYLE.nd}`}
                                        title={e.label}>
                                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEMAFORO_DOT[e.semaforo] ?? SEMAFORO_DOT.nd}`} />
                                        {e.label}: {e.formatted}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {!hasKpi && (
                        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 rounded-md px-3 py-2">
                          <TrendingUp className="w-3 h-3" />
                          <span>Dati finanziari non ancora disponibili</span>
                        </div>
                      )}

                      {/* Azioni: PDF + Richiedi */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline" size="sm"
                          onClick={() => handleExportPdf(p)}
                          className="gap-1.5 text-xs shrink-0">
                          📄 Scheda PDF
                        </Button>
                        {!alreadyRequested ? (
                          <Button
                            className="flex-1 gap-1.5 bg-blue-600 hover:bg-blue-700" size="sm"
                            onClick={() => { setSelected(p); setNotaBanca(''); }}>
                            <Send className="w-3.5 h-3.5" /> Richiedi Documenti
                          </Button>
                        ) : p.myRequest?.status === 'in_attesa' ? (
                          <div className="flex-1 text-center text-xs text-amber-600 bg-amber-50 rounded-md py-2">
                            ⏳ In attesa di approvazione segreteria
                          </div>
                        ) : p.myRequest?.status === 'approvata' ? (
                          <div
                            className="flex-1 text-center text-xs text-green-600 bg-green-50 rounded-md py-2 cursor-pointer hover:bg-green-100"
                            onClick={() => setActiveTab('ricevute')}
                            title="Vai a Pratiche Ricevute">
                            ✅ Documenti ricevuti — vedi in <strong>Pratiche Ricevute</strong>
                          </div>
                        ) : (
                          <div className="flex-1 text-center text-xs text-red-600 bg-red-50 rounded-md py-2">
                            ❌ Richiesta rifiutata
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── TAB: Preferiti ── */}
      {activeTab === 'preferiti' && (
        <>
          <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
            ❤️ Le pratiche salvate nei preferiti. Clicca il cuore su una pratica per rimuoverla.
          </div>
          {favoritePractices.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
              <Heart className="w-10 h-10 text-slate-300" />
              <p className="text-slate-600 font-medium">Nessun preferito ancora</p>
              <p className="text-slate-400 text-sm max-w-xs">Clicca il cuore su una pratica disponibile per salvarla qui.</p>
              <Button variant="outline" size="sm" onClick={() => setActiveTab('disponibili')} className="mt-2 gap-1.5">
                <Search className="w-3.5 h-3.5" /> Sfoglia Pratiche Disponibili
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {favoritePractices.map(p => {
                const city  = extractCity(p.clients?.indirizzo);
                const ateco = extractAteco(p.clients?.indirizzo, p.codice_ateco ?? undefined);
                const hasKpi = !!p.kpi;
                const alreadyRequested = !!p.myRequest;
                const isCompared = compareIds.includes(p.id);

                return (
                  <Card key={p.id} className={`border transition-shadow hover:shadow-md ${isCompared ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-red-200'}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={isCompared}
                            onChange={() => toggleCompare(p.id)}
                            className="mt-1 accent-indigo-600 shrink-0 cursor-pointer"
                            title="Aggiungi al confronto"
                          />
                          <div className="min-w-0">
                            <CardTitle className="text-base font-semibold text-slate-700">
                              Pratica #{p.numero_pratica}
                            </CardTitle>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {new Date(p.created_at).toLocaleDateString('it-IT')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge variant="outline" className={`text-xs ${STATUS_COLOR[p.status] ?? ''}`}>
                            {STATUS_LABEL[p.status] ?? p.status}
                          </Badge>
                          <button
                            onClick={() => toggleWatchlist(p.id)}
                            className="p-1 rounded-full hover:bg-slate-100 transition-colors"
                            title="Rimuovi dai preferiti">
                            <Heart className="w-4 h-4 fill-red-500 text-red-500" />
                          </button>
                        </div>
                      </div>
                      {p.myRequest && <div className="mt-1"><RequestBadge req={p.myRequest} /></div>}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap gap-2">
                        {city && (
                          <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md">
                            <MapPin className="w-3 h-3" /> {city}
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
                      {!hasKpi && (
                        <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 rounded-md px-3 py-2">
                          <TrendingUp className="w-3 h-3" />
                          <span>Dati finanziari non ancora disponibili</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleExportPdf(p)} className="gap-1.5 text-xs shrink-0">
                          📄 Scheda PDF
                        </Button>
                        {!alreadyRequested ? (
                          <Button className="flex-1 gap-1.5 bg-blue-600 hover:bg-blue-700" size="sm"
                            onClick={() => { setSelected(p); setNotaBanca(''); }}>
                            <Send className="w-3.5 h-3.5" /> Richiedi Documenti
                          </Button>
                        ) : p.myRequest?.status === 'approvata' ? (
                          <div className="flex-1 text-center text-xs text-green-600 bg-green-50 rounded-md py-2 cursor-pointer hover:bg-green-100"
                            onClick={() => setActiveTab('ricevute')}>
                            ✅ Documenti ricevuti
                          </div>
                        ) : (
                          <div className="flex-1 text-center text-xs text-amber-600 bg-amber-50 rounded-md py-2">
                            ⏳ In attesa
                          </div>
                        )}
                      </div>
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

      {/* ── Banner sticky confronto ── */}
      {compareIds.length >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-indigo-700 text-white px-5 py-3 rounded-full shadow-xl">
          <GitCompare className="w-4 h-4" />
          <span className="text-sm font-medium">{compareIds.length} pratiche selezionate</span>
          <Button
            size="sm"
            className="bg-white text-indigo-700 hover:bg-indigo-50 rounded-full px-4 h-7 text-xs font-semibold"
            onClick={() => setCompareOpen(true)}>
            Confronta
          </Button>
          <button
            onClick={() => setCompareIds([])}
            className="ml-1 p-1 rounded-full hover:bg-indigo-600 transition-colors"
            title="Annulla selezione">
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Dialog confronto pratiche ── */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-4xl w-full overflow-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-indigo-600" />
              Confronto Pratiche
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left text-xs text-slate-500 uppercase tracking-wide py-2 pr-4 font-semibold w-32">Campo</th>
                  {compareIds.map(id => {
                    const p = practices.find(x => x.id === id);
                    return (
                      <th key={id} className="text-left py-2 px-3 bg-indigo-50 rounded-t border-b border-indigo-200 font-semibold text-slate-700">
                        #{p?.numero_pratica ?? id.slice(0, 8)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* Righe fisse */}
                {([
                  { label: 'Città', render: (p: AnonymousPractice) => extractCity(p.clients?.indirizzo) ?? '—' },
                  { label: 'ATECO',  render: (p: AnonymousPractice) => extractAteco(p.clients?.indirizzo, p.codice_ateco ?? undefined) ?? '—' },
                  { label: 'Importo', render: (p: AnonymousPractice) => p.importo_richiesto != null ? fmt(p.importo_richiesto) : '—' },
                  { label: 'Stato',  render: (p: AnonymousPractice) => STATUS_LABEL[p.status] ?? p.status },
                  { label: 'Data',   render: (p: AnonymousPractice) => new Date(p.created_at).toLocaleDateString('it-IT') },
                  { label: 'Fatturato', render: (p: AnonymousPractice) => p.kpi?.ricavi_vendite != null ? fmt(p.kpi.ricavi_vendite) : '—' },
                  { label: 'Patrimonio Netto', render: (p: AnonymousPractice) => p.kpi?.totale_patrimonio_netto != null ? fmt(p.kpi.totale_patrimonio_netto) : '—' },
                ] as { label: string; render: (p: AnonymousPractice) => string }[]).map(row => (
                  <tr key={row.label}>
                    <td className="py-2 pr-4 text-xs font-medium text-slate-500">{row.label}</td>
                    {compareIds.map(id => {
                      const p = practices.find(x => x.id === id);
                      return (
                        <td key={id} className="py-2 px-3 text-slate-700">{p ? row.render(p) : '—'}</td>
                      );
                    })}
                  </tr>
                ))}

                {/* KPI per area */}
                {(Object.keys(AREA_LABEL) as (keyof KpiAreas)[]).map(areaKey => {
                  // Raccoglie tutti i label KPI di questa area tra le pratiche selezionate
                  const kpiLabels = new Set<string>();
                  compareIds.forEach(id => {
                    const p = practices.find(x => x.id === id);
                    const area = (p?.kpi?.kpi as KpiAreas | undefined)?.[areaKey];
                    if (area) Object.values(area).forEach(e => { if (e.valore !== null) kpiLabels.add(e.label); });
                  });
                  if (!kpiLabels.size) return null;
                  return (
                    <>
                      <tr key={`header-${areaKey}`}>
                        <td colSpan={compareIds.length + 1} className="pt-3 pb-1">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                            {AREA_LABEL[areaKey]}
                          </span>
                        </td>
                      </tr>
                      {[...kpiLabels].map(kpiLabel => (
                        <tr key={`${areaKey}-${kpiLabel}`}>
                          <td className="py-1.5 pr-4 text-xs text-slate-500 pl-2">{kpiLabel}</td>
                          {compareIds.map(id => {
                            const p = practices.find(x => x.id === id);
                            const area = (p?.kpi?.kpi as KpiAreas | undefined)?.[areaKey];
                            const entry = area ? Object.values(area).find(e => e.label === kpiLabel) : undefined;
                            if (!entry || entry.valore === null) return <td key={id} className="py-1.5 px-3 text-slate-300">—</td>;
                            return (
                              <td key={id} className="py-1.5 px-3">
                                <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border font-medium ${SEMAFORO_STYLE[entry.semaforo] ?? SEMAFORO_STYLE.nd}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEMAFORO_DOT[entry.semaforo] ?? SEMAFORO_DOT.nd}`} />
                                  {entry.formatted}
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompareOpen(false)}>Chiudi</Button>
            <Button variant="outline" onClick={() => { setCompareIds([]); setCompareOpen(false); }} className="text-slate-500">
              Deseleziona tutto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* ── Sezione Impostazioni Notifiche (solo banca loggata) ── */}
      {bankId && (
        <div className="mt-8 border-t border-slate-200 pt-6">
          <button
            type="button"
            onClick={() => setNotifOpen(prev => !prev)}
            className="flex items-center gap-2 text-slate-700 hover:text-slate-900 font-semibold text-base mb-3 group"
          >
            <Settings className="w-5 h-5 text-slate-500 group-hover:text-slate-700 transition-colors" />
            ⚙️ Impostazioni Notifiche
            <span className={`ml-2 text-xs text-slate-400 font-normal transition-transform ${notifOpen ? 'rotate-180' : ''}`}>▼</span>
          </button>

          {notifOpen && (
            <Card className="border-slate-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-blue-500" />
                  Preferenze ricezione notifiche email
                </CardTitle>
                <p className="text-xs text-slate-500 mt-1">
                  Le notifiche vengono inviate all'email indicata quando arriva una nuova pratica compatibile con i tuoi criteri.
                </p>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Toggle notifica_nuove */}
                <div className="flex items-center justify-between gap-4 py-1">
                  <div>
                    <Label className="text-sm font-medium text-slate-700">Ricevi notifiche nuove pratiche</Label>
                    <p className="text-xs text-slate-400 mt-0.5">Attiva per ricevere email quando arriva una pratica compatibile</p>
                  </div>
                  <Switch
                    checked={notifSettings.notifica_nuove}
                    onCheckedChange={v => setNotifSettings(prev => ({ ...prev, notifica_nuove: v }))}
                  />
                </div>

                <div className={`space-y-4 transition-opacity ${notifSettings.notifica_nuove ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                  {/* Email */}
                  <div className="space-y-1.5">
                    <Label htmlFor="notif-email" className="text-sm font-medium text-slate-700">
                      Email per notifiche
                    </Label>
                    <Input
                      id="notif-email"
                      type="email"
                      placeholder={user?.email ?? 'es. nome@banca.it'}
                      value={notifSettings.email}
                      onChange={e => setNotifSettings(prev => ({ ...prev, email: e.target.value }))}
                      className="max-w-sm"
                    />
                  </div>

                  {/* Importo min / max */}
                  <div className="grid grid-cols-2 gap-4 max-w-sm">
                    <div className="space-y-1.5">
                      <Label htmlFor="notif-importo-min" className="text-sm font-medium text-slate-700">
                        Importo minimo (€)
                      </Label>
                      <Input
                        id="notif-importo-min"
                        type="number"
                        min={0}
                        placeholder="es. 50000"
                        value={notifSettings.importo_min}
                        onChange={e => setNotifSettings(prev => ({ ...prev, importo_min: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="notif-importo-max" className="text-sm font-medium text-slate-700">
                        Importo massimo (€) <span className="text-slate-400 font-normal">– opz.</span>
                      </Label>
                      <Input
                        id="notif-importo-max"
                        type="number"
                        min={0}
                        placeholder="es. 500000"
                        value={notifSettings.importo_max}
                        onChange={e => setNotifSettings(prev => ({ ...prev, importo_max: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* ATECO filter */}
                  <div className="space-y-1.5 max-w-sm">
                    <Label htmlFor="notif-ateco" className="text-sm font-medium text-slate-700">
                      Filtro ATECO
                    </Label>
                    <Input
                      id="notif-ateco"
                      placeholder="es. 68, 47.1, 10.1"
                      value={notifSettings.ateco_filter}
                      onChange={e => setNotifSettings(prev => ({ ...prev, ateco_filter: e.target.value }))}
                    />
                    <p className="text-xs text-slate-400">Codici ATECO separati da virgola. Lascia vuoto per ricevere tutte le pratiche.</p>
                  </div>
                </div>

                {/* Salva */}
                <div className="flex items-center gap-3 pt-2 border-t border-slate-100">
                  <Button
                    onClick={saveNotifSettings}
                    disabled={savingNotif}
                    className="gap-2 bg-blue-600 hover:bg-blue-700"
                    size="sm"
                  >
                    {savingNotif
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Salvataggio…</>
                      : <><Save className="w-3.5 h-3.5" /> Salva Impostazioni</>
                    }
                  </Button>
                  <p className="text-xs text-slate-400">Le modifiche hanno effetto immediato</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </BancaLayout>
  );
}
