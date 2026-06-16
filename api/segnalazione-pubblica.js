// api/segnalazione-pubblica.js
// Endpoint pubblico (nessuna autenticazione richiesta) per ricevere segnalazioni esterne.
// Salva in segnalazioni_pubbliche e invia email al super_admin.

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'stefano@daddino.com';

async function supabaseFetch(path, method = 'GET', body = null, useAnon = false) {
  const key = useAnon
    ? process.env.VITE_SUPABASE_ANON_KEY
    : SUPABASE_KEY;
  const opts = {
    method,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : '',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, opts);
  const txt = await r.text();
  try { return { ok: r.ok, status: r.status, data: JSON.parse(txt) }; }
  catch { return { ok: r.ok, status: r.status, data: txt }; }
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return { ok: false, error: 'no RESEND_KEY' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Credifile <notifiche@credifile.it>',
      to,
      subject,
      html,
    }),
  });
  return { ok: r.ok };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ragione_sociale, nome_referente, email_referente, telefono, note } = req.body ?? {};
  if (!ragione_sociale || !ragione_sociale.trim()) {
    return res.status(400).json({ error: 'ragione_sociale obbligatoria' });
  }

  // 1. Salva nel DB (usa service key per bypassare RLS — la tabella ha INSERT policy per anon comunque)
  const insert = await supabaseFetch('/segnalazioni_pubbliche', 'POST', {
    ragione_sociale: ragione_sociale.trim(),
    nome_referente:  nome_referente?.trim()  || null,
    email_referente: email_referente?.trim() || null,
    telefono:        telefono?.trim()        || null,
    note:            note?.trim()            || null,
    stato:           'nuova',
  });

  if (!insert.ok) {
    console.error('Errore inserimento segnalazione_pubblica:', insert.data);
    return res.status(500).json({ error: 'Errore salvataggio segnalazione', detail: insert.data });
  }

  const segnalazione = Array.isArray(insert.data) ? insert.data[0] : insert.data;

  // 2. Invia email notifica al super admin
  const emailHtml = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#f97316;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">📥 Nuova Segnalazione Pubblica</h2>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;padding:20px">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="padding:8px 0;color:#6b7280;font-size:14px;width:40%"><strong>Azienda:</strong></td>
        <td style="padding:8px 0;font-size:14px;font-weight:bold">${ragione_sociale}</td>
      </tr>
      ${nome_referente ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Referente:</strong></td><td style="padding:8px 0;font-size:14px">${nome_referente}</td></tr>` : ''}
      ${email_referente ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Email:</strong></td><td style="padding:8px 0;font-size:14px">${email_referente}</td></tr>` : ''}
      ${telefono ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Telefono:</strong></td><td style="padding:8px 0;font-size:14px">${telefono}</td></tr>` : ''}
      ${note ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Note:</strong></td><td style="padding:8px 0;font-size:14px">${note}</td></tr>` : ''}
    </table>
    <div style="margin-top:20px;padding:12px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;font-size:13px;color:#9a3412">
      ⚡ Accedi a Credifile → <em>Segnalazioni Ricevute</em> per assegnare questa segnalazione a un agente.
    </div>
  </div>
</div>`;

  await sendEmail(SUPER_ADMIN_EMAIL, `Nuova segnalazione: ${ragione_sociale}`, emailHtml);

  return res.status(200).json({ success: true, id: segnalazione?.id ?? null });
}
