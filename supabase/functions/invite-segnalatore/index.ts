const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM_EMAIL     = Deno.env.get('FROM_EMAIL') ?? 'Credifile <noreply@stedasrls.it>';
const APP_URL        = Deno.env.get('APP_URL') ?? 'https://credifile-eosin.vercel.app';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { agent_id, agent_name, email } = await req.json();
    if (!agent_id || !email) {
      return new Response(JSON.stringify({ success: false, error: 'agent_id e email obbligatori' }), { headers: cors });
    }

    const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const restH = {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    // Genera token e salva invito (scadenza 7 giorni)
    const insertRes = await fetch(`${SUPA_URL}/rest/v1/segnalatore_invites`, {
      method: 'POST',
      headers: restH,
      body: JSON.stringify({ agent_id, email: email.trim().toLowerCase() }),
    });
    const insertArr = await insertRes.json();
    if (!insertRes.ok) {
      return new Response(JSON.stringify({ success: false, error: insertArr?.message ?? 'Errore DB' }), { headers: cors });
    }
    const token: string = insertArr[0]?.token;
    if (!token) {
      return new Response(JSON.stringify({ success: false, error: 'Token non generato' }), { headers: cors });
    }

    const link = `${APP_URL}/#/invito-segnalatore?token=${token}`;
    const agentLabel = agent_name ?? 'Un agente';

    const html = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1e40af;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:20px;">Invito Credifile</h1>
    <p style="color:#bfdbfe;margin:4px 0 0 0;font-size:14px;">Piattaforma di gestione documentale finanziaria</p>
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
    <p>Gentile <strong>${email}</strong>,</p>
    <p><strong>${agentLabel}</strong> ti ha invitato a registrarti su <strong>Credifile</strong> come <strong>Segnalatore</strong>.</p>
    <p>In qualità di segnalatore potrai caricare i documenti iniziali (visura camerale, bilancio, richiesta finanziamento) e collaborare direttamente con l'agente.</p>
    <p>Clicca sul pulsante qui sotto per completare la registrazione:</p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${link}" style="background:#1e40af;color:white;padding:13px 32px;border-radius:7px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block;">
        Completa Registrazione
      </a>
    </div>
    <p style="font-size:13px;color:#555;">Oppure copia il link:<br>
      <a href="${link}" style="color:#1e40af;word-break:break-all;">${link}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
    <p style="color:#6b7280;font-size:12px;">
      Questo invito è valido per <strong>7 giorni</strong>. 
      Se non ti aspettavi questa email puoi ignorarla.
    </p>
  </div>
</body></html>`;

    const mailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email.trim().toLowerCase()],
        subject: `Invito a registrarti su Credifile`,
        html,
      }),
    });
    const mailData = await mailRes.json();
    if (!mailRes.ok) {
      return new Response(JSON.stringify({ success: false, error: mailData?.message ?? 'Errore invio email' }), { headers: cors });
    }

    return new Response(JSON.stringify({ success: true, email: email.trim().toLowerCase() }), { headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { headers: cors });
  }
});
