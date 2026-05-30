import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { email, nome, segreteria_user_id, resend } = await req.json()
    if (!email) return new Response(JSON.stringify({ error: 'email obbligatoria' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    let inviteLink = ''
    let agentId = ''
    if (resend) {
      // Utente già esistente: genera magic link (rimanda accesso)
      const { data: ld, error: le } = await sb.auth.admin.generateLink({ type: 'magiclink', email: email.trim().toLowerCase() })
      if (le || !ld) return new Response(JSON.stringify({ error: le?.message ?? 'Errore generazione link' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      inviteLink = ld.properties.action_link
      agentId = ld.user.id
    } else {
      // Nuovo invito
      const { data, error } = await sb.auth.admin.generateLink({ type: 'invite', email: email.trim().toLowerCase(), options: { data: { nome: nome || null } } })
      if (error || !data) return new Response(JSON.stringify({ error: error?.message ?? 'Errore' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
      inviteLink = data.properties.action_link
      agentId = data.user.id
      await sb.from('admin_profiles').upsert({ id: agentId, email: email.trim().toLowerCase(), nome: nome || null, ruolo: 'agente' })
    }
    if (segreteria_user_id) {
      await sb.from('segreteria_agent_assignments').upsert({ segreteria_user_id, agent_user_id: agentId })
    }
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev',
          to: [email.trim().toLowerCase()],
          subject: resend ? 'Nuovo link di accesso a DocFlow Finanziario' : 'Invito a DocFlow Finanziario',
          html: `<div style="font-family:sans-serif;max-width:520px;margin:auto">
            <h2 style="color:#1a1a2e">${resend ? 'Nuovo link di accesso' : 'Sei stato invitato a DocFlow Finanziario'}</h2>
            <p>Ciao${nome ? ' <strong>' + nome + '</strong>' : ''},</p>
            <p>${resend ? 'Ecco il tuo nuovo link per accedere alla piattaforma <strong>DocFlow Finanziario</strong>.' : 'Sei stato invitato come <strong>Agente</strong> su DocFlow Finanziario.'}</p>
            <div style="text-align:center;margin:32px 0">
              <a href="${inviteLink}" style="background:#6366f1;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px">${resend ? 'Accedi ora' : 'Accetta invito'}</a>
            </div>
            <p style="color:#888;font-size:12px">Il link è valido per 24 ore.</p>
          </div>`
        })
      })
    }
    return new Response(JSON.stringify({ success: true, invite_link: inviteLink, agent_id: agentId }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }) }
})
