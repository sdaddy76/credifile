import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const responseJson = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { email, password, nome, ruolo, agent_id } = await req.json()

    if (!email || !password || !ruolo) {
      return responseJson({ success: false, error: 'email, password e ruolo obbligatori' })
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return responseJson({ success: false, error: 'Formato email non valido' })
    }
    if (String(password).length < 6) {
      return responseJson({ success: false, error: 'Password minimo 6 caratteri' })
    }
    if (!['agente', 'supervisore_segreteria', 'segnalatore'].includes(ruolo)) {
      return responseJson({ success: false, error: 'Ruolo non consentito da questa sezione' })
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
      return responseJson({ success: false, error: `Un account con email ${email} esiste già (ruolo: ${existing.ruolo})` })
    }

    // Crea utente via Admin API (non disconnette l'admin corrente)
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { nome: nome || null },
    })

    if (userError || !userData.user) {
      return responseJson({ success: false, error: userError?.message ?? 'Errore creazione utente' })
    }

    // Aggiorna profilo con ruolo scelto (il trigger ha già inserito 'agente')
    const { error: profileError } = await supabase.from('admin_profiles').upsert({
      id: userData.user.id,
      email: email.trim().toLowerCase(),
      nome: nome || null,
      ruolo,
    })
    if (profileError) {
      await supabase.auth.admin.deleteUser(userData.user.id)
      return responseJson({ success: false, error: `Profilo non creato: ${profileError.message}` })
    }

    // Se segnalatore e agent_id fornito, crea il collegamento automatico
    if (ruolo === 'segnalatore' && agent_id) {
      const { error: linkError } = await supabase.from('agent_segnalatori').upsert({
        agent_id,
        segnalatore_id: userData.user.id,
      }, { onConflict: 'agent_id,segnalatore_id' })
      if (linkError) {
        await supabase.from('admin_profiles').delete().eq('id', userData.user.id)
        await supabase.auth.admin.deleteUser(userData.user.id)
        return responseJson({ success: false, error: `Collegamento all’agente non creato: ${linkError.message}` })
      }
    }

    return responseJson({ success: true, id: userData.user.id })
  } catch (e) {
    return responseJson({ success: false, error: String(e) })
  }
})
