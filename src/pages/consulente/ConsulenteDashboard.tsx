import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, FileBarChart2, Users, LogOut, Settings, TrendingUp, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface Client {
  id: string; ragione_sociale: string; partita_iva: string | null;
  codice_ateco: string | null; settore: string | null; email: string | null;
  created_at: string;
}
interface Report {
  id: string; client_id: string | null; client_name: string;
  anno_bilancio: number | null; indice_bancabilita: number | null; sent_at: string | null; created_at: string;
}

function ratingInfo(score: number) {
  if (score >= 85) return { label: 'Eccellente', cls: 'bg-emerald-100 text-emerald-800' };
  if (score >= 70) return { label: 'Buono',      cls: 'bg-green-100 text-green-800' };
  if (score >= 55) return { label: 'Sufficiente',cls: 'bg-yellow-100 text-yellow-800' };
  if (score >= 40) return { label: 'Critico',    cls: 'bg-orange-100 text-orange-800' };
  return               { label: 'Non bancabile',cls: 'bg-red-100 text-red-800' };
}

export default function ConsulenteDashboard() {
  const { user, profileNome, signOut } = useAuth();
  const navigate = useNavigate();
  const [clients,  setClients]  = useState<Client[]>([]);
  const [reports,  setReports]  = useState<Report[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tab,      setTab]      = useState<'clienti' | 'report'>('clienti');
  // form nuovo cliente
  const [showForm,    setShowForm]    = useState(false);
  const [formData,    setFormData]    = useState({ ragione_sociale: '', partita_iva: '', email: '', codice_ateco: '', settore: '', telefono: '', indirizzo: '' });
  const [savingClient, setSavingClient] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: cl }, { data: rp }] = await Promise.all([
      supabase.from('consulente_clients').select('*').eq('consulente_id', user.id).order('ragione_sociale'),
      supabase.from('consulente_reports').select('id,client_id,client_name,anno_bilancio,indice_bancabilita,sent_at,created_at').eq('consulente_id', user.id).order('created_at', { ascending: false }),
    ]);
    setClients((cl ?? []) as Client[]);
    setReports((rp ?? []) as Report[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const saveClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !formData.ragione_sociale.trim()) return;
    setSavingClient(true);
    const { error } = await supabase.from('consulente_clients').insert({ ...formData, consulente_id: user.id });
    setSavingClient(false);
    if (error) { toast.error('Errore salvataggio cliente'); return; }
    toast.success('Cliente aggiunto');
    setShowForm(false);
    setFormData({ ragione_sociale: '', partita_iva: '', email: '', codice_ateco: '', settore: '', telefono: '', indirizzo: '' });
    load();
  };

  const deleteClient = async (id: string) => {
    if (!confirm('Eliminare questo cliente e tutti i suoi report?')) return;
    await supabase.from('consulente_clients').delete().eq('id', id);
    toast.success('Cliente eliminato');
    load();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50/40 to-slate-50">
      {/* Header */}
      <div className="bg-teal-700 text-white px-6 py-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold leading-tight">Credifile — Portale Consulente</h1>
            <p className="text-teal-200 text-xs">{profileNome || user?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={() => navigate('/consulente/profilo')}>
            <Settings className="w-4 h-4 mr-1" /> Profilo
          </Button>
          <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={async () => { await signOut(); navigate('/login'); }}>
            <LogOut className="w-4 h-4 mr-1" /> Esci
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: Users, label: 'Clienti', value: clients.length, color: 'text-teal-600 bg-teal-50' },
            { icon: FileBarChart2, label: 'Report generati', value: reports.length, color: 'text-blue-600 bg-blue-50' },
            { icon: TrendingUp, label: 'Inviati', value: reports.filter(r => r.sent_at).length, color: 'text-emerald-600 bg-emerald-50' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border p-4 flex items-center gap-3 shadow-sm">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-2xl font-black text-slate-800">{s.value}</div>
                <div className="text-xs text-slate-500">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
          {(['clienti', 'report'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize ${tab === t ? 'bg-white shadow text-teal-700' : 'text-slate-500 hover:text-slate-700'}`}>
              {t === 'clienti' ? `👤 Clienti (${clients.length})` : `📊 Report (${reports.length})`}
            </button>
          ))}
        </div>

        {/* Tab Clienti */}
        {tab === 'clienti' && (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="font-semibold text-slate-700">I tuoi clienti</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="w-3.5 h-3.5 mr-1" /> Aggiorna</Button>
                <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => setShowForm(s => !s)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Nuovo cliente
                </Button>
              </div>
            </div>

            {/* Form nuovo cliente */}
            {showForm && (
              <form onSubmit={saveClient} className="bg-white border-2 border-teal-200 rounded-xl p-5 space-y-3">
                <h3 className="font-semibold text-teal-700 text-sm">Aggiungi nuovo cliente</h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: 'ragione_sociale', label: 'Ragione Sociale *', required: true },
                    { key: 'partita_iva',     label: 'Partita IVA' },
                    { key: 'email',           label: 'Email cliente' },
                    { key: 'telefono',        label: 'Telefono' },
                    { key: 'codice_ateco',    label: 'Codice ATECO' },
                    { key: 'settore',         label: 'Settore' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="text-xs font-medium text-slate-600">{f.label}</label>
                      <input required={f.required}
                        className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 ring-teal-400 outline-none"
                        value={(formData as Record<string,string>)[f.key]}
                        onChange={e => setFormData(d => ({ ...d, [f.key]: e.target.value }))} />
                    </div>
                  ))}
                  <div className="col-span-2">
                    <label className="text-xs font-medium text-slate-600">Indirizzo</label>
                    <input className="w-full border rounded-lg px-3 py-1.5 text-sm mt-0.5 focus:ring-2 ring-teal-400 outline-none"
                      value={formData.indirizzo} onChange={e => setFormData(d => ({ ...d, indirizzo: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" className="bg-teal-600 hover:bg-teal-700" disabled={savingClient}>
                    {savingClient ? 'Salvataggio...' : 'Salva cliente'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(false)}>Annulla</Button>
                </div>
              </form>
            )}

            {loading ? (
              <div className="py-10 text-center text-sm text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Caricamento...</div>
            ) : clients.length === 0 ? (
              <div className="py-14 text-center border-2 border-dashed rounded-xl">
                <Users className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                <p className="font-medium text-slate-500">Nessun cliente ancora</p>
                <p className="text-sm text-slate-400 mt-1">Clicca "Nuovo cliente" per iniziare</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {clients.map(c => {
                  const clientReports = reports.filter(r => r.client_id === c.id);
                  return (
                    <div key={c.id} className="bg-white rounded-xl border hover:border-teal-300 transition-colors p-4 flex items-center gap-4">
                      <div className="w-10 h-10 bg-teal-50 rounded-lg flex items-center justify-center shrink-0">
                        <span className="text-teal-700 font-bold text-sm">{c.ragione_sociale.slice(0, 2).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{c.ragione_sociale}</p>
                        <p className="text-xs text-slate-500">
                          {[c.partita_iva && `P.IVA ${c.partita_iva}`, c.codice_ateco && `ATECO ${c.codice_ateco}`, c.email].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="text-xs text-slate-400">{clientReports.length} report</div>
                      <div className="flex gap-2">
                        <Button size="sm" className="bg-teal-600 hover:bg-teal-700 h-8 text-xs"
                          onClick={() => navigate(`/consulente/cliente/${c.id}/nuovo-report`)}>
                          <FileBarChart2 className="w-3.5 h-3.5 mr-1" /> Nuovo report
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => deleteClient(c.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab Report */}
        {tab === 'report' && (
          <div className="space-y-3">
            <h2 className="font-semibold text-slate-700">Report generati</h2>
            {loading ? (
              <div className="py-10 text-center text-sm text-slate-400"><RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /></div>
            ) : reports.length === 0 ? (
              <div className="py-14 text-center border-2 border-dashed rounded-xl">
                <FileBarChart2 className="w-10 h-10 mx-auto text-slate-300 mb-3" />
                <p className="font-medium text-slate-500">Nessun report ancora</p>
              </div>
            ) : (
              <div className="space-y-2">
                {reports.map(r => {
                  const rating = r.indice_bancabilita !== null ? ratingInfo(r.indice_bancabilita) : null;
                  return (
                    <div key={r.id} className="bg-white rounded-xl border p-4 flex items-center gap-4 hover:border-teal-200 transition-colors cursor-pointer"
                      onClick={() => navigate(`/consulente/report/${r.id}`)}>
                      <FileBarChart2 className="w-5 h-5 text-teal-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{r.client_name}</p>
                        <p className="text-xs text-slate-500">Bilancio {r.anno_bilancio ?? 'N/D'} · {new Date(r.created_at).toLocaleDateString('it-IT')}</p>
                      </div>
                      {r.indice_bancabilita !== null && rating && (
                        <div className="text-right">
                          <div className="text-lg font-black text-slate-700">{Math.round(r.indice_bancabilita)}/100</div>
                          <Badge className={`text-[10px] py-0 ${rating.cls}`}>{rating.label}</Badge>
                        </div>
                      )}
                      {r.sent_at && <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 shrink-0">✅ Inviato</Badge>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
