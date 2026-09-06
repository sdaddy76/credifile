// api/segnalazione-pubblica.js
// Endpoint pubblico (nessuna autenticazione richiesta) per ricevere segnalazioni esterne.
// Accetta campi testo + file codificati base64, li carica su Supabase Storage,
// salva in segnalazioni_pubbliche e notifica il super_admin via email.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'stefano@daddino.com';
const STORAGE_BUCKET = 'practice-files';
const MAX_PUBLIC_FILES = 12;
const MAX_PUBLIC_FILE_BYTES = 30 * 1024 * 1024;
const MAX_PUBLIC_TOTAL_BYTES = 100 * 1024 * 1024;
const PUBLIC_UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 6;
const requestBuckets = new Map();
const PRIVACY_CONSENT_VERSION = '2026-09-05-v1';
const PRIVACY_CONSENT_TEXT = `Dichiaro di aver preso visione dell’informativa privacy e, in qualità di interessato e/o legale rappresentante della società, autorizzo Credifile e il consulente o intermediario incaricato a raccogliere e trattare i dati e i documenti trasmessi con questa richiesta. Autorizzo inoltre la successiva trasmissione alle banche e agli intermediari finanziari coinvolti, esclusivamente per la valutazione della bancabilità, l’istruttoria e l’eventuale perfezionamento di una richiesta di finanziamento. Dichiaro di essere autorizzato a comunicare eventuali dati di terzi contenuti nei documenti.`;
const PAYMENT_DISCLAIMER_VERSION = '2026-09-05-v1';
const PAYMENT_DISCLAIMER_TEXT = `Il servizio di analisi e ricerca di soluzioni finanziarie è a pagamento. L’eventuale attività di mediazione creditizia sarà svolta esclusivamente previa stipula di un apposito contratto di mediazione, con compenso regolato secondo il modello success fee e subordinato al buon esito dell’operazione, secondo le condizioni contrattuali sottoscritte.`;
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

const storageAdmin = SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const ALLOWED_PUBLIC_EXTENSIONS = new Set([
  'pdf', 'csv', 'xls', 'xlsx', 'ods', 'doc', 'docx', 'jpg', 'jpeg', 'png',
]);

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

function safeFileName(value) {
  const cleaned = String(value ?? 'documento')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_\\.]+|[_\\.]+$/g, '')
    .slice(0, 140);
  return cleaned || 'documento';
}

function getExtension(name) {
  const match = String(name ?? '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match?.[1] ?? '';
}

function validateUploadDescriptors(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_PUBLIC_FILES) {
    return { error: `Sono consentiti da 1 a ${MAX_PUBLIC_FILES} documenti per richiesta.` };
  }

  let totalBytes = 0;
  let visure = 0;
  const normalized = [];

  for (const [index, rawFile] of files.entries()) {
    const name = String(rawFile?.name ?? '').trim();
    const size = Number(rawFile?.size);
    const role = rawFile?.role === 'visura' ? 'visura' : 'allegato';
    const extension = getExtension(name);

    if (!name || !Number.isFinite(size) || size <= 0 || size > MAX_PUBLIC_FILE_BYTES) {
      return { error: `Il documento ${index + 1} non è valido o supera 30 MB.` };
    }
    if (!ALLOWED_PUBLIC_EXTENSIONS.has(extension)) {
      return { error: `Formato .${extension || '?'} non consentito per ${name}.` };
    }
    if (role === 'visura') {
      visure += 1;
      if (extension !== 'pdf') return { error: 'La visura camerale deve essere in formato PDF.' };
    }

    totalBytes += size;
    normalized.push({
      client_id: String(rawFile?.client_id ?? `${index}`),
      name,
      safe_name: safeFileName(name),
      type: String(rawFile?.type || 'application/octet-stream').slice(0, 150),
      size,
      role,
      nome_descrittivo: String(rawFile?.nome_descrittivo || name).trim().slice(0, 180),
    });
  }

  if (visure !== 1) return { error: 'È richiesta una sola visura camerale in formato PDF.' };
  if (totalBytes > MAX_PUBLIC_TOTAL_BYTES) {
    return { error: 'La dimensione complessiva dei documenti supera 100 MB.' };
  }
  return { files: normalized };
}

function tokenSecret() {
  return process.env.PUBLIC_UPLOAD_SIGNING_SECRET || SUPABASE_KEY || '';
}

function createSubmissionToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', tokenSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySubmissionToken(token) {
  try {
    const [encoded, signature] = String(token ?? '').split('.');
    if (!encoded || !signature || !tokenSecret()) return null;
    const expected = createHmac('sha256', tokenSecret()).update(encoded).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.expires_at || Date.now() > Number(payload.expires_at)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function prepareDirectUploads(req, res) {
  const {
    piva,
    files,
    website,
    form_started_at,
    privacy_consent,
    privacy_consent_version,
    payment_disclaimer,
    payment_disclaimer_version,
  } = req.body ?? {};

  const elapsed = Date.now() - Number(form_started_at);
  if (website || !Number.isFinite(elapsed) || elapsed < 2500 || elapsed > 24 * 60 * 60 * 1000) {
    return res.status(400).json({ error: 'Richiesta non valida' });
  }
  if (!consumeRateLimit(req)) {
    return res.status(429).json({ error: 'Troppe richieste. Riprova più tardi.' });
  }

  const normalizedPiva = normalizePiva(piva);
  if (!isValidPiva(normalizedPiva)) {
    return res.status(400).json({ error: 'P.IVA non valida' });
  }
  if (privacy_consent !== true || privacy_consent_version !== PRIVACY_CONSENT_VERSION) {
    return res.status(400).json({ error: 'Autorizzazione privacy obbligatoria' });
  }
  if (payment_disclaimer !== true || payment_disclaimer_version !== PAYMENT_DISCLAIMER_VERSION) {
    return res.status(400).json({ error: 'Presa visione del servizio a pagamento obbligatoria' });
  }
  if (!storageAdmin || !tokenSecret()) {
    return res.status(500).json({ error: 'Servizio di caricamento non configurato' });
  }

  const validated = validateUploadDescriptors(files);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const submissionId = randomUUID();
  const preparedFiles = [];

  for (const [index, file] of validated.files.entries()) {
    const path = `segnalazioni-pubbliche/${submissionId}/${String(index + 1).padStart(2, '0')}_${file.safe_name}`;
    const { data, error } = await storageAdmin.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data?.token) {
      console.error('Errore creazione upload firmato:', error);
      return res.status(500).json({ error: 'Impossibile preparare il caricamento dei documenti' });
    }
    preparedFiles.push({ ...file, path, upload_token: data.token });
  }

  const tokenFiles = preparedFiles.map(({ upload_token, safe_name, ...file }) => file);
  const submissionToken = createSubmissionToken({
    submission_id: submissionId,
    piva: normalizedPiva,
    files: tokenFiles,
    expires_at: Date.now() + PUBLIC_UPLOAD_TOKEN_TTL_MS,
  });

  return res.status(200).json({
    success: true,
    submission_token: submissionToken,
    uploads: preparedFiles.map(file => ({
      client_id: file.client_id,
      path: file.path,
      token: file.upload_token,
    })),
  });
}

function normalizePiva(value) {
  return String(value ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

function isValidPiva(value) {
  return /^[0-9]{11}$/.test(value);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
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
      body: JSON.stringify({ expiresIn: 3600 }),
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
  if (req.body?.action === 'prepare_uploads') {
    return prepareDirectUploads(req, res);
  }

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
    privacy_consent,
    privacy_consent_version,
    payment_disclaimer,
    payment_disclaimer_version,
    uploaded_files,
    submission_token,
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
  if (!visura?.data && !submission_token) {
    return res.status(400).json({ error: 'visura camerale obbligatoria' });
  }
  if (privacy_consent !== true || privacy_consent_version !== PRIVACY_CONSENT_VERSION) {
    return res.status(400).json({ error: 'Autorizzazione privacy obbligatoria' });
  }
  if (payment_disclaimer !== true || payment_disclaimer_version !== PAYMENT_DISCLAIMER_VERSION) {
    return res.status(400).json({ error: 'Presa visione del servizio a pagamento obbligatoria' });
  }

  const consentAcceptedAt = new Date().toISOString();
  const consentUserAgent = String(req.headers?.['user-agent'] ?? '').slice(0, 500) || null;
  let directFileUrls = [];

  if (submission_token) {
    const tokenPayload = verifySubmissionToken(submission_token);
    if (!tokenPayload || tokenPayload.piva !== normalizedPiva || !Array.isArray(tokenPayload.files)) {
      return res.status(400).json({ error: 'Autorizzazione di caricamento non valida o scaduta' });
    }

    const submittedPaths = new Set(
      (Array.isArray(uploaded_files) ? uploaded_files : [])
        .map(file => String(file?.path ?? ''))
        .filter(Boolean)
    );
    if (
      submittedPaths.size !== tokenPayload.files.length ||
      tokenPayload.files.some(file => !submittedPaths.has(file.path))
    ) {
      return res.status(400).json({ error: 'Elenco dei documenti caricati non coerente' });
    }

    const directory = `segnalazioni-pubbliche/${tokenPayload.submission_id}`;
    const { data: storedObjects, error: listError } = await storageAdmin.storage
      .from(STORAGE_BUCKET)
      .list(directory, { limit: MAX_PUBLIC_FILES + 5 });
    if (listError) {
      console.error('Errore verifica documenti caricati:', listError);
      return res.status(500).json({ error: 'Impossibile verificare i documenti caricati' });
    }
    const storedNames = new Set((storedObjects ?? []).map(object => object.name));
    if (tokenPayload.files.some(file => !storedNames.has(file.path.split('/').pop()))) {
      return res.status(400).json({ error: 'Uno o più documenti non risultano caricati correttamente' });
    }

    directFileUrls = tokenPayload.files.map(file => ({
      nome: file.role === 'visura'
        ? `Visura Camerale — ${file.name}`
        : file.nome_descrittivo || file.name,
      path: file.path,
    }));
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
      file_urls: directFileUrls,
      privacy_consent_accepted_at: consentAcceptedAt,
      privacy_consent_version: PRIVACY_CONSENT_VERSION,
      privacy_consent_text: PRIVACY_CONSENT_TEXT,
      privacy_consent_user_agent: consentUserAgent,
      disclaimer_pagamento_accettato_at: consentAcceptedAt,
      disclaimer_pagamento_version: PAYMENT_DISCLAIMER_VERSION,
      disclaimer_pagamento_text: PAYMENT_DISCLAIMER_TEXT,
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
  const fileUrls = [...directFileUrls];

  // Compatibilità temporanea con schede del vecchio modulo già aperte nel
  // browser: i nuovi invii usano upload diretto e non attraversano Vercel.
  if (!submission_token) {
    // 1. Upload visura
    const visuraPath = `${base}/visura_${safeFileName(visura.name)}`;
    const visuraUrl  = await uploadToStorage(visura.data, visura.type || 'application/pdf', visuraPath);
    if (visuraUrl) {
      fileUrls.push({ nome: `Visura Camerale — ${visura.name}`, url: visuraUrl, path: visuraPath });
    }

    // 2. Upload altri documenti
    if (Array.isArray(altri_docs)) {
      for (const doc of altri_docs) {
        if (!doc?.data) continue;
        const safeName = safeFileName(doc.name);
        const docPath = `${base}/${safeName}`;
        const docUrl = await uploadToStorage(doc.data, doc.type || 'application/octet-stream', docPath);
        if (docUrl) {
          fileUrls.push({ nome: doc.nomeDescrittivo || doc.name, url: docUrl, path: docPath });
        }
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
    tipo_richiesta:  'report_autonomo',
    file_urls:       fileUrls,
    privacy_consent_accepted_at: consentAcceptedAt,
    privacy_consent_version: PRIVACY_CONSENT_VERSION,
    privacy_consent_text: PRIVACY_CONSENT_TEXT,
    privacy_consent_user_agent: consentUserAgent,
    disclaimer_pagamento_accettato_at: consentAcceptedAt,
    disclaimer_pagamento_version: PAYMENT_DISCLAIMER_VERSION,
    disclaimer_pagamento_text: PAYMENT_DISCLAIMER_TEXT,
  });

  if (!insert.ok) {
    console.error('Errore DB:', insert.data);
    return res.status(500).json({ error: 'Errore salvataggio segnalazione' });
  }

  const segnalazione = Array.isArray(insert.data) ? insert.data[0] : insert.data;

  // 4. Email notifica al super admin
  const fileLinksHtml = fileUrls.length > 0
    ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;vertical-align:top"><strong>Documenti:</strong></td>
       <td style="padding:8px 0;font-size:14px">${fileUrls.map(f => f.url
         ? `<a href="${escapeHtml(f.url)}" style="color:#f97316">${escapeHtml(f.nome)}</a>`
         : escapeHtml(f.nome)
       ).join('<br>')}</td></tr>`
    : '';

  const emailHtml = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">
  <div style="background:#f97316;color:white;padding:16px 20px;border-radius:8px 8px 0 0">
    <h2 style="margin:0;font-size:18px">📥 Nuova Segnalazione Pubblica</h2>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;padding:20px">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;width:35%"><strong>Azienda:</strong></td>
          <td style="padding:8px 0;font-size:14px;font-weight:bold">${escapeHtml(ragione_sociale)}</td></tr>
      <tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>P.IVA:</strong></td><td style="padding:8px 0;font-size:14px">${escapeHtml(normalizedPiva)}</td></tr>
      ${nome_referente ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Referente:</strong></td><td style="padding:8px 0;font-size:14px">${escapeHtml(nome_referente)}</td></tr>` : ''}
      ${email_referente ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Email:</strong></td><td style="padding:8px 0;font-size:14px">${escapeHtml(email_referente)}</td></tr>` : ''}
      ${telefono ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px"><strong>Telefono:</strong></td><td style="padding:8px 0;font-size:14px">${escapeHtml(telefono)}</td></tr>` : ''}
      ${note ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:14px;vertical-align:top"><strong>Note:</strong></td><td style="padding:8px 0;font-size:14px">${escapeHtml(note)}</td></tr>` : ''}
      ${fileLinksHtml}
    </table>
    <div style="margin-top:16px;padding:12px 16px;background:#ecfeff;border:1px solid #a5f3fc;border-radius:6px;font-size:13px;color:#155e75">
      Privacy e trasmissione documenti autorizzate il ${escapeHtml(new Date(consentAcceptedAt).toLocaleString('it-IT'))}.<br>
      Presa visione del servizio a pagamento registrata.
    </div>
    <div style="margin-top:20px;padding:12px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;font-size:13px;color:#9a3412">
      ⚡ Accedi a Credifile → <em>Segnalazioni Ricevute</em> per assegnare questa segnalazione a un agente.
    </div>
  </div>
</div>`;

  await sendEmail(SUPER_ADMIN_EMAIL, `Nuova segnalazione: ${ragione_sociale}`, emailHtml);

  return res.status(200).json({ success: true, id: segnalazione?.id ?? null });
}
