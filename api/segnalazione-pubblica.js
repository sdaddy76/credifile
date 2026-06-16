// api/segnalazione-pubblica.js
// Endpoint pubblico (nessuna autenticazione richiesta) per ricevere segnalazioni esterne.
// Accetta campi testo + file codificati base64, li carica su Supabase Storage,
// salva in segnalazioni_pubbliche e notifica il super_admin via email.

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'stefano@daddino.com';

// ── Upload file su Supabase Storage via REST ───────────────────────────────
async function uploadToStorage(base64Data, mimeType, storagePath) {
  const binary = Buffer.from(base64Data, 'base64');
  const r = await fetch(
    `${SUPABASE_URL}/storage/v1/object/practice-files/${storagePath}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': mimeType,
        'x-upsert': 'true',
      },
      body: binary,
    }
  );
  if (!r.ok) {
    const txt = await r.text();
    console.error('Storage upload error:', r.status, txt);
    return null;
  }
  // Genera URL firmato (10 anni)
  const signR = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/practice-files/${storagePath}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 315360000 }),
    }
  );
  if (!signR.ok) return null;
  const signData = await signR.json();
  const token = signData.signedURL ?? signData.token;
  if (!token) return null;
  // signedURL può essere relativo o assoluto
  if (token.startsWith('http')) return token;
  return `${SUPABASE_URL}/storage/v1${token}`;
}

// ── Inserimento DB ─────────────────────────────────────────────────────────
async function dbInsert(record) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/segnalazioni_pubbliche`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(record),
  });
  const txt = await r.text();
  try { return { ok: r.ok, data: JSON.parse(txt) }; }
  catch { return { ok: r.ok, data: txt }; }
}

// ── Email notifica ─────────────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Credifile <notifiche@credifile.it>', to, subject, html }),
  });
}

// ── Handler principale ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    ragione_sociale,
    nome_referente,
    email_referente,
    telefono,
    note,
    visura,       // { name, type, data: base64 }
    altri_docs,   // [{ name, type, nomeDescrittivo, data: base64 }]
  } = req.body ?? {};

  if (!ragione_sociale?.trim()) {
    return res.status(400).json({ error: 'ragione_sociale obbligatoria' });
  }
  if (!visura?.data) {
    return res.status(400).json({ error: 'visura camerale obbligatoria' });
  }

  const ts   = Date.now();
  const base = `segnalazioni-pubbliche/${ts}`;
  const fileUrls = [];

  // 1. Upload visura
  const visuraPath = `${base}/visura_${visura.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const visuraUrl  = await uploadToStorage(visura.data, visura.type || 'application/pdf', visuraPath);
  if (visuraUrl) {
    fileUrls.push({ nome: `Visura Camerale — ${visura.name}`, url: visuraUrl });
  }

  // 2. Upload altri documenti
  if (Array.isArray(altri_docs)) {
    for (const doc of altri_docs) {
      if (!doc?.data) continue;
      const safeName = doc.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const docUrl   = await uploadToStorage(doc.data, doc.type || 'application/octet-stream', `${base}/${safeName}`);
      if (docUrl) {
        fileUrls.push({ nome: doc.nomeDescrittivo || doc.name, url: docUrl });
      }
    }
  }

  // 3. Salva nel DB
  const insert = await dbInsert({
    ragione_sociale: ragione_sociale.trim(),
    nome_referente:  nome_referente?.trim()  || null,
    email_referente: email_referente?.trim() || null,
    telefono:        telefono?.trim()        || null,
    note:            note?.trim()            || null,
    stato:           'nuova',
    file_urls:       fileUrls,
  });

  if (!insert.ok) {
    console.error('Errore DB:', insert.data);
    return res.status(500).json({ error: 'Errore salvataggio segnalazione' });
  }

  const segnalazione = Array.isArray(insert.data) ? insert.data[0] : insert.data;

  // 4. Email notifica al super admin
  const fileLinksHtml = fileUrls.length > 0
    ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;vertical-align:top"><strong>Documenti:</strong></td>
       <td style="padding:8px 0;font-size:14px">${fileUrls.map(f => `<a href="${f.url}" style="color:#f97316">${f.nome}</a>`).join('<br>')}</td></tr>`
    : '';

  const emailHtml = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#f97316;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">📥 Nuova Segnalazione Pubblica</h2>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;padding:20px">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;width:35%"><strong>Azienda:</strong></td>
          <td style="padding:8px 0;font-size:14px;font-weight:bold">${ragione_sociale}</td></tr>
      ${nome_referente ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Referente:</strong></td><td style="padding:8px 0;font-size:14px">${nome_referente}</td></tr>` : ''}
      ${email_referente ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Email:</strong></td><td style="padding:8px 0;font-size:14px">${email_referente}</td></tr>` : ''}
      ${telefono ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Telefono:</strong></td><td style="padding:8px 0;font-size:14px">${telefono}</td></tr>` : ''}
      ${note ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;vertical-align:top"><strong>Note:</strong></td><td style="padding:8px 0;font-size:14px">${note}</td></tr>` : ''}
      ${fileLinksHtml}
    </table>
    <div style="margin-top:20px;padding:12px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;font-size:13px;color:#9a3412">
      ⚡ Accedi a Credifile → <em>Segnalazioni Ricevute</em> per assegnare questa segnalazione a un agente.
    </div>
  </div>
</div>`;

  await sendEmail(SUPER_ADMIN_EMAIL, `Nuova segnalazione: ${ragione_sociale}`, emailHtml);

  return res.status(200).json({ success: true, id: segnalazione?.id ?? null });
}
