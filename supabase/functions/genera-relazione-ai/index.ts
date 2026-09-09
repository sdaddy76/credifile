import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QUESTION_IDS = [
  'presentazione_storia','presentazione_continuita','presentazione_trasformazioni','presentazione_attivita','presentazione_competitors',
  'rep_compagine','rep_precedente','rep_acquisizioni','rep_quote_terze','rep_conservatorie','rep_collegate','rep_negativita','rep_gruppo',
  'clienti_descrizione','clienti_settori','clienti_export','fornitori_concentrazioni','fornitori_pagamento','fornitori_import',
  'finalita_descrizione','finalita_vantaggio','finalita_coerenza','finalita_commissioni','bilancio_analisi','bilancio_sede','bilancio_crediti_debiti',
  'straordinari_operazioni','straordinari_investimenti','finanziario_impegni','finanziario_tributario','finanziario_banche',
  'visita_sede','visita_stato_immobile','visita_logistica','visita_disponibilita','pregressa_contatti','pregressa_erogati','foto_note',
];

const NARRATIVE_IDS = [
  '__company_situation',
  '__growth_opportunities',
  '__main_balance_items',
  '__year_over_year_comment',
  '__provisional_balance_comment',
];

const OUTPUT_IDS = [...QUESTION_IDS, ...NARRATIVE_IDS];

type BodyInput = {
  practice_id?: string | null;
  consulente_mode?: boolean;
  ragione_sociale?: string;
  piva?: string;
  ateco?: string;
  importo?: number;
  durata?: number;
  finalita?: string;
  kpi_scores?: unknown;
  finanziamenti?: Array<Record<string, unknown>>;
  bilancio_testo?: string;
  cr_testo?: string;
  reputazione_json?: string;
  visura_json?: string;
  deterministic_analysis?: Record<string, string>;
  kpi_comments?: Array<Record<string, unknown>>;
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

function clip(value: unknown, max = 6000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...[testo abbreviato]` : text;
}

function sectorFromAteco(ateco?: string | null) {
  const clean = String(ateco ?? '').replace(/[^0-9]/g, '');
  if (!clean) return 'settore non determinato';
  if (/^0[1-3]/.test(clean)) return 'agricoltura, silvicoltura o pesca';
  if (/^[12][0-9]|^3[0-3]/.test(clean)) return 'attività manifatturiere';
  if (/^4[1-3]/.test(clean)) return 'costruzioni';
  if (/^4[5-7]/.test(clean)) return 'commercio all’ingrosso o al dettaglio';
  if (/^5[5-6]/.test(clean)) return 'alloggio e ristorazione';
  if (/^6[4-6]/.test(clean)) return 'attività finanziarie e assicurative';
  if (/^68/.test(clean)) return 'attività immobiliari';
  if (/^6[9]|^7[0-5]/.test(clean)) return 'servizi professionali, scientifici o tecnici';
  return `macro-settore ATECO ${clean.slice(0, 2)}`;
}

function normalizeAnswers(raw: Record<string, unknown>, allowedIds = OUTPUT_IDS) {
  const answers: Record<string, string> = {};
  for (const id of allowedIds) {
    const v = raw?.[id];
    if (v === null || v === undefined) continue;
    const normalized = typeof v === 'string' ? v.trim() : String(v).trim();
    if (normalized && !/^(?:n\/?d|non disponibile|non verificabile|non fornito|nessun dato|dato non disponibile)\b/i.test(normalized)) {
      answers[id] = normalized;
    }
  }
  return answers;
}

async function safeSelect(label: string, query: PromiseLike<{ data: unknown; error: unknown }>) {
  try {
    const { data, error } = await query;
    if (error) return { label, error: String((error as any)?.message ?? error), data: null };
    return { label, data, error: null };
  } catch (e) {
    return { label, error: String(e), data: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const groqKey = Deno.env.get('GROQ_API_KEY');

    const input = (await req.json()) as BodyInput;
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const context: Record<string, unknown> = {};

    if (input.practice_id) {
      const { data: practice, error: practiceError } = await supabase
        .from('practices')
        .select('*, clients(*)')
        .eq('id', input.practice_id)
        .maybeSingle();

      if (practiceError) {
        context.practice_error = practiceError.message;
      } else {
        context.practice = practice;
        context.client = (practice as any)?.clients ?? null;
      }

      const clientId = (practice as any)?.client_id ?? (practice as any)?.clients?.id ?? null;
      const results = await Promise.all([
        safeSelect('bilanci_kpi', supabase
          .from('bilanci_kpi')
          .select('*')
          .eq('practice_id', input.practice_id)
          .order('anno_esercizio', { ascending: false })
          .limit(3)),
        safeSelect('analisi_bilancio', supabase
          .from('analisi_bilancio')
          .select('*')
          .eq('practice_id', input.practice_id)
          .order('created_at', { ascending: false })
          .limit(3)),
        safeSelect('client_financing', supabase
          .from('client_financing')
          .select('*')
          .eq('practice_id', input.practice_id)
          .order('ordinamento', { ascending: true })),
        safeSelect('practice_banks', supabase
          .from('practice_banks')
          .select('*, banks(nome)')
          .eq('practice_id', input.practice_id)),
        safeSelect('estratto_conto_transactions', supabase
          .from('estratto_conto_transactions')
          .select('*')
          .eq('practice_id', input.practice_id)
          .limit(200)),
        safeSelect('uploaded_documents', supabase
          .from('uploaded_files')
          .select('id,nome_file,created_at,practice_document_id,practice_documents(nome,tipo,status)')
          .eq('practice_id', input.practice_id)
          .order('created_at', { ascending: false })),
      ]);

      for (const item of results) {
        context[item.label] = item.data;
        if (item.error) context[`${item.label}_error`] = item.error;
      }

      if (clientId) {
        const rep = await safeSelect('analisi_reputazione', supabase
          .from('analisi_reputazione')
          .select('*')
          .eq('client_id', clientId)
          .order('created_at', { ascending: false })
          .limit(1));
        context.analisi_reputazione = rep.data;
        if (rep.error) context.analisi_reputazione_error = rep.error;

        const clientKpi = await safeSelect('bilanci_kpi_cliente', supabase
          .from('bilanci_kpi')
          .select('*')
          .eq('client_id', clientId)
          .order('anno_esercizio', { ascending: false })
          .limit(3));
        context.bilanci_kpi_cliente = clientKpi.data;
        if (clientKpi.error) context.bilanci_kpi_cliente_error = clientKpi.error;
      }
    }

    const ctx: any = context;
    const practice = ctx.practice ?? {};
    const client = ctx.client ?? practice?.clients ?? {};
    const ragioneSociale = input.ragione_sociale || client?.ragione_sociale || client?.nome || practice?.ragione_sociale || 'N/D';
    const piva = input.piva || client?.piva || client?.partita_iva || client?.codice_fiscale || 'N/D';
    const ateco = input.ateco || client?.codice_ateco || practice?.codice_ateco || 'N/D';
    const settore = sectorFromAteco(ateco);
    const importo = input.importo ?? practice?.importo_richiesto ?? practice?.importo ?? 'N/D';
    const durata = input.durata ?? practice?.durata ?? 'N/D';
    const finalita = input.finalita ?? practice?.finalita ?? practice?.descrizione_finalita ?? 'N/D';

    const deterministicAnswers = normalizeAnswers(input.deterministic_analysis ?? {}, NARRATIVE_IDS);
    if (deterministicAnswers.__company_situation || deterministicAnswers.__year_over_year_comment) {
      deterministicAnswers.bilancio_analisi = [
        deterministicAnswers.__company_situation,
        deterministicAnswers.__year_over_year_comment,
        deterministicAnswers.__provisional_balance_comment,
      ].filter(Boolean).join('\n\n');
    }

    const systemPrompt = `Sei un esperto analista creditizio italiano specializzato in relazioni commerciali bancarie.
Compila la relazione commerciale per la società indicata usando i dati forniti.
Scrivi in italiano professionale e formale, adatto a una richiesta di finanziamento bancario.
Non inventare informazioni e non sostituire mai con zero un dato assente.
Riporta esclusivamente gli elementi positivi e documentati dell'azienda, con tono commerciale favorevole e professionale.
Se un'informazione o una sezione non è documentata, restituisci una stringa vuota: non inserire "Non disponibile", "Non verificabile", criticità, giudizi negativi o richieste di integrazione nel testo destinato alla relazione.
Mantieni distinti i bilanci annuali dal bilancio provvisorio e non annualizzare dati infrannuali se il periodo non è indicato.
Restituisci SOLO un oggetto JSON valido, senza markdown, senza backtick, senza testo aggiuntivo.`;

    const userPrompt = `Compila una relazione commerciale bancaria italiana per la società indicata.

DATI SOCIETÀ
- Ragione sociale: ${ragioneSociale}
- Partita IVA/Codice fiscale: ${piva}
- Codice ATECO: ${ateco}
- Settore dedotto: ${settore}
- Importo richiesto: ${importo}
- Durata richiesta: ${durata}
- Finalità dichiarata: ${finalita}

DATI COMPLETI DISPONIBILI DA PRATICA / DB
${clip(context, 12000)}

KPI / ANALISI BILANCIO FORNITI DAL CLIENT
${clip(input.kpi_scores ?? ctx.bilanci_kpi ?? ctx.analisi_bilancio ?? ctx.bilanci_kpi_cliente ?? {}, 5000)}

COMMENTI DETERMINISTICI DEGLI INDICI DI BILANCIO
${clip(input.kpi_comments ?? [], 8000)}

BASE DI ANALISI CALCOLATA DAL SISTEMA
${clip(input.deterministic_analysis ?? {}, 9000)}

FINANZIAMENTI / CENTRALE RISCHI
${clip(input.finanziamenti ?? ctx.client_financing ?? [], 5000)}

VISURA / REPUTAZIONE
${clip({ visura_json: input.visura_json, reputazione_json: input.reputazione_json, analisi_reputazione_db: ctx.analisi_reputazione }, 6000)}

TESTO BILANCIO
${clip(input.bilancio_testo ?? '', 6000)}

TESTO CENTRALE RISCHI / ESTRATTO CONTO
${clip({ cr_testo: input.cr_testo, estratto_conto_transactions: ctx.estratto_conto_transactions }, 6000)}

Restituisci un JSON valido con una stringa professionale dettagliata per ognuno di questi cinque campi, senza chiavi aggiuntive e senza contenitore answers:
${NARRATIVE_IDS.join(', ')}

Regole:
- Non inventare nomi, percentuali, protesti, procedure o importi non presenti nei dati.
- Non creare frasi generiche per colmare dati mancanti: lascia vuota la sezione.
- Per clienti, fornitori, export, import e concentrazioni, non creare valori numerici se assenti.
- __company_situation deve valorizzare redditività, equilibrio patrimoniale, liquidità e indebitamento soltanto quando i dati sono positivi e documentati.
- __growth_opportunities deve descrivere soltanto opportunità e leve supportate dall'andamento positivo di ricavi, margini, capitale circolante e debito.
- __main_balance_items deve valorizzare le principali voci positive di Stato patrimoniale e Conto economico, incluse materie, servizi, personale, crediti, rimanenze, liquidità e patrimonio quando disponibili; ometti le voci assenti o sfavorevoli.
- __year_over_year_comment deve riportare soltanto miglioramenti o stabilità positive dell'ultimo bilancio annuale rispetto al precedente; ometti variazioni negative e dati non disponibili.
- __provisional_balance_comment deve commentare il bilancio provvisorio solo se contiene elementi positivi identificabili; se manca o non è analizzato restituisci stringa vuota.
- I commenti degli indici forniti al modello sono già filtrati agli indicatori positivi: non aggiungere indici negativi, neutri o non disponibili e non alterare valori, benchmark, fonte o giudizio.
- Mantieni la risposta complessiva entro 900 token, privilegiando dati, variazioni e conclusioni verificabili.`;

    if (!groqKey) {
      return jsonResponse({
        answers: deterministicAnswers,
        source: 'deterministic_fallback',
        warning: 'GROQ_API_KEY non configurata: applicata la base di analisi deterministica.',
      });
    }

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        temperature: 0.3,
        max_tokens: 1000,
        reasoning_effort: 'none',
        reasoning_format: 'hidden',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (Object.keys(deterministicAnswers).length > 0) {
        return jsonResponse({
          answers: deterministicAnswers,
          source: 'deterministic_fallback',
          warning: `Servizio AI non disponibile (${resp.status}); mantenuta la base deterministica.`,
        });
      }
      return new Response(JSON.stringify({ error: `Servizio AI errore ${resp.status}: ${errText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const completion = await resp.json();
    const content = completion.choices?.[0]?.message?.content ?? '';

    let answers: Record<string, string> = {};
    try {
      answers = JSON.parse(content);
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        answers = JSON.parse(match[0]);
      } else {
        return new Response(JSON.stringify({ error: 'Il servizio AI non ha restituito JSON valido', raw: content.slice(0, 500) }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const aiAnswers = normalizeAnswers(answers, NARRATIVE_IDS);
    return new Response(JSON.stringify({
      answers: { ...deterministicAnswers, ...aiAnswers },
      source: 'groq',
    }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
