// Vercel Serverless Function — Backup Credifile su Dropbox
// Include: dati delle pratiche, note, report e inventario completo dei file
// fisici presenti nel bucket Supabase Storage "practice-files".

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
  const authorization = req.headers.authorization || '';
  if (secret) return authorization === `Bearer ${secret}`;

  // Vercel aggiunge sempre questo header alle invocazioni Cron. Il progetto
  // usa due schedule UTC (22:00 e 23:00) per coprire l'ora legale italiana;
  // il controllo sull'ora locale viene eseguito subito dopo, nel route handler.
  // In questo modo il job resta automatico anche se CRON_SECRET non è stato
  // ancora configurato nelle variabili Vercel, mentre le chiamate manuali
  // senza header non possono avviare il backup.
  const schedule = String(req.headers['x-vercel-cron-schedule'] || '');
  return schedule === '0 22 * * *' || schedule === '0 23 * * *';
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

async function listStorageFiles() {
  const files = [];
  const pendingPrefixes = [''];
  const visitedPrefixes = new Set();
  const pageSize = 1000;

  while (pendingPrefixes.length > 0) {
    const prefix = pendingPrefixes.pop();
    if (visitedPrefixes.has(prefix)) continue;
    visitedPrefixes.add(prefix);

    let offset = 0;
    while (true) {
      const r = await fetchWithRetry(
        `${SUPABASE_URL}/storage/v1/object/list/${STORAGE_BUCKET}`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prefix,
            limit: pageSize,
            offset,
            sortBy: { column: 'name', order: 'asc' },
          }),
        },
        `Storage inventory ${prefix || '/'}`,
      );
      if (!r.ok) {
        throw new Error(`Storage inventory error ${r.status} for ${prefix || '/'}: ${await r.text()}`);
      }

      const entries = await r.json();
      if (!Array.isArray(entries)) {
        throw new Error(`Storage inventory returned invalid data for ${prefix || '/'}`);
      }

      for (const entry of entries) {
        if (!entry?.name) continue;
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const isFile = Boolean(entry.id || entry.metadata);
        if (isFile) files.push(fullPath);
        else pendingPrefixes.push(fullPath);
      }

      if (entries.length < pageSize) break;
      offset += pageSize;
    }
  }

  return [...new Set(files)];
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
      'practice_notes', 'practice_tasks', 'practice_checklist_items',
      'practice_client_questions', 'practice_client_banks',
      'practice_integration_requests', 'practice_moduli_compilati',
      'practice_activity_log', 'practice_status_log', 'practice_bank_status_log',
      'relazioni_commerciali', 'consulente_reports',
      'bilanci_kpi', 'reputational_analyses', 'schede_valutazione_rischio',
      'document_deadlines', 'document_coherence_alerts', 'client_financing',
      'estratto_conto_transactions', 'balance_anomaly_alerts', 'email_send_log',
    ];

    // 1. Backup DB (JSON) ─────────────────────────────────────────────────────
    const backup = {
      _meta: {
        date: now,
        tables,
        storage_bucket: STORAGE_BUCKET,
      },
    };
    for (const table of tables) {
      backup[table] = await queryTable(table);
    }

    const token = await getDropboxToken();

    // 2. Copia file fisici da Supabase Storage → Dropbox /files/ ─────────────
    const uploadedFiles = backup['uploaded_files'] || [];
    const referencedPaths = [
      uploadedFiles
        .map(f => f.storage_path)
        .filter(Boolean),
      (backup['practice_moduli_compilati'] || [])
        .map(record => record.file_path)
        .filter(Boolean),
      (backup['relazioni_commerciali'] || [])
        .flatMap(record => [record.docx_url, record.pdf_url])
        .filter(Boolean),
      (backup['consulente_reports'] || [])
        .map(record => record.report_pdf_path)
        .filter(Boolean),
    ].flat();
    const inventoryPaths = await listStorageFiles();
    const filePaths = [...new Set([...referencedPaths, ...inventoryPaths])];

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
    backup._meta.storage_inventory = {
      inventory_files: inventoryPaths.length,
      referenced_files: new Set(referencedPaths).size,
      backup_files: filePaths.length,
      files_ok,
      files_err,
      files_pending,
    };

    // Il JSON viene scritto per ultimo: contiene anche l'esito reale dei file.
    const jsonStr = JSON.stringify(backup, null, 2);
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
    const db_kb = Math.round(Buffer.byteLength(jsonStr) / 1024);

    return res.status(partial ? 207 : 200).json({
      ok:          !partial,
      partial,
      date:        now,
      db_kb,
      tables_total: tables.length,
      storage_inventory_files: inventoryPaths.length,
      referenced_files: new Set(referencedPaths).size,
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
