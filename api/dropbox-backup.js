// Vercel Serverless Function — Backup Credifile su Dropbox
// Include: 9 tabelle DB (JSON) + file fisici da Supabase Storage

const SUPABASE_URL      = process.env.SUPABASE_URL      || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DBX_APP_KEY       = process.env.DROPBOX_APP_KEY;
const DBX_APP_SECRET    = process.env.DROPBOX_APP_SECRET;
const DBX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN;
const STORAGE_BUCKET    = 'practice-files';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// ── Dropbox helpers ──────────────────────────────────────────────────────────

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
  return (await r.json()).access_token;
}

async function dropboxUploadBuffer(token, path, buffer) {
  const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization':   `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }),
      'Content-Type':    'application/octet-stream',
    },
    body: buffer,
  });
  if (!r.ok) throw new Error(`Dropbox upload error ${r.status}: ${await r.text()}`);
}

// ── Supabase helpers ─────────────────────────────────────────────────────────

async function queryTable(table) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) { console.warn(`Skip ${table}: ${r.status}`); return []; }
  return await r.json();
}

async function downloadStorageFile(storagePath) {
  const url = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${storagePath}`;
  const r = await fetch(url, {
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`Storage download error ${r.status} for ${storagePath}`);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf);
}

// ── Handler principale ───────────────────────────────────────────────────────

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const startTime = Date.now();

  try {
    const now    = new Date().toISOString().split('T')[0];
    const tables = [
      'practices', 'clients', 'banks', 'admin_profiles', 'uploaded_files',
      'practice_documents', 'practice_banks', 'leads', 'document_templates',
    ];

    // 1. Backup DB (JSON) ─────────────────────────────────────────────────────
    const backup = { _meta: { date: now, tables } };
    for (const table of tables) {
      backup[table] = await queryTable(table);
    }
    const jsonStr = JSON.stringify(backup, null, 2);

    const token = await getDropboxToken();

    await dropboxUploadBuffer(
      token,
      `/Apps/Credifile/backups/backup_${now}.json`,
      Buffer.from(jsonStr),
    );
    await dropboxUploadBuffer(
      token,
      '/Apps/Credifile/backups/backup_latest.json',
      Buffer.from(jsonStr),
    );
    const db_kb = Math.round(jsonStr.length / 1024);

    // 2. Copia file fisici da Supabase Storage → Dropbox /files/ ─────────────
    const uploadedFiles = backup['uploaded_files'] || [];
    const filePaths = [...new Set(
      uploadedFiles
        .map(f => f.storage_path)
        .filter(Boolean),
    )];

    let files_ok = 0;
    let files_err = 0;
    const errors = [];

    for (const storagePath of filePaths) {
      // Controlla timeout: lascia almeno 8s per rispondere
      if (Date.now() - startTime > 50_000) {
        errors.push('timeout — ' + (filePaths.length - files_ok - files_err) + ' file rimasti');
        break;
      }
      try {
        const buf = await downloadStorageFile(storagePath);
        const dbxPath = `/Apps/Credifile/files/${storagePath}`;
        await dropboxUploadBuffer(token, dbxPath, buf);
        files_ok++;
        console.log(`OK: ${storagePath} (${Math.round(buf.length / 1024)} KB)`);
      } catch (e) {
        files_err++;
        errors.push(`${storagePath}: ${e.message}`);
        console.warn(`ERR: ${storagePath}:`, e.message);
      }
    }

    return res.status(200).json({
      ok:          true,
      date:        now,
      db_kb,
      files_total: filePaths.length,
      files_ok,
      files_err,
      elapsed_s:   Math.round((Date.now() - startTime) / 1000),
      errors:      errors.length ? errors : undefined,
    });

  } catch (e) {
    console.error('BACKUP ERROR:', e);
    return res.status(500).json({
      ok:        false,
      error:     e.message,
      elapsed_s: Math.round((Date.now() - startTime) / 1000),
    });
  }
}
