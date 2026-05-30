import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { email, nome, segreteria_user_id, resend } = await req.json()
    if (!email) return new Response(JSON.stringify({ error: 'email obbligatoria' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const appUrl = Deno.env.get('APP_URL') || 'https://bunat7dyvv.skywork.website'
    let inviteLink = '', agentId = ''
    if (resend) {
      const { data: ld, error: le } = await sb.auth.admin.generateLink({ type: 'magiclink', email: email.trim().toLowerCase() })
      if (le || !ld) return new Response(JSON.stringify({ error: le?.message ?? 'Errore' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      inviteLink = ld.properties.action_link; agentId = ld.user.id
    } else {
      const { data, error } = await sb.auth.admin.generateLink({ type: 'invite', email: email.trim().toLowerCase(), options: { data: { nome: nome || null } } })
      if (error || !data) return new Response(JSON.stringify({ error: error?.message ?? 'Errore' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      inviteLink = data.properties.action_link; agentId = data.user.id
      await sb.from('admin_profiles').upsert({ id: agentId, email: email.trim().toLowerCase(), nome: nome || null, ruolo: 'agente' })
    }
    if (segreteria_user_id) await sb.from('segreteria_agent_assignments').upsert({ segreteria_user_id, agent_user_id: agentId })
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev',
          to: [email.trim().toLowerCase()],
          subject: resend ? 'Nuovo link di accesso — DocFlow Finanziario' : 'Invito a DocFlow Finanziario',
          html: `<div style="font-family:sans-serif;max-width:540px;margin:auto;padding:24px;background:#fff">
            <div style="background:#6366f1;border-radius:12px;padding:20px 24px;margin-bottom:24px">
              <h1 style="color:#fff;margin:0;font-size:22px">DocFlow Finanziario</h1>
            </div>
            <p style="font-size:16px;color:#1a1a2e">Ciao${nome ? ' <strong>' + nome + '</strong>' : ''},</p>
            <p style="color:#444">${resend ? 'Ecco il tuo nuovo link di accesso alla piattaforma.' : 'Sei stato invitato ad accedere a <strong>DocFlow Finanziario</strong> come <strong>Agente</strong>.'}</p>
            <p style="color:#444">Clicca il pulsante qui sotto per ${resend ? 'accedere' : 'impostare la tua password e accedere'}:</p>
            <div style="text-align:center;margin:32px 0">
              <a href="${inviteLink}" style="background:#6366f1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block">${resend ? 'Accedi ora' : 'Accetta invito'}</a>
            </div>
            <div style="background:#f5f5ff;border-radius:8px;padding:16px;margin-top:16px">
              <p style="margin:0 0 8px;font-size:13px;color:#666">Dopo aver impostato la password, accedi sempre da:</p>
              <a href="${appUrl}" style="color:#6366f1;font-weight:600;font-size:14px">${appUrl}</a>
            </div>
            <p style="color:#aaa;font-size:12px;margin-top:24px">Il link di attivazione è valido per 24 ore. Se non hai richiesto questo invito, ignora questa email.</p>
          </div>`
        })
      })
    }
    return new Response(JSON.stringify({ success: true, invite_link: inviteLink, agent_id: agentId }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }) }
})
