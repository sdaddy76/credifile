// Vercel Serverless Function — Backup Credifile su Dropbox
// Sostituisce la Supabase Edge Function che aveva BOOT_ERROR irrecuperabile

const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DBX_APP_KEY       = process.env.DROPBOX_APP_KEY;
const DBX_APP_SECRET    = process.env.DROPBOX_APP_SECRET;
const DBX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

async function getDropboxToken() {
  const creds = Buffer.from(`${DBX_APP_KEY}:${DBX_APP_SECRET}`).toString('base64');
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(DBX_REFRESH_TOKEN)}`,
  });
  if (!r.ok) throw new Error(`Dropbox token error ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.access_token;
}

async function queryTable(table) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: {
      'apikey':         SUPABASE_KEY,
      'Authorization':  `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!r.ok) { console.warn(`Skip ${table}: ${r.status}`); return []; }
  return await r.json();
}

async function dropboxUpload(token, path, body) {
  const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization':   `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }),
      'Content-Type':    'application/octet-stream',
    },
    body: Buffer.from(body),
  });
  if (!r.ok) throw new Error(`Dropbox upload error ${r.status}: ${await r.text()}`);
}

export default async function handler(req, res) {
  // CORS headers su tutte le risposte
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const now    = new Date().toISOString().split('T')[0];
    const tables = [
      'practices', 'clients', 'banks', 'admin_profiles', 'uploaded_files',
      'practice_documents', 'practice_banks', 'leads', 'document_templates',
    ];

    const backup = { _meta: { date: now, tables } };
    for (const table of tables) {
      backup[table] = await queryTable(table);
    }

    const jsonStr = JSON.stringify(backup, null, 2);
    const token   = await getDropboxToken();

    await dropboxUpload(token, `/Apps/Credifile/backups/backup_${now}.json`, jsonStr);
    await dropboxUpload(token, '/Apps/Credifile/backups/backup_latest.json', jsonStr);

    const kb = Math.round(jsonStr.length / 1024);
    return res.status(200).json({ ok: true, date: now, size_kb: kb });
  } catch (e) {
    console.error('BACKUP ERROR:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
