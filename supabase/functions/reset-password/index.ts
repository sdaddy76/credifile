import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok  = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { email } = await req.json()
    if (!email) return fail('Email obbligatoria')

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const appUrl = Deno.env.get('APP_URL') || 'https://credifile-eosin.vercel.app'

    // Verifica che l'utente esista
    const { data: authList } = await sb.auth.admin.listUsers({ perPage: 1000 })
    const userExists = authList?.users?.some((u: { email?: string }) =>
      u.email?.toLowerCase() === email.trim().toLowerCase()
    )
    if (!userExists) {
      // Non rivelare se l'email esiste o meno (sicurezza)
      return ok({ success: true })
    }

    // Genera link di recupero
    const { data, error } = await sb.auth.admin.generateLink({
      type: 'recovery',
      email: email.trim().toLowerCase(),
      options: { redirectTo: appUrl },
    })
    if (error || !data) return fail(error?.message ?? 'Errore generazione link')

    const recoveryLink = data.properties.action_link

    // Invia via Resend
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'
    if (!resendKey) return fail('Servizio email non configurato')

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [email.trim().toLowerCase()],
        subject: 'Recupera la tua password — Credifile',
        html: `<div style="font-family:sans-serif;max-width:540px;margin:auto;padding:24px">
          <div style="background:#1e40af;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h1 style="color:#fff;margin:0;font-size:22px">Credifile</h1>
            <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px">Gestione Pratiche Finanziarie</p>
          </div>
          <p style="font-size:15px;color:#111827">Hai richiesto il recupero della password.</p>
          <p style="color:#6b7280;font-size:14px">Clicca il pulsante qui sotto per impostare una nuova password:</p>
          <div style="text-align:center;margin:32px 0">
            <a href="${recoveryLink}" style="background:#1e40af;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
              Reimposta Password
            </a>
          </div>
          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin-top:8px">
            <p style="margin:0;font-size:12px;color:#92400e">⏱ Il link è valido per <strong>24 ore</strong>. Se non hai richiesto il recupero, ignora questa email.</p>
          </div>
          <p style="color:#9ca3af;font-size:11px;margin-top:24px">Dopo aver reimpostato la password accedi sempre da: <a href="${appUrl}" style="color:#1e40af">${appUrl}</a></p>
        </div>`,
      })
    })

    if (!emailRes.ok) {
      const err = await emailRes.json()
      return fail('Errore invio email: ' + (err?.message ?? emailRes.status))
    }

    return ok({ success: true })
  } catch (e) { return fail(String(e)) }
})
