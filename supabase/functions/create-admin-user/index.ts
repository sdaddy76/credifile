import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email, password, nome, ruolo, agent_id } = await req.json()

    if (!email || !password || !ruolo) {
      return new Response(JSON.stringify({ error: 'email, password e ruolo obbligatori' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Blocca se l'email esiste già — impedisce sovrascrittura ruolo
    const { data: existing } = await supabase
      .from('admin_profiles')
      .select('id, ruolo')
      .eq('email', email.trim().toLowerCase())
      .maybeSingle()
    if (existing) {
      return new Response(JSON.stringify({ error: `Un account con email ${email} esiste già (ruolo: ${existing.ruolo})` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Crea utente via Admin API (non disconnette l'admin corrente)
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { nome: nome || null },
    })

    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: userError?.message ?? 'Errore creazione utente' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Aggiorna profilo con ruolo scelto (il trigger ha già inserito 'agente')
    await supabase.from('admin_profiles').upsert({
      id: userData.user.id,
      email: email.trim().toLowerCase(),
      nome: nome || null,
      ruolo,
    })

    // Se segnalatore e agent_id fornito, crea il collegamento automatico
    if (ruolo === 'segnalatore' && agent_id) {
      await supabase.from('agent_segnalatori').insert({
        agent_id,
        segnalatore_id: userData.user.id,
      })
    }

    return new Response(JSON.stringify({ success: true, id: userData.user.id }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
