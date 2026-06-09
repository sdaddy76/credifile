const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_KEY   = Deno.env.get('RESEND_API_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { practice_id } = await req.json()
    if (!practice_id) return new Response(JSON.stringify({ error: 'practice_id mancante' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const h = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }

    // 1. Dati pratica + KPI anonimi
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/practices?id=eq.${practice_id}&select=numero_pratica,importo_richiesto,motivazione,status,clients(indirizzo)`, { headers: h })
    const practices = await pRes.json()
    const p = practices?.[0]
    if (!p) return new Response(JSON.stringify({ error: 'Pratica non trovata' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // 2. KPI più recenti
    const kRes = await fetch(`${SUPABASE_URL}/rest/v1/bilanci_kpi?practice_id=eq.${practice_id}&select=anno_esercizio,ricavi_vendite,utile_netto,totale_patrimonio_netto,kpi&order=anno_esercizio.desc&limit=1`, { headers: h })
    const kpis = await kRes.json()
    const kpi = kpis?.[0]

    // 3. Estrai città e ATECO dall'indirizzo
    const indirizzo = p.clients?.indirizzo ?? ''
    const cityMatch = indirizzo.match(/^([A-ZÀ-Ù][A-ZÀ-Ùa-zà-ù\s'-]+?)\s*\([A-Z]{2}\)/i)
    const city = cityMatch ? cityMatch[1].trim() : ''
    const atecoMatch = indirizzo.match(/(?:ATECO|attivit[àa])[^\d]*(\d{2}[.\-]\d{2})/i)
    const ateco = atecoMatch ? atecoMatch[1] : ''

    // 4. Banche con notifiche attive
    const bnsRes = await fetch(`${SUPABASE_URL}/rest/v1/bank_notification_settings?notifica_nuove=eq.true&select=bank_id,email,ateco_filter,importo_min,importo_max`, { headers: h })
    const bnsAll = await bnsRes.json()

    // Filtra banche compatibili
    const importo = p.importo_richiesto ?? 0
    const banks = (bnsAll || []).filter((b: { ateco_filter?: string[] | null; importo_min?: number | null; importo_max?: number | null }) => {
      if (b.importo_min && importo < b.importo_min) return false
      if (b.importo_max && importo > b.importo_max) return false
      if (b.ateco_filter && b.ateco_filter.length > 0 && ateco) {
        const match = b.ateco_filter.some((prefix: string) => ateco.startsWith(prefix))
        if (!match) return false
      }
      return true
    })

    if (!banks.length) return new Response(JSON.stringify({ success: true, sent: 0, message: 'Nessuna banca da notificare' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    // 5. Composizione email
    const kpiHtml = kpi ? `
      <tr><td style="padding:4px 8px;border:1px solid #e2e8f0;">Fatturato</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">€ ${Number(kpi.ricavi_vendite || 0).toLocaleString('it-IT')}</td></tr>
      <tr><td style="padding:4px 8px;border:1px solid #e2e8f0;">Utile Netto</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">€ ${Number(kpi.utile_netto || 0).toLocaleString('it-IT')}</td></tr>
      <tr><td style="padding:4px 8px;border:1px solid #e2e8f0;">Patrimonio Netto</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">€ ${Number(kpi.totale_patrimonio_netto || 0).toLocaleString('it-IT')}</td></tr>
    ` : '<tr><td colspan="2" style="padding:8px;color:#64748b;">KPI non ancora disponibili</td></tr>'

    const emailHtml = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1e293b;">
<div style="background:#1d4ed8;padding:20px;border-radius:8px 8px 0 0;">
  <h1 style="color:white;margin:0;font-size:20px;">🏦 Credifile — Nuova Pratica Disponibile</h1>
</div>
<div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
  <p>È disponibile una nuova pratica di finanziamento compatibile con i tuoi criteri.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;">
    <tr style="background:#e2e8f0;"><th style="padding:8px;text-align:left;border:1px solid #cbd5e1;" colspan="2">Dati Anonimi Pratica</th></tr>
    <tr><td style="padding:4px 8px;border:1px solid #e2e8f0;">Pratica n.</td><td style="padding:4px 8px;border:1px solid #e2e8f0;font-weight:bold;">${p.numero_pratica}</td></tr>
    ${city ? `<tr><td style="padding:4px 8px;border:1px solid #e2e8f0;">Città</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">${city}</td></tr>` : ''}
    ${ateco ? `<tr><td style="padding:4px 8px;border:1px solid #e2e8f0;">ATECO</td><td style="padding:4px 8px;border:1px solid #e2e8f0;">${ateco}</td></tr>` : ''}
    <tr><td style="padding:4px 8px;border:1px solid #e2e8f0;">Importo Richiesto</td><td style="padding:4px 8px;border:1px solid #e2e8f0;font-weight:bold;">€ ${Number(importo).toLocaleString('it-IT')}</td></tr>
    ${kpiHtml}
  </table>
  <p style="color:#64748b;font-size:13px;">I dati identificativi del cliente sono visibili solo dopo aver richiesto la pratica sul portale.</p>
  <a href="https://credifile-eosin.vercel.app" style="display:inline-block;background:#1d4ed8;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:8px;">Accedi al Portale Banche →</a>
</div>
<p style="color:#94a3b8;font-size:11px;margin-top:16px;">Credifile – stedasrls.it | Per disattivare le notifiche accedi al portale banche → Impostazioni</p>
</body></html>`

    // 6. Invio email via Resend
    const sent: string[] = []
    const failed: string[] = []
    for (const bank of banks) {
      try {
        const rRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Credifile <docflow@stedasrls.it>',
            to: [bank.email],
            subject: `Nuova Pratica Disponibile — ${city || 'Italia'} | ATECO ${ateco || 'N/D'} | € ${Number(importo).toLocaleString('it-IT')}`,
            html: emailHtml
          })
        })
        if (rRes.ok) sent.push(bank.email)
        else failed.push(bank.email)
      } catch { failed.push(bank.email) }
    }

    return new Response(JSON.stringify({ success: true, sent: sent.length, failed: failed.length, emails: sent }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
