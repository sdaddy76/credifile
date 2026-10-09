// Tracker per i link ai documenti inviati alle banche.
// Il token dell'email è stabile: a ogni accesso viene verificata l'appartenenza
// del documento alla pratica e viene generato un nuovo signed URL breve.

import { handleClientVisura } from '../src/lib/clientVisuraHandler.js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PRACTICE_FILES_BUCKET = 'practice-files';
const FRESH_SIGNED_URL_TTL_SECONDS = 10 * 60;

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

function json(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify(payload));
}

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function encodeStoragePath(path) {
  return String(path)
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function normalizeSignedUrl(value) {
  const url = String(value ?? '').trim();
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  if (url.startsWith('/storage/v1/')) return `${SUPABASE_URL}${url}`;
  if (url.startsWith('/object/')) return `${SUPABASE_URL}/storage/v1${url}`;
  return null;
}

export function extractPracticeFileStoragePath(value) {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return null;
  if (!/^https?:\/\//i.test(rawValue)) {
    return rawValue.replace(/^\/+/, '') || null;
  }

  try {
    const url = new URL(rawValue);
    const prefixes = [
      `/storage/v1/object/sign/${PRACTICE_FILES_BUCKET}/`,
      `/storage/v1/object/public/${PRACTICE_FILES_BUCKET}/`,
      `/storage/v1/object/${PRACTICE_FILES_BUCKET}/`,
    ];
    const prefix = prefixes.find(candidate => url.pathname.startsWith(candidate));
    if (!prefix) return null;
    return url.pathname
      .slice(prefix.length)
      .split('/')
      .map(segment => decodeURIComponent(segment))
      .join('/');
  } catch {
    return null;
  }
}

async function readFirstRow(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function createFreshSignedUrl(storagePath, fileName, forceDownload, headers) {
  const encodedPath = encodeStoragePath(storagePath);
  if (!encodedPath) return null;
  const body = { expiresIn: FRESH_SIGNED_URL_TTL_SECONDS };
  if (forceDownload) body.download = String(fileName || 'documento');

  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${PRACTICE_FILES_BUCKET}/${encodedPath}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return normalizeSignedUrl(payload?.signedUrl ?? payload?.signedURL);
}

async function resolveCurrentDocumentUrl(link, headers) {
  let storagePath = null;
  let fileName = null;

  if (link.uploaded_file_id) {
    const uploadedFile = await readFirstRow(
      `${SUPABASE_URL}/rest/v1/uploaded_files?id=eq.${encodeURIComponent(link.uploaded_file_id)}&practice_id=eq.${encodeURIComponent(link.practice_id)}&select=id,practice_id,practice_document_id,nome_file,storage_path&limit=1`,
      headers,
    );
    if (!uploadedFile) return null;
    if (
      link.practice_document_id
      && uploadedFile.practice_document_id
      && uploadedFile.practice_document_id !== link.practice_document_id
    ) {
      return null;
    }
    storagePath = extractPracticeFileStoragePath(uploadedFile.storage_path);
    fileName = uploadedFile.nome_file;
  } else if (link.relation_id) {
    const relation = await readFirstRow(
      `${SUPABASE_URL}/rest/v1/relazioni_commerciali?id=eq.${encodeURIComponent(link.relation_id)}&practice_id=eq.${encodeURIComponent(link.practice_id)}&select=id,practice_id,bank_id,pdf_url&limit=1`,
      headers,
    );
    if (!relation) return null;
    if (relation.bank_id && relation.bank_id !== link.bank_id) return null;

    storagePath = extractPracticeFileStoragePath(relation.pdf_url);
    fileName = 'Relazione_Commerciale.pdf';
    if (!storagePath && /^https:\/\//i.test(String(relation.pdf_url ?? ''))) {
      return relation.pdf_url;
    }
  }

  if (storagePath) {
    return createFreshSignedUrl(
      storagePath,
      fileName,
      link.event_type === 'downloaded',
      headers,
    );
  }

  // Compatibilità per eventuali vecchi link esterni non ospitati nello
  // Storage Credifile. I vecchi signed URL Supabase non vengono riutilizzati.
  const legacyTarget = String(link.target_url ?? '').trim();
  if (
    /^https:\/\//i.test(legacyTarget)
    && !extractPracticeFileStoragePath(legacyTarget)
  ) {
    return legacyTarget;
  }
  return null;
}

export default async function handler(req, res) {
  // La route /api/client-visura viene riscritta qui per restare sotto il
  // limite di 12 Serverless Functions del piano Hobby. Questo endpoint
  // storico accetta solo GET, quindi i metodi POST/OPTIONS sono non ambigui.
  if (req.method !== 'GET') {
    return handleClientVisura(req, res);
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

  // expires_at apparteneva al vecchio signed URL creato durante l'invio.
  // Non limita più il token dell'email: il file viene rifirmato a ogni clic.
  const currentDocumentUrl = await resolveCurrentDocumentUrl(link, headers);
  if (!currentDocumentUrl) {
    return json(res, 404, {
      success: false,
      error: 'Documento non più disponibile nella pratica',
    });
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
  res.setHeader('Location', currentDocumentUrl);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.end();
}
