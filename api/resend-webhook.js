import crypto from 'node:crypto';

export const config = {
  api: {
    bodyParser: false,
  },
};

const EVENT_STATUS = {
  'email.sent': 'inviata',
  'email.delivered': 'consegnata',
  'email.bounced': 'rimbalzata',
  'email.complained': 'spam',
  'email.opened': 'aperta',
  'email.clicked': 'cliccata',
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function decodeSvixSecret(secret) {
  const normalized = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  try {
    return Buffer.from(normalized, 'base64');
  } catch {
    return Buffer.from(normalized, 'utf8');
  }
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyResendSignature(req, rawBody, secret) {
  const svixId = getHeader(req, 'svix-id');
  const svixTimestamp = getHeader(req, 'svix-timestamp');
  const svixSignature = getHeader(req, 'svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', decodeSvixSecret(secret))
    .update(signedContent)
    .digest('base64');

  return svixSignature
    .split(' ')
    .flatMap(part => part.split(','))
    .map(part => part.trim())
    .some(part => {
      const candidate = part.startsWith('v1,') ? part.slice(3) : part.startsWith('v1=') ? part.slice(3) : part;
      return candidate ? timingSafeEqual(candidate, expected) : false;
    });
}

function pickEventTimestamp(payload) {
  return payload?.data?.created_at || payload?.created_at || new Date().toISOString();
}

function pickEmailId(payload) {
  return payload?.data?.email_id || payload?.data?.id || payload?.email_id || payload?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const rawBody = await readRawBody(req);
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return res.status(500).json({ success: false, error: 'RESEND_WEBHOOK_SECRET mancante' });
  }

  if (!verifyResendSignature(req, rawBody, webhookSecret)) {
    return res.status(401).json({ success: false, error: 'Firma webhook non valida' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ success: false, error: 'Payload JSON non valido' });
  }

  const eventType = payload?.type;
  const stato = EVENT_STATUS[eventType];
  if (!stato) {
    return res.status(200).json({ success: true, ignored: true, event: eventType });
  }

  const emailId = pickEmailId(payload);
  if (!emailId) {
    return res.status(400).json({ success: false, error: 'email_id non presente nel webhook' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ success: false, error: 'Configurazione Supabase mancante' });
  }

  const timestamp = pickEventTimestamp(payload);
  const recipient = Array.isArray(payload?.data?.to)
    ? payload.data.to[0]
    : payload?.data?.to || payload?.to || null;
  const normalizedRecipient = typeof recipient === 'string' ? recipient.trim().toLowerCase() : null;
  const lookupRes = await fetch(
    `${supabaseUrl}/rest/v1/email_send_log?resend_id=eq.${encodeURIComponent(emailId)}&select=id,destinatari,cc,bcc,recipient_events,stato,opened_at,delivered_at&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    },
  );
  if (!lookupRes.ok) {
    const err = await lookupRes.text().catch(() => '');
    return res.status(502).json({ success: false, error: `Errore lettura email_send_log (${lookupRes.status})`, detail: err });
  }
  const existingRows = await lookupRes.json().catch(() => []);
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  const recipientEvents = existing?.recipient_events && typeof existing.recipient_events === 'object'
    ? { ...existing.recipient_events }
    : {};
  const eventRank = { inviata: 1, consegnata: 2, aperta: 3, cliccata: 4, rimbalzata: 5, spam: 5 };
  if (normalizedRecipient) {
    const previous = recipientEvents[normalizedRecipient];
    // Non permettere a un evento precedente di stato inferiore di cancellare
    // un'apertura o un errore già registrato per lo stesso destinatario.
    if (!previous || (eventRank[stato] ?? 0) >= (eventRank[previous.stato] ?? 0)) {
      recipientEvents[normalizedRecipient] = {
        stato,
        evento: eventType,
        timestamp,
      };
    }
  }

  const aggregateStatus = !existing?.stato
    || (eventRank[stato] ?? 0) >= (eventRank[existing.stato] ?? 0)
    ? stato
    : existing.stato;
  const updatePayload = {
    stato: aggregateStatus,
    recipient_events: recipientEvents,
  };
  if (eventType === 'email.opened') updatePayload.opened_at = timestamp;
  if (eventType === 'email.delivered') updatePayload.delivered_at = timestamp;

  const updateRes = await fetch(
    `${supabaseUrl}/rest/v1/email_send_log?resend_id=eq.${encodeURIComponent(emailId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(updatePayload),
    },
  );

  if (!updateRes.ok) {
    const err = await updateRes.text().catch(() => '');
    return res.status(502).json({ success: false, error: `Errore aggiornamento email_send_log (${updateRes.status})`, detail: err });
  }

  const rows = await updateRes.json().catch(() => []);
  return res.status(200).json({ success: true, event: eventType, email_id: emailId, updated: Array.isArray(rows) ? rows.length : 0 });
}
