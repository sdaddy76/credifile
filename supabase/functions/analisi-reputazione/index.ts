
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ── Parole chiave rischio con peso e categoria ─────────────────────────────
const RISK_KW = [
  { w: 'fallimento',            p: -30, cat: 'Procedure concorsuali' },
  { w: 'bancarotta',            p: -30, cat: 'Procedure concorsuali' },
  { w: 'concordato preventivo', p: -22, cat: 'Procedure concorsuali' },
  { w: 'liquidazione coatta',   p: -22, cat: 'Procedure concorsuali' },
  { w: 'insolvenza',            p: -18, cat: 'Procedure concorsuali' },
  { w: 'condanna',              p: -25, cat: 'Procedimenti penali' },
  { w: 'arrestato',             p: -28, cat: 'Procedimenti penali' },
  { w: 'frode',                 p: -25, cat: 'Procedimenti penali' },
  { w: 'truffa',                p: -25, cat: 'Procedimenti penali' },
  { w: 'sequestro',             p: -22, cat: 'Procedimenti penali' },
  { w: 'corruzione',            p: -25, cat: 'Procedimenti penali' },
  { w: 'evasione fiscale',      p: -25, cat: 'Procedimenti penali' },
  { w: 'indagato',              p: -15, cat: 'Procedimenti penali' },
  { w: 'rinviato a giudizio',   p: -20, cat: 'Procedimenti penali' },
  { w: 'riciclaggio',           p: -28, cat: 'Procedimenti penali' },
  { w: 'protesto',              p: -15, cat: 'Segnali finanziari' },
  { w: 'pignoramento',          p: -15, cat: 'Segnali finanziari' },
  { w: 'inadempienza',          p: -12, cat: 'Segnali finanziari' },
  { w: 'mancato pagamento',     p: -12, cat: 'Segnali finanziari' },
  { w: 'sanzione',              p: -10, cat: 'Sanzioni / Violazioni' },
  { w: 'multa',                 p: -8,  cat: 'Sanzioni / Violazioni' },
  { w: 'antitrust',             p: -12, cat: 'Sanzioni / Violazioni' },
  { w: 'abuso',                 p: -12, cat: 'Sanzioni / Violazioni' },
];
const POS_KW = [
  { w: 'premiata', p: +6 }, { w: 'eccellenza', p: +6 },
  { w: 'crescita', p: +4 }, { w: 'acquisizione', p: +3 },
  { w: 'innovazione', p: +4 }, { w: 'certificazione', p: +5 },
  { w: 'quotazione', p: +4 }, { w: 'espansione', p: +3 },
  { w: 'record', p: +3 }, { w: 'investimento', p: +3 },
];

function analyzeText(text: string): { signals: { text: string; category: string; weight: number }[]; score: number } {
  const lower = text.toLowerCase();
  const signals: { text: string; category: string; weight: number }[] = [];
  let delta = 0;
  for (const k of RISK_KW) {
    if (lower.includes(k.w)) { signals.push({ text: k.w, category: k.cat, weight: k.p }); delta += k.p; }
  }
  for (const k of POS_KW) {
    if (lower.includes(k.w)) { signals.push({ text: k.w, category: 'Positivo', weight: k.p }); delta += k.p; }
  }
  return { signals, score: delta };
}

// ── Fetch Google News RSS ──────────────────────────────────────────────────
async function fetchNews(query: string): Promise<{ title: string; snippet: string; link: string; date: string; source: string }[]> {
  const encoded = encodeURIComponent(`"${query}"`);
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=it&gl=IT&ceid=IT:it&num=10`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Credifile/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: { title: string; snippet: string; link: string; date: string; source: string }[] = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
    for (const m of itemMatches) {
      const item = m[1];
      const title   = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1]?.trim() ?? '';
      const snippet = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/))?.[1]?.replace(/<[^>]+>/g, '')?.trim() ?? '';
      const link    = item.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? '';
      const date    = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? '';
      const source  = item.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() ?? '';
      if (title) items.push({ title, snippet: snippet.substring(0, 300), link, date, source });
    }
    return items.slice(0, 8);
  } catch { return []; }
}

// ── Analisi per singolo soggetto ──────────────────────────────────────────
async function analyzeSubject(name: string, tipo: string): Promise<{
  nome: string; tipo: string; score: number; news: typeof [] ; signals: typeof []; newsRischio: typeof [];
}> {
  const [generalNews, riskNews] = await Promise.all([
    fetchNews(name),
    fetchNews(`${name} fallimento frode indagato condanna protesto`),
  ]);

  const allNews = [...generalNews];
  const seenLinks = new Set(generalNews.map(n => n.link));
  for (const n of riskNews) { if (!seenLinks.has(n.link)) allNews.push(n); }

  const allText = allNews.map(n => `${n.title} ${n.snippet}`).join(' ');
  const { signals, score: delta } = analyzeText(allText);
  const newsRischio = riskNews.slice(0, 5);

  const score = Math.max(0, Math.min(100, 70 + delta));
  return { nome: name, tipo, score, news: generalNews.slice(0, 5), signals, newsRischio };
}

// ── Handler principale ─────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { client_id, practice_id } = await req.json();
    if (!client_id) return new Response(JSON.stringify({ error: 'client_id obbligatorio' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Recupera dati cliente
    const clientRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${client_id}&select=ragione_sociale,piva,soci,amministratori`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const clients = await clientRes.json();
    if (!clients?.length) return new Response(JSON.stringify({ error: 'Cliente non trovato' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const client = clients[0];
    const soci: { nome: string; percentuale?: string }[] = client.soci ?? [];
    const amm:  { nome: string; carica?: string }[]     = client.amministratori ?? [];

    // Analisi parallela: società + primi 4 amm + primi 4 soci
    const [socRes, ...personResults] = await Promise.all([
      analyzeSubject(client.ragione_sociale, 'societa'),
      ...amm.slice(0, 4).map(a => analyzeSubject(a.nome, 'amministratore')),
      ...soci.slice(0, 4).map(s => analyzeSubject(s.nome, 'socio')),
    ]);

    const ammResults  = personResults.slice(0, amm.slice(0,4).length);
    const sociResults = personResults.slice(amm.slice(0,4).length);

    const scoreAmm  = ammResults.length  ? Math.round(ammResults.reduce((s,r)  => s + r.score, 0) / ammResults.length)  : 100;
    const scoreSoci = sociResults.length ? Math.round(sociResults.reduce((s,r) => s + r.score, 0) / sociResults.length) : 100;
    const scoreGlobale = Math.round(socRes.score * 0.5 + scoreAmm * 0.3 + scoreSoci * 0.2);

    const risultati = {
      societa:        socRes,
      amministratori: ammResults,
      soci:           sociResults,
      generato_il:    new Date().toISOString(),
    };

    // Salva su DB
    const authHeader = req.headers.get('Authorization') ?? `Bearer ${SUPABASE_KEY}`;
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: authHeader },
    });
    const userObj = await userRes.json().catch(() => null);
    const created_by = userObj?.id ?? null;

    await fetch(`${SUPABASE_URL}/rest/v1/reputational_analyses`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ client_id, practice_id: practice_id ?? null, created_by, score_globale: scoreGlobale, score_societa: socRes.score, score_amm: scoreAmm, score_soci: scoreSoci, risultati }),
    });

    return new Response(JSON.stringify({ success: true, score_globale: scoreGlobale, score_societa: socRes.score, score_amm: scoreAmm, score_soci: scoreSoci, risultati }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
