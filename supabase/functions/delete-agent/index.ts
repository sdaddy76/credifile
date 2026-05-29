import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { agent_id, reassign_to } = await req.json()
    if (!agent_id) return new Response(JSON.stringify({ error: 'agent_id obbligatorio' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    // Riassegna pratiche se specificato
    if (reassign_to) {
      await sb.from('practices').update({ created_by: reassign_to }).eq('created_by', agent_id)
    }
    // Elimina assegnazioni segreteria
    await sb.from('segreteria_agent_assignments').delete().eq('agent_user_id', agent_id)
    // Elimina profilo
    await sb.from('admin_profiles').delete().eq('id', agent_id)
    // Elimina utente auth
    const { error } = await sb.auth.admin.deleteUser(agent_id)
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) { return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }) }
})
