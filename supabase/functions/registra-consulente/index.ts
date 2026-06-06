import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok   = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { email, password, nome } = await req.json()
    if (!email || !password) return fail('email e password obbligatorie')
    if (password.length < 8) return fail('Password minimo 8 caratteri')

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Verifica che l'email non esista già
    const { data: existing } = await sb.from('admin_profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle()
    if (existing) return fail(`Un utente con email ${email} esiste già nel sistema`)

    // Crea utente con service role (nessuna email di conferma richiesta)
    const { data, error } = await sb.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true, // conferma immediata, nessuna email richiesta
      user_metadata: { nome: nome?.trim() || null }
    })
    if (error || !data.user) return fail(error?.message ?? 'Errore creazione account')

    // Crea profilo con ruolo consulente
    const { error: profErr } = await sb.from('admin_profiles').upsert({
      id: data.user.id,
      email: email.trim().toLowerCase(),
      nome: nome?.trim() || null,
      ruolo: 'consulente'
    })
    if (profErr) return fail('Account creato ma errore profilo: ' + profErr.message)

    return ok({ success: true, user_id: data.user.id })
  } catch (e) { return fail(String(e)) }
})
