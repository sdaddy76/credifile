import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok   = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { email, nome, invited_by, resend } = await req.json()
    if (!email) return fail('email obbligatoria')

    const sb     = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const appUrl = Deno.env.get('APP_URL') || 'https://credifile-eosin.vercel.app'
    let inviteLink = '', userId = ''

    if (resend) {
      const { data: ld, error: le } = await sb.auth.admin.generateLink({ type: 'magiclink', email: email.trim().toLowerCase() })
      if (le || !ld) return fail(le?.message ?? 'Errore generazione link')
      inviteLink = ld.properties.action_link; userId = ld.user.id
    } else {
      const { data: existing } = await sb.from('admin_profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle()
      if (existing) return fail(`Un utente con email ${email} esiste già nel sistema`)

      const { data: authList } = await sb.auth.admin.listUsers({ perPage: 1000 })
      const authMatch = authList?.users?.find((u: { email?: string }) => u.email?.toLowerCase() === email.trim().toLowerCase())
      if (authMatch) await sb.auth.admin.deleteUser(authMatch.id)

      const { data, error } = await sb.auth.admin.generateLink({
        type: 'invite',
        email: email.trim().toLowerCase(),
        options: { data: { nome: nome || null } }
      })
      if (error || !data) return fail(error?.message ?? 'Errore generazione invito')
      inviteLink = data.properties.action_link; userId = data.user.id

      await sb.from('admin_profiles').upsert({
        id: userId,
        email: email.trim().toLowerCase(),
        nome: nome || null,
        ruolo: 'consulente'
      })
    }

    // Invia email
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'Credifile <noreply@stedasrls.it>'
    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromEmail,
          to: [email.trim().toLowerCase()],
          subject: resend ? 'Nuovo link di accesso — Credifile' : 'Invito come Consulente — Credifile',
          html: `<div style="font-family:sans-serif;max-width:540px;margin:auto;padding:24px">
            <div style="background:#0f766e;border-radius:12px;padding:20px 24px;margin-bottom:24px">
              <h1 style="color:#fff;margin:0;font-size:22px">Credifile</h1>
              <p style="color:#ccfbf1;margin:4px 0 0;font-size:14px">Portale Consulenti</p>
            </div>
            <p>Ciao${nome ? ' <strong>' + nome + '</strong>' : ''},</p>
            <p>${resend
              ? 'Ecco il tuo nuovo link di accesso al portale consulenti.'
              : 'Sei stato invitato come <strong>Consulente/Commercialista</strong> su Credifile.<br>Potrai generare report di bancabilità professionali per i tuoi clienti.'
            }</p>
            <div style="text-align:center;margin:32px 0">
              <a href="${inviteLink}" style="background:#0f766e;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">
                ${resend ? 'Accedi ora' : 'Accetta invito e imposta password'}
              </a>
            </div>
            <p style="color:#888;font-size:12px">Dopo aver impostato la password accedi sempre da: <a href="${appUrl}">${appUrl}</a></p>
            <p style="color:#aaa;font-size:11px">Link valido 24 ore.</p>
          </div>`
        })
      })
    }

    return ok({ success: true, invite_link: inviteLink, user_id: userId })
  } catch (e) { return fail(String(e)) }
})
