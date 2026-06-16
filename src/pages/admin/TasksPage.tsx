import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckSquare, Clock, AlertCircle, CheckCircle2, RefreshCw, ArrowRight, Filter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Task {
  id: string;
  titolo: string;
  descrizione?: string;
  stato: string;
  priorita: string;
  scadenza?: string;
  assegnato_a?: string;
  assegnato_nome?: string;
  practice_id: string;
  practices?: { numero_pratica: string; clients?: { ragione_sociale: string } };
  created_at: string;
}

const PRIORITA_COLOR: Record<string, string> = {
  alta:   'bg-red-100 text-red-800',
  media:  'bg-amber-100 text-amber-800',
  bassa:  'bg-green-100 text-green-800',
};
const STATO_COLOR: Record<string, string> = {
  aperta:     'bg-blue-100 text-blue-800',
  in_corso:   'bg-purple-100 text-purple-800',
  completata: 'bg-green-100 text-green-800',
  annullata:  'bg-gray-100 text-gray-600',
};

export default function TasksPage() {
  const { user, isSuperAdmin, isSegreteria, role } = useAuth();
  const isSegnalatore = role === 'segnalatore';
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStato, setFiltroStato] = useState('aperta');
  const [filtroPriorita, setFiltroPriorita] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    let q = supabase
      .from('practice_tasks')
      .select('*, practices(numero_pratica, clients(ragione_sociale))')
      .order('scadenza', { ascending: true, nullsFirst: false })
      .order('priorita', { ascending: true });

    // Agenti e segnalatori vedono solo le task assegnate a loro
    if (!isSuperAdmin && !isSegreteria) {
      q = q.eq('assegnato_a', user.id);
    }
    if (filtroStato && filtroStato !== 'tutti') q = q.eq('stato', filtroStato);

    const { data } = await q.limit(100);
    setTasks((data ?? []) as Task[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id, filtroStato]);

  const updateStato = async (taskId: string, newStato: string) => {
    const update: Record<string, unknown> = { stato: newStato, updated_at: new Date().toISOString() };
    if (newStato === 'completata') update.completata_at = new Date().toISOString();
    await supabase.from('practice_tasks').update(update).eq('id', taskId);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, stato: newStato } : t));
  };

  const today = new Date().toISOString().split('T')[0];

  const filtered = tasks.filter(t => {
    if (filtroPriorita && t.priorita !== filtroPriorita) return false;
    if (search) {
      const q = search.toLowerCase();
      return t.titolo.toLowerCase().includes(q) ||
        (t.assegnato_nome ?? '').toLowerCase().includes(q) ||
        (t.practices?.clients?.ragione_sociale ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const scadutiCount = filtered.filter(t => t.scadenza && t.scadenza < today && t.stato !== 'completata').length;

  // Contatori per tab
  const counts = {
    aperta: tasks.filter(t => t.stato === 'aperta').length,
    in_corso: tasks.filter(t => t.stato === 'in_corso').length,
    completata: tasks.filter(t => t.stato === 'completata').length,
    tutti: tasks.length,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestione Task</h1>
          <p className="text-muted-foreground text-sm mt-1">Task e attività su tutte le pratiche</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Aggiorna
        </Button>
      </div>

      {scadutiCount > 0 && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <strong>{scadutiCount} task scadut{scadutiCount > 1 ? 'i' : 'o'}</strong> — verifica e aggiorna lo stato
        </div>
      )}

      {/* Banner informativo per segnalatori */}
      {isSegnalatore && !loading && tasks.length === 0 && (
        <div className="flex items-start gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Questa sezione mostra le <strong>attività assegnate a te</strong> dall'agente di riferimento
            sulle pratiche in corso. Al momento non hai task aperte — verranno visualizzate
            non appena il tuo agente te ne assegnerà una.
          </span>
        </div>
      )}

      {/* Filtri */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex gap-1 flex-wrap">
          {(['tutti','aperta','in_corso','completata'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFiltroStato(s)}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                filtroStato === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {s === 'tutti' ? 'Tutti' : s === 'aperta' ? 'Aperte' : s === 'in_corso' ? 'In corso' : 'Completate'}
              {counts[s] > 0 && <span className="ml-1.5 opacity-70">({counts[s]})</span>}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-1 min-w-[200px]">
          <Input
            placeholder="Cerca task, cliente..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-sm"
          />
          <Select value={filtroPriorita} onValueChange={setFiltroPriorita}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue placeholder="Priorità" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Tutte</SelectItem>
              <SelectItem value="alta">🔴 Alta</SelectItem>
              <SelectItem value="media">🟡 Media</SelectItem>
              <SelectItem value="bassa">🟢 Bassa</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Lista task */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckSquare className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm">Nessun task {filtroStato !== 'tutti' ? `con stato "${filtroStato}"` : ''}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(task => {
            const isScaduto = task.scadenza && task.scadenza < today && task.stato !== 'completata';
            const isCompletata = task.stato === 'completata';
            return (
              <Card key={task.id} className={`border ${isScaduto ? 'border-red-200 bg-red-50/30' : ''}`}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-start gap-3">
                    {/* Check completamento rapido */}
                    <button
                      onClick={() => updateStato(task.id, isCompletata ? 'aperta' : 'completata')}
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isCompletata ? 'bg-green-500 border-green-500' : 'border-border hover:border-primary'
                      }`}
                    >
                      {isCompletata && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${isCompletata ? 'line-through text-muted-foreground' : ''}`}>
                          {task.titolo}
                        </span>
                        <Badge className={`text-[10px] ${PRIORITA_COLOR[task.priorita] ?? 'bg-gray-100 text-gray-600'}`}>
                          {task.priorita}
                        </Badge>
                        <Badge className={`text-[10px] ${STATO_COLOR[task.stato] ?? 'bg-gray-100'}`}>
                          {task.stato.replace('_', ' ')}
                        </Badge>
                      </div>
                      {task.descrizione && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{task.descrizione}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-muted-foreground">
                        {task.practices?.clients?.ragione_sociale && (
                          <span className="truncate max-w-[160px]">{task.practices.clients.ragione_sociale}</span>
                        )}
                        {task.practices?.numero_pratica && (
                          <span className="font-mono">#{task.practices.numero_pratica}</span>
                        )}
                        {task.assegnato_nome && <span>👤 {task.assegnato_nome}</span>}
                        {task.scadenza && (
                          <span className={`flex items-center gap-1 ${isScaduto ? 'text-red-600 font-semibold' : ''}`}>
                            <Clock className="w-3 h-3" />
                            {isScaduto ? 'SCADUTO — ' : ''}
                            {new Date(task.scadenza + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Azioni */}
                    <div className="flex items-center gap-1 shrink-0">
                      {task.stato === 'aperta' && (
                        <button
                          onClick={() => updateStato(task.id, 'in_corso')}
                          className="text-xs px-2 py-1 rounded border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors"
                        >
                          In corso
                        </button>
                      )}
                      <button
                        onClick={() => task.practice_id && navigate(`/admin/pratiche/${task.practice_id}`)}
                        className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground"
                        title="Apri pratica"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
