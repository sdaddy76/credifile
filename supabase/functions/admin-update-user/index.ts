// admin-update-user — cambia password utente via Supabase Admin REST API
// Nessun import esterno: solo fetch nativo Deno
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const ok   = (d: unknown) => new Response(JSON.stringify(d),              { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { user_id, password } = await req.json();
    if (!user_id)  return fail('user_id obbligatorio');
    if (!password) return fail('password obbligatoria');
    if (password.length < 6) return fail('Password minimo 6 caratteri');

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) return fail('Configurazione server mancante');

    // PUT /auth/v1/admin/users/{user_id}  →  aggiorna password
    const r = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user_id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return fail(err?.message ?? `Errore API (${r.status})`, 400);
    }

    return ok({ success: true });
  } catch (e) {
    return fail(String(e), 500);
  }
});
