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

  // Fiscale
  { w: 'cartella esattoriale',   p: -18, cat: 'Rischio fiscale' },
  { w: 'avviso di accertamento', p: -15, cat: 'Rischio fiscale' },
  { w: 'omesso versamento',      p: -20, cat: 'Rischio fiscale' },
  { w: 'debiti fiscali',         p: -15, cat: 'Rischio fiscale' },
  { w: 'equitalia',              p: -12, cat: 'Rischio fiscale' },
  { w: 'agenzia entrate',        p: -8,  cat: 'Rischio fiscale' },
  { w: 'inps contributi',        p: -10, cat: 'Rischio fiscale' },
  { w: 'irregolarità fiscale',   p: -18, cat: 'Rischio fiscale' },
  { w: 'elusione fiscale',       p: -20, cat: 'Rischio fiscale' },

  // Lavoro
  { w: 'caporalato',             p: -28, cat: 'Violazioni lavoro' },
  { w: 'lavoro nero',            p: -22, cat: 'Violazioni lavoro' },
  { w: 'sfruttamento',           p: -25, cat: 'Violazioni lavoro' },
  { w: 'irregolarità lavoro',    p: -15, cat: 'Violazioni lavoro' },
  { w: 'infortuni sul lavoro',   p: -12, cat: 'Violazioni lavoro' },
  { w: 'violazione sicurezza',   p: -12, cat: 'Violazioni lavoro' },

  // Ambientale
  { w: 'inquinamento',           p: -18, cat: 'Rischio ambientale' },
  { w: 'smaltimento illecito',   p: -22, cat: 'Rischio ambientale' },
  { w: 'discarica abusiva',      p: -22, cat: 'Rischio ambientale' },
  { w: 'reato ambientale',       p: -25, cat: 'Rischio ambientale' },
  { w: 'bonifica',               p: -10, cat: 'Rischio ambientale' },

  // GDPR / Privacy
  { w: 'multa garante',          p: -18, cat: 'Privacy / GDPR' },
  { w: 'violazione dati',        p: -15, cat: 'Privacy / GDPR' },
  { w: 'data breach',            p: -20, cat: 'Privacy / GDPR' },
  { w: 'gdpr',                   p: -8,  cat: 'Privacy / GDPR' },
  { w: 'garante privacy',        p: -10, cat: 'Privacy / GDPR' },

  // Antimafia / AML
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

// Keyword specifiche per indirizzi (eventi negativi nei locali/sede)
const ADDRESS_RISK_KW = [
  { w: 'sequestro',        p: -25, cat: 'Locali / Sede' },
  { w: 'sequestrati',      p: -25, cat: 'Locali / Sede' },
  { w: 'sgombero',         p: -18, cat: 'Locali / Sede' },
  { w: 'abusivo',          p: -20, cat: 'Locali / Sede' },
  { w: 'abusiva',          p: -20, cat: 'Locali / Sede' },
  { w: 'illecito',         p: -18, cat: 'Locali / Sede' },
  { w: 'illecita',         p: -18, cat: 'Locali / Sede' },
  { w: 'spaccio',          p: -28, cat: 'Locali / Sede' },
  { w: 'blitz',            p: -15, cat: 'Locali / Sede' },
  { w: 'operazione polizia', p: -18, cat: 'Locali / Sede' },
  { w: 'arrestati',        p: -20, cat: 'Locali / Sede' },
  { w: 'fallimento',       p: -15, cat: 'Locali / Sede' },
  { w: 'chiuso',           p: -8,  cat: 'Locali / Sede' },
  { w: 'chiusura coatta',  p: -18, cat: 'Locali / Sede' },
  { w: 'incendio doloso',  p: -22, cat: 'Locali / Sede' },
  { w: 'interdittiva',     p: -30, cat: 'Locali / Sede' },
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
  text: string; category: string; weight: number;
  articleTitle?: string; articleDate?: string; articleLink?: string
}
interface SubjectResult {
  nome: string; tipo: string; score: number;
  news: NewsItem[]; signals: Signal[]; newsRischio: NewsItem[];
  totalNewsFetched: number;
  cessato?: boolean;
}
interface AddressResult {
  indirizzo: string;
  signals: Signal[];
  news: NewsItem[];
  score_delta: number;
}

function analyzeTextWithNews(news: NewsItem[], kwList = RISK_KW): { signals: Signal[]; scoreDelta: number } {
  const seenSignals = new Set<string>()
  const signals: Signal[] = []
  let scoreDelta = 0

  for (const item of news) {
    const timeW = getTimeWeight(item.date)
    const fullText = `${item.title} ${item.snippet}`.toLowerCase()

    for (const k of kwList) {
      if (!fullText.includes(k.w)) continue
      if (hasNegationContext(fullText, k.w)) continue
      const dedupKey = k.w
      if (seenSignals.has(dedupKey)) continue
      seenSignals.add(dedupKey)
      const weightedPenalty = Math.round(k.p * timeW)
      signals.push({
        text: k.w, category: k.cat, weight: weightedPenalty,
        articleTitle: item.title.substring(0, 80),
        articleDate: item.date,
        articleLink: item.link || undefined,
      })
      scoreDelta += weightedPenalty
    }

    // Positivi solo per analisi soggetti (non indirizzi)
    if (kwList === RISK_KW) {
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
          articleLink: item.link || undefined,
        })
        scoreDelta += weightedBonus
      }
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
// codiceFiscale: per persone fisiche (16 char alfanumerici) viene usato come discriminatore forte
async function analyzeSubject(
  name: string,
  tipo: string,
  piva?: string,
  city?: string,
  codiceFiscale?: string,
  cessato = false,
): Promise<SubjectResult> {
  // Determina il discriminatore più preciso disponibile
  // - Per persone fisiche: CF (16 char alfanumerici) ha precedenza sulla città
  // - Per società: P.IVA ha precedenza sulla città
  const isCF = codiceFiscale && /^[A-Z0-9]{16}$/i.test(codiceFiscale)
  const hasPiva = !!piva
  const discriminator = isCF
    ? `"${codiceFiscale}"`
    : hasPiva
      ? `"${piva}"`
      : city ? `"${city}"` : ''

  const nameQ = `"${name}"`

  const queries = [
    // Query base
    fetchGoogleNews(name),
    // Query legale con discriminatore (CF/PIVA/città)
    fetchGoogleNews(discriminator
      ? `${nameQ} ${discriminator} indagato condanna tribunale arresti`
      : `${name} indagato condanna tribunale arresti`),
    // Query finanziaria con discriminatore
    fetchGoogleNews(discriminator
      ? `${nameQ} ${discriminator} protesto pignoramento insolvenza fallimento`
      : `${name} protesto pignoramento insolvenza fallimento`),
    // Query fiscale
    fetchGoogleNews(`${name} evasione fiscale cartella esattoriale debiti INPS`),
    // Query antimafia
    fetchGoogleNews(`${name} antimafia riciclaggio sequestro`),
    // DuckDuckGo con discriminatore
    fetchDuckDuckGo(discriminator
      ? `${nameQ} ${discriminator} fallimento indagato protesto condanna frode`
      : `${nameQ} fallimento indagato protesto condanna frode`),
    fetchDuckDuckGo(`${nameQ} sanzione multa violazione`),
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

  const hasNegativeSignals = signals.some(s => s.weight < 0)
  const newsBonus = allNews.length > 0 && !hasNegativeSignals ? 10 : 0
  const score = Math.max(0, Math.min(100, 60 + newsBonus + scoreDelta))

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
    cessato,
  }
}

// ─── Analisi indirizzo/sede ───────────────────────────────────────────────────
async function analyzeAddress(indirizzo: string): Promise<AddressResult> {
  if (!indirizzo || indirizzo.trim().length < 5) {
    return { indirizzo, signals: [], news: [], score_delta: 0 }
  }

  // Estrai il comune dall'indirizzo per query più mirata
  const communeMatch = indirizzo.match(/\b(\d{5})\s+([A-ZÀÈÉÌÒÙ][A-Z\s\']{2,30})(?:\s*\([A-Z]{2}\))?/i)
  const comune = communeMatch?.[2]?.trim() ?? ''
  const indirizzoQ = `"${indirizzo}"`

  const queries = [
    // Query mirata sull'indirizzo con parole chiave di allerta
    fetchGoogleNews(`${indirizzoQ} sequestro abusivo illecito blitz operazione`),
    fetchDuckDuckGo(`${indirizzoQ} fallimento sequestro abusivo illecito spaccio`),
    // Query sul comune + indirizzo breve (per attività commerciali)
    ...(comune ? [
      fetchGoogleNews(`${comune} "${indirizzo.split(',')[0]}" sequestro illecito abusivo`),
    ] : []),
  ]

  const results = await Promise.allSettled(queries)
  const allNewsRaw: NewsItem[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') allNewsRaw.push(...r.value)
  }

  // Deduplica
  const seenLinks = new Set<string>()
  const allNews: NewsItem[] = []
  for (const item of allNewsRaw) {
    const key = item.link || item.title
    if (!seenLinks.has(key)) { seenLinks.add(key); allNews.push(item) }
  }

  const { signals, scoreDelta } = analyzeTextWithNews(allNews, ADDRESS_RISK_KW)

  // Solo news rilevanti (quelle che hanno generato segnali)
  const relevantNews = allNews.filter(n =>
    signals.some(sig => sig.articleTitle && n.title.startsWith(sig.articleTitle.substring(0, 40)))
  ).slice(0, 4)

  return {
    indirizzo,
    signals,
    news: relevantNews,
    score_delta: scoreDelta,
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

    // 1. Dati cliente — incluso visura_json per storico cessati
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${client_id}&select=ragione_sociale,piva,indirizzo,soci,amministratori,visura_json`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
    const clients = await clientRes.json()
    if (!clients?.length) {
      return new Response(JSON.stringify({ error: 'Cliente non trovato' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const client = clients[0]
    const soci: { nome: string; codice_fiscale?: string }[] = client.soci ?? []
    const amm:  { nome: string; codice_fiscale?: string }[] = client.amministratori ?? []
    const piva: string | undefined = client.piva ?? undefined

    // visura_json per storico
    type VisuraJsonType = {
      storico_amministratori?: Array<{ carica: string; nome: string; data_inizio?: string | null; data_fine?: string | null; cessato?: boolean; codice_fiscale?: string }>;
      storico_soci?: Array<{ nome: string; percentuale?: number | null; data_variazione?: string | null; codice_fiscale?: string; cessato?: boolean }>;
      storico_sedi?: Array<{ indirizzo: string; data_inizio?: string | null; tipo?: string }>;
    }
    const visuraJson: VisuraJsonType = (client.visura_json as VisuraJsonType) ?? {}

    // Estrai la città dall'indirizzo
    const cityMatch = (client.indirizzo ?? '').match(/\b(\d{5})\s+([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s\']{2,40?})(?:\s*\([A-Z]{2}\))?\s*$/i)
    const city: string | undefined = cityMatch?.[2]?.trim() ?? undefined

    // 2. Estrai soggetti cessati dalla visura_json (max 3 per tipo)
    const ammCessatiRaw = (visuraJson.storico_amministratori ?? [])
      .filter(a => a.cessato === true && a.nome && a.nome.trim().length > 2)
      // Esclude chi è già presente tra gli attuali
      .filter(a => !amm.some(cur => cur.nome?.toLowerCase() === a.nome?.toLowerCase()))
      .slice(0, 3)

    const sociCessatiRaw = (visuraJson.storico_soci ?? [])
      .filter(s => s.cessato === true && s.nome && s.nome.trim().length > 2)
      .filter(s => !soci.some(cur => cur.nome?.toLowerCase() === s.nome?.toLowerCase()))
      .slice(0, 3)

    // 3. Indirizzi da analizzare (attuale + storiche, max 4)
    const indirizziDaAnalizzare: string[] = []
    if (client.indirizzo) indirizziDaAnalizzare.push(client.indirizzo)
    for (const sede of (visuraJson.storico_sedi ?? []).slice(0, 3)) {
      if (sede.indirizzo && !indirizziDaAnalizzare.some(i => i.toLowerCase() === sede.indirizzo.toLowerCase())) {
        indirizziDaAnalizzare.push(sede.indirizzo)
      }
    }
    const indirizziSlice = indirizziDaAnalizzare.slice(0, 4)

    // 4. Analisi PARALLELA di tutti i soggetti + cessati + indirizzi
    const [
      socRes,
      ...allPersonResults
    ] = await Promise.all([
      analyzeSubject(client.ragione_sociale, 'societa', piva, city),
      // Amministratori attuali: CF se disponibile (persone fisiche)
      ...amm.slice(0, 3).map(a => {
        const cf = a.codice_fiscale && /^[A-Z0-9]{16}$/i.test(a.codice_fiscale) ? a.codice_fiscale : undefined
        return analyzeSubject(a.nome, 'amministratore', undefined, city, cf, false)
      }),
      // Soci attuali: se CF ha 11 cifre è P.IVA di società
      ...soci.slice(0, 3).map(s => {
        const socioPiva = s.codice_fiscale && /^\d{11}$/.test(s.codice_fiscale) ? s.codice_fiscale : undefined
        const socioCF   = s.codice_fiscale && /^[A-Z0-9]{16}$/i.test(s.codice_fiscale) ? s.codice_fiscale : undefined
        return analyzeSubject(s.nome, 'socio', socioPiva, city, socioCF, false)
      }),
      // Amministratori cessati
      ...ammCessatiRaw.map(a => {
        const cf = a.codice_fiscale && /^[A-Z0-9]{16}$/i.test(a.codice_fiscale) ? a.codice_fiscale : undefined
        return analyzeSubject(a.nome, 'amministratore', undefined, city, cf, true)
      }),
      // Soci cessati
      ...sociCessatiRaw.map(s => {
        const cf = s.codice_fiscale && /^[A-Z0-9]{16}$/i.test(s.codice_fiscale) ? s.codice_fiscale : undefined
        return analyzeSubject(s.nome, 'socio', undefined, city, cf, true)
      }),
      // Analisi indirizzi
      ...indirizziSlice.map(ind => analyzeAddress(ind)),
    ])

    const ammCount     = amm.slice(0, 3).length
    const sociCount    = soci.slice(0, 3).length
    const ammCessCount = ammCessatiRaw.length
    const sociCessCount= sociCessatiRaw.length

    const ammResults      = allPersonResults.slice(0, ammCount) as SubjectResult[]
    const sociResults     = allPersonResults.slice(ammCount, ammCount + sociCount) as SubjectResult[]
    const ammCessResults  = allPersonResults.slice(ammCount + sociCount, ammCount + sociCount + ammCessCount) as SubjectResult[]
    const sociCessResults = allPersonResults.slice(ammCount + sociCount + ammCessCount, ammCount + sociCount + ammCessCount + sociCessCount) as SubjectResult[]
    const indirizziResults= allPersonResults.slice(ammCount + sociCount + ammCessCount + sociCessCount) as unknown as AddressResult[]

    // 5. Score globale ponderato (solo soggetti attuali)
    const scoreAmm     = ammResults.length  ? Math.round(ammResults.reduce((s, r)  => s + r.score, 0) / ammResults.length)  : 100
    const scoreSoci    = sociResults.length ? Math.round(sociResults.reduce((s, r) => s + r.score, 0) / sociResults.length) : 100
    const scoreGlobale = Math.round(socRes.score * 0.5 + scoreAmm * 0.3 + scoreSoci * 0.2)

    const risultati = {
      societa:        socRes,
      amministratori: ammResults,
      soci:           sociResults,
      amm_cessati:    ammCessResults.length  > 0 ? ammCessResults  : undefined,
      soci_cessati:   sociCessResults.length > 0 ? sociCessResults : undefined,
      indirizzi:      indirizziResults.length > 0 ? indirizziResults : undefined,
      generato_il:    new Date().toISOString(),
    }

    // 6. User corrente
    const authHeader = req.headers.get('Authorization') ?? `Bearer ${SUPABASE_KEY}`
    let created_by = null
    try {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_KEY, Authorization: authHeader },
      })
      const userObj = await userRes.json()
      created_by = userObj?.id ?? null
    } catch { /* ignore */ }

    // 7. Salva su DB
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
