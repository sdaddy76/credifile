// reset-password — nessun import esterno, solo fetch REST nativi Deno
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const ok   = (d: unknown) => new Response(JSON.stringify(d),  { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { email } = await req.json();
    if (!email) return fail('Email obbligatoria');

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const appUrl      = Deno.env.get('APP_URL') ?? 'https://credifile-eosin.vercel.app';
    const resendKey   = Deno.env.get('RESEND_API_KEY') ?? '';
    const fromEmail   = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';

    if (!supabaseUrl || !serviceKey) return fail('Configurazione server mancante');
    if (!resendKey) return fail('Servizio email non configurato');

    const adminHeaders = {
      'Authorization': `Bearer ${serviceKey}`,
      'apikey': serviceKey,
      'Content-Type': 'application/json',
    };

    // Genera link di recupero via REST admin API (nessun SDK)
    const genRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        type: 'recovery',
        email: email.trim().toLowerCase(),
        redirect_to: appUrl,   // main.tsx intercetta #access_token e riscrive → #/reset-password
      }),
    });

    if (!genRes.ok) {
      const err = await genRes.json().catch(() => ({}));
      // 422 = utente non trovato — non rivelare per sicurezza
      if (genRes.status === 422) return ok({ success: true });
      return fail('Errore generazione link: ' + (err?.message ?? String(genRes.status)));
    }

    const genData     = await genRes.json();
    const recoveryLink = genData?.action_link ?? genData?.properties?.action_link ?? '';
    if (!recoveryLink) return fail('Link di recupero non ottenuto');

    // Invia email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [email.trim().toLowerCase()],
        subject: 'Recupera la tua password - Credifile',
        html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;max-width:540px;margin:auto;padding:24px;color:#111827">
  <div style="background:#1e40af;border-radius:12px;padding:20px 24px;margin-bottom:24px">
    <h1 style="color:#fff;margin:0;font-size:22px">Credifile</h1>
    <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px">Gestione Pratiche Finanziarie</p>
  </div>
  <p style="font-size:15px">Hai richiesto il recupero della password.</p>
  <p style="color:#6b7280;font-size:14px">Clicca il pulsante qui sotto per impostare una nuova password:</p>
  <div style="text-align:center;margin:32px 0">
    <a href="${recoveryLink}"
       style="background:#1e40af;color:#fff;padding:14px 32px;border-radius:8px;
              text-decoration:none;font-weight:700;font-size:15px;display:inline-block">
      Reimposta Password
    </a>
  </div>
  <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px">
    <p style="margin:0;font-size:12px;color:#92400e">
      Il link e' valido per <strong>24 ore</strong>.
      Se non hai richiesto il recupero, ignora questa email.
    </p>
  </div>
  <p style="color:#9ca3af;font-size:11px;margin-top:24px">
    Accedi sempre da:
    <a href="${appUrl}" style="color:#1e40af">${appUrl}</a>
  </p>
</body></html>`,
        text: `Recupera la tua password - Credifile\n\nHai richiesto il recupero della password.\nClicca qui per reimpostarla:\n${recoveryLink}\n\nIl link e' valido per 24 ore.\n\nAccedi da: ${appUrl}`,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.json().catch(() => ({}));
      return fail('Errore invio email: ' + (err?.message ?? String(emailRes.status)));
    }

    return ok({ success: true });
  } catch (e) {
    return fail(String(e));
  }
});
