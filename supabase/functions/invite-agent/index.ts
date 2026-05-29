import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { email, nome } = await req.json()
    if (!email) return new Response(JSON.stringify({ error: 'email obbligatoria' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Genera link invito — l'agente clicca e imposta la propria password
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'invite',
      email: email.trim().toLowerCase(),
      options: { data: { nome: nome || null } },
    })

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })

    // Pre-crea profilo con ruolo agente (il trigger farà lo stesso, ma impostiamo subito nome)
    await supabase.from('admin_profiles').upsert({
      id: data.user.id,
      email: email.trim().toLowerCase(),
      nome: nome || null,
      ruolo: 'agente',
    })

    return new Response(JSON.stringify({ success: true, invite_link: data.properties.action_link }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
