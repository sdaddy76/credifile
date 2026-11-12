const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual Edge handler and its shared TS modules with mocked HTTP.
// No production requests, document downloads, credentials or writes are made.
const pdf = `ALFA S.R.L.
Bilancio di esercizio al 31/12/2025
Stato patrimoniale
Attivo
Totale attivo circolante 500.000
Totale attivo 1.000.000
Passivo
Totale patrimonio netto 300.000
D) Debiti
esigibili entro l'esercizio successivo 200.000
esigibili oltre l'esercizio successivo 490.000
Totale debiti 690.000
E) Ratei e risconti 10.000
Totale passivo 1.000.000
Conto economico
Utile dell'esercizio 50.000`;

function harness(options = {}) {
  let handler;
  const requests = [];
  const existing = {
    id: 'balance-1', practice_id: 'practice-1', uploaded_file_id: 'file-1', anno_esercizio: 2025,
    totale_attivo: 1_000_000, totale_patrimonio_netto: 300_000,
    totale_attivo_circolante: 500_000, rimanenze: 50_000, disponibilita_liquide: 40_000,
    crediti_circolante: 410_000, totale_debiti: 690_000, utile_netto: 50_000,
    kpi: { liquidita: { current_ratio: { valore: null } }, copertura: { dscr: { valore: 1.8, source: 'Rate reali' } } },
    anomaly_analysis: { findings: [{ id: 'preserve-review' }] }, ...options.existing,
  };
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
  const fetch = async (url, init = {}) => {
    requests.push({ url, ...init });
    if (url.endsWith('/auth/v1/user')) return json(options.unauthenticated ? {} : { id: 'user-1' });
    if (url.includes('/admin_profiles?')) return json([{ ruolo: 'super_admin' }]);
    if (url.includes('/uploaded_files?')) return json(options.fileMissing ? [] : [{ id: 'file-1' }]);
    if (url.includes('/bilanci_kpi?')) {
      if (init.method === 'PATCH') return json(options.patchDenied ? [] : [{ id: 'balance-1' }]);
      return json(options.accessDenied ? [] : [existing]);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const Deno = { env: { get: key => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'test-anon' })[key] }, serve: fn => { handler = fn; } };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      module, exports: module.exports,
      require: relative => load(path.resolve(path.dirname(filename), relative)),
      Deno, fetch, Response, Request, console,
    }, { filename });
    return module.exports;
  }
  load(path.resolve(__dirname, '../supabase/functions/analizza-bilancio/index.ts'));
  return {
    requests, existing,
    async run(body = {}) {
      const response = await handler(new Request('https://example.supabase.co/functions/v1/analizza-bilancio', {
        method: 'POST', headers: { Authorization: 'Bearer test-user', 'Content-Type': 'application/json' },
        body: JSON.stringify({ practice_id: 'practice-1', uploaded_file_id: 'file-1', bilancio_id: 'balance-1',
          pdf_text: pdf, refresh_liquidity_only: true, ...body }),
      }));
      return { status: response.status, data: await response.json() };
    },
  };
}

test('recovers actual debt maturities, exact row and source, preserving other KPI and anomaly reviews', async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.data.success, true);
  assert.equal(result.data.updated, true);
  assert.equal(result.data.passivita_correnti, 200_000);
  const writes = h.requests.filter(request => request.method === 'PATCH');
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /id=eq.balance-1&practice_id=eq.practice-1&uploaded_file_id=eq.file-1/);
  assert.equal(writes[0].headers.Authorization, 'Bearer test-user');
  const patch = JSON.parse(writes[0].body);
  assert.deepEqual(Object.keys(patch).sort(), ['kpi', 'passivita_correnti']);
  assert.deepEqual(patch.kpi.copertura, h.existing.kpi.copertura);
  assert.equal(patch.kpi.liquidita.current_ratio.valore, 2.5);
  assert.match(patch.kpi.liquidita.current_ratio.source_note, /PROXY/);
});

for (const [name, options, body] of [
  ['unauthenticated operator', { unauthenticated: true }, {}],
  ['inaccessible balance', { accessDenied: true }, {}],
  ['deleted/unreadable source', { fileMissing: true }, {}],
  ['different fiscal year', { existing: { anno_esercizio: 2024 } }, {}],
  ['different company figures', { existing: { totale_attivo: 2_000_000 } }, {}],
  ['missing financial fingerprint', { existing: { totale_patrimonio_netto: null } }, {}],
  ['missing row identity', {}, { bilancio_id: null }],
]) {
  test(`does not update with ${name}`, async () => {
    const h = harness(options);
    const result = await h.run(body);
    assert.equal(result.data.success, false);
    assert.equal(h.requests.filter(request => request.method === 'PATCH').length, 0);
  });
}

test('does not fabricate a maturity or write anything when the PDF has none', async () => {
  const h = harness();
  const result = await h.run({ pdf_text: pdf.replace(/esigibili (entro|oltre)[^\n]+\n/g, '') });
  assert.equal(result.data.success, true);
  assert.equal(result.data.updated, false);
  assert.equal(h.requests.filter(request => request.method === 'PATCH').length, 0);
});

test('does not claim success when RLS changes between read and write', async () => {
  const h = harness({ patchDenied: true });
  assert.equal((await h.run()).data.success, false);
});

test('capability handshake is authenticated and read-only, even without a practice', async () => {
  const h = harness();
  const result = await h.run({ action: 'liquidity_recovery_capabilities', practice_id: null, pdf_text: null });
  assert.equal(result.data.liquidity_recovery_version, 'liquidity-v2');
  assert.equal(h.requests.some(request => request.url.includes('/bilanci_kpi?')), false);
  const denied = harness({ unauthenticated: true });
  assert.equal((await denied.run({ action: 'liquidity_recovery_capabilities' })).status, 403);
});
