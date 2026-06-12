import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import { Building2, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Tipi ──────────────────────────────────────────────────────────────────────
interface BancaColonna { id: string; nome: string; }

interface PraticaBanca {
  pb_id: string;
  practice_id: string;
  bank_id: string | null;
  numero_pratica: string;
  ragione_sociale: string;
  status_pratica: string;
  status_banca: string;
  data_invio: string | null;
  created_at_pb: string;
  agente: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_PRATICA_LABELS: Record<string, string> = {
  bozza: 'Bozza', raccolta_documenti: 'Raccolta Doc.', in_valutazione: 'In Valutazione',
  integrazioni_richieste: 'Integrazioni', approvata: 'Approvata', declinata: 'Declinata', erogata: 'Erogata',
};
const STATUS_PRATICA_COLOR: Record<string, string> = {
  bozza: 'bg-gray-100 text-gray-700', raccolta_documenti: 'bg-blue-100 text-blue-700',
  in_valutazione: 'bg-yellow-100 text-yellow-800', integrazioni_richieste: 'bg-orange-100 text-orange-700',
  approvata: 'bg-green-100 text-green-700', declinata: 'bg-red-100 text-red-700', erogata: 'bg-emerald-100 text-emerald-800',
};
const STATUS_BANCA_BG: Record<string, string> = {
  inviata: 'bg-blue-50 border-blue-200', in_attesa: 'bg-amber-50 border-amber-200',
  rifiutata: 'bg-red-50 border-red-200', approvata: 'bg-green-50 border-green-200',
};
const STATUS_BANCA_DOT: Record<string, string> = {
  inviata: 'bg-blue-500', in_attesa: 'bg-amber-400', rifiutata: 'bg-red-500', approvata: 'bg-green-500',
};

function tempoTrascorso(dateStr: string | null): { label: string; urgente: boolean } {
  if (!dateStr) return { label: '—', urgente: false };
  const ms   = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / 86400000);
  const hrs  = Math.floor(ms / 3600000);
  if (days >= 30) return { label: `${Math.floor(days / 30)} mesi`, urgente: true };
  if (days >= 7)  return { label: `${Math.floor(days / 7)} sett.`, urgente: days >= 14 };
  if (days >= 1)  return { label: `${days} gg`, urgente: days >= 10 };
  return { label: hrs > 0 ? `${hrs}h` : '< 1h', urgente: false };
}

// ─── Card pratica ───────────────────────────────────────────────────────────────
function PraticaCard({ p, showAgente, onOpen }: { p: PraticaBanca; showAgente: boolean; onOpen: () => void }) {
  const ref = p.data_invio ?? p.created_at_pb;
  const { label: tempo, urgente } = tempoTrascorso(ref);
  const dot    = STATUS_BANCA_DOT[p.status_banca]  ?? 'bg-gray-400';
  const cardBg = STATUS_BANCA_BG[p.status_banca]   ?? 'bg-white border-gray-200';

  return (
    <div
      className={`rounded-lg border p-3 cursor-pointer hover:shadow-md transition-shadow ${cardBg}`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="font-semibold text-sm text-gray-900 leading-tight line-clamp-2 flex-1">{p.ragione_sociale}</p>
        <span className={`mt-0.5 shrink-0 w-2.5 h-2.5 rounded-full ${dot}`} title={p.status_banca} />
      </div>
      <code className="text-[10px] text-gray-500 font-mono">{p.numero_pratica}</code>
      <div className="mt-1.5">
        <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_PRATICA_COLOR[p.status_pratica] ?? 'bg-gray-100 text-gray-600'}`}>
          {STATUS_PRATICA_LABELS[p.status_pratica] ?? p.status_pratica}
        </Badge>
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-gray-500">
        {showAgente
          ? <span className="truncate max-w-[70%]">👤 {p.agente}</span>
          : <span />}
        <span className={`flex items-center gap-0.5 font-semibold ${urgente ? 'text-red-600' : 'text-gray-400'}`}>
          {urgente && <AlertCircle className="w-3 h-3" />}
          <Clock className="w-2.5 h-2.5" />{tempo}
        </span>
      </div>
    </div>
  );
}

// ─── Pagina principale ──────────────────────────────────────────────────────────
export default function KanbanBanchePage() {
  const { isSuperAdmin, isSegreteria, isAgente, isSegnalatore, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [banche, setBanche]     = useState<BancaColonna[]>([]);
  const [pratiche, setPratiche] = useState<PraticaBanca[]>([]);
  const [loading, setLoading]   = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const ruoloLabel = isSuperAdmin   ? 'Tutte le pratiche'
                   : isSegreteria   ? 'Pratiche dei miei agenti'
                   : isAgente       ? 'Le mie pratiche'
                   : isSegnalatore  ? 'Pratiche da me segnalate'
                   : '';

  // Mostra nome agente sulla card solo per ruoli che gestiscono più agenti
  const showAgente = isSuperAdmin || isSegreteria;

  async function load() {
    setLoading(true);
    try {
      const { data: bancheData } = await supabase
        .from('banks').select('id, nome').eq('attiva', true).order('nome');
      setBanche((bancheData ?? []) as BancaColonna[]);

      // ── Calcola lista practice_id visibili per il ruolo ──────────────────────
      let allowedIds: string[] | null = null; // null = nessun filtro (super_admin)

      if (isAgente && user?.id) {
        // Agente: solo pratiche a lui assegnate
        const { data } = await supabase
          .from('practices').select('id').eq('assigned_to', user.id);
        allowedIds = (data ?? []).map((r: { id: string }) => r.id);

      } else if (isSegreteria && user?.id) {
        // Segreteria: pratiche degli agenti assegnati a questa segreteria
        const { data: assigns } = await supabase
          .from('segreteria_agent_assignments')
          .select('agent_user_id')
          .eq('segreteria_user_id', user.id);
        const agentIds = (assigns ?? []).map((a: { agent_user_id: string }) => a.agent_user_id);
        if (agentIds.length > 0) {
          const { data } = await supabase
            .from('practices').select('id').in('assigned_to', agentIds);
          allowedIds = (data ?? []).map((r: { id: string }) => r.id);
        } else {
          allowedIds = [];
        }

      } else if (isSegnalatore && user?.id) {
        // Segnalatore: pratiche dove è segnalatore
        const { data } = await supabase
          .from('practices').select('id').eq('segnalatore_id', user.id);
        allowedIds = (data ?? []).map((r: { id: string }) => r.id);
      }

      // Lista vuota → nessun risultato
      if (allowedIds !== null && allowedIds.length === 0) {
        setPratiche([]);
        setLastRefresh(new Date());
        return;
      }

      // ── Query practice_banks con filtro opzionale ─────────────────────────────
      let q = supabase
        .from('practice_banks')
        .select(`
          id, practice_id, bank_id, status, data_invio, created_at,
          practices!inner(numero_pratica, status,
            assigned_agent:admin_profiles!practices_assigned_to_fkey(nome,email),
            clients!inner(ragione_sociale)),
          banks(nome)
        `)
        .order('created_at', { ascending: true });

      if (allowedIds !== null) {
        q = q.in('practice_id', allowedIds);
      }

      const { data: pbData } = await q;

      const mapped: PraticaBanca[] = (pbData ?? []).map((row: any) => {
        const pr = row.practices ?? {};
        const ag = Array.isArray(pr.assigned_agent) ? pr.assigned_agent[0] : pr.assigned_agent;
        const cl = Array.isArray(pr.clients)         ? pr.clients[0]        : pr.clients;
        return {
          pb_id: row.id, practice_id: row.practice_id, bank_id: row.bank_id,
          numero_pratica: pr.numero_pratica ?? '—', ragione_sociale: cl?.ragione_sociale ?? '—',
          status_pratica: pr.status ?? '', status_banca: row.status ?? 'inviata',
          data_invio: row.data_invio, created_at_pb: row.created_at,
          agente: ag?.nome || ag?.email || '—',
        };
      });
      setPratiche(mapped);
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (!authLoading) load(); }, [authLoading, user?.id]);

  // Raggruppa per banca
  const byBank: Record<string, PraticaBanca[]> = {};
  for (const b of banche) byBank[b.id] = [];
  for (const p of pratiche) { if (p.bank_id && byBank[p.bank_id]) byBank[p.bank_id].push(p); }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* @section: kanban-header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" /> Kanban Pratiche per Banca
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {ruoloLabel} · {banche.length} banche · {pratiche.length} assegnazioni ·
            aggiornato {lastRefresh.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-3 text-[11px] text-muted-foreground">
            {[
              { dot: 'bg-blue-500',  label: 'Inviata' },
              { dot: 'bg-amber-400', label: 'In attesa' },
              { dot: 'bg-green-500', label: 'Approvata' },
              { dot: 'bg-red-500',   label: 'Rifiutata' },
            ].map(({ dot, label }) => (
              <span key={label} className="flex items-center gap-1">
                <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />{label}
              </span>
            ))}
            <span className="flex items-center gap-1 text-red-600 font-medium">
              <AlertCircle className="w-3 h-3" /> Urgente (&gt;10 gg)
            </span>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Aggiorna
          </Button>
        </div>
      </div>

      {/* @section: kanban-board */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Caricamento...
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full gap-3 p-4" style={{ minWidth: `${Math.max(banche.length, 1) * 264 + 32}px` }}>
            {banche.map(banca => {
              const cards = byBank[banca.id] ?? [];
              const urgenti = cards.filter(c => {
                const ref = c.data_invio ?? c.created_at_pb;
                return ref ? Math.floor((Date.now() - new Date(ref).getTime()) / 86400000) >= 10 : false;
              }).length;
              return (
                <div key={banca.id} className="flex flex-col w-60 shrink-0">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs font-semibold text-foreground truncate" title={banca.nome}>{banca.nome}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      {urgenti > 0 && (
                        <span className="text-[10px] bg-red-100 text-red-700 rounded-full px-1.5 font-semibold flex items-center gap-0.5">
                          <AlertCircle className="w-2.5 h-2.5" />{urgenti}
                        </span>
                      )}
                      <span className="text-[10px] bg-muted text-muted-foreground rounded-full px-1.5 font-semibold">{cards.length}</span>
                    </div>
                  </div>
                  <div className="overflow-y-auto space-y-2 pb-2" style={{ maxHeight: 'calc(100vh - 160px)' }}>
                    {cards.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-muted-foreground">
                        Nessuna pratica
                      </div>
                    ) : (
                      cards.map(p => (
                        <PraticaCard
                          key={p.pb_id}
                          p={p}
                          showAgente={showAgente}
                          onOpen={() => navigate(`/admin/pratiche/${p.practice_id}`)}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
            {banche.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Nessuna banca configurata.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
