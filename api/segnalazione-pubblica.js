// api/segnalazione-pubblica.js
// Endpoint pubblico (nessuna autenticazione richiesta) per ricevere segnalazioni esterne.
// Accetta campi testo + file codificati base64, li carica su Supabase Storage,
// salva in segnalazioni_pubbliche e notifica il super_admin via email.

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'stefano@daddino.com';
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 6;
const requestBuckets = new Map();
const ACTIVE_PRACTICE_STATUSES = [
  'bozza',
  'raccolta_documenti',
  'inviata_banca',
  'integrazioni_richieste',
  'istruttoria',
  'in_delibera',
  'deliberata',
  'completata',
];

function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || 'unknown';
  return String(forwarded).split(',')[0].trim().slice(0, 120) || 'unknown';
}

function consumeRateLimit(req) {
  const key = getClientIp(req);
  const now = Date.now();
  const current = (requestBuckets.get(key) ?? []).filter(timestamp => timestamp > now - RATE_LIMIT_WINDOW_MS);
  if (current.length >= RATE_LIMIT_MAX) {
    requestBuckets.set(key, current);
    return false;
  }
  current.push(now);
  requestBuckets.set(key, current);
  if (requestBuckets.size > 2000) {
    for (const [bucketKey, timestamps] of requestBuckets) {
      if (timestamps.every(timestamp => timestamp <= now - RATE_LIMIT_WINDOW_MS)) requestBuckets.delete(bucketKey);
    }
  }
  return true;
}

function normalizePiva(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function isValidPiva(value) {
  return /^[0-9]{11}$/.test(value);
}

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

async function findActivePracticeByPiva(piva) {
  const clients = await rest(
    `clients?piva=eq.${encodeURIComponent(piva)}&select=id,ragione_sociale,email&limit=20`
  );
  if (!clients.ok || !Array.isArray(clients.data)) return null;

  for (const client of clients.data) {
    const statusFilter = `(${ACTIVE_PRACTICE_STATUSES.join(',')})`;
    const practices = await rest(
      `practices?client_id=eq.${encodeURIComponent(client.id)}&status=in.${encodeURIComponent(statusFilter)}&select=id,numero_pratica,status&order=updated_at.desc&limit=1`
    );
    if (practices.ok && Array.isArray(practices.data) && practices.data[0]) {
      return { client, practice: practices.data[0] };
    }
  }
  return null;
}

async function notifySuperAdmin(subject, html, practiceId, notification) {
  const admins = await rest('admin_profiles?ruolo=eq.super_admin&select=id');
  const adminRows = Array.isArray(admins.data) ? admins.data : [];
  const notificationRows = adminRows
    .filter(admin => admin?.id)
    .map(admin => ({
      user_id: admin.id,
      tipo: notification.tipo,
      titolo: notification.titolo,
      testo: notification.testo,
      link: '/admin/segnalazioni-ricevute',
      practice_id: practiceId ?? null,
    }));
  if (notificationRows.length > 0) {
    await rest('notifications', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(notificationRows),
    });
  }
  await sendEmail(SUPER_ADMIN_EMAIL, subject, html);
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
    piva,
    nome_referente,
    email_referente,
    telefono,
    note,
    visura,       // { name, type, data: base64 }
    altri_docs,   // [{ name, type, nomeDescrittivo, data: base64 }]
    website,      // honeypot invisibile: deve restare vuoto
    form_started_at,
  } = req.body ?? {};

  // Protezioni anti-bot: honeypot, tempo minimo di compilazione e limite per IP.
  const elapsed = Date.now() - Number(form_started_at);
  if (website || !Number.isFinite(elapsed) || elapsed < 2500 || elapsed > 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'Richiesta non valida' });
  }
  if (!consumeRateLimit(req)) {
    return res.status(429).json({ error: 'Troppe richieste. Riprova più tardi.' });
  }

  if (!ragione_sociale?.trim()) {
    return res.status(400).json({ error: 'ragione_sociale obbligatoria' });
  }
  const normalizedPiva = normalizePiva(piva);
  if (!isValidPiva(normalizedPiva)) {
    return res.status(400).json({ error: 'P.IVA non valida' });
  }
  if (!visura?.data) {
    return res.status(400).json({ error: 'visura camerale obbligatoria' });
  }

  // Se l'impresa ha già una pratica operativa, non aprire una seconda pratica.
  // La segnalazione viene comunque tracciata e collegata per la presa in carico.
  const activeMatch = await findActivePracticeByPiva(normalizedPiva);
  if (activeMatch) {
    const existingPractice = activeMatch.practice;
    const existingNote = `Richiesta di valutazione ricevuta: P.IVA già associata alla pratica ${existingPractice.numero_pratica}, attualmente in lavorazione. Verificare la pratica esistente prima di aprirne una nuova.`;
    const duplicateInsert = await dbInsert({
      ragione_sociale: ragione_sociale.trim(),
      piva: normalizedPiva,
      nome_referente: nome_referente?.trim() || null,
      email_referente: email_referente?.trim() || null,
      telefono: telefono?.trim() || null,
      note: [note?.trim(), existingNote].filter(Boolean).join('\n\n'),
      stato: 'nuova',
      tipo_richiesta: 'richiesta_su_pratica_esistente',
      practice_id: existingPractice.id,
      file_urls: [],
    });

    if (!duplicateInsert.ok) {
      console.error('Errore registrazione richiesta su pratica esistente:', duplicateInsert.data);
      return res.status(500).json({ error: 'Errore salvataggio richiesta' });
    }

    const duplicateRequest = Array.isArray(duplicateInsert.data)
      ? duplicateInsert.data[0]
      : duplicateInsert.data;
    const duplicateHtml = `
      <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:20px">
        <div style="background:#b45309;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0;font-size:18px">⚠️ Richiesta su pratica già esistente</h2>
        </div>
        <div style="border:1px solid #d1d5db;border-top:0;padding:20px;border-radius:0 0 8px 8px">
          <p>Una nuova richiesta contiene una P.IVA già associata a una pratica in lavorazione.</p>
          <p><strong>Azienda:</strong> ${escapeHtml(ragione_sociale)}<br>
          <strong>P.IVA:</strong> ${escapeHtml(normalizedPiva)}<br>
          <strong>Pratica esistente:</strong> ${escapeHtml(existingPractice.numero_pratica)}<br>
          <strong>Stato:</strong> ${escapeHtml(existingPractice.status)}</p>
          <p>Verifica la pratica esistente e contatta il cliente tramite il portale già attivo.</p>
        </div>
      </div>`;
    await notifySuperAdmin(
      `Richiesta collegata a pratica esistente: ${ragione_sociale}`,
      duplicateHtml,
      existingPractice.id,
      {
        tipo: 'valutazione_pratica_esistente',
        titolo: 'P.IVA già associata a pratica in lavorazione',
        testo: `${ragione_sociale} ha inviato una richiesta, ma la P.IVA è già collegata alla pratica ${existingPractice.numero_pratica}.`,
      }
    );

    return res.status(200).json({
      success: true,
      already_in_progress: true,
      existing_practice: {
        id: existingPractice.id,
        numero_pratica: existingPractice.numero_pratica,
        status: existingPractice.status,
      },
      request: duplicateRequest,
      message: `Abbiamo trovato una pratica già in lavorazione (${existingPractice.numero_pratica}). La richiesta è stata collegata alla pratica esistente.`,
    });
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
    piva: normalizedPiva,
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
