import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Clock, CheckSquare, AlertCircle, RefreshCw, Activity, Upload, Mail, ArrowRightLeft, ClipboardList, Inbox } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatRomeDateTime, APP_TIME_ZONE } from '@/lib/dateTime';

interface CalEvent {
  id: string;
  tipo: 'scadenza' | 'task' | 'attivita' | 'stato' | 'upload' | 'email' | 'integrazione' | 'segnalazione';
  titolo: string;
  data: string;      // YYYY-MM-DD
  timestamp?: string;
  descrizione?: string;
  pratica_id?: string;
  pratica_numero?: string;
  cliente?: string;
  stato?: string;
  priorita?: string;
  scaduto?: boolean;
  link?: string;
}

const MESI = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const GIORNI_SHORT = ['D','L','M','M','G','V','S'];

function romeDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function eventTitle(action: string, metadata?: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    richiesta_documentale_cliente_inviata: 'Richiesta documenti inviata al cliente',
    approfondimenti_banca_inviati: 'Approfondimenti inviati alla banca',
    notifica_banche_inviata: 'Notifica inviata alle banche',
    risposta_domanda_cliente_inserita: 'Risposta a domanda cliente inserita',
    pratica_assegnata: 'Pratica assegnata',
    documento_caricato: 'Documento caricato',
  };
  if (labels[action]) return labels[action];
  const bank = typeof metadata?.banca === 'string' ? ` · ${metadata.banca}` : '';
  return `${action.replaceAll('_', ' ')}${bank}`;
}

function eventIcon(tipo: CalEvent['tipo'], scaduto?: boolean) {
  if (tipo === 'scadenza') return <Clock className={`w-3.5 h-3.5 mt-0.5 ${scaduto ? 'text-red-500' : 'text-amber-500'}`} />;
  if (tipo === 'task') return <CheckSquare className={`w-3.5 h-3.5 mt-0.5 ${scaduto ? 'text-red-500' : 'text-blue-500'}`} />;
  if (tipo === 'upload') return <Upload className="w-3.5 h-3.5 mt-0.5 text-emerald-600" />;
  if (tipo === 'email') return <Mail className="w-3.5 h-3.5 mt-0.5 text-violet-600" />;
  if (tipo === 'stato') return <ArrowRightLeft className="w-3.5 h-3.5 mt-0.5 text-cyan-600" />;
  if (tipo === 'integrazione') return <ClipboardList className="w-3.5 h-3.5 mt-0.5 text-orange-600" />;
  if (tipo === 'segnalazione') return <Inbox className="w-3.5 h-3.5 mt-0.5 text-rose-600" />;
  return <Activity className="w-3.5 h-3.5 mt-0.5 text-primary" />;
}

function eventTypeLabel(tipo: CalEvent['tipo']): string {
  return {
    scadenza: 'Scadenza',
    task: 'Task',
    attivita: 'Attività',
    stato: 'Cambio stato',
    upload: 'Documento',
    email: 'Email',
    integrazione: 'Integrazione',
    segnalazione: 'Valutazione',
  }[tipo];
}

export default function CalendarioPage() {
  const { user, isSuperAdmin, isSegreteria, isAgente, isSegnalatore } = useAuth();
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
    try {
      // Risolviamo prima le pratiche visibili: super admin tutte, segreteria
      // quelle dei propri agenti, agente solo quelle assegnate a sé.
      let allowedIds: string[] | null = null;
      let allowedAgentIds: string[] = [];
      if (isAgente) {
        const { data } = await supabase.from('practices').select('id').eq('assigned_to', user.id);
        allowedIds = (data ?? []).map(row => row.id);
      } else if (isSegreteria) {
        const { data: assignments } = await supabase
          .from('segreteria_agent_assignments')
          .select('agent_user_id')
          .eq('segreteria_user_id', user.id);
        allowedAgentIds = (assignments ?? []).map(row => row.agent_user_id);
        if (allowedAgentIds.length > 0) {
          const { data } = await supabase.from('practices').select('id').in('assigned_to', allowedAgentIds);
          allowedIds = (data ?? []).map(row => row.id);
        } else {
          allowedIds = [];
        }
      } else if (isSegnalatore) {
        const { data } = await supabase.from('practices').select('id').eq('segnalatore_id', user.id);
        allowedIds = (data ?? []).map(row => row.id);
      }

      const [practiceRows, publicRequests] = await Promise.all([
        (() => {
          let query = supabase
            .from('practices')
            .select('id,numero_pratica,assigned_to,segnalatore_id,clients(ragione_sociale)');
          if (allowedIds !== null) {
            query = query.in('id', allowedIds.length > 0 ? allowedIds : ['00000000-0000-0000-0000-000000000000']);
          }
          return query;
        })(),
        (() => {
          let query = supabase
            .from('segnalazioni_pubbliche')
            .select('id,ragione_sociale,stato,tipo_richiesta,practice_id,agente_id,created_at')
            .gte('created_at', `${year - 1}-12-31T23:00:00.000Z`)
            .lt('created_at', `${year + 1}-01-01T23:00:00.000Z`);
          // Le segnalazioni senza pratica sono lead del super admin; dopo
          // l'assegnazione diventano visibili anche all'agente competente.
          if (isAgente) query = query.eq('agente_id', user.id);
          else if (isSegreteria && allowedAgentIds.length > 0) query = query.in('agente_id', allowedAgentIds);
          else if (isSegreteria) query = query.in('agente_id', ['00000000-0000-0000-0000-000000000000']);
          else if (isSegnalatore) query = query.in('practice_id', allowedIds?.length ? allowedIds : ['00000000-0000-0000-0000-000000000000']);
          return query;
        })(),
      ]);
      const practices = (practiceRows.data ?? []) as any[];
      const practiceMap = new Map(practices.map(practice => [
        practice.id,
        {
          numero: practice.numero_pratica,
          cliente: Array.isArray(practice.clients) ? practice.clients[0]?.ragione_sociale : practice.clients?.ragione_sociale,
        },
      ]));

      const applyPracticeFilter = <T extends { in: (column: string, values: string[]) => T }>(query: T): T => (
        allowedIds === null
          ? query
          : query.in('practice_id', allowedIds.length > 0 ? allowedIds : ['00000000-0000-0000-0000-000000000000'])
      );
      const rangeStart = new Date(Date.UTC(year, 0, 1) - 86400000).toISOString();
      const rangeEnd = new Date(Date.UTC(year + 1, 0, 1) + 86400000).toISOString();
      const [deadlines, tasks, activities, statusLogs, uploads, emailLogs, integrations] = await Promise.all([
        applyPracticeFilter(supabase.from('document_deadlines')
          .select('id, documento, data_scadenza, practice_id')
          .gte('data_scadenza', `${year}-01-01`)
          .lte('data_scadenza', `${year}-12-31`)),
        applyPracticeFilter(supabase.from('practice_tasks')
          .select('id, titolo, scadenza, stato, priorita, practice_id')
          .not('scadenza', 'is', null)
          .gte('scadenza', `${year}-01-01`)
          .lte('scadenza', `${year}-12-31`)
          .neq('stato', 'annullata')),
        applyPracticeFilter(supabase.from('practice_activity_log')
          .select('id,practice_id,action,actor_nome,metadata,created_at')
          .gte('created_at', rangeStart)
          .lt('created_at', rangeEnd)),
        applyPracticeFilter(supabase.from('practice_status_log')
          .select('id,practice_id,old_status,new_status,note,created_at')
          .gte('created_at', rangeStart)
          .lt('created_at', rangeEnd)),
        applyPracticeFilter(supabase.from('uploaded_files')
          .select('id,practice_id,practice_document_id,nome_file,uploaded_by,created_at'))
          .gte('created_at', rangeStart)
          .lt('created_at', rangeEnd),
        applyPracticeFilter(supabase.from('email_send_log')
          .select('id,practice_id,bank_nome,oggetto,destinatari,delivery_type,created_at')
          .gte('created_at', rangeStart)
          .lt('created_at', rangeEnd)),
        applyPracticeFilter(supabase.from('practice_integration_requests')
          .select('id,practice_id,note,requested_at,sent_at,practice_bank_id')
          .gte('created_at', rangeStart)
          .lt('created_at', rangeEnd)),
      ]);

      const todayStr = romeDateKey(today);
      const info = (practiceId?: string) => practiceId ? practiceMap.get(practiceId) : undefined;
      const evs: CalEvent[] = [
        ...((deadlines.data ?? []) as any[]).map(d => ({
        id: d.id,
        tipo: 'scadenza' as const,
        titolo: d.documento,
        data: d.data_scadenza,
        timestamp: d.data_scadenza,
        pratica_id: d.practice_id,
        pratica_numero: info(d.practice_id)?.numero,
        cliente: info(d.practice_id)?.cliente,
        scaduto: d.data_scadenza < todayStr,
      })),
      ...((tasks.data ?? []) as any[]).map(t => ({
        id: t.id,
        tipo: 'task' as const,
        titolo: t.titolo,
        data: t.scadenza,
        timestamp: t.scadenza,
        pratica_id: t.practice_id,
        pratica_numero: info(t.practice_id)?.numero,
        cliente: info(t.practice_id)?.cliente,
        stato: t.stato,
        priorita: t.priorita,
        scaduto: t.scadenza < todayStr && t.stato !== 'completata',
      })),
      ...((activities.data ?? []) as any[]).map(activity => ({
        id: `activity-${activity.id}`,
        tipo: 'attivita' as const,
        titolo: eventTitle(activity.action, activity.metadata),
        data: romeDateKey(activity.created_at),
        timestamp: activity.created_at,
        descrizione: activity.actor_nome ? `Operatore: ${activity.actor_nome}` : undefined,
        pratica_id: activity.practice_id,
        pratica_numero: info(activity.practice_id)?.numero,
        cliente: info(activity.practice_id)?.cliente,
      })),
      ...((statusLogs.data ?? []) as any[]).map(log => ({
        id: `status-${log.id}`,
        tipo: 'stato' as const,
        titolo: `Stato pratica: ${log.old_status || '—'} → ${log.new_status}`,
        data: romeDateKey(log.created_at),
        timestamp: log.created_at,
        descrizione: log.note || undefined,
        pratica_id: log.practice_id,
        pratica_numero: info(log.practice_id)?.numero,
        cliente: info(log.practice_id)?.cliente,
      })),
      ...((uploads.data ?? []) as any[]).map(file => ({
        id: `upload-${file.id}`,
        tipo: 'upload' as const,
        titolo: `Documento caricato: ${file.nome_file}`,
        data: romeDateKey(file.created_at),
        timestamp: file.created_at,
        descrizione: file.uploaded_by ? `Caricato da: ${file.uploaded_by}` : undefined,
        pratica_id: file.practice_id,
        pratica_numero: info(file.practice_id)?.numero,
        cliente: info(file.practice_id)?.cliente,
      })),
      ...((emailLogs.data ?? []) as any[]).map(email => ({
        id: `email-${email.id}`,
        tipo: 'email' as const,
        titolo: email.delivery_type === 'approfondimento'
          ? `Approfondimenti inviati${email.bank_nome ? ` a ${email.bank_nome}` : ''}`
          : `Pratica inviata${email.bank_nome ? ` a ${email.bank_nome}` : ''}`,
        data: romeDateKey(email.created_at),
        timestamp: email.created_at,
        descrizione: email.oggetto || undefined,
        pratica_id: email.practice_id,
        pratica_numero: info(email.practice_id)?.numero,
        cliente: info(email.practice_id)?.cliente,
      })),
      ...((integrations.data ?? []) as any[]).flatMap(integration => {
        const requested = integration.requested_at
          ? [{
              id: `integration-request-${integration.id}`,
              tipo: 'integrazione' as const,
              titolo: 'Richiesta integrazione documentale',
              data: romeDateKey(integration.requested_at),
              timestamp: integration.requested_at,
              descrizione: integration.note || undefined,
              pratica_id: integration.practice_id,
              pratica_numero: info(integration.practice_id)?.numero,
              cliente: info(integration.practice_id)?.cliente,
            }]
          : [];
        const sent = integration.sent_at
          ? [{
              id: `integration-sent-${integration.id}`,
              tipo: 'email' as const,
              titolo: 'Integrazione inviata alla banca',
              data: romeDateKey(integration.sent_at),
              timestamp: integration.sent_at,
              descrizione: integration.note || undefined,
              pratica_id: integration.practice_id,
              pratica_numero: info(integration.practice_id)?.numero,
              cliente: info(integration.practice_id)?.cliente,
            }]
          : [];
        return [...requested, ...sent];
      }),
      ...((publicRequests.data ?? []) as any[]).map(request => ({
        id: `public-${request.id}`,
        tipo: 'segnalazione' as const,
        titolo: request.tipo_richiesta === 'report_autonomo'
          ? 'Nuova valutazione autonoma ricevuta'
          : 'Nuova segnalazione pubblica ricevuta',
        data: romeDateKey(request.created_at),
        timestamp: request.created_at,
        descrizione: `${request.ragione_sociale}${request.piva ? ` · P.IVA ${request.piva}` : ''} · Stato: ${request.stato}`,
        pratica_id: request.practice_id || undefined,
        pratica_numero: info(request.practice_id)?.numero,
        cliente: request.ragione_sociale,
        link: '/admin/segnalazioni-ricevute',
      })),
    ];
      setEvents(evs.filter(event => event.data.startsWith(String(year))));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user?.id, year, isSuperAdmin, isSegreteria, isAgente, isSegnalatore]);

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
          <h1 className="text-2xl font-bold">Calendario attività e scadenze</h1>
          <p className="text-muted-foreground text-sm mt-1">Scadenze, attività operative, invii, cambi di stato e documenti caricati</p>
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
                      onClick={() => e.pratica_id
                        ? navigate(`/admin/pratiche/${e.pratica_id}`)
                        : e.link
                          ? navigate(e.link)
                          : undefined}
                      className={`flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer hover:bg-accent/50 transition-colors ${
                        e.scaduto ? 'border-red-200 bg-red-50' : 'border-border'
                      }`}
                    >
                      {eventIcon(e.tipo, e.scaduto)}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{e.titolo}</p>
                        {e.cliente && <p className="text-muted-foreground truncate">{e.cliente} {e.pratica_numero ? `#${e.pratica_numero}` : ''}</p>}
                        {e.descrizione && <p className="text-muted-foreground/80 truncate">{e.descrizione}</p>}
                        {e.timestamp && e.tipo !== 'scadenza' && e.tipo !== 'task' && (
                          <p className="text-[10px] text-muted-foreground">{formatRomeDateTime(e.timestamp)}</p>
                        )}
                        {e.scaduto && <span className="text-red-600 font-semibold">SCADUTO</span>}
                      </div>
                      <Badge className={`text-[10px] shrink-0 ${
                        e.tipo === 'scadenza' ? 'bg-amber-100 text-amber-800'
                          : e.tipo === 'task' ? 'bg-blue-100 text-blue-800'
                            : 'bg-slate-100 text-slate-700'
                      }`}>
                        {eventTypeLabel(e.tipo)}
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
                          onClick={() => e.pratica_id
                            ? navigate(`/admin/pratiche/${e.pratica_id}`)
                            : e.link
                              ? navigate(e.link)
                              : undefined}
                      className="flex items-start gap-2 p-2 rounded-lg border border-border hover:bg-accent/50 cursor-pointer transition-colors text-xs"
                    >
                      <div className={`w-8 h-8 rounded-lg flex flex-col items-center justify-center shrink-0 font-bold ${diff <= 2 ? 'bg-red-100 text-red-700' : diff <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                        <span className="text-[10px] leading-none">{MESI[d.getMonth()].slice(0,3)}</span>
                        <span className="text-sm leading-none">{d.getDate()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{e.titolo}</p>
                        {e.cliente && <p className="text-muted-foreground truncate">{e.cliente}</p>}
                        {e.tipo !== 'scadenza' && e.tipo !== 'task' && <p className="text-[10px] text-muted-foreground">{eventTypeLabel(e.tipo)}</p>}
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
