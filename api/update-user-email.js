// update-user-email.js — Aggiorna email utente via Supabase Admin REST API
// Vercel Serverless Function (Hobby: max 60s)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const ok   = (d)   => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const fail = (msg) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: CORS });

export default async function handler(req, res) {
  // Gestione CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const { user_id, email } = req.body ?? {};
    if (!user_id) { res.status(200).json({ success: false, error: 'user_id obbligatorio' }); return; }
    if (!email)   { res.status(200).json({ success: false, error: 'email obbligatoria' }); return; }

    const emailTrimmed = email.trim().toLowerCase();

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      res.status(200).json({ success: false, error: 'Configurazione server mancante' });
      return;
    }

    // 1. Aggiorna auth.users via Admin API (bypass verifica email)
    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${user_id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: emailTrimmed }),
    });

    if (!authRes.ok) {
      const err = await authRes.json().catch(() => ({}));
      res.status(200).json({ success: false, error: err?.message ?? `Errore API auth (${authRes.status})` });
      return;
    }

    // 2. Aggiorna admin_profiles.email per consistenza
    const profileRes = await fetch(
      `${supabaseUrl}/rest/v1/admin_profiles?id=eq.${user_id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ email: emailTrimmed }),
      }
    );

    if (!profileRes.ok) {
      const err = await profileRes.json().catch(() => ({}));
      res.status(200).json({ success: false, error: err?.message ?? `Errore aggiornamento profilo (${profileRes.status})` });
      return;
    }

    res.status(200).json({ success: true });
  } catch (e) {
    res.status(200).json({ success: false, error: String(e) });
  }
}
