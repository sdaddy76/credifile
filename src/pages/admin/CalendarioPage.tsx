import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, CheckSquare, AlertCircle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CalEvent {
  id: string;
  tipo: 'scadenza' | 'task';
  titolo: string;
  data: string;      // YYYY-MM-DD
  pratica_id?: string;
  pratica_numero?: string;
  cliente?: string;
  stato?: string;
  priorita?: string;
  scaduto?: boolean;
}

const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const GIORNI_SHORT = ['D','L','M','M','G','V','S'];

export default function CalendarioPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  const load = async () => {
    if (!user?.id) return;
    setLoading(true);
    const [deadlines, tasks] = await Promise.all([
      supabase.from('document_deadlines')
        .select('id, documento, data_scadenza, practice_id, practices(numero_pratica, clients(ragione_sociale))')
        .gte('data_scadenza', `${year}-01-01`)
        .lte('data_scadenza', `${year}-12-31`),
      supabase.from('practice_tasks')
        .select('id, titolo, scadenza, stato, priorita, practice_id, practices(numero_pratica, clients(ragione_sociale))')
        .not('scadenza', 'is', null)
        .gte('scadenza', `${year}-01-01`)
        .lte('scadenza', `${year}-12-31`)
        .neq('stato', 'annullata'),
    ]);

    const todayStr = today.toISOString().split('T')[0];
    const evs: CalEvent[] = [
      ...((deadlines.data ?? []) as any[]).map(d => ({
        id: d.id,
        tipo: 'scadenza' as const,
        titolo: d.documento,
        data: d.data_scadenza,
        pratica_id: d.practice_id,
        pratica_numero: d.practices?.numero_pratica,
        cliente: d.practices?.clients?.ragione_sociale,
        scaduto: d.data_scadenza < todayStr,
      })),
      ...((tasks.data ?? []) as any[]).map(t => ({
        id: t.id,
        tipo: 'task' as const,
        titolo: t.titolo,
        data: t.scadenza,
        pratica_id: t.practice_id,
        pratica_numero: t.practices?.numero_pratica,
        cliente: t.practices?.clients?.ragione_sociale,
        stato: t.stato,
        priorita: t.priorita,
        scaduto: t.scadenza < todayStr && t.stato !== 'completata',
      })),
    ];
    setEvents(evs);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id, year]);

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  // Calcola griglia calendario
  const firstDay = new Date(year, month, 1).getDay(); // 0=domenica
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDay).fill(null).concat(Array.from({ length: daysInMonth }, (_, i) => i + 1));
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsForDay = (day: number): CalEvent[] => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter(e => e.data === dateStr);
  };

  const selectedDateStr = selectedDay
    ? `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`
    : null;
  const selectedEvents = selectedDay ? eventsForDay(selectedDay) : [];

  // Lista eventi prossimi 14gg
  const upcoming = events
    .filter(e => {
      const d = new Date(e.data);
      const diff = (d.getTime() - today.getTime()) / 86400000;
      return diff >= 0 && diff <= 14;
    })
    .sort((a, b) => a.data.localeCompare(b.data));

  const scadutiCount = events.filter(e => e.scaduto && (e.tipo === 'scadenza' || e.stato !== 'completata')).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Calendario Scadenze</h1>
          <p className="text-muted-foreground text-sm mt-1">Scadenze documenti e task</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Aggiorna
        </Button>
      </div>

      {scadutiCount > 0 && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <strong>{scadutiCount} elemento{scadutiCount > 1 ? 'i' : ''} scadut{scadutiCount > 1 ? 'i' : 'o'}</strong> — verificarli nella lista sottostante
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Calendario */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
              <CardTitle className="text-sm font-semibold">{MESI[month]} {year}</CardTitle>
              <Button variant="ghost" size="sm" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 mb-2">
              {GIORNI_SHORT.map(g => (
                <div key={g} className="text-center text-xs text-muted-foreground font-semibold py-1">{g}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, idx) => {
                if (!day) return <div key={idx} />;
                const dayEvents = eventsForDay(day);
                const isToday = year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
                const isSelected = selectedDay === day;
                const hasScaduto = dayEvents.some(e => e.scaduto);
                const hasEvents = dayEvents.length > 0;
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedDay(day === selectedDay ? null : day)}
                    className={`relative aspect-square rounded-lg text-xs font-medium transition-colors flex flex-col items-center justify-center gap-0.5 ${
                      isSelected ? 'bg-primary text-primary-foreground' :
                      isToday ? 'bg-primary/10 text-primary font-bold' :
                      'hover:bg-accent'
                    }`}
                  >
                    {day}
                    {hasEvents && (
                      <div className="flex gap-0.5">
                        {dayEvents.slice(0, 3).map((_, i) => (
                          <span key={i} className={`w-1 h-1 rounded-full ${
                            isSelected ? 'bg-primary-foreground' :
                            hasScaduto ? 'bg-red-500' : 'bg-primary'
                          }`} />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Dettaglio giorno selezionato */}
            {selectedDay && (
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-semibold text-muted-foreground mb-2">
                  {selectedDay} {MESI[month]} {year}
                  {selectedEvents.length === 0 && ' — nessun evento'}
                </p>
                <div className="space-y-2">
                  {selectedEvents.map(e => (
                    <div
                      key={e.id}
                      onClick={() => e.pratica_id && navigate(`/admin/pratiche/${e.pratica_id}`)}
                      className={`flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer hover:bg-accent/50 transition-colors ${
                        e.scaduto ? 'border-red-200 bg-red-50' : 'border-border'
                      }`}
                    >
                      {e.tipo === 'scadenza' ? <Clock className={`w-3.5 h-3.5 mt-0.5 ${e.scaduto ? 'text-red-500' : 'text-amber-500'}`} /> : <CheckSquare className={`w-3.5 h-3.5 mt-0.5 ${e.scaduto ? 'text-red-500' : 'text-blue-500'}`} />}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{e.titolo}</p>
                        {e.cliente && <p className="text-muted-foreground truncate">{e.cliente} {e.pratica_numero ? `#${e.pratica_numero}` : ''}</p>}
                        {e.scaduto && <span className="text-red-600 font-semibold">SCADUTO</span>}
                      </div>
                      <Badge className={`text-[10px] shrink-0 ${e.tipo === 'scadenza' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}`}>
                        {e.tipo === 'scadenza' ? 'Scadenza' : 'Task'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sidebar: prossimi 14 giorni */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-primary" /> Prossimi 14 giorni
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
            ) : upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nessuna scadenza nei prossimi 14 giorni</p>
            ) : (
              <div className="space-y-2">
                {upcoming.map(e => {
                  const d = new Date(e.data);
                  const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000);
                  return (
                    <div
                      key={e.id}
                      onClick={() => e.pratica_id && navigate(`/admin/pratiche/${e.pratica_id}`)}
                      className="flex items-start gap-2 p-2 rounded-lg border border-border hover:bg-accent/50 cursor-pointer transition-colors text-xs"
                    >
                      <div className={`w-8 h-8 rounded-lg flex flex-col items-center justify-center shrink-0 font-bold ${diff <= 2 ? 'bg-red-100 text-red-700' : diff <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                        <span className="text-[10px] leading-none">{MESI[d.getMonth()].slice(0,3)}</span>
                        <span className="text-sm leading-none">{d.getDate()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{e.titolo}</p>
                        {e.cliente && <p className="text-muted-foreground truncate">{e.cliente}</p>}
                        <p className={`font-semibold ${diff <= 2 ? 'text-red-600' : diff <= 7 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {diff === 0 ? 'Oggi' : diff === 1 ? 'Domani' : `tra ${diff}g`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
