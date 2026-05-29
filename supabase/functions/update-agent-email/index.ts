import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { agent_id, new_email } = await req.json()
    if (!agent_id || !new_email) return new Response(JSON.stringify({ error: 'agent_id e new_email obbligatori' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { error: authErr } = await sb.auth.admin.updateUserById(agent_id, { email: new_email.trim().toLowerCase(), email_confirm: true })
    if (authErr) return new Response(JSON.stringify({ error: authErr.message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    await sb.from('admin_profiles').update({ email: new_email.trim().toLowerCase() }).eq('id', agent_id)
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }) }
})
