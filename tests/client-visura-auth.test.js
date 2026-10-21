import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const clientId = '11111111-1111-1111-1111-111111111111';
const callerId = '22222222-2222-2222-2222-222222222222';
const pdf = Buffer.from('%PDF-1.4\nvisura di prova');

const jsonResponse = (data, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

function responseMock() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

test('visura server: autentica il Bearer utente senza fallback anon e mantiene i permessi', async () => {
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'];
  const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.SUPABASE_URL = 'https://supabase.example.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-server-key';
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    const { handleClientVisura } = await import('../src/lib/clientVisuraHandler.js?auth-regression');
    const request = () => ({
      method: 'POST',
      headers: {
        authorization: 'Bearer mock-user-session',
        'x-client-id': clientId,
        'x-file-name': 'visura.pdf',
        'content-type': 'application/pdf',
      },
      body: pdf,
    });
    let role = 'super_admin';
    let authStatus = 200;
    const writes = [];
    globalThis.fetch = async (url, options = {}) => {
      assert.ok(String(url).startsWith('https://supabase.example.invalid/'));
      if (String(url).endsWith('/auth/v1/user')) {
        assert.equal(options.headers.apikey, 'mock-server-key');
        assert.equal(options.headers.Authorization, 'Bearer mock-user-session');
        return jsonResponse(authStatus === 200 ? { id: callerId } : {}, authStatus);
      }
      assert.equal(options.headers.Authorization, 'Bearer mock-server-key');
      if (String(url).includes('/admin_profiles?')) return jsonResponse([{ ruolo: role }]);
      if (String(url).includes('/clients?') && !options.method) {
        return jsonResponse([{ id: clientId, created_by: 'other-user', visura_json: { preserved: true } }]);
      }
      if (String(url).includes('/practices?')) return jsonResponse([]);
      if (options.method === 'POST' && String(url).includes('/storage/v1/object/')) {
        assert.deepEqual(options.body, pdf);
        writes.push('storage');
        return jsonResponse({ Key: 'mock' });
      }
      if (options.method === 'PATCH' && String(url).includes('/clients?')) {
        const body = JSON.parse(options.body);
        assert.equal(body.visura_json.preserved, true);
        assert.equal(body.visura_json.client_visura.uploaded_by, callerId);
        writes.push('client-reference');
        return jsonResponse({});
      }
      throw new Error(`Unexpected mock request: ${options.method || 'GET'}`);
    };
    const success = responseMock();
    await handleClientVisura(request(), success);
    assert.equal(success.statusCode, 200);
    assert.equal(success.payload.success, true);
    assert.equal(success.payload.reference.dimensione, pdf.length);
    assert.deepEqual(writes, ['storage', 'client-reference']);

    writes.length = 0;
    role = 'agente';
    const unauthorizedClient = responseMock();
    await handleClientVisura(request(), unauthorizedClient);
    assert.equal(unauthorizedClient.statusCode, 403);
    assert.deepEqual(writes, []);

    role = 'segnalatore';
    const unauthorizedRole = responseMock();
    await handleClientVisura(request(), unauthorizedRole);
    assert.equal(unauthorizedRole.statusCode, 403);
    assert.deepEqual(writes, []);

    authStatus = 401;
    const expired = responseMock();
    await handleClientVisura(request(), expired);
    assert.equal(expired.statusCode, 401);
    assert.deepEqual(writes, []);

    authStatus = 503;
    const outage = responseMock();
    await handleClientVisura(request(), outage);
    assert.equal(outage.statusCode, 502);
    assert.doesNotMatch(outage.payload.error, /Accedi nuovamente/);
    assert.deepEqual(writes, []);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});

async function loadClientFunction(supabase, fetchMock) {
  const source = await readFile(new URL('../src/lib/clientVisura.ts', import.meta.url), 'utf8');
  const javascript = ts.transpileModule(
    source.replace("import { supabase } from '@/lib/supabase';", ''),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const context = { supabase, fetch: fetchMock, exports: {} };
  vm.runInNewContext(javascript, context);
  return context.exports.saveClientVisura;
}

test('visura client: rinnova una sessione scaduta una sola volta e ritenta lo stesso PDF', async () => {
  let refreshCalls = 0;
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'old-session' } }, error: null }),
      refreshSession: async () => {
        refreshCalls += 1;
        return { data: { session: { access_token: 'new-session' } }, error: null };
      },
    },
  };
  const file = { type: 'application/pdf', name: 'Visura prova.pdf' };
  const calls = [];
  const save = await loadClientFunction(supabase, async (url, options) => {
    assert.equal(url, '/api/client-visura');
    assert.equal(options.body, file);
    assert.equal(options.headers['X-Client-Id'], clientId);
    assert.equal(options.headers['X-File-Name'], 'Visura%20prova.pdf');
    calls.push(options.headers.Authorization);
    return calls.length === 1
      ? jsonResponse({ success: false, error: 'expired' }, 401)
      : jsonResponse({ success: true, reference: { storage_path: 'mock/visura.pdf' } });
  });
  const result = await save(clientId, file);
  assert.equal(result.storage_path, 'mock/visura.pdf');
  assert.equal(refreshCalls, 1);
  assert.deepEqual(calls, ['Bearer old-session', 'Bearer new-session']);
});

test('visura client: non ritenta permessi, errori di salvataggio o autenticazione persistente', async () => {
  for (const status of [403, 500, 401]) {
    let requests = 0;
    let refreshes = 0;
    const supabase = {
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'session' } }, error: null }),
        refreshSession: async () => {
          refreshes += 1;
          return { data: { session: { access_token: 'refreshed' } }, error: null };
        },
      },
    };
    const save = await loadClientFunction(supabase, async () => {
      requests += 1;
      return jsonResponse({ success: false, error: 'mock-failure' }, status);
    });
    await assert.rejects(save(clientId, { type: 'application/pdf', name: 'visura.pdf' }), /mock-failure/);
    assert.equal(requests, status === 401 ? 2 : 1);
    assert.equal(refreshes, status === 401 ? 1 : 0);
  }
});
