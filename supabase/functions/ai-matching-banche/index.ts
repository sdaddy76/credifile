const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { practice_id } = await req.json()
    if (!practice_id) return new Response(JSON.stringify({ error: 'practice_id obbligatorio' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const h = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }

    // 1. Dati pratica + cliente
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/practices?id=eq.${practice_id}&select=importo_richiesto,motivazione,codice_ateco,clients(ragione_sociale,indirizzo,capitale_sociale_versato)`, { headers: h })
    const practices = await pRes.json()
    const p = practices?.[0]
    if (!p) return new Response(JSON.stringify({ error: 'Pratica non trovata' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // 2. KPI più recenti
    const kRes = await fetch(`${SUPABASE_URL}/rest/v1/bilanci_kpi?practice_id=eq.${practice_id}&select=anno_esercizio,ricavi_vendite,totale_patrimonio_netto,totale_debiti,utile_netto,kpi&order=anno_esercizio.desc&limit=1`, { headers: h })
    const kpis = await kRes.json()
    const kpi = kpis?.[0]

    // 3. Banche attive con criteri KPI
    const bRes = await fetch(`${SUPABASE_URL}/rest/v1/banks?attiva=eq.true&select=id,nome,bank_kpi_requirements(kpi_key,kpi_area,kpi_label,min_value,max_value)`, { headers: h })
    const banks = await bRes.json()

    // 4. Score matching per ogni banca
    const matchResults = (banks || []).map((bank: Record<string, unknown>) => {
      const reqs = (bank.bank_kpi_requirements as { kpi_key: string; kpi_area: string; kpi_label: string; min_value: number|null; max_value: number|null }[]) || []
      if (!reqs.length) return { bankId: bank.id, bankName: bank.nome, score: 70, passCount: 0, failCount: 0, details: [] }
      let pass = 0, fail = 0
      const details: { label: string; pass: boolean|null; actual: number|null; min: number|null; max: number|null }[] = []
      for (const req of reqs) {
        let actual: number|null = null
        if (kpi?.kpi) {
          const area = (kpi.kpi as Record<string, Record<string, {valore: number|null}>>)[req.kpi_area]
          actual = area?.[req.kpi_key]?.valore ?? null
        }
        let passed: boolean|null = null
        if (actual !== null) {
          passed = true
          if (req.min_value !== null && actual < req.min_value) passed = false
          if (req.max_value !== null && actual > req.max_value) passed = false
        }
        if (passed === true) pass++
        if (passed === false) fail++
        details.push({ label: req.kpi_label, pass: passed, actual, min: req.min_value, max: req.max_value })
      }
      const score = reqs.length > 0 ? Math.round(((pass) / reqs.length) * 100) : 70
      return { bankId: bank.id, bankName: bank.nome, score, passCount: pass, failCount: fail, ndCount: reqs.length - pass - fail, details }
    }).sort((a: {score: number}, b: {score: number}) => b.score - a.score)

    // 5. Groq AI per suggerimento narrativo
    let aiSuggerimento = ''
    try {
      const topBanks = matchResults.slice(0, 3).map((b: {bankName: unknown; score: number; passCount: number; failCount: number}) => `${b.bankName} (score ${b.score}%, ${b.passCount} criteri OK, ${b.failCount} NOK)`).join('; ')
      const kpiSummary = kpi ? `fatturato ${kpi.ricavi_vendite || 'ND'}€, patrimonio netto ${kpi.totale_patrimonio_netto || 'ND'}€, utile ${kpi.utile_netto || 'ND'}€` : 'KPI non disponibili'
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3-8b-8192',
          messages: [{
            role: 'user',
            content: `Sei un consulente finanziario italiano. Analizza questo matching banca-pratica e dai un suggerimento operativo in 2-3 frasi.
Pratica: importo ${p.importo_richiesto || 'ND'}€, ATECO ${p.codice_ateco || 'ND'}, motivazione: ${p.motivazione || 'ND'}
KPI: ${kpiSummary}
Banche migliori: ${topBanks}
Rispondi in italiano, sii diretto e pratico.`
          }],
          max_tokens: 200
        })
      })
      const groqData = await groqRes.json()
      aiSuggerimento = groqData.choices?.[0]?.message?.content || ''
    } catch { /* ignore AI errors */ }

    return new Response(JSON.stringify({ success: true, matching: matchResults, aiSuggerimento }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
