// Conserva la visura usata per censire un cliente.
// L'upload passa dal backend perché il cliente può non avere ancora pratiche
// e quindi non esiste un percorso pratica autorizzabile nelle policy Storage.

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.VITE_SUPABASE_URL
  || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJm' +
     'aGllcHBqcWxlZmRsYW52cnBpayIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzgwMDU2MTk5LCJleHAiOjIwOTU2MzIxOTl9.' +
     'tM0B5OyxF1-w9ed1-eEX09S_d5gehZnFUZEJCnXMVBQ';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Id, X-File-Name',
  'Content-Type': 'application/json',
};

const reply = (res, payload, status = 200) => res.status(status).json(payload);

const serviceHeaders = (contentType = 'application/json') => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': contentType,
});

const encodeStoragePath = (path) => path.split('/').map(encodeURIComponent).join('/');

const safeFileName = (value) => String(value || 'visura.pdf')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]/g, '_')
  .replace(/_+/g, '_')
  .slice(0, 180);

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_FILE_BYTES) throw new Error('FILE_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return reply(res, { success: false, error: 'Metodo non consentito' }, 405);

  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return reply(res, { success: false, error: 'Configurazione server mancante' }, 500);
    }

    const authorization = String(req.headers.authorization || '');
    const accessToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    const clientId = String(req.headers['x-client-id'] || '').trim();
    let originalName = 'visura.pdf';
    try {
      originalName = decodeURIComponent(String(req.headers['x-file-name'] || 'visura.pdf'));
    } catch {
      originalName = String(req.headers['x-file-name'] || 'visura.pdf');
    }
    const mimeType = String(req.headers['content-type'] || 'application/pdf').split(';')[0];

    if (!accessToken) return reply(res, { success: false, error: 'Sessione non autorizzata' }, 401);
    if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
      return reply(res, { success: false, error: 'Cliente non valido' }, 400);
    }
    if (mimeType !== 'application/pdf') {
      return reply(res, { success: false, error: 'È consentito soltanto un file PDF' }, 400);
    }

    const callerResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
    const caller = await readJson(callerResponse);
    if (!callerResponse.ok || !caller?.id) {
      return reply(res, { success: false, error: 'Sessione non riconosciuta. Accedi nuovamente.' }, 401);
    }

    const profileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_profiles?id=eq.${encodeURIComponent(caller.id)}&select=ruolo&limit=1`,
      { headers: serviceHeaders() },
    );
    const profiles = await readJson(profileResponse);
    const role = Array.isArray(profiles) ? profiles[0]?.ruolo : null;
    if (!profileResponse.ok || !['super_admin', 'supervisore_segreteria', 'agente'].includes(role)) {
      return reply(res, { success: false, error: 'Ruolo non autorizzato al caricamento della visura' }, 403);
    }

    const clientResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,created_by,visura_json&limit=1`,
      { headers: serviceHeaders() },
    );
    const clients = await readJson(clientResponse);
    const client = Array.isArray(clients) ? clients[0] : null;
    if (!clientResponse.ok || !client?.id) {
      return reply(res, { success: false, error: 'Cliente non trovato' }, 404);
    }

    let canManage = role === 'super_admin' || client.created_by === caller.id;
    if (!canManage && role === 'agente') {
      const practicesResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/practices?client_id=eq.${encodeURIComponent(clientId)}&assigned_to=eq.${encodeURIComponent(caller.id)}&select=id&limit=1`,
        { headers: serviceHeaders() },
      );
      const practices = await readJson(practicesResponse);
      canManage = practicesResponse.ok && Array.isArray(practices) && practices.length > 0;
    }
    if (!canManage && role === 'supervisore_segreteria') {
      const assignmentsResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/segreteria_agent_assignments?segreteria_user_id=eq.${encodeURIComponent(caller.id)}&select=agent_user_id`,
        { headers: serviceHeaders() },
      );
      const assignments = await readJson(assignmentsResponse);
      const agentIds = assignmentsResponse.ok && Array.isArray(assignments)
        ? assignments.map((assignment) => assignment.agent_user_id).filter(Boolean)
        : [];
      canManage = agentIds.includes(client.created_by);
      if (!canManage && agentIds.length > 0) {
        const agentFilter = agentIds.map(encodeURIComponent).join(',');
        const practicesResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/practices?client_id=eq.${encodeURIComponent(clientId)}&or=(created_by.in.(${agentFilter}),assigned_to.in.(${agentFilter}))&select=id&limit=1`,
          { headers: serviceHeaders() },
        );
        const practices = await readJson(practicesResponse);
        canManage = practicesResponse.ok && Array.isArray(practices) && practices.length > 0;
      }
    }
    if (!canManage) {
      return reply(res, { success: false, error: 'Non sei autorizzato a modificare questo cliente' }, 403);
    }

    const fileBuffer = await readBody(req);
    if (fileBuffer.length === 0) {
      return reply(res, { success: false, error: 'Il PDF è vuoto' }, 400);
    }

    const storagePath = `clienti/${clientId}/visura/${Date.now()}_${safeFileName(originalName)}`;
    const storageResponse = await fetch(
      `${SUPABASE_URL}/storage/v1/object/practice-files/${encodeStoragePath(storagePath)}`,
      {
        method: 'POST',
        headers: {
          ...serviceHeaders(mimeType),
          'x-upsert': 'false',
          'Cache-Control': '3600',
        },
        body: fileBuffer,
      },
    );
    if (!storageResponse.ok) {
      const storageError = await readJson(storageResponse);
      throw new Error(storageError?.message || `Upload non riuscito (HTTP ${storageResponse.status})`);
    }

    const reference = {
      storage_path: storagePath,
      nome_file: originalName,
      mime_type: mimeType,
      dimensione: fileBuffer.length,
      uploaded_at: new Date().toISOString(),
      uploaded_by: caller.id,
    };
    const currentJson = client.visura_json && typeof client.visura_json === 'object' && !Array.isArray(client.visura_json)
      ? client.visura_json
      : {};
    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}`,
      {
        method: 'PATCH',
        headers: { ...serviceHeaders(), Prefer: 'return=minimal' },
        body: JSON.stringify({ visura_json: { ...currentJson, client_visura: reference } }),
      },
    );
    if (!updateResponse.ok) {
      await fetch(
        `${SUPABASE_URL}/storage/v1/object/practice-files/${encodeStoragePath(storagePath)}`,
        { method: 'DELETE', headers: serviceHeaders() },
      ).catch(() => undefined);
      const updateError = await readJson(updateResponse);
      throw new Error(updateError?.message || `Salvataggio non riuscito (HTTP ${updateResponse.status})`);
    }

    return reply(res, { success: true, reference });
  } catch (error) {
    if (error instanceof Error && error.message === 'FILE_TOO_LARGE') {
      return reply(res, { success: false, error: 'Il PDF supera il limite di 15 MB' }, 413);
    }
    return reply(res, {
      success: false,
      error: error instanceof Error ? error.message : 'Errore durante il salvataggio della visura',
    }, 500);
  }
}
