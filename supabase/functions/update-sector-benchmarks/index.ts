// Aggiornamento mensile benchmark ATECO.
// Controlla un feed numerico configurabile, conserva lo storico e aggiorna
// separatamente il commento congiunturale da Google News.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const VALID_KPI = new Set([
  'Current Ratio', 'Quick Ratio', 'Debt/Equity', 'Leverage',
  'PN / Totale Attivo', 'Grado Indebitamento', 'ROE', 'ROI', 'ROS',
  'EBITDA Margin', 'PFN / EBITDA', 'PFN / PN', 'DSO',
  'Interest Coverage', 'DSCR',
]);

const QUERY_BY_SECTOR: Record<string, string> = {
  agricoltura: 'agricoltura agroalimentare Italia PMI andamento settore',
  estrazione: 'industria estrattiva cave miniere Italia andamento settore',
  manifattura: 'manifattura industria italiana PMI produzione ordini',
  energia: 'energia imprese Italia prezzi produzione settore',
  acqua_rifiuti: 'servizi ambientali acqua rifiuti imprese Italia',
  costruzioni: 'edilizia costruzioni Italia mercato imprese',
  commercio: 'commercio dettaglio ingrosso Italia PMI consumi',
  trasporti: 'trasporti logistica Italia autotrasporto imprese',
  ristorazione: 'ristorazione turismo alberghi Italia imprese',
  ict: 'tecnologia digitale ICT Italia imprese mercato',
  finanza: 'finanza assicurazioni Italia imprese settore',
  immobiliare: 'immobiliare Italia mercato imprese prezzi',
  professionali: 'servizi professionali consulenza Italia imprese',
  amministrativi: 'servizi amministrativi supporto imprese Italia',
  sanita: 'sanità privata assistenza sociale Italia imprese',
  default: 'PMI italiane economia congiuntura imprese',
};

interface SectorRow {
  id: string;
  ateco_macro: string;
  ateco_label: string;
  kpi_data: Record<string, number | null>;
  data_hash?: string | null;
}

interface FeedSector {
  ateco_macro: string;
  ateco_label?: string;
  kpi_data: Record<string, number | null>;
  source_url?: string;
}

interface BenchmarkFeed {
  source_name: string;
  source_url?: string;
  source_version: string;
  source_published_at: string;
  effective_period: string;
  sectors: FeedSector[];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function stableKpiJson(data: Record<string, number | null>): string {
  const ordered = Object.keys(data).sort().reduce<Record<string, number | null>>((acc, key) => {
    acc[key] = data[key];
    return acc;
  }, {});
  return JSON.stringify(ordered);
}

function sanitizeKpiData(data: unknown): Record<string, number | null> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const clean: Record<string, number | null> = {};
  for (const [key, raw] of Object.entries(data as Record<string, unknown>)) {
    if (!VALID_KPI.has(key)) continue;
    if (raw === null) clean[key] = null;
    else if (typeof raw === 'number' && Number.isFinite(raw)) clean[key] = raw;
  }
  return clean;
}

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

function validateFeed(raw: unknown): BenchmarkFeed {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Payload fonte non valido');
  const feed = raw as Partial<BenchmarkFeed>;
  if (!feed.source_name || !feed.source_version || !feed.effective_period ||
      !feed.source_published_at || !isValidDate(feed.source_published_at) ||
      !Array.isArray(feed.sectors)) {
    throw new Error('Metadati obbligatori della fonte mancanti');
  }
  return feed as BenchmarkFeed;
}

async function fetchJson(url: string, timeoutMs = 15000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Credifile benchmark updater/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Fonte numerica HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNewsComment(atecoMacro: string, atecoLabel: string): Promise<string | null> {
  try {
    const query = QUERY_BY_SECTOR[atecoMacro] ?? `${atecoLabel} Italia imprese andamento settore`;
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=it&gl=IT&ceid=IT:it`;
    const response = await fetch(rssUrl, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const xml = await response.text();
    const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
    const titles: string[] = [];

    for (const item of (xml.match(/<item>[\s\S]*?<\/item>/g) ?? []).slice(0, 12)) {
      const title = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1];
      const date = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1];
      if (!title) continue;
      const timestamp = date ? new Date(date).getTime() : 0;
      if (timestamp && timestamp < cutoff) continue;
      const cleanTitle = title.replace(/ - [^-]+$/, '').trim();
      if (cleanTitle && !titles.includes(cleanTitle)) titles.push(cleanTitle);
    }

    if (titles.length === 0) return null;
    const month = new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
    return `Quadro congiunturale aggiornato a ${month}. Notizie monitorate: ${titles.slice(0, 4).join('; ')}. Fonte informativa: Google News Italia, titoli recenti; il commento non modifica i benchmark numerici.`;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'Metodo non consentito' }, 405);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let runId: string | null = null;

  try {
    const { data: settings, error: settingsError } = await supabase
      .from('benchmark_automation_settings')
      .select('*')
      .eq('id', true)
      .single();
    if (settingsError || !settings) throw new Error('Configurazione automazione non disponibile');

    const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const cronSecret = req.headers.get('x-cron-secret') ?? '';
    const validCronSecret = cronSecret
      ? (await sha256(cronSecret)) === settings.cron_secret_hash
      : false;
    if (bearer !== SERVICE_ROLE_KEY && !validCronSecret) {
      return jsonResponse({ error: 'Non autorizzato' }, 401);
    }
    if (!settings.enabled) return jsonResponse({ skipped: true, reason: 'Automazione disattivata' });

    const requestBody = await req.json().catch(() => ({}));
    const triggerType = requestBody?.trigger === 'cron' ? 'cron' : requestBody?.trigger === 'test' ? 'test' : 'manual';

    const { data: run, error: runError } = await supabase
      .from('benchmark_update_runs')
      .insert({
        trigger_type: triggerType,
        status: 'running',
        source_name: settings.source_name,
        source_url: settings.numeric_source_url ?? settings.source_landing_url,
      })
      .select('id')
      .single();
    if (runError) throw new Error(`Impossibile aprire il log: ${runError.message}`);
    runId = run.id;

    const { data: sectors, error: sectorsError } = await supabase
      .from('sector_benchmarks')
      .select('id, ateco_macro, ateco_label, kpi_data, data_hash')
      .order('ateco_macro');
    if (sectorsError) throw new Error(`Errore lettura settori: ${sectorsError.message}`);

    const sectorRows = (sectors ?? []) as SectorRow[];
    const warnings: string[] = [];
    const numericUpdated: string[] = [];
    const commentsUpdated: string[] = [];
    let feed: BenchmarkFeed | null = null;

    if (settings.numeric_source_url) {
      try {
        feed = validateFeed(await fetchJson(settings.numeric_source_url));
        const feedBySector = new Map(feed.sectors.map(sector => [sector.ateco_macro, sector]));

        for (const current of sectorRows) {
          const incoming = feedBySector.get(current.ateco_macro);
          if (!incoming) {
            warnings.push(`${current.ateco_macro}: settore assente nella fonte`);
            continue;
          }
          const cleanIncoming = sanitizeKpiData(incoming.kpi_data);
          const availableMetrics = Object.keys(cleanIncoming).filter(key => cleanIncoming[key] !== null);
          if (availableMetrics.length < 10) {
            warnings.push(`${current.ateco_macro}: solo ${availableMetrics.length} KPI validi, aggiornamento ignorato`);
            continue;
          }

          const merged = { ...current.kpi_data, ...cleanIncoming };
          const newHash = await sha256(stableKpiJson(merged));
          if (newHash === current.data_hash) continue;

          const { error: closeError } = await supabase
            .from('sector_benchmark_history')
            .update({ replaced_at: new Date().toISOString() })
            .eq('benchmark_id', current.id)
            .is('replaced_at', null);
          if (closeError) warnings.push(`${current.ateco_macro}: chiusura storico non riuscita`);

          const { error: updateError } = await supabase
            .from('sector_benchmarks')
            .update({
              ateco_label: incoming.ateco_label ?? current.ateco_label,
              kpi_data: merged,
              fonte: feed.source_name,
              source_url: incoming.source_url ?? feed.source_url ?? settings.numeric_source_url,
              source_dataset: feed.source_name,
              source_version: feed.source_version,
              source_published_at: feed.source_published_at,
              effective_period: feed.effective_period,
              data_hash: newHash,
              aggiornato_il: new Date().toISOString().slice(0, 10),
              last_update_status: 'updated',
            })
            .eq('id', current.id);
          if (updateError) {
            warnings.push(`${current.ateco_macro}: ${updateError.message}`);
            continue;
          }

          await supabase.from('sector_benchmark_history').insert({
            benchmark_id: current.id,
            ateco_macro: current.ateco_macro,
            ateco_label: incoming.ateco_label ?? current.ateco_label,
            kpi_data: merged,
            fonte: feed.source_name,
            source_url: incoming.source_url ?? feed.source_url ?? settings.numeric_source_url,
            source_dataset: feed.source_name,
            source_version: feed.source_version,
            source_published_at: feed.source_published_at,
            effective_period: feed.effective_period,
            data_hash: newHash,
          });
          numericUpdated.push(current.ateco_macro);
        }
      } catch (error) {
        warnings.push(`Fonte numerica: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      warnings.push('Fonte numerica non ancora configurata: KPI esistenti conservati senza modifiche');
    }

    // Quattro richieste alla volta: limita il carico senza moltiplicare i timeout
    // per tutti i settori in modo sequenziale.
    for (let index = 0; index < sectorRows.length; index += 4) {
      const batch = sectorRows.slice(index, index + 4);
      const batchComments = await Promise.all(
        batch.map(sector => fetchNewsComment(sector.ateco_macro, sector.ateco_label))
      );
      await Promise.all(batch.map(async (sector, batchIndex) => {
        const comment = batchComments[batchIndex];
        const patch: Record<string, unknown> = {
          last_checked_at: new Date().toISOString(),
          last_update_status: numericUpdated.includes(sector.ateco_macro) ? 'updated' : 'checked_no_change',
        };
        if (comment) {
          patch.commento_settore = comment;
          patch.last_commentary_at = new Date().toISOString();
        }
        const { error } = await supabase.from('sector_benchmarks').update(patch).eq('id', sector.id);
        if (!error && comment) commentsUpdated.push(sector.ateco_macro);
        if (error) warnings.push(`${sector.ateco_macro}: aggiornamento controllo/commento non riuscito`);
      }));
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    const status = warnings.length > 0 ? 'partial' : 'success';
    await supabase.from('benchmark_update_runs').update({
      status,
      source_name: feed?.source_name ?? settings.source_name,
      source_url: feed?.source_url ?? settings.numeric_source_url ?? settings.source_landing_url,
      source_version: feed?.source_version ?? null,
      source_published_at: feed?.source_published_at ?? null,
      effective_period: feed?.effective_period ?? null,
      sectors_checked: sectorRows.length,
      sectors_updated: numericUpdated.length,
      comments_updated: commentsUpdated.length,
      warnings,
      completed_at: new Date().toISOString(),
    }).eq('id', runId);

    return jsonResponse({
      success: true,
      status,
      sectors_checked: sectorRows.length,
      numeric_updated: numericUpdated,
      comments_updated: commentsUpdated,
      warnings,
      next_schedule: 'giorno 1 di ogni mese alle 04:15 UTC',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await supabase.from('benchmark_update_runs').update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      }).eq('id', runId);
    }
    return jsonResponse({ error: message }, 500);
  }
});
