// Tracker per i link ai documenti inviati alle banche.
// Registra l'evento e poi reindirizza al signed URL temporaneo di Supabase Storage.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(payload));
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { success: false, error: 'Method not allowed' });
  }
  const token = String(req.query?.token ?? '').trim();
  if (!token || !SUPABASE_KEY) {
    return json(res, 400, { success: false, error: 'Link documento non valido' });
  }

  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  const linkResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/bank_document_access_links?token=eq.${encodeURIComponent(token)}&select=token,practice_id,bank_id,practice_document_id,uploaded_file_id,relation_id,event_type,target_url,expires_at,access_count&limit=1`,
    { headers },
  );
  if (!linkResponse.ok) {
    return json(res, 502, { success: false, error: 'Impossibile verificare il link documento' });
  }
  const links = await linkResponse.json().catch(() => []);
  const link = Array.isArray(links) ? links[0] : null;
  if (!link) return json(res, 404, { success: false, error: 'Link documento non trovato' });
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return json(res, 410, { success: false, error: 'Link documento scaduto' });
  }

  const logPayload = {
    token: link.token,
    practice_id: link.practice_id,
    bank_id: link.bank_id,
    practice_document_id: link.practice_document_id ?? null,
    uploaded_file_id: link.uploaded_file_id ?? null,
    relation_id: link.relation_id ?? null,
    event_type: link.event_type,
    ip_address: firstHeader(req.headers['x-forwarded-for']) ?? req.socket?.remoteAddress ?? null,
    user_agent: firstHeader(req.headers['user-agent']) ?? null,
    referer: firstHeader(req.headers.referer) ?? null,
  };

  await fetch(`${SUPABASE_URL}/rest/v1/bank_document_access_logs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify(logPayload),
  }).catch(() => null);

  await fetch(`${SUPABASE_URL}/rest/v1/bank_document_access_links?token=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      access_count: Number(link.access_count ?? 0) + 1,
      last_accessed_at: new Date().toISOString(),
    }),
  }).catch(() => null);

  // Una sola notifica per il primo accesso di ciascun link evita un flusso
  // rumoroso, mantenendo comunque la visibilità dell'evento in-app.
  if (Number(link.access_count ?? 0) === 0) {
    try {
      const practiceResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/practices?id=eq.${encodeURIComponent(link.practice_id)}&select=assigned_to`,
        { headers },
      );
      const practiceRows = practiceResponse.ok ? await practiceResponse.json() : [];
      const assignedTo = Array.isArray(practiceRows) ? practiceRows[0]?.assigned_to : null;
      const adminsResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_profiles?ruolo=eq.super_admin&select=id`,
        { headers },
      );
      const adminRows = adminsResponse.ok ? await adminsResponse.json() : [];
      const recipientIds = new Set([
        assignedTo,
        ...(Array.isArray(adminRows) ? adminRows.map(row => row?.id) : []),
      ].filter(Boolean));
      if (recipientIds.size > 0) {
        const isDownload = link.event_type === 'downloaded';
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: 'POST',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify([...recipientIds].map(userId => ({
            user_id: userId,
            tipo: isDownload ? 'documento_banca_scaricato' : 'documento_banca_aperto',
            titolo: isDownload ? 'La banca ha scaricato un documento' : 'La banca ha aperto un documento',
            testo: `È stato ${isDownload ? 'scaricato' : 'aperto'} un documento della pratica.`,
            link: `/admin/pratiche/${link.practice_id}`,
            practice_id: link.practice_id,
          }))),
        });
      }
    } catch (notificationError) {
      console.warn('Notifica accesso documento non registrata:', notificationError);
    }
  }

  res.statusCode = 302;
  res.setHeader('Location', link.target_url);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.end();
}
