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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

async function waitBeforeRetry(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.min(retryAfter * 1000, 10_000)
    : Math.min(500 * (2 ** attempt), 5_000);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}

async function fetchWithRetry(url, options, label) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok || !RETRYABLE_STATUS.has(response.status) || attempt === 2) {
        return response;
      }
      await waitBeforeRetry(response, attempt);
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(500 * (2 ** attempt), 5_000)));
    }
  }
  throw new Error(`${label} failed after retries`);
}

function getRomeDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    calendar: 'gregory',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]),
  );
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function hasValidCronAuthorization(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authorization = req.headers.authorization || '';
  return authorization === `Bearer ${secret}`;
}

// ── Dropbox helpers ──────────────────────────────────────────────────────────

async function getDropboxToken() {
  const creds = Buffer.from(`${DBX_APP_KEY}:${DBX_APP_SECRET}`).toString('base64');
  const r = await fetchWithRetry('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(DBX_REFRESH_TOKEN)}`,
  }, 'Dropbox token request');
  if (!r.ok) throw new Error(`Dropbox token error ${r.status}: ${await r.text()}`);
  return (await r.json()).access_token;
}

async function dropboxUploadBuffer(token, path, buffer) {
  const r = await fetchWithRetry('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Authorization':   `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }),
      'Content-Type':    'application/octet-stream',
    },
    body: buffer,
  }, 'Dropbox upload');
  if (!r.ok) throw new Error(`Dropbox upload error ${r.status}: ${await r.text()}`);
}

// ── Supabase helpers ─────────────────────────────────────────────────────────

async function queryTable(table) {
  const rows = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const r = await fetchWithRetry(
      `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=${pageSize}&offset=${offset}`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } },
      `Supabase query ${table}`,
    );
    if (!r.ok) {
      throw new Error(`Supabase query error ${r.status} for ${table}: ${await r.text()}`);
    }
    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function downloadStorageFile(storagePath) {
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  const url = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${encodedPath}`;
  const r = await fetchWithRetry(url, {
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` },
  }, `Storage download ${storagePath}`);
  if (!r.ok) throw new Error(`Storage download error ${r.status} for ${storagePath}`);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf);
}

// ── Handler principale ───────────────────────────────────────────────────────

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    if (!process.env.CRON_SECRET) {
      return res.status(503).json({
        ok: false,
        error: 'CRON_SECRET non configurato: backup automatico non attivato',
      });
    }
    if (!hasValidCronAuthorization(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const localTime = getRomeDateTime();
    if (localTime.hour !== 0) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: 'Non è mezzanotte nel fuso Europe/Rome',
        local_date: localTime.date,
        local_hour: localTime.hour,
      });
    }
  } else if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    const now = getRomeDateTime().date;
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

    let nextIndex = 0;
    const workerCount = Math.min(4, Math.max(1, filePaths.length));
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= filePaths.length) return;
        const storagePath = filePaths[index];
        try {
          const buf = await downloadStorageFile(storagePath);
          const dbxPath = `/Apps/Credifile/files/${storagePath}`;
          await dropboxUploadBuffer(token, dbxPath, buf);
          files_ok++;
          console.log(`OK: ${storagePath} (${Math.round(buf.length / 1024)} KB)`);
        } catch (e) {
          files_err++;
          const message = e instanceof Error ? e.message : String(e);
          errors.push(`${storagePath}: ${message}`);
          console.warn(`ERR: ${storagePath}:`, message);
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const files_pending = filePaths.length - files_ok - files_err;
    const partial = files_err > 0 || files_pending > 0;
    return res.status(partial ? 207 : 200).json({
      ok:          !partial,
      partial,
      date:        now,
      db_kb,
      files_total: filePaths.length,
      files_ok,
      files_err,
      files_pending,
      elapsed_s:   Math.round((Date.now() - startTime) / 1000),
      error_count: errors.length,
      errors:      errors.slice(0, 50),
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
