import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Mail,
  MessageSquare,
  Upload,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { APP_TIME_ZONE, formatRomeDateTime } from '@/lib/dateTime';
import { STATUS_LABELS, type PracticeStatusLog } from '@/lib/types';

type ActivityLog = {
  id: string;
  action: string;
  actor_nome?: string;
  actor_ruolo?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

type TimelineCategory =
  | 'phase'
  | 'document_request'
  | 'document_upload'
  | 'bank'
  | 'email'
  | 'document_access'
  | 'note'
  | 'other';

type TimelineEvent = {
  id: string;
  title: string;
  description?: string;
  timestamp: string;
  dateKey: string;
  category: TimelineCategory;
  phase?: string;
  actor?: string;
  actorRole?: string;
};

type TimelineEmailLog = {
  id: string;
  bank_nome?: string | null;
  destinatari?: string[] | null;
  cc?: string[] | null;
  oggetto?: string | null;
  stato?: string | null;
  sent_by_nome?: string | null;
  delivery_type?: 'pratica' | 'approfondimento' | 'copia' | string | null;
  created_at: string;
  opened_at?: string | null;
  delivered_at?: string | null;
  recipient_events?: Record<string, {
    stato?: string;
    evento?: string;
    timestamp?: string;
  }> | null;
};

type TimelineDocumentAccessLog = {
  id: string;
  event_type: 'opened' | 'downloaded';
  occurred_at: string;
  bank_id?: string | null;
};

type PhaseStyle = {
  label: string;
  bar: string;
  soft: string;
  text: string;
  dot: string;
};

const MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre',
];
const WEEK_DAYS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'];

const PHASE_STYLES: Record<string, PhaseStyle> = {
  bozza: {
    label: 'Bozza',
    bar: 'bg-slate-400',
    soft: 'bg-slate-50 border-slate-200',
    text: 'text-slate-700',
    dot: 'bg-slate-400',
  },
  raccolta_documenti: {
    label: 'Raccolta documenti',
    bar: 'bg-amber-500',
    soft: 'bg-amber-50 border-amber-200',
    text: 'text-amber-800',
    dot: 'bg-amber-500',
  },
  integrazioni_richieste: {
    label: 'Integrazioni richieste',
    bar: 'bg-orange-500',
    soft: 'bg-orange-50 border-orange-200',
    text: 'text-orange-800',
    dot: 'bg-orange-500',
  },
  inviata_banca: {
    label: 'Inviata alla banca',
    bar: 'bg-blue-500',
    soft: 'bg-blue-50 border-blue-200',
    text: 'text-blue-800',
    dot: 'bg-blue-500',
  },
  istruttoria: {
    label: 'Istruttoria',
    bar: 'bg-cyan-500',
    soft: 'bg-cyan-50 border-cyan-200',
    text: 'text-cyan-800',
    dot: 'bg-cyan-500',
  },
  completata: {
    label: 'Istruttoria completata',
    bar: 'bg-teal-500',
    soft: 'bg-teal-50 border-teal-200',
    text: 'text-teal-800',
    dot: 'bg-teal-500',
  },
  in_delibera: {
    label: 'In delibera',
    bar: 'bg-violet-500',
    soft: 'bg-violet-50 border-violet-200',
    text: 'text-violet-800',
    dot: 'bg-violet-500',
  },
  deliberata: {
    label: 'Deliberata',
    bar: 'bg-indigo-500',
    soft: 'bg-indigo-50 border-indigo-200',
    text: 'text-indigo-800',
    dot: 'bg-indigo-500',
  },
  approvata: {
    label: 'Approvata',
    bar: 'bg-green-500',
    soft: 'bg-green-50 border-green-200',
    text: 'text-green-800',
    dot: 'bg-green-500',
  },
  erogata: {
    label: 'Erogata',
    bar: 'bg-emerald-600',
    soft: 'bg-emerald-50 border-emerald-200',
    text: 'text-emerald-800',
    dot: 'bg-emerald-600',
  },
  rifiutata: {
    label: 'Rifiutata',
    bar: 'bg-red-500',
    soft: 'bg-red-50 border-red-200',
    text: 'text-red-800',
    dot: 'bg-red-500',
  },
  declinata: {
    label: 'Declinata',
    bar: 'bg-rose-600',
    soft: 'bg-rose-50 border-rose-200',
    text: 'text-rose-800',
    dot: 'bg-rose-600',
  },
};

const FALLBACK_PHASE: PhaseStyle = {
  label: 'Fase pratica',
  bar: 'bg-slate-500',
  soft: 'bg-slate-50 border-slate-200',
  text: 'text-slate-700',
  dot: 'bg-slate-500',
};

const EVENT_STYLES: Record<Exclude<TimelineCategory, 'phase'>, {
  label: string;
  dot: string;
  badge: string;
}> = {
  document_request: {
    label: 'Richiesta documentale',
    dot: 'bg-orange-500',
    badge: 'bg-orange-100 text-orange-800 border-orange-200',
  },
  document_upload: {
    label: 'Documento caricato',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  },
  bank: {
    label: 'Attività banca',
    dot: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
  },
  email: {
    label: 'Comunicazione',
    dot: 'bg-fuchsia-500',
    badge: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200',
  },
  document_access: {
    label: 'Lettura documento',
    dot: 'bg-indigo-500',
    badge: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  },
  note: {
    label: 'Nota',
    dot: 'bg-purple-500',
    badge: 'bg-purple-100 text-purple-800 border-purple-200',
  },
  other: {
    label: 'Attività',
    dot: 'bg-slate-500',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
  },
};

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

function monthFromKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month: month - 1, day };
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function activityCategory(action: string): TimelineCategory {
  const normalized = action.toLocaleLowerCase('it-IT');
  if (
    normalized.includes('documenti_banca_inviati')
    || normalized.includes('documenti_banca_copia_inviati')
    || normalized.includes('approfondimenti_banca_inviati')
  ) return 'email';
  if (
    normalized.includes('richiesta_documentale')
    || normalized.includes('richiesta document')
    || normalized.includes('integrazione')
  ) return 'document_request';
  if (normalized.includes('document') || normalized.includes('caric')) return 'document_upload';
  if (normalized.includes('banca') || normalized.includes('delibera') || normalized.includes('istruttoria')) return 'bank';
  if (normalized.includes('email') || normalized.includes('notifica') || normalized.includes('inviat')) return 'email';
  if (normalized.includes('nota') || normalized.includes('note')) return 'note';
  return 'other';
}

function activityTitle(action: string): string {
  const labels: Record<string, string> = {
    richiesta_documentale_cliente_inviata: 'Richiesta documentale inviata al cliente',
    documenti_banca_inviati: 'Documenti inviati alla banca',
    documenti_banca_copia_inviati: 'Copia documenti inviata',
    approfondimenti_banca_inviati: 'Approfondimenti inviati alla banca',
    notifica_banche_inviata: 'Notifica inviata alle banche',
    risposta_domanda_cliente_inserita: 'Risposta alla domanda del cliente',
    pratica_assegnata: 'Pratica assegnata',
    documento_caricato: 'Documento caricato',
    campo_pratica_compilato_da_agente: 'Campo pratica compilato dall’agente',
  };
  return labels[action] ?? action.replace(/_/g, ' ');
}

function EventIcon({ category }: { category: TimelineCategory }) {
  if (category === 'phase') return <ArrowRightLeft className="h-4 w-4" />;
  if (category === 'document_request') return <FileText className="h-4 w-4" />;
  if (category === 'document_upload') return <Upload className="h-4 w-4" />;
  if (category === 'bank') return <Building2 className="h-4 w-4" />;
  if (category === 'email') return <Mail className="h-4 w-4" />;
  if (category === 'document_access') return <CheckCircle2 className="h-4 w-4" />;
  if (category === 'note') return <MessageSquare className="h-4 w-4" />;
  return <Clock className="h-4 w-4" />;
}

function timelineEventStyle(event: TimelineEvent): {
  dot: string;
  icon: string;
  badge: string;
  label: string;
} {
  if (event.category === 'phase') {
    const style = PHASE_STYLES[event.phase ?? ''] ?? FALLBACK_PHASE;
    return {
      dot: style.dot,
      icon: `${style.soft} ${style.text}`,
      badge: `${style.soft} ${style.text}`,
      label: style.label,
    };
  }

  const style = EVENT_STYLES[event.category];
  return {
    dot: style.dot,
    icon: style.badge,
    badge: style.badge,
    label: style.label,
  };
}

interface PracticeTimelineCalendarProps {
  currentStatus: string;
  practiceCreatedAt: string;
  statusLogs: PracticeStatusLog[];
  activityLogs: ActivityLog[];
  emailLogs?: TimelineEmailLog[];
  documentAccessLogs?: TimelineDocumentAccessLog[];
}

export default function PracticeTimelineCalendar({
  currentStatus,
  practiceCreatedAt,
  statusLogs,
  activityLogs,
  emailLogs = [],
  documentAccessLogs = [],
}: PracticeTimelineCalendarProps) {
  const todayKey = romeDateKey(new Date());
  const todayParts = monthFromKey(todayKey);
  const newestTimestamp = [
    ...statusLogs.map(item => item.created_at),
    ...activityLogs.map(item => item.created_at),
    ...emailLogs.map(item => item.created_at),
    ...documentAccessLogs.map(item => item.occurred_at),
  ].filter(Boolean).sort().at(-1);
  const initialMonth = newestTimestamp ? monthFromKey(romeDateKey(newestTimestamp)) : todayParts;
  const [year, setYear] = useState(initialMonth.year);
  const [month, setMonth] = useState(initialMonth.month);
  const [selectedDate, setSelectedDate] = useState(
    initialMonth.year === todayParts.year && initialMonth.month === todayParts.month
      ? todayKey
      : ''
  );

  useEffect(() => {
    if (selectedDate.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)) return;
    setSelectedDate('');
  }, [year, month, selectedDate]);

  const sortedStatusLogs = useMemo(
    () => [...statusLogs].sort((left, right) => left.created_at.localeCompare(right.created_at)),
    [statusLogs]
  );

  const events = useMemo<TimelineEvent[]>(() => {
    const phaseEvents = sortedStatusLogs.map(log => ({
      id: `phase-${log.id}`,
      title: `Fase: ${STATUS_LABELS[log.new_status as keyof typeof STATUS_LABELS] ?? PHASE_STYLES[log.new_status]?.label ?? log.new_status}`,
      description: log.note || undefined,
      timestamp: log.created_at,
      dateKey: romeDateKey(log.created_at),
      category: 'phase' as const,
      phase: log.new_status,
    }));
    const activities = activityLogs
      .filter(log => !log.action.toLocaleLowerCase('it-IT').startsWith('stato cambiato:'))
      .filter(log => ![
        'documenti_banca_inviati',
        'documenti_banca_copia_inviati',
        'approfondimenti_banca_inviati',
      ].includes(log.action))
      .map(log => ({
        id: `activity-${log.id}`,
        title: activityTitle(log.action),
        description: typeof log.metadata?.note === 'string'
          ? log.metadata.note
          : undefined,
        timestamp: log.created_at,
        dateKey: romeDateKey(log.created_at),
        category: activityCategory(log.action),
        actor: log.actor_nome,
        actorRole: log.actor_ruolo,
      }));

    const emailEvents = emailLogs.map(log => {
      const isIntegration = log.delivery_type === 'approfondimento';
      const isCopy = log.delivery_type === 'copia';
      const recipient = (log.destinatari ?? []).join(', ') || 'destinatario non indicato';
      const cc = (log.cc ?? []).filter(Boolean);
      const recipientStatuses = Object.entries(log.recipient_events ?? {})
        .map(([address, event]) => `${address}: ${event.stato ?? 'inviata'}`);
      const state = log.opened_at
        ? `Letta dal destinatario il ${formatRomeDateTime(log.opened_at)}`
        : log.delivered_at
          ? `Consegnata il ${formatRomeDateTime(log.delivered_at)}`
          : log.stato === 'rimbalzata'
            ? 'Rimbalzata'
            : log.stato === 'spam'
              ? 'Segnalata come spam'
              : 'Inviata, in attesa di conferma';
      const title = isCopy
        ? 'Copia documenti inviata'
        : isIntegration
          ? 'Integrazione inviata alla banca'
          : 'Documenti inviati alla banca';
      return {
        id: `email-${log.id}`,
        title,
        description: `${recipientStatuses.length > 0 ? `Stati destinatari: ${recipientStatuses.join(' · ')}. ` : ''}${state} · A: ${recipient}${cc.length > 0 ? ` · CC: ${cc.join(', ')}` : ''}${log.bank_nome ? ` · ${log.bank_nome}` : ''}`,
        timestamp: log.created_at,
        dateKey: romeDateKey(log.created_at),
        category: 'email' as const,
        actor: log.sent_by_nome ?? undefined,
      };
    });

    const documentAccessEvents = documentAccessLogs.map(log => ({
      id: `document-access-${log.id}`,
      title: log.event_type === 'downloaded'
        ? 'Documento scaricato dalla banca'
        : 'Documento aperto dalla banca',
      description: log.event_type === 'downloaded'
        ? 'Il destinatario ha scaricato il documento dal link tracciato.'
        : 'Il destinatario ha aperto il link tracciato del documento.',
      timestamp: log.occurred_at,
      dateKey: romeDateKey(log.occurred_at),
      category: 'document_access' as const,
    }));

    return [...phaseEvents, ...activities, ...emailEvents, ...documentAccessEvents]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  }, [activityLogs, documentAccessLogs, emailLogs, sortedStatusLogs]);

  const practiceStartKey = romeDateKey(practiceCreatedAt);
  const initialStatus = sortedStatusLogs[0]?.old_status || (sortedStatusLogs.length === 0 ? currentStatus : 'bozza');
  const phaseForDay = (key: string): string | null => {
    if (!practiceStartKey || key < practiceStartKey || key > todayKey) return null;
    let phase = initialStatus || 'bozza';
    sortedStatusLogs.forEach(log => {
      if (romeDateKey(log.created_at) <= key) phase = log.new_status;
    });
    return phase;
  };

  const firstWeekDay = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<number | null> = [
    ...Array(firstWeekDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsForDay = (key: string) => events.filter(event => event.dateKey === key);
  const selectedEvents = selectedDate ? eventsForDay(selectedDate) : [];
  const selectedPhase = selectedDate ? phaseForDay(selectedDate) : null;

  const phaseLegend = useMemo(() => {
    const keys = new Set<string>();
    if (currentStatus) keys.add(currentStatus);
    sortedStatusLogs.forEach(log => {
      if (log.old_status) keys.add(log.old_status);
      keys.add(log.new_status);
    });
    return [...keys].map(key => ({ key, style: PHASE_STYLES[key] ?? FALLBACK_PHASE }));
  }, [currentStatus, sortedStatusLogs]);

  const previousMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear(value => value - 1);
    } else setMonth(value => value - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear(value => value + 1);
    } else setMonth(value => value + 1);
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-slate-200">
        <CardHeader className="border-b border-slate-100 bg-slate-50/70 pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-4 w-4 text-primary" />
                Percorso della pratica
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                La banda colorata indica la fase attiva del giorno; i punti segnalano le attività registrate.
              </p>
            </div>
            <div className="flex items-center justify-between gap-1 rounded-lg border bg-white p-1 sm:min-w-[230px]">
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={previousMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm font-semibold">{MONTHS[month]} {year}</span>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2">
            {phaseLegend.map(({ key, style }) => (
              <div key={key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={`h-2.5 w-2.5 rounded-sm ${style.dot}`} />
                {style.label}
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-full ${EVENT_STYLES.document_request.dot}`} />
              Richiesta documentale
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-full ${EVENT_STYLES.document_upload.dot}`} />
              Documento caricato
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-full ${EVENT_STYLES.email.dot}`} />
              Invio / consegna email
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`h-2.5 w-2.5 rounded-full ${EVENT_STYLES.document_access.dot}`} />
              Apertura / download banca
            </div>
          </div>

          <div className="grid grid-cols-7 border-l border-t border-slate-200">
            {WEEK_DAYS.map((label, index) => (
              <div
                key={`${label}-${index}`}
                className="border-b border-r border-slate-200 bg-slate-50 py-1.5 text-center text-[10px] font-semibold text-slate-500 sm:text-xs"
              >
                {label}
              </div>
            ))}
            {cells.map((day, index) => {
              if (!day) {
                return <div key={`empty-${index}`} className="min-h-16 border-b border-r border-slate-200 bg-slate-50/30 sm:min-h-24" />;
              }
              const key = dateKey(year, month, day);
              const phase = phaseForDay(key);
              const phaseStyle = phase ? PHASE_STYLES[phase] ?? FALLBACK_PHASE : null;
              const dayEvents = eventsForDay(key);
              const isToday = key === todayKey;
              const isSelected = key === selectedDate;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(isSelected ? '' : key)}
                  className={`relative min-h-16 overflow-hidden border-b border-r border-slate-200 p-1.5 text-left transition-colors sm:min-h-24 sm:p-2 ${
                    isSelected ? 'bg-primary/5 ring-2 ring-inset ring-primary' : 'bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      isToday ? 'bg-primary text-primary-foreground' : 'text-slate-700'
                    }`}>
                      {day}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="text-[9px] font-semibold text-slate-400 sm:text-[10px]">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 hidden space-y-1 sm:block">
                    {dayEvents.slice(0, 2).map(event => {
                      const eventStyle = timelineEventStyle(event);
                      return (
                        <div key={event.id} className="flex min-w-0 items-center gap-1">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${eventStyle.dot}`} />
                          <span className="truncate text-[9px] leading-tight text-slate-600">{event.title}</span>
                        </div>
                      );
                    })}
                  </div>
                  {dayEvents.length > 0 && (
                    <div className="mt-1 flex gap-1 sm:hidden">
                      {dayEvents.slice(0, 3).map(event => {
                        const eventStyle = timelineEventStyle(event);
                        return <span key={event.id} className={`h-1.5 w-1.5 rounded-full ${eventStyle.dot}`} />;
                      })}
                    </div>
                  )}
                  {phaseStyle && (
                    <div className={`absolute inset-x-0 bottom-0 h-1.5 ${phaseStyle.bar}`} title={phaseStyle.label} />
                  )}
                </button>
              );
            })}
          </div>

          {selectedDate && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {new Intl.DateTimeFormat('it-IT', {
                    timeZone: APP_TIME_ZONE,
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  }).format(new Date(`${selectedDate}T12:00:00Z`))}
                </p>
                {selectedPhase && (() => {
                  const style = PHASE_STYLES[selectedPhase] ?? FALLBACK_PHASE;
                  return (
                    <Badge className={`${style.soft} ${style.text}`}>
                      <span className={`mr-1.5 h-2 w-2 rounded-sm ${style.dot}`} />
                      {style.label}
                    </Badge>
                  );
                })()}
              </div>
              {selectedEvents.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">Nessuna attività puntuale registrata in questo giorno.</p>
              ) : (
                <div className="mt-3 space-y-2">
                  {selectedEvents.map(event => {
                    const style = timelineEventStyle(event);
                    return (
                      <div key={event.id} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
                          <EventIcon category={event.category} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-slate-800">{event.title}</p>
                          {event.description && <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>}
                          <p className="mt-1 text-[10px] text-muted-foreground">{formatRomeDateTime(event.timestamp)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Elenco cronologico</CardTitle>
          <p className="text-xs text-muted-foreground">Cambi di fase e attività della pratica, dal più recente.</p>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Clock className="mx-auto mb-2 h-8 w-8 opacity-30" />
              Nessuna attività registrata per questa pratica
            </div>
          ) : (
            <div className="space-y-2">
              {events.map(event => {
                const eventStyle = timelineEventStyle(event);
                return (
                  <div key={event.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${eventStyle.icon}`}>
                      <EventIcon category={event.category} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">{event.title}</p>
                        <Badge className={`text-[10px] ${eventStyle.badge}`}>
                          {eventStyle.label}
                        </Badge>
                      </div>
                      {event.description && <p className="mt-1 text-xs text-muted-foreground">{event.description}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRomeDateTime(event.timestamp)}
                        </span>
                        {event.actor && <span>{event.actor}</span>}
                        {event.actorRole && <span className="rounded-full bg-slate-100 px-1.5 py-0.5">{event.actorRole}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
