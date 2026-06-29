// update-sector-benchmarks
// Cron mensile: aggiorna commenti settore basati su Google News RSS
// Invocabile manualmente: POST /functions/v1/update-sector-benchmarks
// Richiede: Authorization: Bearer <service_role_key>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Mappa settore → termini di ricerca Google News
const SECTOR_QUERIES: Record<string, { query: string; fallback: string }> = {
  commercio:     { query: 'commercio dettaglio Italia PMI 2026 andamento', fallback: 'Il settore del commercio al dettaglio mostra segnali di stabilizzazione nel 2026, con pressioni sui margini legate all\'inflazione ancora presente e alla cautela dei consumatori.' },
  manifattura:   { query: 'manifattura industria italiana PMI 2026 produzione', fallback: 'Il settore manifatturiero italiano continua a mostrare resilienza nel 2026, con ordini esteri in lieve crescita e costi energetici in progressiva normalizzazione.' },
  costruzioni:   { query: 'edilizia costruzioni Italia 2026 Superbonus mercato', fallback: 'Il settore delle costruzioni affronta il post-Superbonus nel 2026 con un riassestamento degli ordini, mentre il PNRR sostiene la domanda pubblica.' },
  ict:           { query: 'tecnologia digitale ICT Italia 2026 crescita startup', fallback: 'Il settore ICT italiano cresce a ritmi sostenuti nel 2026 grazie alla transizione digitale delle PMI e agli investimenti pubblici in infrastrutture digitali.' },
  professionali: { query: 'servizi professionali consulenza Italia 2026', fallback: 'I servizi professionali italiani mostrano solidità nel 2026, con crescente domanda di consulenza su compliance, sostenibilità e trasformazione digitale.' },
  trasporti:     { query: 'trasporti logistica Italia 2026 autotrasporto', fallback: 'Il settore dei trasporti e logistica italiano affronta nel 2026 il calo dei volumi post-pandemia e la transizione verso veicoli a basse emissioni.' },
  ristorazione:  { query: 'ristorazione turismo alberghi Italia 2026', fallback: 'Il settore della ristorazione e alloggio registra nel 2026 una ripresa consolidata, con flussi turistici internazionali in crescita e presenze in aumento.' },
  agricoltura:   { query: 'agricoltura agroalimentare Italia 2026', fallback: 'L\'agricoltura italiana affronta nel 2026 sfide legate ai cambiamenti climatici, mentre il settore agroalimentare mantiene forte competitività sui mercati esteri.' },
  immobiliare:   { query: 'immobiliare mercato case Italia 2026 prezzi', fallback: 'Il mercato immobiliare italiano nel 2026 registra una stabilizzazione dei prezzi nelle grandi città e maggiore selettività da parte degli investitori.' },
  sanita:        { query: 'sanità privata welfare Italia 2026', fallback: 'Il settore sanitario privato italiano cresce nel 2026, trainato dalla crescente domanda di servizi integrativi e dall\'invecchiamento della popolazione.' },
  default:       { query: 'PMI italiane economia 2026 congiuntura', fallback: 'Le PMI italiane nel 2026 mostrano resilienza, con crescita moderata e attenzione alla gestione dei costi in un contesto macroeconomico di cauto ottimismo.' },
};

async function fetchNewsComment(query: string, fallback: string): Promise<string> {
  try {
    const encoded = encodeURIComponent(query);
    const rssUrl  = `https://news.google.com/rss/search?q=${encoded}&hl=it&gl=IT&ceid=IT:it`;
    const res     = await fetch(rssUrl, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return fallback;
    const xml = await res.text();

    // Estrai titoli degli ultimi 30 giorni
    const items  = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const titles: string[] = [];
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    for (const item of items.slice(0, 8)) {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
      const dateMatch  = item.match(/<pubDate>(.*?)<\/pubDate>/);
      if (!titleMatch) continue;
      const pubDate = dateMatch ? new Date(dateMatch[1]).getTime() : 0;
      if (pubDate >= cutoff || pubDate === 0) {
        titles.push(titleMatch[1].replace(/ - [^-]+$/, '').trim());
      }
    }

    if (titles.length === 0) return fallback;

    // Genera commento sintetico dai titoli
    const topTitles = titles.slice(0, 4).join('; ');
    const year      = new Date().getFullYear();
    const month     = new Date().toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

    return `Aggiornamento ${month}: i principali indicatori del settore mostrano ${topTitles.toLowerCase().includes('calo') || topTitles.toLowerCase().includes('contrazione') ? 'segnali di pressione' : 'dinamiche di evoluzione'}. Principali notizie: ${topTitles}. Fonte: Google News / selezione titoli ultimi 30 giorni.`;
  } catch {
    return fallback;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Carica tutti i settori
    const { data: sectors, error } = await supabase
      .from('sector_benchmarks')
      .select('id, ateco_macro, ateco_label');

    if (error) throw new Error(`Errore lettura settori: ${error.message}`);
    if (!sectors || sectors.length === 0) {
      return new Response(JSON.stringify({ updated: 0, sectors: [], message: 'Nessun settore trovato' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const updated: string[] = [];
    const today = new Date().toISOString().split('T')[0];

    for (const sector of sectors) {
      const cfg     = SECTOR_QUERIES[sector.ateco_macro] ?? SECTOR_QUERIES['default'];
      const comment = await fetchNewsComment(cfg.query, cfg.fallback);

      const { error: upErr } = await supabase
        .from('sector_benchmarks')
        .update({ commento_settore: comment, aggiornato_il: today })
        .eq('id', sector.id);

      if (!upErr) updated.push(sector.ateco_macro);

      // Throttle: 1 request/sec per evitare rate-limit
      await new Promise(r => setTimeout(r, 1100));
    }

    return new Response(
      JSON.stringify({ updated: updated.length, sectors: updated, aggiornato_il: today }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
