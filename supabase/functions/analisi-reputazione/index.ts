const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// ─── Keyword dictionary ───────────────────────────────────────────────────────
const RISK_KW = [
  // Procedure concorsuali
  { w: 'fallimento',             p: -30, cat: 'Procedure concorsuali' },
  { w: 'bancarotta',             p: -30, cat: 'Procedure concorsuali' },
  { w: 'concordato preventivo',  p: -22, cat: 'Procedure concorsuali' },
  { w: 'liquidazione coatta',    p: -22, cat: 'Procedure concorsuali' },
  { w: 'insolvenza',             p: -18, cat: 'Procedure concorsuali' },
  { w: 'amministrazione straordinaria', p: -18, cat: 'Procedure concorsuali' },
  { w: 'procedura concorsuale',  p: -20, cat: 'Procedure concorsuali' },
  { w: 'piano di risanamento',   p: -12, cat: 'Procedure concorsuali' },

  // Procedimenti penali
  { w: 'condanna',               p: -25, cat: 'Procedimenti penali' },
  { w: 'arrestato',              p: -28, cat: 'Procedimenti penali' },
  { w: 'arresti domiciliari',    p: -26, cat: 'Procedimenti penali' },
  { w: 'frode',                  p: -25, cat: 'Procedimenti penali' },
  { w: 'truffa',                 p: -25, cat: 'Procedimenti penali' },
  { w: 'sequestro',              p: -22, cat: 'Procedimenti penali' },
  { w: 'corruzione',             p: -25, cat: 'Procedimenti penali' },
  { w: 'evasione fiscale',       p: -25, cat: 'Procedimenti penali' },
  { w: 'indagato',               p: -15, cat: 'Procedimenti penali' },
  { w: 'rinviato a giudizio',    p: -20, cat: 'Procedimenti penali' },
  { w: 'riciclaggio',            p: -28, cat: 'Procedimenti penali' },
  { w: 'peculato',               p: -25, cat: 'Procedimenti penali' },
  { w: 'estorsione',             p: -28, cat: 'Procedimenti penali' },
  { w: 'abuso d\'ufficio',       p: -22, cat: 'Procedimenti penali' },
  { w: 'reato',                  p: -15, cat: 'Procedimenti penali' },

  // Segnali finanziari
  { w: 'protesto',               p: -15, cat: 'Segnali finanziari' },
  { w: 'pignoramento',           p: -15, cat: 'Segnali finanziari' },
  { w: 'inadempienza',           p: -12, cat: 'Segnali finanziari' },
  { w: 'mancato pagamento',      p: -12, cat: 'Segnali finanziari' },
  { w: 'crediti inesigibili',    p: -12, cat: 'Segnali finanziari' },
  { w: 'insolvenza bancaria',    p: -18, cat: 'Segnali finanziari' },
  { w: 'fideiussione escussa',   p: -14, cat: 'Segnali finanziari' },

  // Sanzioni / Violazioni
  { w: 'sanzione',               p: -10, cat: 'Sanzioni / Violazioni' },
  { w: 'multa',                  p: -8,  cat: 'Sanzioni / Violazioni' },
  { w: 'antitrust',              p: -12, cat: 'Sanzioni / Violazioni' },
  { w: 'agcm',                   p: -12, cat: 'Sanzioni / Violazioni' },
  { w: 'autorità garante',       p: -10, cat: 'Sanzioni / Violazioni' },

  // Fiscale (NUOVO)
  { w: 'cartella esattoriale',   p: -18, cat: 'Rischio fiscale' },
  { w: 'avviso di accertamento', p: -15, cat: 'Rischio fiscale' },
  { w: 'omesso versamento',      p: -20, cat: 'Rischio fiscale' },
  { w: 'debiti fiscali',         p: -15, cat: 'Rischio fiscale' },
  { w: 'equitalia',              p: -12, cat: 'Rischio fiscale' },
  { w: 'agenzia entrate',        p: -8,  cat: 'Rischio fiscale' },
  { w: 'inps contributi',        p: -10, cat: 'Rischio fiscale' },
  { w: 'irregolarità fiscale',   p: -18, cat: 'Rischio fiscale' },
  { w: 'elusione fiscale',       p: -20, cat: 'Rischio fiscale' },

  // Lavoro (NUOVO)
  { w: 'caporalato',             p: -28, cat: 'Violazioni lavoro' },
  { w: 'lavoro nero',            p: -22, cat: 'Violazioni lavoro' },
  { w: 'sfruttamento',           p: -25, cat: 'Violazioni lavoro' },
  { w: 'irregolarità lavoro',    p: -15, cat: 'Violazioni lavoro' },
  { w: 'infortuni sul lavoro',   p: -12, cat: 'Violazioni lavoro' },
  { w: 'violazione sicurezza',   p: -12, cat: 'Violazioni lavoro' },

  // Ambientale (NUOVO)
  { w: 'inquinamento',           p: -18, cat: 'Rischio ambientale' },
  { w: 'smaltimento illecito',   p: -22, cat: 'Rischio ambientale' },
  { w: 'discarica abusiva',      p: -22, cat: 'Rischio ambientale' },
  { w: 'reato ambientale',       p: -25, cat: 'Rischio ambientale' },
  { w: 'bonifica',               p: -10, cat: 'Rischio ambientale' },

  // GDPR / Privacy (NUOVO)
  { w: 'multa garante',          p: -18, cat: 'Privacy / GDPR' },
  { w: 'violazione dati',        p: -15, cat: 'Privacy / GDPR' },
  { w: 'data breach',            p: -20, cat: 'Privacy / GDPR' },
  { w: 'gdpr',                   p: -8,  cat: 'Privacy / GDPR' },
  { w: 'garante privacy',        p: -10, cat: 'Privacy / GDPR' },

  // Antimafia / AML (NUOVO)
  { w: 'interdittiva antimafia', p: -35, cat: 'Antimafia / AML' },
  { w: 'infiltrazione mafiosa',  p: -35, cat: 'Antimafia / AML' },
  { w: 'contiguità mafia',       p: -30, cat: 'Antimafia / AML' },
  { w: 'antimafia',              p: -20, cat: 'Antimafia / AML' },
  { w: 'camorra',                p: -30, cat: 'Antimafia / AML' },
  { w: 'ndrangheta',             p: -30, cat: 'Antimafia / AML' },
  { w: 'cosa nostra',            p: -30, cat: 'Antimafia / AML' },
  { w: 'autoriciclaggio',        p: -28, cat: 'Antimafia / AML' },
]

const POS_KW = [
  { w: 'premiata',               p: +8  },
  { w: 'eccellenza',             p: +7  },
  { w: 'crescita',               p: +5  },
  { w: 'acquisizione',           p: +4  },
  { w: 'innovazione',            p: +5  },
  { w: 'certificazione iso',     p: +7  },
  { w: 'certificazione',         p: +5  },
  { w: 'quotazione',             p: +5  },
  { w: 'espansione',             p: +4  },
  { w: 'record fatturato',       p: +8  },
  { w: 'investimento',           p: +4  },
  { w: 'partnership',            p: +4  },
  { w: 'accordo strategico',     p: +5  },
  { w: 'sostenibilità',          p: +4  },
  { w: 'responsabilità sociale', p: +5  },
  { w: 'riconoscimento',         p: +5  },
  { w: 'finanziamento europeo',  p: +6  },
  { w: 'brevetto',               p: +5  },
]

// Parole che indicano negazione del rischio nel contesto locale
const NEGATION_WORDS = [
  'non', 'senza', 'evitato', 'evita', 'sventato', 'scongiurato',
  'escluso', 'assolto', 'assoluzione', 'innocente', 'prosciolt',
  'archiviato', 'archiviazione', 'nessun', 'nessuna', 'contro',
  'accusa di', 'ipotesi di', 'rischio di',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getTimeWeight(dateStr: string): number {
  if (!dateStr) return 0.5
  try {
    const d = new Date(dateStr)
    const ageMs = Date.now() - d.getTime()
    const ageMonths = ageMs / (1000 * 60 * 60 * 24 * 30)
    if (ageMonths < 6)  return 1.0
    if (ageMonths < 12) return 0.8
    if (ageMonths < 24) return 0.6
    if (ageMonths < 48) return 0.35
    return 0.15
  } catch { return 0.5 }
}

function hasNegationContext(text: string, keyword: string): boolean {
  const lower = text.toLowerCase()
  const idx = lower.indexOf(keyword)
  if (idx === -1) return false
  const window = lower.substring(Math.max(0, idx - 60), idx + keyword.length + 20)
  return NEGATION_WORDS.some(neg => window.includes(neg))
}

interface NewsItem {
  title: string; snippet: string; link: string; date: string; source: string
}
interface Signal {
  text: string; category: string; weight: number; articleTitle?: string; articleDate?: string
}

function analyzeTextWithNews(news: NewsItem[]): { signals: Signal[]; scoreDelta: number } {
  const seenSignals = new Set<string>()
  const signals: Signal[] = []
  let scoreDelta = 0

  for (const item of news) {
    const timeW = getTimeWeight(item.date)
    const fullText = `${item.title} ${item.snippet}`.toLowerCase()

    for (const k of RISK_KW) {
      if (!fullText.includes(k.w)) continue
      if (hasNegationContext(fullText, k.w)) continue
      const dedupKey = k.w
      if (seenSignals.has(dedupKey)) continue   // deduplica: stessa keyword conta 1 volta
      seenSignals.add(dedupKey)
      const weightedPenalty = Math.round(k.p * timeW)
      signals.push({
        text: k.w, category: k.cat, weight: weightedPenalty,
        articleTitle: item.title.substring(0, 80),
        articleDate: item.date,
      })
      scoreDelta += weightedPenalty
    }

    for (const k of POS_KW) {
      if (!fullText.includes(k.w)) continue
      const dedupKey = `pos_${k.w}`
      if (seenSignals.has(dedupKey)) continue
      seenSignals.add(dedupKey)
      const weightedBonus = Math.round(k.p * timeW)
      signals.push({
        text: k.w, category: 'Positivo', weight: weightedBonus,
        articleTitle: item.title.substring(0, 80),
        articleDate: item.date,
      })
      scoreDelta += weightedBonus
    }
  }
  return { signals, scoreDelta }
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'it-IT,it;q=0.9',
      },
    })
    return res
  } catch { return null }
  finally { clearTimeout(timer) }
}

// ─── Google News RSS ──────────────────────────────────────────────────────────
async function fetchGoogleNews(query: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${query}"`)}&hl=it&gl=IT&ceid=IT:it`
  const res = await fetchWithTimeout(url, 8000)
  if (!res || !res.ok) return []
  const xml = await res.text()
  const items: NewsItem[] = []
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  for (const m of matches) {
    const item = m[1]
    const titleM   = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/) || item.match(/<title>([\s\S]*?)<\/title>/)
    const snippetM = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/) || item.match(/<description>([\s\S]*?)<\/description>/)
    const linkM    = item.match(/<link>([\s\S]*?)<\/link>/)
    const dateM    = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)
    const sourceM  = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)
    const title    = titleM?.[1]?.trim() ?? ''
    const snippet  = snippetM?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
    if (title) items.push({
      title,
      snippet: snippet.substring(0, 300),
      link: linkM?.[1]?.trim() ?? '',
      date: dateM?.[1]?.trim() ?? '',
      source: sourceM?.[1]?.trim() ?? 'Google News',
    })
  }
  return items.slice(0, 10)
}

// ─── DuckDuckGo HTML scraping ─────────────────────────────────────────────────
async function fetchDuckDuckGo(query: string): Promise<NewsItem[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=it-it`
  const res = await fetchWithTimeout(url, 8000)
  if (!res || !res.ok) return []
  const html = await res.text()
  const items: NewsItem[] = []
  // Estrae risultati dal DOM semplificato di DDG
  const resultRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snippetRegex = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
  const links: string[] = []
  const titles: string[] = []
  const snippets: string[] = []
  for (const m of html.matchAll(resultRegex)) {
    links.push(m[1])
    titles.push(m[2].replace(/<[^>]+>/g, '').trim())
  }
  for (const m of html.matchAll(snippetRegex)) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim())
  }
  for (let i = 0; i < Math.min(links.length, 6); i++) {
    if (!titles[i] || titles[i].length < 5) continue
    items.push({
      title: titles[i].substring(0, 120),
      snippet: (snippets[i] ?? '').substring(0, 200),
      link: links[i],
      date: '',
      source: 'DuckDuckGo',
    })
  }
  return items
}

// ─── Analisi soggetto ─────────────────────────────────────────────────────────
async function analyzeSubject(name: string, tipo: string, piva?: string) {
  // 5 query parallele: generale, legale, finanziaria, fiscale, antimafia
  const searchName = piva ? `"${name}" "${piva}"` : `"${name}"`
  const queries = [
    fetchGoogleNews(name),
    fetchGoogleNews(`${name} indagato condanna tribunale arresti`),
    fetchGoogleNews(`${name} protesto pignoramento insolvenza fallimento`),
    fetchGoogleNews(`${name} evasione fiscale cartella esattoriale debiti INPS`),
    fetchGoogleNews(`${name} antimafia riciclaggio sequestro`),
    fetchDuckDuckGo(`${searchName} fallimento indagato protesto condanna frode`),
    fetchDuckDuckGo(`${searchName} sanzione multa violazione`),
  ]
  const results = await Promise.allSettled(queries)
  const allNewsRaw: NewsItem[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') allNewsRaw.push(...r.value)
  }

  // Deduplica per link
  const seenLinks = new Set<string>()
  const allNews: NewsItem[] = []
  for (const item of allNewsRaw) {
    const key = item.link || item.title
    if (!seenLinks.has(key)) { seenLinks.add(key); allNews.push(item) }
  }

  const { signals, scoreDelta } = analyzeTextWithNews(allNews)

  // Score: base 60. Se news trovate ma nessun segnale negativo → bonus +10
  const hasNegativeSignals = signals.some(s => s.weight < 0)
  const newsBonus = allNews.length > 0 && !hasNegativeSignals ? 10 : 0
  const score = Math.max(0, Math.min(100, 60 + newsBonus + scoreDelta))

  // Solo Google News come news "generali" per la UI (più affidabili per le news)
  const googleNews = allNews.filter(n => n.source === 'Google News').slice(0, 6)
  const riskNews   = allNews.filter(n =>
    signals.some(sig => sig.weight < 0 && sig.articleTitle &&
      n.title.startsWith(sig.articleTitle.substring(0, 40)))
  ).slice(0, 4)

  return {
    nome: name, tipo, score,
    news: googleNews,
    signals,
    newsRischio: riskNews,
    totalNewsFetched: allNews.length,
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { client_id, practice_id } = await req.json()
    if (!client_id) {
      return new Response(JSON.stringify({ error: 'client_id obbligatorio' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Dati cliente
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${client_id}&select=ragione_sociale,piva,soci,amministratori`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
    const clients = await clientRes.json()
    if (!clients?.length) {
      return new Response(JSON.stringify({ error: 'Cliente non trovato' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const client = clients[0]
    const soci: { nome: string }[] = client.soci ?? []
    const amm:  { nome: string }[] = client.amministratori ?? []
    const piva: string | undefined = client.piva ?? undefined

    // 2. Analisi PARALLELA di tutti i soggetti
    const [socRes, ...personResults] = await Promise.all([
      analyzeSubject(client.ragione_sociale, 'societa', piva),
      ...amm.slice(0, 3).map(a => analyzeSubject(a.nome, 'amministratore')),
      ...soci.slice(0, 3).map(s => analyzeSubject(s.nome, 'socio')),
    ])

    const ammResults  = personResults.slice(0, amm.slice(0, 3).length)
    const sociResults = personResults.slice(amm.slice(0, 3).length)

    // 3. Score globale ponderato
    const scoreAmm     = ammResults.length  ? Math.round(ammResults.reduce((s, r)  => s + r.score, 0) / ammResults.length)  : 100
    const scoreSoci    = sociResults.length ? Math.round(sociResults.reduce((s, r) => s + r.score, 0) / sociResults.length) : 100
    const scoreGlobale = Math.round(socRes.score * 0.5 + scoreAmm * 0.3 + scoreSoci * 0.2)

    const risultati = {
      societa:        socRes,
      amministratori: ammResults,
      soci:           sociResults,
      generato_il:    new Date().toISOString(),
    }

    // 4. User corrente
    const authHeader = req.headers.get('Authorization') ?? `Bearer ${SUPABASE_KEY}`
    let created_by = null
    try {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_KEY, Authorization: authHeader },
      })
      const userObj = await userRes.json()
      created_by = userObj?.id ?? null
    } catch { /* ignore */ }

    // 5. Salva su DB
    await fetch(`${SUPABASE_URL}/rest/v1/reputational_analyses`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        client_id,
        practice_id: practice_id ?? null,
        created_by,
        score_globale: scoreGlobale,
        score_societa: socRes.score,
        score_amm:     scoreAmm,
        score_soci:    scoreSoci,
        risultati,
      }),
    })

    return new Response(JSON.stringify({
      success: true,
      score_globale: scoreGlobale,
      score_societa: socRes.score,
      score_amm:     scoreAmm,
      score_soci:    scoreSoci,
      risultati,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
