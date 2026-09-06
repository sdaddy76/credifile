import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  FileSearch,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { analyzeDocumentCoherence, type CoherenceFinding, type DocumentCoherenceResult } from '@/lib/documentCoherence';
import { normalizePrimaryStatus } from '@/lib/practiceTimeline';
import { supabase } from '@/lib/supabase';

interface Props {
  practiceId: string;
}

type AlertStatus =
  | 'open'
  | 'answered_by_consultant'
  | 'client_requested'
  | 'client_answered'
  | 'ignored';

interface CoherenceAlert {
  id: string;
  practice_id: string;
  check_key: string;
  title: string;
  category: string;
  severity: 'alta' | 'media' | 'bassa';
  confidence: 'alta' | 'media' | 'bassa';
  finding: CoherenceFinding;
  source_fingerprint: string;
  status: AlertStatus;
  consultant_response?: string | null;
  ignore_reason?: string | null;
  client_question_id?: string | null;
  active: boolean;
  resolved_at?: string | null;
  practice_client_questions?: {
    risposta?: string | null;
    answered_at?: string | null;
  } | null;
}

const STATUS_LABELS: Record<AlertStatus, string> = {
  open: 'Da gestire',
  answered_by_consultant: 'Chiarito dal consulente',
  client_requested: 'Chiesto al cliente',
  client_answered: 'Risposta cliente ricevuta',
  ignored: 'Ignorato con motivazione',
};

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default function DocumentCoherenceTab({ practiceId }: Props) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<DocumentCoherenceResult | null>(null);
  const [alerts, setAlerts] = useState<CoherenceAlert[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingAlertId, setSavingAlertId] = useState<string | null>(null);

  const loadAndAnalyze = useCallback(async () => {
    setLoading(true);
    try {
      const [
        { data: practiceData, error: practiceError },
        { data: balanceData, error: balanceError },
        { data: financingData, error: financingError },
        { data: transactionData, error: transactionError },
        { data: existingData, error: existingError },
      ] = await Promise.all([
        supabase
          .from('practices')
          .select('numero_pratica,status,codice_ateco,importo_richiesto,client_id,clients(ragione_sociale,email,piva,codice_fiscale,capitale_sociale,codice_ateco,visura_json),assigned_agent:admin_profiles!practices_assigned_to_fkey(nome,email)')
          .eq('id', practiceId)
          .single(),
        supabase
          .from('bilanci_kpi')
          .select('id,anno_esercizio,ragione_sociale,capitale_sociale,debiti_banche_breve,debiti_banche_lungo,debiti_altri_finanziatori')
          .eq('practice_id', practiceId)
          .order('anno_esercizio', { ascending: false }),
        supabase
          .from('client_financing')
          .select('tipologia,banca_finanziaria,rata,debito_residuo,accordato,accordato_operativo,utilizzato,fonte,data_riferimento')
          .eq('practice_id', practiceId),
        supabase
          .from('estratto_conto_transactions')
          .select('data_valuta,data_contabile,importo,tipo,categoria,descrizione,beneficiario_ordinante,saldo_progressivo,classification_confidence,parse_confidence')
          .eq('practice_id', practiceId),
        supabase
          .from('document_coherence_alerts')
          .select('*, practice_client_questions(risposta,answered_at)')
          .eq('practice_id', practiceId),
      ]);
      if (practiceError) throw practiceError;
      if (balanceError) throw balanceError;
      if (financingError) throw financingError;
      if (transactionError && transactionError.code !== '42P01') throw transactionError;
      if (existingError && existingError.code !== '42P01') throw existingError;

      const practice = practiceData as unknown as {
        numero_pratica: string;
        status: string;
        codice_ateco?: string | null;
        importo_richiesto?: number | null;
        clients?: {
          ragione_sociale?: string | null;
          email?: string | null;
          piva?: string | null;
          codice_fiscale?: string | null;
          capitale_sociale?: number | null;
          codice_ateco?: string | null;
          visura_json?: Record<string, unknown> | null;
        } | Array<{
          ragione_sociale?: string | null;
          email?: string | null;
          piva?: string | null;
          codice_fiscale?: string | null;
          capitale_sociale?: number | null;
          codice_ateco?: string | null;
          visura_json?: Record<string, unknown> | null;
        }> | null;
      };
      const analysis = analyzeDocumentCoherence({
        client: relationOne(practice.clients),
        practice,
        balances: balanceData ?? [],
        financing: financingData ?? [],
        transactions: (transactionData ?? []) as Parameters<typeof analyzeDocumentCoherence>[0]['transactions'],
      });
      setResult(analysis);

      if (existingError?.code === '42P01') {
        setAlerts([]);
        return;
      }

      setSyncing(true);
      const existing = (existingData ?? []) as CoherenceAlert[];
      const currentKeys = new Set(analysis.findings.map(finding => finding.id));
      const toDeactivate = existing.filter(alert => alert.active && !currentKeys.has(alert.check_key));
      if (toDeactivate.length > 0) {
        const { error } = await supabase
          .from('document_coherence_alerts')
          .update({ active: false })
          .in('id', toDeactivate.map(alert => alert.id));
        if (error) throw error;
      }

      for (const finding of analysis.findings) {
        const current = existing.find(alert => alert.check_key === finding.id);
        if (!current) {
          const { error } = await supabase.from('document_coherence_alerts').insert({
            practice_id: practiceId,
            check_key: finding.id,
            title: finding.title,
            category: finding.category,
            severity: finding.severity,
            confidence: finding.confidence,
            finding,
            source_fingerprint: finding.source_fingerprint,
            active: true,
          });
          if (error) throw error;
          continue;
        }

        const evidenceChanged = current.source_fingerprint !== finding.source_fingerprint;
        const { error } = await supabase
          .from('document_coherence_alerts')
          .update({
            title: finding.title,
            category: finding.category,
            severity: finding.severity,
            confidence: finding.confidence,
            finding,
            source_fingerprint: finding.source_fingerprint,
            active: true,
            ...(evidenceChanged ? {
              status: 'open',
              consultant_response: null,
              ignore_reason: null,
              client_question_id: null,
              resolved_at: null,
            } : {}),
          })
          .eq('id', current.id);
        if (error) throw error;
      }

      const { data: refreshed, error: refreshedError } = await supabase
        .from('document_coherence_alerts')
        .select('*, practice_client_questions(risposta,answered_at)')
        .eq('practice_id', practiceId)
        .eq('active', true)
        .order('created_at');
      if (refreshedError) throw refreshedError;
      setAlerts((refreshed ?? []) as CoherenceAlert[]);
    } catch (error) {
      console.error('Errore coerenza documentale:', error);
      toast.error(`Impossibile completare la verifica documentale: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }, [practiceId]);

  useEffect(() => {
    loadAndAnalyze();
  }, [loadAndAnalyze]);

  const updateAlert = async (alert: CoherenceAlert, status: 'answered_by_consultant' | 'ignored') => {
    const note = notes[alert.id]?.trim() ?? '';
    if (!note) {
      toast.error(status === 'ignored'
        ? 'Inserisci il motivo per cui la segnalazione può essere ignorata'
        : 'Inserisci la spiegazione del consulente');
      return;
    }
    setSavingAlertId(alert.id);
    try {
      const resolvedAt = new Date().toISOString();
      const { error } = await supabase
        .from('document_coherence_alerts')
        .update({
          status,
          consultant_response: status === 'answered_by_consultant' ? note : null,
          ignore_reason: status === 'ignored' ? note : null,
          resolved_at: resolvedAt,
        })
        .eq('id', alert.id);
      if (error) throw error;
      setAlerts(previous => previous.map(item => item.id === alert.id ? {
        ...item,
        status,
        consultant_response: status === 'answered_by_consultant' ? note : null,
        ignore_reason: status === 'ignored' ? note : null,
        resolved_at: resolvedAt,
      } : item));
      toast.success(status === 'ignored' ? 'Segnalazione ignorata con motivazione' : 'Spiegazione salvata');
    } catch (error) {
      toast.error(`Errore aggiornamento: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingAlertId(null);
    }
  };

  const askClient = async (alert: CoherenceAlert) => {
    const question = notes[alert.id]?.trim() || alert.finding.suggested_question;
    if (!question) {
      toast.error('Inserisci la domanda da inviare al cliente');
      return;
    }
    setSavingAlertId(alert.id);
    let integrationRequestId: string | null = null;
    let questionId: string | null = null;
    try {
      const { data: authData } = await supabase.auth.getUser();
      const currentUser = authData.user;
      const [
        { data: practiceData, error: practiceError },
        { data: accessCode, error: accessError },
        { data: profile },
      ] = await Promise.all([
        supabase
          .from('practices')
          .select('numero_pratica,status,clients(ragione_sociale,email),assigned_agent:admin_profiles!practices_assigned_to_fkey(nome,email)')
          .eq('id', practiceId)
          .single(),
        supabase
          .from('practice_access_codes')
          .select('codice')
          .eq('practice_id', practiceId)
          .maybeSingle(),
        currentUser
          ? supabase.from('admin_profiles').select('nome,email').eq('id', currentUser.id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (practiceError) throw practiceError;
      if (accessError) throw accessError;

      const practice = practiceData as unknown as {
        numero_pratica: string;
        status: string;
        clients: { ragione_sociale: string; email: string } | Array<{ ragione_sociale: string; email: string }> | null;
        assigned_agent: { nome?: string; email: string } | Array<{ nome?: string; email: string }> | null;
      };
      const client = relationOne(practice.clients);
      const assignedAgent = relationOne(practice.assigned_agent);
      if (!client?.email) throw new Error('Il cliente non ha un indirizzo email');
      if (!accessCode?.codice) throw new Error('Genera prima il link e il codice di accesso del cliente');
      if (!assignedAgent?.email) throw new Error('Assegna alla pratica un agente con email valida');

      const { data: integrationRequest, error: integrationError } = await supabase
        .from('practice_integration_requests')
        .insert({
          practice_id: practiceId,
          origin_status: normalizePrimaryStatus(practice.status),
          status: 'open',
          note: `Chiarimento su coerenza documentale: ${alert.title}`,
          created_by: currentUser?.id ?? null,
        })
        .select('id')
        .single();
      if (integrationError || !integrationRequest?.id) {
        throw integrationError ?? new Error('Impossibile creare la richiesta di chiarimento');
      }
      integrationRequestId = integrationRequest.id;

      const { data: insertedQuestion, error: questionError } = await supabase
        .from('practice_client_questions')
        .insert({
          practice_id: practiceId,
          integration_request_id: integrationRequestId,
          domanda: question,
          stato: 'richiesta',
          created_by: currentUser?.id ?? null,
        })
        .select('id')
        .single();
      if (questionError || !insertedQuestion?.id) {
        throw questionError ?? new Error('Impossibile creare la domanda');
      }
      questionId = insertedQuestion.id;

      const { error: alertError } = await supabase
        .from('document_coherence_alerts')
        .update({ status: 'client_requested', client_question_id: questionId, resolved_at: null })
        .eq('id', alert.id);
      if (alertError) throw alertError;

      const consultantName = profile?.nome ?? currentUser?.email ?? 'Il tuo consulente';
      const { data: emailData, error: emailError } = await supabase.functions.invoke('send-client-email', {
        body: {
          to: client.email,
          consultant_name: consultantName,
          documents: [],
          questions: [question],
          link: `https://credifile-eosin.vercel.app/#/accesso?p=${practiceId}`,
          code: accessCode.codice,
          practice_number: practice.numero_pratica,
          company_name: client.ragione_sociale,
          subject_override: `Approfondimento documentale — ${client.ragione_sociale}`,
          cc: assignedAgent.email,
          reply_to: assignedAgent.email,
        },
      });
      if (emailError || emailData?.success === false) {
        throw new Error(`Domanda creata, ma email non inviata: ${emailData?.error ?? emailError?.message ?? 'errore sconosciuto'}`);
      }

      await Promise.all([
        supabase
          .from('practice_integration_requests')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', integrationRequestId),
        supabase.from('practice_activity_log').insert({
          practice_id: practiceId,
          action: 'chiarimento_coerenza_documentale_richiesto',
          actor_id: currentUser?.id ?? null,
          actor_nome: consultantName,
          actor_ruolo: 'consulente',
          metadata: {
            alert_id: alert.id,
            check_key: alert.check_key,
            domanda: question,
            destinatario: client.email,
            integration_request_id: integrationRequestId,
          },
        }),
      ]);

      setAlerts(previous => previous.map(item => item.id === alert.id
        ? { ...item, status: 'client_requested', client_question_id: questionId }
        : item
      ));
      toast.success(`Domanda inviata a ${client.email}`);
    } catch (error) {
      if (integrationRequestId) {
        await supabase.from('practice_integration_requests').delete().eq('id', integrationRequestId);
      }
      if (questionId) {
        await supabase
          .from('document_coherence_alerts')
          .update({ status: 'open', client_question_id: null, resolved_at: null })
          .eq('id', alert.id);
      }
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingAlertId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Verifica coerenza documentale in corso…
      </div>
    );
  }

  const openAlerts = alerts.filter(alert => alert.status === 'open' || alert.status === 'client_requested').length;
  const unavailableChecks = result?.checks.filter(check => check.status === 'non_verificabile').length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold">
            <FileSearch className="h-4 w-4 text-primary" />
            Coerenza documentale
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Confronto tra visura, bilancio, finanziamenti dichiarati, Centrale Rischi ed estratti conto.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={loadAndAnalyze} disabled={syncing}>
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          Ricalcola verifiche
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Copertura verifiche</p>
            <p className="mt-1 text-2xl font-bold">{result?.coverage ?? 0}%</p>
          </CardContent>
        </Card>
        <Card className={openAlerts > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-emerald-200 bg-emerald-50/40'}>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Elementi da gestire</p>
            <p className="mt-1 text-2xl font-bold">{openAlerts}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Verifiche non eseguibili</p>
            <p className="mt-1 text-2xl font-bold">{unavailableChecks}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Fonti disponibili</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(result?.availableSources ?? []).length > 0 ? result?.availableSources.map(source => (
            <Badge key={source} variant="outline" className="bg-blue-50 text-blue-700">{source}</Badge>
          )) : (
            <p className="text-xs text-muted-foreground">Nessuna fonte analizzabile disponibile.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Matrice delle verifiche</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {result?.checks.map(check => (
            <div key={check.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-2">
                {check.status === 'coerente' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : check.status === 'da_approfondire' ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                ) : (
                  <CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                )}
                <div>
                  <p className="text-sm font-medium">{check.label}</p>
                  <p className="text-xs text-muted-foreground">{check.note}</p>
                </div>
              </div>
              <Badge
                variant="outline"
                className={
                  check.status === 'coerente'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : check.status === 'da_approfondire'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
                }
              >
                {check.status === 'coerente' ? 'Coerente' : check.status === 'da_approfondire' ? 'Da approfondire' : 'Non verificabile'}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {alerts.length === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4" />
            Nessuna incoerenza rilevata nelle verifiche eseguibili
          </div>
          {unavailableChecks > 0 && (
            <p className="mt-1 text-xs">
              Il risultato non copre le verifiche prive di una o più fonti necessarie.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Incoerenze da verificare</h4>
          {alerts.map(alert => (
            <Card key={alert.id} className={alert.status === 'open' ? 'border-amber-200' : 'border-slate-200'}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={
                    alert.severity === 'alta'
                      ? 'bg-red-100 text-red-800 hover:bg-red-100'
                      : alert.severity === 'media'
                        ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-100'
                  }>
                    Gravità {alert.severity}
                  </Badge>
                  <Badge variant="outline">Confidenza {alert.confidence}</Badge>
                  <Badge variant="outline" className="ml-auto">{STATUS_LABELS[alert.status]}</Badge>
                </div>
                <h5 className="mt-2 text-sm font-semibold">{alert.title}</h5>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{alert.finding.explanation}</p>
                <div className="mt-2 rounded-md bg-muted/50 p-2">
                  {alert.finding.evidence.map((line, index) => (
                    <p key={index} className="text-xs font-medium">{line}</p>
                  ))}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">Possibili spiegazioni</p>
                    <ul className="mt-1 space-y-1">
                      {alert.finding.possible_explanations.map((item, index) => (
                        <li key={index} className="text-xs text-muted-foreground">• {item}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">Verifiche consigliate</p>
                    <ul className="mt-1 space-y-1">
                      {alert.finding.recommended_checks.map((item, index) => (
                        <li key={index} className="text-xs">• {item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {alert.consultant_response && (
                  <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-2">
                    <p className="text-[10px] font-semibold uppercase text-emerald-700">Spiegazione del consulente</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-emerald-900">{alert.consultant_response}</p>
                  </div>
                )}
                {alert.ignore_reason && (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[10px] font-semibold uppercase text-slate-600">Motivo esclusione</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-800">{alert.ignore_reason}</p>
                  </div>
                )}
                {alert.practice_client_questions?.risposta && (
                  <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-2">
                    <p className="text-[10px] font-semibold uppercase text-blue-700">Risposta del cliente</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-blue-900">{alert.practice_client_questions.risposta}</p>
                  </div>
                )}

                {alert.status === 'client_requested' ? (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Domanda inviata. La risposta aggiornerà automaticamente la segnalazione.
                  </div>
                ) : alert.status === 'open' ? (
                  <div className="mt-3 space-y-2 border-t pt-3">
                    <Textarea
                      rows={3}
                      value={notes[alert.id] ?? ''}
                      onChange={event => setNotes(previous => ({ ...previous, [alert.id]: event.target.value }))}
                      placeholder={alert.finding.suggested_question || 'Inserisci una spiegazione, una domanda o il motivo per ignorare…'}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        disabled={savingAlertId === alert.id}
                        onClick={() => updateAlert(alert, 'answered_by_consultant')}
                      >
                        <UserRoundCheck className="h-3.5 w-3.5" />
                        Rispondo io
                      </Button>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={savingAlertId === alert.id}
                        onClick={() => askClient(alert)}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Chiedi al cliente
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-slate-600"
                        disabled={savingAlertId === alert.id}
                        onClick={() => updateAlert(alert, 'ignored')}
                      >
                        Ignora con motivazione
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
