const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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
]
const POS_KW = [
  { w: 'premiata', p: +6 }, { w: 'eccellenza', p: +6 },
  { w: 'crescita', p: +4 }, { w: 'acquisizione', p: +3 },
  { w: 'innovazione', p: +4 }, { w: 'certificazione', p: +5 },
  { w: 'quotazione', p: +4 }, { w: 'espansione', p: +3 },
]

function analyzeText(text: string) {
  const lower = text.toLowerCase()
  const signals: { text: string; category: string; weight: number }[] = []
  let delta = 0
  for (const k of RISK_KW) {
    if (lower.includes(k.w)) { signals.push({ text: k.w, category: k.cat, weight: k.p }); delta += k.p }
  }
  for (const k of POS_KW) {
    if (lower.includes(k.w)) { signals.push({ text: k.w, category: 'Positivo', weight: k.p }); delta += k.p }
  }
  return { signals, score: delta }
}

async function fetchWithTimeout(url: string, ms = 9000): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)' },
    })
    return res
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchNews(query: string): Promise<{ title: string; snippet: string; link: string; date: string; source: string }[]> {
  const encoded = encodeURIComponent(`"${query}"`)
  const url = `https://news.google.com/rss/search?q=${encoded}&hl=it&gl=IT&ceid=IT:it`
  const res = await fetchWithTimeout(url, 9000)
  if (!res || !res.ok) return []
  const xml = await res.text()
  const items: { title: string; snippet: string; link: string; date: string; source: string }[] = []
  const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  for (const m of matches) {
    const item = m[1]
    const titleM   = item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/) || item.match(/<title>([\s\S]*?)<\/title>/)
    const snippetM = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/) || item.match(/<description>([\s\S]*?)<\/description>/)
    const linkM    = item.match(/<link>([\s\S]*?)<\/link>/)
    const dateM    = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)
    const sourceM  = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)
    const title   = titleM?.[1]?.trim() ?? ''
    const snippet = snippetM?.[1]?.replace(/<[^>]+>/g, '').trim() ?? ''
    const link    = linkM?.[1]?.trim() ?? ''
    const date    = dateM?.[1]?.trim() ?? ''
    const source  = sourceM?.[1]?.trim() ?? ''
    if (title) items.push({ title, snippet: snippet.substring(0, 300), link, date, source })
  }
  return items.slice(0, 8)
}

async function analyzeSubject(name: string, tipo: string) {
  const generalNews = await fetchNews(name)
  const riskNews    = await fetchNews(`${name} fallimento indagato condanna protesto frode`)
  const seenLinks   = new Set(generalNews.map(n => n.link))
  const allNews     = [...generalNews, ...riskNews.filter(n => !seenLinks.has(n.link))]
  const allText     = allNews.map(n => `${n.title} ${n.snippet}`).join(' ')
  const { signals, score: delta } = analyzeText(allText)
  const score = Math.max(0, Math.min(100, 70 + delta))
  return { nome: name, tipo, score, news: generalNews.slice(0, 5), signals, newsRischio: riskNews.slice(0, 4) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { client_id, practice_id } = await req.json()
    if (!client_id) {
      return new Response(JSON.stringify({ error: 'client_id obbligatorio' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Recupera dati cliente
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

    const client  = clients[0]
    const soci: { nome: string }[]  = client.soci ?? []
    const amm:  { nome: string }[]  = client.amministratori ?? []

    // 2. Analisi società
    const socRes = await analyzeSubject(client.ragione_sociale, 'societa')

    // 3. Analisi amministratori (max 3, in sequenza)
    const ammResults = []
    for (const a of amm.slice(0, 3)) {
      ammResults.push(await analyzeSubject(a.nome, 'amministratore'))
    }

    // 4. Analisi soci (max 3, in sequenza)
    const sociResults = []
    for (const s of soci.slice(0, 3)) {
      sociResults.push(await analyzeSubject(s.nome, 'socio'))
    }

    // 5. Score globale ponderato
    const scoreAmm     = ammResults.length  ? Math.round(ammResults.reduce((s, r)  => s + r.score, 0) / ammResults.length)  : 100
    const scoreSoci    = sociResults.length ? Math.round(sociResults.reduce((s, r) => s + r.score, 0) / sociResults.length) : 100
    const scoreGlobale = Math.round(socRes.score * 0.5 + scoreAmm * 0.3 + scoreSoci * 0.2)

    const risultati = {
      societa:        socRes,
      amministratori: ammResults,
      soci:           sociResults,
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
