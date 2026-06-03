const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { token, nome, password } = await req.json();
    if (!token || !password) {
      return new Response(JSON.stringify({ success: false, error: 'token e password obbligatori' }), { headers: cors });
    }
    if (password.length < 6) {
      return new Response(JSON.stringify({ success: false, error: 'Password minimo 6 caratteri' }), { headers: cors });
    }

    const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const restH = {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    // 1. Recupera e valida il token
    const inviteRes = await fetch(
      `${SUPA_URL}/rest/v1/segnalatore_invites?token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
      { headers: restH },
    );
    const inviteArr = await inviteRes.json();
    const invite = inviteArr?.[0];

    if (!invite) {
      return new Response(JSON.stringify({ success: false, error: 'Link non valido o scaduto' }), { headers: cors });
    }
    if (invite.used) {
      return new Response(JSON.stringify({ success: false, error: 'Questo link è già stato utilizzato' }), { headers: cors });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return new Response(JSON.stringify({ success: false, error: 'Il link è scaduto (validità 7 giorni)' }), { headers: cors });
    }

    const email: string = invite.email;
    const agentId: string = invite.agent_id;

    // 2. Controlla se esiste già un utente con questa email
    const checkRes = await fetch(
      `${SUPA_URL}/rest/v1/admin_profiles?email=eq.${encodeURIComponent(email)}&limit=1`,
      { headers: restH },
    );
    const existing = await checkRes.json();
    if (existing?.length > 0) {
      return new Response(JSON.stringify({ success: false, error: 'Un account con questa email esiste già' }), { headers: cors });
    }

    // 3. Crea utente via Auth Admin API
    const createRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: restH,
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome: nome || null },
      }),
    });
    const userData = await createRes.json();
    if (!createRes.ok || !userData?.id) {
      return new Response(
        JSON.stringify({ success: false, error: userData?.msg ?? userData?.message ?? 'Errore creazione account' }),
        { headers: cors },
      );
    }
    const userId: string = userData.id;

    // 4. Upsert profilo con ruolo segnalatore
    await fetch(`${SUPA_URL}/rest/v1/admin_profiles`, {
      method: 'POST',
      headers: { ...restH, Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify({ id: userId, email, nome: nome || null, ruolo: 'segnalatore' }),
    });

    // 5. Auto-link agent_segnalatori
    await fetch(`${SUPA_URL}/rest/v1/agent_segnalatori`, {
      method: 'POST',
      headers: { ...restH, Prefer: 'return=minimal' },
      body: JSON.stringify({ agent_id: agentId, segnalatore_id: userId }),
    });

    // 6. Marca invito come usato
    await fetch(
      `${SUPA_URL}/rest/v1/segnalatore_invites?token=eq.${encodeURIComponent(token)}`,
      {
        method: 'PATCH',
        headers: restH,
        body: JSON.stringify({ used: true }),
      },
    );

    return new Response(JSON.stringify({ success: true }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { headers: cors });
  }
});
