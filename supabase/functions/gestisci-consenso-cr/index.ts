import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok   = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

const CONSENT_TEXT = `Autorizzo il trattamento dei miei dati personali della Centrale dei Rischi della Banca d'Italia (esposizioni creditizie, affidamenti, utilizzi e relativi andamentali), ai soli fini dell'elaborazione di un'analisi di bancabilità da parte del consulente indicato. Il trattamento avverrà in conformità al Regolamento UE 2016/679 (GDPR).`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { action, token } = await req.json()
    if (!token) return fail('token obbligatorio')

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: consent, error: fetchErr } = await sb
      .from('consulente_cr_consents').select('*').eq('token', token).maybeSingle()
    if (fetchErr || !consent) return fail('Consenso non trovato o token non valido')
    if (new Date(consent.expires_at) < new Date()) return fail('Richiesta scaduta')

    if (action === 'get') {
      return ok({ success: true, consent: {
        id: consent.id, token: consent.token, status: consent.status,
        client_name: consent.client_name, consulente_nome: consent.consulente_nome,
        expires_at: consent.expires_at, accepted_at: consent.accepted_at,
      }})
    }

    if (action === 'accept') {
      if (consent.status !== 'pending') return fail('Consenso già processato')
      const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
      await sb.from('consulente_cr_consents').update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        ip_address: ip,
        user_agent: req.headers.get('user-agent') ?? null,
        consent_text: CONSENT_TEXT,
      }).eq('id', consent.id)
      return ok({ success: true })
    }

    if (action === 'decline') {
      if (consent.status !== 'pending') return fail('Consenso già processato')
      await sb.from('consulente_cr_consents').update({
        status: 'declined',
        declined_at: new Date().toISOString(),
        ip_address: req.headers.get('x-forwarded-for') ?? 'unknown',
      }).eq('id', consent.id)
      return ok({ success: true })
    }

    return fail('Azione non valida')
  } catch (e) { return fail(String(e)) }
})
