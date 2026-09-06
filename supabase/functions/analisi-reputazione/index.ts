import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  title: string; snippet: string; link: string; date: string; source: string;
  relevance?: number;
  sourceQuality?: number;
  sourceTier?: 'ufficiale' | 'stampa_primaria' | 'aggregatore' | 'web';
  identityEvidence?: 'forte' | 'media' | 'debole';
  discriminatorMatched?: boolean;
}
interface Signal {
  text: string; category: string; weight: number;
  articleTitle?: string; articleDate?: string; articleLink?: string;
  confidence?: number;
  sourceCount?: number;
  sourceName?: string;
  eventId?: string;
  identityEvidence?: 'forte' | 'media' | 'debole';
}
interface ReputationEvent {
  id: string;
  title: string;
  category: string;
  polarity: 'negativo' | 'positivo';
  weight: number;
  confidence: number;
  sourceCount: number;
  sources: string[];
  date?: string;
  articleLink?: string;
  identityEvidence: 'forte' | 'media' | 'debole';
  manualReviewRequired: boolean;
  signals: string[];
}
interface QueryAudit {
  label: string;
  provider: 'Google News' | 'DuckDuckGo';
  status: 'risultati' | 'nessun_risultato' | 'non_disponibile';
  resultCount: number;
}
interface SourceCoverage {
  source: string;
  tier: 'ufficiale' | 'stampa_primaria' | 'aggregatore' | 'web';
  resultCount: number;
}
interface SubjectResult {
  nome: string; tipo: string; score: number;
  news: NewsItem[]; signals: Signal[]; newsRischio: NewsItem[];
  totalNewsFetched: number;
  relevantNews: number;
  coverage: number;
  confidence: 'alta' | 'media' | 'bassa';
  queriesWithResults: number;
  queriesAttempted: number;
  queryAudit: QueryAudit[];
  sourceCoverage: SourceCoverage[];
  events: ReputationEvent[];
  scoreExplanation: string[];
  identityAssessment: {
    discriminatorType: 'codice_fiscale' | 'partita_iva' | 'citta' | 'nessuno';
    strongMatches: number;
    weakMatches: number;
    manualReviewRequired: boolean;
    reason: string;
  };
  cessato?: boolean;
}
interface AddressResult {
  indirizzo: string;
  signals: Signal[];
  news: NewsItem[];
  score_delta: number;
}

function canonicalText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(srl|s\.r\.l|spa|s\.p\.a|societa|cooperativa|snc|sas)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function canonicalNewsKey(item: NewsItem): string {
  const title = canonicalText(item.title.replace(/\s+-\s+[^-]+$/, ''))
  return title.split(' ').slice(0, 14).join(' ')
}

function getSourceQuality(source: string, link: string): number {
  const haystack = `${source} ${link}`.toLowerCase()
  if (/(gazzettaufficiale|giustizia|interno|guardiadifinanza|agenziaentrate|agcm|bancaditalia|consob|europa\.eu)/.test(haystack)) return 1
  if (/(ansa|reuters|adnkronos|ilsole24ore|corriere|repubblica|rainews|radiocor)/.test(haystack)) return 0.9
  if (source === 'DuckDuckGo') return 0.55
  if (source === 'Google News') return 0.65
  return 0.72
}

function getSourceTier(source: string, link: string): 'ufficiale' | 'stampa_primaria' | 'aggregatore' | 'web' {
  const quality = getSourceQuality(source, link)
  if (quality >= 0.98) return 'ufficiale'
  if (quality >= 0.85) return 'stampa_primaria'
  if (source === 'Google News' || source === 'DuckDuckGo') return 'aggregatore'
  return 'web'
}

function identityRelevance(item: NewsItem, name: string, discriminator?: string, city?: string): number {
  const text = canonicalText(`${item.title} ${item.snippet}`)
  const normalizedName = canonicalText(name)
  const nameTokens = normalizedName.split(' ').filter(token => token.length >= 3)
  const matchedTokens = nameTokens.filter(token => text.includes(token)).length
  let score = normalizedName && text.includes(normalizedName)
    ? 0.65
    : nameTokens.length > 0 ? 0.55 * (matchedTokens / nameTokens.length) : 0

  const cleanDiscriminator = canonicalText(discriminator ?? '')
  if (cleanDiscriminator && text.includes(cleanDiscriminator)) score += 0.35
  const cleanCity = canonicalText(city ?? '')
  if (cleanCity && text.includes(cleanCity)) score += 0.12
  return Math.min(1, Math.round(score * 100) / 100)
}

function assessIdentityEvidence(
  item: NewsItem,
  name: string,
  discriminator?: string,
  city?: string,
): { level: 'forte' | 'media' | 'debole'; discriminatorMatched: boolean } {
  const text = canonicalText(`${item.title} ${item.snippet}`)
  const cleanName = canonicalText(name)
  const cleanDiscriminator = canonicalText(discriminator ?? '')
  const cleanCity = canonicalText(city ?? '')
  const discriminatorMatched = Boolean(cleanDiscriminator && text.includes(cleanDiscriminator))
  if (discriminatorMatched) return { level: 'forte', discriminatorMatched: true }
  if (cleanName && text.includes(cleanName) && cleanCity && text.includes(cleanCity)) {
    return { level: 'media', discriminatorMatched: false }
  }
  return { level: 'debole', discriminatorMatched: false }
}

function analyzeTextWithNews(
  news: NewsItem[],
  kwList = RISK_KW,
): { signals: Signal[]; scoreDelta: number; events: ReputationEvent[] } {
  const signals: Signal[] = []

  const evaluate = (keyword: { w: string; p: number; cat?: string }, positive: boolean) => {
    const matches = news
      .filter(item => {
        const fullText = `${item.title} ${item.snippet}`.toLowerCase()
        return fullText.includes(keyword.w) && (positive || !hasNegationContext(fullText, keyword.w))
      })
      .map(item => {
        const evidence = getTimeWeight(item.date) * (item.relevance ?? 0.5) * (item.sourceQuality ?? 0.6)
        return { item, evidence }
      })
      .filter(match => positive ? match.evidence >= 0.3 : match.evidence >= 0.18)
      .sort((a, b) => b.evidence - a.evidence)

    if (matches.length === 0) return
    const best = matches[0]
    const independentSources = new Set(matches.map(match => match.item.source)).size
    const confidence = Math.min(1, best.evidence + Math.min(0.2, (independentSources - 1) * 0.1))
    const weighted = Math.round(keyword.p * Math.max(0.25, confidence))
    if (weighted === 0) return
    signals.push({
      text: keyword.w,
      category: positive ? 'Positivo' : keyword.cat ?? 'Rischio',
      weight: weighted,
      articleTitle: best.item.title.substring(0, 80),
      articleDate: best.item.date,
      articleLink: best.item.link || undefined,
      confidence: Math.round(confidence * 100),
      sourceCount: independentSources,
      sourceName: best.item.source,
      identityEvidence: best.item.identityEvidence ?? 'debole',
    })
  }

  for (const keyword of kwList) evaluate(keyword, false)
  if (kwList === RISK_KW) {
    for (const keyword of POS_KW) evaluate(keyword, true)
  }

  // Raggruppa le parole chiave riferite allo stesso evento, evitando che un solo
  // articolo con più termini produca penalizzazioni multiple non proporzionate.
  const eventGroups = new Map<string, Signal[]>()
  for (const signal of signals) {
    const articleKey = canonicalText(signal.articleTitle ?? signal.text).split(' ').slice(0, 14).join(' ')
    const key = `${signal.category}:${articleKey}`
    const group = eventGroups.get(key) ?? []
    group.push(signal)
    eventGroups.set(key, group)
  }

  const events: ReputationEvent[] = Array.from(eventGroups.entries()).map(([key, group]) => {
    const negative = group.some(signal => signal.weight < 0)
    const rawWeight = group.reduce((sum, signal) => sum + signal.weight, 0)
    const weight = negative ? Math.max(-35, rawWeight) : Math.min(12, rawWeight)
    const identityEvidence = group.some(signal => signal.identityEvidence === 'forte')
      ? 'forte'
      : group.some(signal => signal.identityEvidence === 'media') ? 'media' : 'debole'
    const id = canonicalText(key).replace(/\s+/g, '-').slice(0, 90)
    if (rawWeight !== 0 && rawWeight !== weight) {
      const factor = weight / rawWeight
      group.forEach(signal => { signal.weight = Math.round(signal.weight * factor) })
      const allocated = group.reduce((sum, signal) => sum + signal.weight, 0)
      group[0].weight += weight - allocated
    }
    group.forEach(signal => { signal.eventId = id })
    const sources = Array.from(new Set(group.map(signal => signal.sourceName).filter(Boolean) as string[]))
    return {
      id,
      title: group[0].articleTitle ?? group.map(signal => signal.text).join(', '),
      category: group[0].category,
      polarity: negative ? 'negativo' : 'positivo',
      weight,
      confidence: Math.max(...group.map(signal => signal.confidence ?? 0)),
      sourceCount: Math.max(...group.map(signal => signal.sourceCount ?? 1)),
      sources,
      date: group[0].articleDate,
      articleLink: group[0].articleLink,
      identityEvidence,
      manualReviewRequired: identityEvidence === 'debole' || sources.length < 1,
      signals: group.map(signal => signal.text),
    }
  })

  return {
    signals,
    events,
    scoreDelta: events.reduce((sum, event) => sum + event.weight, 0),
  }
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
  if (!res || !res.ok) throw new Error(`Google News non disponibile${res ? ` (${res.status})` : ''}`)
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
      sourceQuality: getSourceQuality(sourceM?.[1]?.trim() ?? 'Google News', linkM?.[1]?.trim() ?? ''),
      sourceTier: getSourceTier(sourceM?.[1]?.trim() ?? 'Google News', linkM?.[1]?.trim() ?? ''),
    })
  }
  return items.slice(0, 10)
}

// ─── DuckDuckGo HTML scraping ─────────────────────────────────────────────────
async function fetchDuckDuckGo(query: string): Promise<NewsItem[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=it-it`
  const res = await fetchWithTimeout(url, 8000)
  if (!res || !res.ok) throw new Error(`DuckDuckGo non disponibile${res ? ` (${res.status})` : ''}`)
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
      sourceQuality: getSourceQuality('DuckDuckGo', links[i]),
      sourceTier: getSourceTier('DuckDuckGo', links[i]),
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
  const discriminatorValue = isCF ? codiceFiscale : hasPiva ? piva : city
  const discriminator = isCF
    ? `"${codiceFiscale}"`
    : hasPiva
      ? `"${piva}"`
      : city ? `"${city}"` : ''

  const nameQ = `"${name}"`

  const queryConfigs: Array<{
    label: string;
    provider: 'Google News' | 'DuckDuckGo';
    run: () => Promise<NewsItem[]>;
  }> = [
    { label: 'Notizie generali', provider: 'Google News', run: () => fetchGoogleNews(name) },
    {
      label: 'Procedimenti e tribunali',
      provider: 'Google News',
      run: () => fetchGoogleNews(discriminator
        ? `${nameQ} ${discriminator} indagato condanna tribunale arresti`
        : `${name} indagato condanna tribunale arresti`),
    },
    {
      label: 'Insolvenze e procedure',
      provider: 'Google News',
      run: () => fetchGoogleNews(discriminator
        ? `${nameQ} ${discriminator} protesto pignoramento insolvenza fallimento`
        : `${name} protesto pignoramento insolvenza fallimento`),
    },
    {
      label: 'Rischio fiscale',
      provider: 'Google News',
      run: () => fetchGoogleNews(discriminator
        ? `${nameQ} ${discriminator} evasione fiscale cartella esattoriale debiti INPS`
        : `${nameQ} evasione fiscale cartella esattoriale debiti INPS`),
    },
    {
      label: 'Antimafia e riciclaggio',
      provider: 'Google News',
      run: () => fetchGoogleNews(discriminator
        ? `${nameQ} ${discriminator} antimafia riciclaggio sequestro`
        : `${nameQ} antimafia riciclaggio sequestro`),
    },
    {
      label: 'Riscontro web rischi',
      provider: 'DuckDuckGo',
      run: () => fetchDuckDuckGo(discriminator
        ? `${nameQ} ${discriminator} fallimento indagato protesto condanna frode`
        : `${nameQ} fallimento indagato protesto condanna frode`),
    },
    {
      label: 'Riscontro web sanzioni',
      provider: 'DuckDuckGo',
      run: () => fetchDuckDuckGo(discriminator
        ? `${nameQ} ${discriminator} sanzione multa violazione`
        : `${nameQ} sanzione multa violazione`),
    },
  ]
  const results = await Promise.allSettled(queryConfigs.map(config => config.run()))
  const allNewsRaw: NewsItem[] = []
  let queriesWithResults = 0
  const queryAudit: QueryAudit[] = []
  for (let index = 0; index < results.length; index++) {
    const r = results[index]
    const config = queryConfigs[index]
    if (r.status === 'fulfilled') {
      if (r.value.length > 0) queriesWithResults++
      allNewsRaw.push(...r.value)
      queryAudit.push({
        label: config.label,
        provider: config.provider,
        status: r.value.length > 0 ? 'risultati' : 'nessun_risultato',
        resultCount: r.value.length,
      })
    } else {
      queryAudit.push({
        label: config.label,
        provider: config.provider,
        status: 'non_disponibile',
        resultCount: 0,
      })
    }
  }

  // Valuta esplicitamente la corrispondenza dell'identità e scarta le omonimie deboli.
  const relevantRaw = allNewsRaw
    .map(item => {
      const identity = assessIdentityEvidence(item, name, discriminatorValue, city)
      return {
        ...item,
        relevance: identityRelevance(item, name, discriminatorValue, city),
        sourceQuality: item.sourceQuality ?? getSourceQuality(item.source, item.link),
        sourceTier: item.sourceTier ?? getSourceTier(item.source, item.link),
        identityEvidence: identity.level,
        discriminatorMatched: identity.discriminatorMatched,
      }
    })
    .filter(item => (item.relevance ?? 0) >= 0.45)

  // Deduplica per titolo canonico: intercetta anche la stessa notizia sindacata con URL diversi.
  const seenNews = new Set<string>()
  const allNews: NewsItem[] = []
  for (const item of relevantRaw.sort((a, b) =>
    ((b.relevance ?? 0) * (b.sourceQuality ?? 0)) - ((a.relevance ?? 0) * (a.sourceQuality ?? 0))
  )) {
    const key = canonicalNewsKey(item) || item.link
    if (key && !seenNews.has(key)) {
      seenNews.add(key)
      allNews.push(item)
    }
  }

  const { signals, scoreDelta, events } = analyzeTextWithNews(allNews)

  // Assenza di notizie non è un segnale positivo: parte da una base neutrale.
  const score = Math.max(0, Math.min(100, 70 + scoreDelta))
  const availableQueries = queryAudit.filter(query => query.status !== 'non_disponibile').length
  const coverage = Math.round((availableQueries / queryConfigs.length) * 100)
  const avgRelevance = allNews.length > 0
    ? allNews.reduce((sum, item) => sum + (item.relevance ?? 0), 0) / allNews.length
    : 0
  const confidenceValue = Math.min(100, Math.round(coverage * 0.45 + avgRelevance * 100 * 0.55))
  const confidence: 'alta' | 'media' | 'bassa' =
    confidenceValue >= 70 ? 'alta' : confidenceValue >= 40 ? 'media' : 'bassa'
  const strongMatches = allNews.filter(item => item.identityEvidence === 'forte').length
  const weakMatches = allNews.filter(item => item.identityEvidence === 'debole').length
  const discriminatorType: 'codice_fiscale' | 'partita_iva' | 'citta' | 'nessuno' =
    isCF ? 'codice_fiscale' : hasPiva ? 'partita_iva' : city ? 'citta' : 'nessuno'
  const manualReviewRequired = events.some(event => event.manualReviewRequired)
    || (events.length > 0 && strongMatches === 0)
  const identityReason = events.length === 0
    ? 'Nessun evento rilevante da attribuire al soggetto'
    : strongMatches > 0
      ? `${strongMatches} risultato/i contengono un discriminatore forte`
      : 'Gli eventi non contengono partita IVA o codice fiscale: verificare manualmente eventuali omonimie'

  const sourceMap = new Map<string, SourceCoverage>()
  for (const item of allNews) {
    const tier = item.sourceTier ?? getSourceTier(item.source, item.link)
    const current = sourceMap.get(item.source)
    sourceMap.set(item.source, {
      source: item.source,
      tier,
      resultCount: (current?.resultCount ?? 0) + 1,
    })
  }
  const sourceCoverage = Array.from(sourceMap.values())
    .sort((a, b) => b.resultCount - a.resultCount)
  const unavailableQueries = queryAudit.filter(query => query.status === 'non_disponibile').length
  const negativeEvents = events.filter(event => event.polarity === 'negativo')
  const positiveEvents = events.filter(event => event.polarity === 'positivo')
  const scoreExplanation = [
    'Base neutrale: 70/100. L’assenza di notizie non aumenta lo score.',
    negativeEvents.length > 0
      ? `${negativeEvents.length} evento/i negativo/i incidono per ${Math.abs(negativeEvents.reduce((sum, event) => sum + event.weight, 0))} punti.`
      : 'Nessun evento negativo sufficientemente pertinente è stato rilevato.',
    positiveEvents.length > 0
      ? `${positiveEvents.length} evento/i positivo/i incidono per ${positiveEvents.reduce((sum, event) => sum + event.weight, 0)} punti.`
      : 'Nessun evento positivo è stato utilizzato per modificare lo score.',
    unavailableQueries > 0
      ? `${unavailableQueries} ricerca/e non erano disponibili e riducono la copertura.`
      : 'Tutte le ricerche previste hanno risposto.',
    manualReviewRequired
      ? 'È richiesta verifica manuale dell’identità per almeno un evento.'
      : 'La corrispondenza dell’identità è adeguata per gli eventi utilizzati.',
  ]

  const displayedNews = allNews.slice(0, 8)
  const riskNews   = allNews.filter(n =>
    signals.some(sig => sig.weight < 0 && sig.articleTitle &&
      n.title.startsWith(sig.articleTitle.substring(0, 40)))
  ).slice(0, 4)

  return {
    nome: name, tipo, score,
    news: displayedNews,
    signals,
    newsRischio: riskNews,
    totalNewsFetched: allNewsRaw.length,
    relevantNews: allNews.length,
    coverage,
    confidence,
    queriesWithResults,
    queriesAttempted: queryConfigs.length,
    queryAudit,
    sourceCoverage,
    events,
    scoreExplanation,
    identityAssessment: {
      discriminatorType,
      strongMatches,
      weakMatches,
      manualReviewRequired,
      reason: identityReason,
    },
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

    // La funzione usa la service role solo per le ricerche e il salvataggio finale,
    // ma l'utente chiamante deve essere autenticato e poter leggere la pratica/cliente.
    const authHeader = req.headers.get('Authorization') ?? ''
    const accessClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const { data: authData, error: authError } = await accessClient.auth.getUser(token)
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Autenticazione richiesta' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accessQuery = practice_id
      ? accessClient.from('practices').select('id').eq('id', practice_id).eq('client_id', client_id).maybeSingle()
      : accessClient.from('clients').select('id').eq('id', client_id).maybeSingle()
    const { data: accessibleRecord, error: accessError } = await accessQuery
    if (accessError || !accessibleRecord) {
      return new Response(JSON.stringify({ error: 'Accesso alla pratica non consentito' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
    const scoreAmm     = ammResults.length  ? Math.round(ammResults.reduce((s, r)  => s + r.score, 0) / ammResults.length)  : 70
    const scoreSoci    = sociResults.length ? Math.round(sociResults.reduce((s, r) => s + r.score, 0) / sociResults.length) : 70
    const scoreGlobale = Math.round(socRes.score * 0.5 + scoreAmm * 0.3 + scoreSoci * 0.2)
    const activeSubjects = [socRes, ...ammResults, ...sociResults]
    const averageCoverage = Math.round(
      activeSubjects.reduce((sum, subject) => sum + subject.coverage, 0) / activeSubjects.length
    )
    const lowConfidenceSubjects = activeSubjects.filter(subject => subject.confidence === 'bassa').length
    const manualReviewSubjects = activeSubjects.filter(
      subject => subject.identityAssessment.manualReviewRequired
    ).length
    const unavailableQueries = activeSubjects.reduce(
      (sum, subject) => sum + subject.queryAudit.filter(query => query.status === 'non_disponibile').length,
      0
    )
    const relevantEvents = activeSubjects.reduce(
      (sum, subject) => sum + subject.events.length,
      0
    )

    const risultati = {
      societa:        socRes,
      amministratori: ammResults,
      soci:           sociResults,
      amm_cessati:    ammCessResults.length  > 0 ? ammCessResults  : undefined,
      soci_cessati:   sociCessResults.length > 0 ? sociCessResults : undefined,
      indirizzi:      indirizziResults.length > 0 ? indirizziResults : undefined,
      quality_summary: {
        average_coverage: averageCoverage,
        low_confidence_subjects: lowConfidenceSubjects,
        manual_review_subjects: manualReviewSubjects,
        unavailable_queries: unavailableQueries,
        relevant_events: relevantEvents,
        active_subjects: activeSubjects.length,
        methodology_version: '3.0-explainable',
      },
      generato_il:    new Date().toISOString(),
    }

    // 6. User corrente
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
