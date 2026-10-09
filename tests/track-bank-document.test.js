import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.SUPABASE_URL = 'https://example.supabase.co';

const {
  default: handler,
  extractPracticeFileStoragePath,
} = await import('../api/track-bank-document.js');

function responseJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    end(body = '') {
      this.body = String(body ?? '');
      return this;
    },
  };
}

test('estrae il percorso Storage anche da un vecchio signed URL', () => {
  assert.equal(
    extractPracticeFileStoragePath(
      'https://example.supabase.co/storage/v1/object/sign/practice-files/pratica%201/bilancio.pdf?token=scaduto',
    ),
    'pratica 1/bilancio.pdf',
  );
  assert.equal(
    extractPracticeFileStoragePath('pratica-1/documenti/bilancio.pdf'),
    'pratica-1/documenti/bilancio.pdf',
  );
});

test('un token email già scaduto genera un nuovo URL breve al momento del download', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/bank_document_access_links?token=')) {
      return responseJson([{
        token: 'token-permanente',
        practice_id: 'practice-1',
        bank_id: 'bank-1',
        practice_document_id: 'document-1',
        uploaded_file_id: 'file-1',
        relation_id: null,
        event_type: 'downloaded',
        target_url: 'https://example.supabase.co/storage/v1/object/sign/practice-files/vecchio.pdf?token=scaduto',
        expires_at: '2020-01-01T00:00:00.000Z',
        access_count: 1,
      }]);
    }
    if (url.includes('/uploaded_files?')) {
      return responseJson([{
        id: 'file-1',
        practice_id: 'practice-1',
        practice_document_id: 'document-1',
        nome_file: 'Bilancio 2025.pdf',
        storage_path: 'practice-1/document-1/bilancio-2025.pdf',
      }]);
    }
    if (url.includes('/storage/v1/object/sign/practice-files/')) {
      return responseJson({
        signedURL: '/object/sign/practice-files/practice-1/document-1/bilancio-2025.pdf?token=nuovo',
      });
    }
    if (url.includes('/bank_document_access_logs')) return responseJson({}, 201);
    if (url.includes('/bank_document_access_links?token=') && init.method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    return responseJson([]);
  };

  try {
    const res = createResponse();
    await handler({
      method: 'GET',
      query: { token: 'token-permanente' },
      headers: { 'user-agent': 'test-agent' },
      socket: { remoteAddress: '127.0.0.1' },
    }, res);

    assert.equal(res.statusCode, 302);
    assert.equal(
      res.headers.location,
      'https://example.supabase.co/storage/v1/object/sign/practice-files/practice-1/document-1/bilancio-2025.pdf?token=nuovo',
    );
    const signCall = calls.find(call => call.url.includes('/storage/v1/object/sign/practice-files/'));
    assert.ok(signCall);
    assert.deepEqual(JSON.parse(signCall.init.body), {
      expiresIn: 600,
      download: 'Bilancio 2025.pdf',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('non firma un file che non appartiene più alla pratica del link', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes('/bank_document_access_links?token=')) {
      return responseJson([{
        token: 'token-errato',
        practice_id: 'practice-1',
        bank_id: 'bank-1',
        practice_document_id: 'document-1',
        uploaded_file_id: 'file-1',
        relation_id: null,
        event_type: 'opened',
        target_url: 'https://example.supabase.co/storage/v1/object/sign/practice-files/vecchio.pdf?token=scaduto',
        expires_at: '2020-01-01T00:00:00.000Z',
        access_count: 0,
      }]);
    }
    if (url.includes('/uploaded_files?')) return responseJson([]);
    throw new Error(`Chiamata inattesa: ${url}`);
  };

  try {
    const res = createResponse();
    await handler({
      method: 'GET',
      query: { token: 'token-errato' },
      headers: {},
      socket: {},
    }, res);

    assert.equal(res.statusCode, 404);
    assert.match(res.body, /Documento non più disponibile/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
