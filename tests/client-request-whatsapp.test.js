import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import handler, { normalizeWhatsAppAddress } from '../api/send-whatsapp.js';

test('richiesta ordinaria: il click non abilita il filtro finanziamenti', async () => {
  const source = await readFile(new URL('../src/pages/admin/PraticaDetailPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /const onlyFinancing = options\.onlyFinancing === true/);
  assert.match(source, /onClick=\{\(\) => void sendDocumentRequest\(\)\}/);
  assert.doesNotMatch(source, /onClick=\{sendDocumentRequest\}|sendDocumentRequest\(true\)/);
  assert.match(source, /sendDocumentRequest\(\{ onlyFinancing: true \}\)/);
});

test('richiesta cliente: il percorso effettivo include integrazioni e domande, non solo finanziamenti', async () => {
  const source = await readFile(new URL('../src/pages/admin/PraticaDetailPage.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const sendDocumentRequest =');
  const end = source.indexOf('\n  // Aggiunge alla pratica', start);
  assert.ok(start >= 0 && end > start);
  // Esegui la funzione reale con database/email simulati, rimuovendo solo i
  // cast e le annotazioni TS. Nessuna richiesta raggiunge i servizi esterni.
  const functionSource = source.slice(start, end)
    .replace('options: { onlyFinancing?: boolean }', 'options')
    .replace(/ as Practice & \{ clients\?: \{ (?:email|ragione_sociale): string \} \}/g, '')
    .replace(/: \{ (?:nome|domanda): string \}/g, '')
    .replace(/ as const/g, '')
    .replace(' as string | null', '')
    .replace(': requestId is string', '');
  const pendingDocs = [
    { nome: 'Bilancio aggiornato', integration_request_id: 'cycle-1' },
    { nome: 'Situazione finanziamenti', integration_request_id: null },
  ];
  const pendingQuestions = [{ domanda: 'Motivazione richiesta', integration_request_id: 'cycle-1' }];
  const invocations = [];
  const infos = [];
  const errors = [];
  const supabase = {
    from(table) {
      const query = {
        update() { return this; },
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        order() { return this; },
        maybeSingle() { return this; },
        insert() { return this; },
        then(resolve, reject) {
          const data = table === 'practice_documents' ? pendingDocs
            : table === 'practice_client_questions' ? pendingQuestions
              : table === 'admin_profiles' ? { nome: 'Consulente di prova' } : null;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    functions: {
      async invoke(name, payload) {
        invocations.push({ name, payload });
        return { data: { success: true }, error: null };
      },
    },
  };
  const context = {
    supabase,
    practice: { id: 'test-practice', numero_pratica: 'TEST', clients: { email: 'cliente@example.invalid', ragione_sociale: 'Società di prova' } },
    accessCode: { id: 'test-code', codice: 'TEST' },
    user: { id: 'test-user', email: 'agente@example.invalid' },
    documents: [],
    clientQuestions: [],
    setSendingEmail() {},
    toast: { info(message) { infos.push(message); }, error(message) { errors.push(message); }, success() {} },
    isFinancingRequestDocument: document => document.nome === 'Situazione finanziamenti',
    buildAppUrl: path => `https://example.invalid${path}`,
    getAssignedAgentEmail: () => 'agente@example.invalid',
  };
  const send = vm.runInNewContext(`${functionSource}\nsendDocumentRequest;`, context);
  await send();
  assert.deepEqual(errors, []);
  assert.deepEqual(infos, []);
  assert.equal(invocations.length, 1);
  assert.deepEqual(Array.from(invocations[0].payload.body.documents), ['Bilancio aggiornato', 'Situazione finanziamenti']);
  assert.deepEqual(Array.from(invocations[0].payload.body.questions), ['Motivazione richiesta']);
  await send({ onlyFinancing: true });
  assert.equal(invocations.length, 2);
  assert.deepEqual(Array.from(invocations[1].payload.body.documents), ['Situazione finanziamenti']);
  assert.deepEqual(Array.from(invocations[1].payload.body.questions), []);
});

test('mittente semplice e destinatario con canale usano WhatsApp una sola volta', () => {
  assert.equal(normalizeWhatsAppAddress('+14155238886'), 'whatsapp:+14155238886');
  assert.equal(normalizeWhatsAppAddress('whatsapp:+39 333 123 4567', '39'), 'whatsapp:+393331234567');
  assert.equal(normalizeWhatsAppAddress('3331234567', '39'), 'whatsapp:+393331234567');
  assert.equal(normalizeWhatsAppAddress('0039 333-123-4567', '39'), 'whatsapp:+393331234567');
  assert.equal(normalizeWhatsAppAddress('06 12345678', '39'), 'whatsapp:+390612345678');
});

test('numero non valido e mittente senza prefisso internazionale vengono rifiutati', () => {
  assert.throws(() => normalizeWhatsAppAddress('sms:+393331234567', '39'));
  assert.throws(() => normalizeWhatsAppAddress('abc', '39'));
  assert.throws(() => normalizeWhatsAppAddress('123', '39'));
  assert.throws(() => normalizeWhatsAppAddress('+390+390612345678', '39'));
  assert.throws(() => normalizeWhatsAppAddress('14155238886'));
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

test('endpoint: payload Twilio sullo stesso canale e nessun invio reale', async () => {
  const envKeys = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'];
  const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.TWILIO_ACCOUNT_SID = 'test-account';
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    process.env.TWILIO_WHATSAPP_FROM = '+14155238886';
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      const params = new URLSearchParams(options.body);
      assert.equal(params.get('From'), 'whatsapp:+14155238886');
      assert.equal(params.get('To'), 'whatsapp:+393331234567');
      assert.equal(params.get('Body'), 'Richiesta integrazioni di prova');
      return { ok: true, json: async () => ({ sid: 'mock-message', status: 'queued' }) };
    };
    const res = responseMock();
    await handler({ method: 'POST', body: { to: 'whatsapp:+39 3331234567', message: 'Richiesta integrazioni di prova' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.success, true);
    assert.equal(calls, 1);

    const invalidRes = responseMock();
    await handler({ method: 'POST', body: { to: 'abc', message: 'Test' } }, invalidRes);
    assert.equal(invalidRes.statusCode, 400);
    assert.equal(calls, 1);

    process.env.TWILIO_WHATSAPP_FROM = 'sms:+14155238886';
    const invalidFromRes = responseMock();
    await handler({ method: 'POST', body: { to: '+393331234567', message: 'Test' } }, invalidFromRes);
    assert.equal(invalidFromRes.statusCode, 503);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  }
});
