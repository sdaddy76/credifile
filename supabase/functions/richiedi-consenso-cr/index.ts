import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok   = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { consulente_id, consulente_nome, client_id, client_name, client_email } = await req.json()
    if (!consulente_id || !client_email || !client_name) return fail('Parametri obbligatori mancanti')

    const sb      = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const appUrl  = Deno.env.get('APP_URL') || 'https://credifile-eosin.vercel.app'
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'Credifile <noreply@stedasrls.it>'

    // Crea record consenso
    const { data: consent, error: insErr } = await sb.from('consulente_cr_consents').insert({
      consulente_id, client_id: client_id || null,
      client_name, client_email: client_email.trim().toLowerCase(),
      consulente_nome: consulente_nome || 'Il Consulente',
      status: 'pending',
    }).select('id, token').single()

    if (insErr || !consent) return fail('Errore creazione richiesta consenso: ' + insErr?.message)

    const consentLink = `${appUrl}/consenso-cr/${consent.token}`

    // Invia email al cliente
    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromEmail,
          to: [client_email.trim().toLowerCase()],
          subject: `Richiesta autorizzazione trattamento dati — Centrale dei Rischi`,
          html: `<div style="font-family:sans-serif;max-width:580px;margin:auto;padding:24px;color:#1e293b">
            <div style="background:#0f766e;border-radius:12px;padding:20px 24px;margin-bottom:24px">
              <h1 style="color:#fff;margin:0;font-size:20px">Credifile</h1>
              <p style="color:#ccfbf1;margin:4px 0 0;font-size:13px">Richiesta di Autorizzazione</p>
            </div>
            <p>Gentile <strong>${client_name}</strong>,</p>
            <p>Il consulente <strong>${consulente_nome}</strong> richiede la Sua autorizzazione al trattamento dei dati della <strong>Centrale dei Rischi (Banca d'Italia)</strong> ai fini dell'elaborazione di un'analisi di bancabilità.</p>
            <div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:16px;margin:20px 0;font-size:13px">
              <strong>Dati oggetto del trattamento:</strong><br>
              Dati della Centrale dei Rischi relativi a esposizioni creditizie, affidamenti e utilizzi,
              trattati esclusivamente ai fini dell'analisi di bancabilità richiesta.
            </div>
            <div style="text-align:center;margin:28px 0">
              <a href="${consentLink}" style="background:#0f766e;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;font-size:15px">
                Visualizza e gestisci l'autorizzazione
              </a>
            </div>
            <p style="font-size:12px;color:#94a3b8">
              Il link è valido 30 giorni. Se non desidera autorizzare il trattamento, può semplicemente ignorare questa email o cliccare il link e selezionare "Rifiuto".
            </p>
          </div>`
        })
      })
    }

    return ok({ success: true, consent_id: consent.id, token: consent.token, consent_link: consentLink })
  } catch (e) { return fail(String(e)) }
})
