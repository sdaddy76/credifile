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

type BodyInput = {
  practice_id?: string;
  consulente_mode?: boolean;
  ragione_sociale?: string;
  piva?: string;
  ateco?: string;
  importo?: number;
  durata?: number;
  finalita?: string;
  kpi_scores?: unknown;
  finanziamenti?: Array<{ istituto: string; tipo: string; importo_residuo: number; rata_mensile?: number; scadenza?: string }>;
  bilancio_testo?: string;
  cr_testo?: string;
  reputazione_json?: string;
  visura_json?: string;
};

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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

function normalizeAnswers(raw: Record<string, unknown>) {
  const answers: Record<string, string> = {};
  for (const id of QUESTION_IDS) {
    const v = raw?.[id];
    answers[id] = typeof v === 'string' ? v.trim() : '';
  }
  return answers;
}

function fallbackAnswers(input: BodyInput, context: Record<string, unknown>) {
  const ctx: any = context;
  const name = input.ragione_sociale || ctx.client?.ragione_sociale || ctx.practice?.clients?.ragione_sociale || 'la società';
  const ateco = input.ateco || ctx.client?.codice_ateco || ctx.practice?.clients?.codice_ateco || '';
  const settore = sectorFromAteco(ateco);
  const importo = input.importo || ctx.practice?.importo_richiesto;
  const kpi = input.kpi_scores || ctx.kpi?.kpi;
  const fin = input.finanziamenti || ctx.finanziamenti || [];
  const answers = normalizeAnswers({});
  answers.presentazione_storia = `${name} viene descritta sulla base dei dati disponibili nei documenti caricati e nella pratica. La relazione dovrà essere integrata dall’agente con dettagli puntuali su soci, amministratori e funzioni chiave non presenti nei dati automatici.`;
  answers.presentazione_attivita = `${name} opera nel ${settore}${ateco ? ` (codice ATECO ${ateco})` : ''}. La descrizione operativa dovrà essere verificata e completata con prodotti/servizi, mercati serviti e clienti principali.`;
  answers.presentazione_competitors = `Per il ${settore}, i competitor principali sono normalmente operatori locali e nazionali con offerta comparabile. Inserire nomi specifici se noti all’agente o rilevati dalla documentazione aziendale.`;
  answers.rep_negativita = input.reputazione_json ? `Sintesi reputazionale da verificare: ${clip(input.reputazione_json, 1200)}` : 'Non risultano dati reputazionali automatici sufficienti. Verificare protesti, pregiudizievoli, procedure concorsuali e posizioni dei soggetti collegati prima dell’invio.';
  answers.clienti_descrizione = 'Informazione non completamente disponibile dai dati automatici. Indicare principali clienti, eventuali concentrazioni superiori al 10% e tempi medi di incasso.';
  answers.fornitori_concentrazioni = 'Informazione non completamente disponibile dai dati automatici. Indicare principali fornitori, eventuali concentrazioni superiori al 10% e dipendenza da materie prime o servizi critici.';
  answers.finalita_descrizione = input.finalita || `Operazione richiesta${importo ? ` per circa € ${Number(importo).toLocaleString('it-IT')}` : ''}. Specificare se destinata a liquidità, investimento o riequilibrio finanziario.`;
  answers.finalita_coerenza = 'La coerenza dell’operazione deve essere valutata rispetto alla capacità di generazione di cassa, ai KPI disponibili e agli impegni finanziari in essere.';
  answers.bilancio_analisi = kpi ? `Dai KPI disponibili emergono i seguenti elementi quantitativi: ${clip(kpi, 1600)}` : 'KPI di bilancio non disponibili o non sufficienti. Integrare con ricavi, marginalità, patrimonio netto, indebitamento e variazioni dell’ultimo triennio.';
  answers.finanziario_impegni = Array.isArray(fin) && fin.length ? `Finanziamenti rilevati: ${fin.map((f: any) => `${f.istituto || f.banca_finanziaria || 'Istituto N/D'} - ${f.tipo || f.tipologia || 'tipo N/D'} - residuo € ${Number(f.importo_residuo || f.debito_residuo || 0).toLocaleString('it-IT')}`).join('; ')}.` : 'Dettagliare prestiti soci, finanziamenti soci, crediti/debiti tributari e altri impegni finanziari significativi.';
  answers.finanziario_banche = answers.finanziario_impegni;
  answers.visita_disponibilita = 'Da confermare con l’agente/consulente.';
  answers.foto_note = 'Se presenti, allegare solo foto aziendali fornite dall’impresa o scattate in sede; non usare immagini da siti web.';
  return answers;
}

async function restGet(path: string, serviceKey: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  if (!supabaseUrl || !serviceKey) return null;
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) return null;
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const input = (await req.json()) as BodyInput;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const context: Record<string, unknown> = {};

    if (input.practice_id && serviceKey) {
      const practiceRows = await restGet(`practices?id=eq.${encodeURIComponent(input.practice_id)}&select=*,clients(*)&limit=1`, serviceKey);
      const practice = Array.isArray(practiceRows) ? practiceRows[0] : null;
      context.practice = practice;
      context.client = practice?.clients ?? null;
      const [kpiRows, financingRows, bankRows] = await Promise.all([
        restGet(`bilanci_kpi?practice_id=eq.${encodeURIComponent(input.practice_id)}&select=*&order=anno_esercizio.desc&limit=2`, serviceKey),
        restGet(`client_financing?practice_id=eq.${encodeURIComponent(input.practice_id)}&select=*`, serviceKey),
        restGet(`practice_banks?practice_id=eq.${encodeURIComponent(input.practice_id)}&select=*,banks(nome)`, serviceKey),
      ]);
      context.kpi = Array.isArray(kpiRows) ? kpiRows[0] : null;
      context.kpi_storico = kpiRows ?? [];
      context.finanziamenti = financingRows ?? [];
      context.banche_pratica = bankRows ?? [];
      const clientId = practice?.client_id;
      if (clientId) {
        const repRows = await restGet(`analisi_reputazione?client_id=eq.${encodeURIComponent(clientId)}&select=*&order=created_at.desc&limit=1`, serviceKey);
        context.reputazione = Array.isArray(repRows) ? repRows[0] : null;
      }
    }

    if (!openaiKey) {
      return ok({ success: false, error: 'Configura OPENAI_API_KEY nelle variabili d’ambiente Supabase', answers: fallbackAnswers(input, context), source: 'fallback_no_openai_key' });
    }

    const ctx: any = context;
    const ragioneSociale = input.ragione_sociale || ctx.client?.ragione_sociale || ctx.practice?.clients?.ragione_sociale || 'N/D';
    const piva = input.piva || ctx.client?.piva || ctx.client?.partita_iva || ctx.practice?.clients?.piva || 'N/D';
    const ateco = input.ateco || ctx.client?.codice_ateco || ctx.practice?.clients?.codice_ateco || 'N/D';
    const settore = sectorFromAteco(ateco);
    const userPrompt = `Compila una relazione commerciale bancaria italiana per questa azienda.\n\nAzienda: ${ragioneSociale}\nP.IVA: ${piva}\nATECO: ${ateco}\nSettore dedotto: ${settore}\nImporto richiesto: ${input.importo ?? ctx.practice?.importo_richiesto ?? 'N/D'}\nDurata: ${input.durata ?? 'N/D'}\nFinalità: ${input.finalita ?? 'N/D'}\n\nDATI DB / PRATICA:\n${clip(context, 9000)}\n\nKPI già calcolati:\n${clip(input.kpi_scores ?? ctx.kpi?.kpi ?? {}, 3500)}\n\nFinanziamenti:\n${clip(input.finanziamenti ?? ctx.finanziamenti ?? [], 3500)}\n\nTesto bilancio:\n${clip(input.bilancio_testo ?? '', 4500)}\n\nTesto Centrale Rischi:\n${clip(input.cr_testo ?? '', 3500)}\n\nAnalisi reputazionale/visura:\n${clip({ reputazione_json: input.reputazione_json, visura_json: input.visura_json, reputazione_db: ctx.reputazione }, 5000)}\n\nRestituisci ESCLUSIVAMENTE JSON valido con forma {"answers":{...}}. La chiave answers deve contenere una stringa professionale per ciascuno di questi domanda_id: ${QUESTION_IDS.join(', ')}. Se un dato non è disponibile, scrivi una frase prudente che indichi cosa deve verificare l’agente, senza inventare nomi, percentuali o eventi. Per clienti/fornitori/concentrazioni/export/import non inventare valori: chiedi integrazione se assenti. La sezione foto aziendale è opzionale e deve specificare che non vanno usate foto da siti web.`;

    const callOpenAI = (model: string) => fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Sei un esperto analista creditizio italiano. Compila la relazione commerciale bancaria per la società indicata, basandoti sui dati forniti. Scrivi in italiano professionale e formale, adatto a una richiesta di finanziamento bancario. Rispondi sempre solo in JSON valido.' },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.25,
        max_tokens: 5000,
        response_format: { type: 'json_object' },
      }),
    });

    let aiRes = await callOpenAI('gpt-4o-mini');
    if (!aiRes.ok) aiRes = await callOpenAI('gpt-3.5-turbo');
    if (!aiRes.ok) return ok({ success: true, answers: fallbackAnswers(input, context), source: 'fallback_openai_error', error: await aiRes.text() });
    const aiData = await aiRes.json();
    const content = aiData.choices?.[0]?.message?.content ?? '{}';
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    return ok({ success: true, answers: normalizeAnswers(parsed.answers ?? parsed), source: 'openai' });
  } catch (e) {
    return ok({ success: false, error: String(e) }, 200);
  }
});
