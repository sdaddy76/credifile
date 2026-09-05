// Endpoint per il percorso "Report autonomo impresa".
// Il browser non scrive direttamente la segnalazione: l'endpoint verifica
// il codice di accesso della pratica e crea una richiesta assegnabile.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'stefano@daddino.com';
const DISCLAIMER_VERSION = '2026-09-05-v1';

const PAYMENT_DISCLAIMER = `Il servizio di analisi e ricerca di soluzioni finanziarie è a pagamento. L’eventuale attività di mediazione creditizia sarà svolta esclusivamente previa stipula di un apposito contratto di mediazione, con compenso regolato secondo il modello success fee e subordinato al buon esito dell’operazione, secondo le condizioni contrattuali sottoscritte.`;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEmail(value) {
  return typeof value === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function rest(path, options = {}) {
  if (!SUPABASE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY non configurata');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: response.ok, status: response.status, data };
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Credifile <notifiche@credifile.it>',
      to,
      subject,
      html,
    }),
  });
}

async function getAuthorizedAccess(practiceId, accessCode, email) {
  const query = [
    `practice_id=eq.${encodeURIComponent(practiceId)}`,
    `codice=eq.${encodeURIComponent(accessCode)}`,
    `email_cliente=eq.${encodeURIComponent(email)}`,
    'select=id,practice_id,email_cliente,privacy_consent_accepted_at',
    'limit=1',
  ].join('&');
  const result = await rest(`practice_access_codes?${query}`);
  const row = Array.isArray(result.data) ? result.data[0] : null;
  return result.ok ? row : null;
}

async function getRequest(practiceId) {
  const query = [
    `practice_id=eq.${encodeURIComponent(practiceId)}`,
    'tipo_richiesta=eq.ricerca_banca',
    'select=id,practice_id,ragione_sociale,email_referente,stato,agente_id,note,created_at,updated_at,disclaimer_pagamento_accettato_at',
    'order=created_at.desc',
    'limit=1',
  ].join('&');
  const result = await rest(`segnalazioni_pubbliche?${query}`);
  if (!result.ok) return null;
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row) return null;
  const practice = await rest(
    `practices?id=eq.${encodeURIComponent(practiceId)}&select=numero_pratica&limit=1`
  );
  row.numero_pratica = Array.isArray(practice.data) ? practice.data[0]?.numero_pratica ?? null : null;
  if (row.agente_id) {
    const agent = await rest(`admin_profiles?id=eq.${encodeURIComponent(row.agente_id)}&select=id,nome,nome_cognome,email&limit=1`);
    row.agente = Array.isArray(agent.data) ? agent.data[0] ?? null : null;
  }
  return row;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body ?? {};
  const query = req.query ?? {};
  const practiceId = body.practice_id ?? query.practice_id;
  const accessCode = body.access_code ?? query.access_code;
  const emailCliente = String(body.email_cliente ?? query.email_cliente ?? '').trim().toLowerCase();

  if (!isUuid(practiceId) || !accessCode || !isEmail(emailCliente)) {
    return res.status(400).json({ error: 'Dati di accesso non validi' });
  }

  const access = await getAuthorizedAccess(practiceId, accessCode, emailCliente);
  if (!access) return res.status(403).json({ error: 'Accesso alla pratica non autorizzato' });

  if (req.method === 'GET') {
    const request = await getRequest(practiceId);
    return res.status(200).json({ success: true, request });
  }

  if (!access.privacy_consent_accepted_at) {
    return res.status(412).json({ error: 'È necessario accettare prima il disclaimer privacy della pratica' });
  }

  const disclaimerAccepted = body.disclaimer_pagamento_accettato === true;
  if (!disclaimerAccepted) {
    return res.status(400).json({ error: 'È necessario accettare il disclaimer del servizio a pagamento' });
  }

  const existing = await getRequest(practiceId);
  if (existing && ['nuova', 'assegnata', 'lavorazione'].includes(existing.stato)) {
    return res.status(200).json({ success: true, request: existing, already_exists: true });
  }

  const practice = await rest(
    `practices?id=eq.${encodeURIComponent(practiceId)}&select=id,numero_pratica,client_id,clients(ragione_sociale,email,telefono)&limit=1`
  );
  const practiceRow = Array.isArray(practice.data) ? practice.data[0] : null;
  if (!practice.ok || !practiceRow) return res.status(404).json({ error: 'Pratica non trovata' });

  const client = Array.isArray(practiceRow.clients) ? practiceRow.clients[0] : practiceRow.clients;
  const ragioneSociale = client?.ragione_sociale || 'Impresa';
  const note = 'Richiesta di ricerca banca dal percorso Report autonomo impresa.';
  const record = {
    ragione_sociale: ragioneSociale,
    email_referente: emailCliente,
    telefono: client?.telefono ?? null,
    note,
    stato: 'nuova',
    tipo_richiesta: 'ricerca_banca',
    practice_id: practiceId,
    disclaimer_pagamento_accettato_at: new Date().toISOString(),
    disclaimer_pagamento_version: DISCLAIMER_VERSION,
    disclaimer_pagamento_text: PAYMENT_DISCLAIMER,
  };

  const inserted = await rest('segnalazioni_pubbliche', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(record),
  });
  if (!inserted.ok) {
    // Una race condition su indice univoco significa che la richiesta esiste già.
    const retry = await getRequest(practiceId);
    if (retry) return res.status(200).json({ success: true, request: retry, already_exists: true });
    console.error('Errore inserimento richiesta ricerca banca:', inserted.data);
    return res.status(500).json({ error: 'Errore salvataggio richiesta' });
  }

  const request = Array.isArray(inserted.data) ? inserted.data[0] : inserted.data;
  if (request) request.numero_pratica = practiceRow.numero_pratica;

  const admins = await rest(
    `admin_profiles?ruolo=eq.super_admin&select=id,email,nome,nome_cognome`
  );
  const adminRows = Array.isArray(admins.data) ? admins.data : [];
  const notificationRows = adminRows
    .filter(admin => admin?.id)
    .map(admin => ({
      user_id: admin.id,
      tipo: 'ricerca_banca',
      titolo: 'Nuova richiesta di ricerca banca',
      testo: `${ragioneSociale} ha richiesto la ricerca di una banca per la pratica ${practiceRow.numero_pratica}.`,
      link: '/admin/segnalazioni-ricevute',
      practice_id: practiceId,
    }));
  if (notificationRows.length > 0) {
    await rest('notifications', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(notificationRows),
    });
  }

  const emailHtml = `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:0 auto;padding:20px">
      <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:18px">🔎 Nuova richiesta “Ricerca banca”</h2>
      </div>
      <div style="border:1px solid #d1d5db;border-top:0;padding:20px;border-radius:0 0 8px 8px">
        <p>Una impresa ha richiesto assistenza per individuare una banca per il proprio report autonomo.</p>
        <p><strong>Azienda:</strong> ${escapeHtml(ragioneSociale)}<br>
        <strong>Pratica:</strong> ${escapeHtml(practiceRow.numero_pratica)}<br>
        <strong>Email:</strong> ${escapeHtml(emailCliente)}</p>
        <p style="color:#475569">Accedi a Credifile → Segnalazioni Ricevute per assegnare la richiesta a un agente.</p>
      </div>
    </div>`;
  await sendEmail(SUPER_ADMIN_EMAIL, `Ricerca banca richiesta: ${ragioneSociale}`, emailHtml);

  return res.status(200).json({ success: true, request });
}
