import assert from 'node:assert/strict';
import test from 'node:test';

const financingRow = {
  tipologia: 'Mutuo',
  banca_finanziaria: 'Istituto <Prova>',
  importo_iniziale: 50000,
  rata: 650,
  debito_residuo: 39000,
  stato_rapporto: 'attivo',
  data_riferimento: '2026-11-05',
};

function responseMock() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('pacchetto documentale e situazione finanziamenti, senza servizi reali', async t => {
  const previousFetch = globalThis.fetch;
  const envKeys = ['SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
  process.env.RESEND_API_KEY = 'test-email';
  const { default: handler } = await import('../api/send-to-bank.js?package-test');

  async function send(body, options = {}) {
    const emails = [];
    const writes = [];
    const relation = {
      id: 'relation-test',
      bank_id: 'bank-test',
      pdf_url: 'https://example.invalid/relation.pdf',
      risposte: { __selected_kpi_keys: [], __bank_positive_only: 'true' },
    };
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input);
      const path = url.pathname;
      const json = (data, ok = true) => ({ ok, json: async () => data });
      if (url.hostname === 'api.resend.com') {
        emails.push(JSON.parse(init.body));
        return json({ id: `mock-email-${emails.length}` });
      }
      if (path === '/auth/v1/user') return json({ id: 'user-test' });
      if (path.startsWith('/storage/')) {
        return json({ signedURL: '/object/sign/practice-files/test.pdf?token=mock' });
      }
      if (init.method && init.method !== 'GET') {
        writes.push({ path, method: init.method, data: JSON.parse(init.body) });
        return json([]);
      }
      if (path.endsWith('/admin_profiles')) return json([{ id: 'user-test', ruolo: 'super_admin', nome: 'Test' }]);
      if (path.endsWith('/practices')) {
        return json([{
          id: 'practice-test',
          numero_pratica: 'TEST-ONLY',
          clients: { id: 'client-test', ragione_sociale: 'Società di prova' },
        }]);
      }
      if (path.endsWith('/practice_banks')) {
        return json([{
          id: 'assignment-test',
          banks: { nome: 'Banca prova', email: options.missingBankEmail ? null : 'bank@example.invalid' },
        }]);
      }
      if (path.endsWith('/relazioni_commerciali')) return json(options.missingRelation ? [] : [relation]);
      if (path.endsWith('/uploaded_files')) {
        return json([{
          id: 'file-test',
          nome_file: 'visura.pdf',
          storage_path: 'practice-test/visura.pdf',
          practice_documents: { id: 'document-test', nome: 'Visura' },
        }]);
      }
      if (path.endsWith('/practice_integration_requests')) {
        return json([{ id: 'integration-test', practice_bank_id: 'assignment-test' }]);
      }
      if (path.endsWith('/practice_documents') && url.searchParams.has('integration_request_id')) {
        return json([{
          id: 'document-integration',
          nome: 'Bilancio aggiornato',
          uploaded_files: [{
            id: 'file-integration',
            nome_file: 'bilancio.pdf',
            storage_path: 'practice-test/bilancio.pdf',
          }],
        }]);
      }
      if (path.endsWith('/client_financing')) {
        if (options.financingError) return json({ message: 'database unavailable' }, false);
        return json(options.emptyFinancing ? [] : [financingRow]);
      }
      return json([]);
    };
    const res = responseMock();
    await handler({
      method: 'POST',
      headers: { authorization: 'Bearer test-session' },
      body: { practice_id: 'practice-test', bank_id: 'bank-test', ...body },
    }, res);
    return { res, emails, writes };
  }

  try {
    await t.test('banca, collaboratore e archivio ricevono lo stesso contenuto', async () => {
      const bank = await send({});
      const copy = await send({ copy_only: true, copy_to: 'collaborator@example.invalid' });
      assert.equal(bank.res.statusCode, 200);
      assert.equal(copy.res.statusCode, 200);
      assert.equal(bank.emails.length, 2);
      assert.equal(copy.emails.length, 2);
      const withoutTokens = html => html.replace(/token=[a-f0-9]{48}/g, 'token=TEST');
      assert.equal(withoutTokens(bank.emails[0].html), withoutTokens(copy.emails[0].html));
      assert.equal(copy.emails[0].html, copy.emails[1].html);
      assert.match(copy.emails[0].html, /Relazione Commerciale/);
      assert.match(copy.emails[0].html, /Situazione finanziamenti/);
      assert.match(copy.emails[0].html, /Istituto &lt;Prova&gt;/);
      assert.match(copy.emails[0].html, /39\.000/);
      assert.equal(copy.res.payload.relation_linked, true);
      assert.equal(copy.res.payload.financing_rows, 1);
      assert.equal(copy.res.payload.bank_status_changed, false);
      assert.equal(copy.writes.some(write => write.path.endsWith('/practice_banks') && write.method === 'PATCH'), false);
      const activity = copy.writes.find(write => write.path.endsWith('/practice_activity_log'));
      assert.equal(activity.data.metadata.situazione_finanziamenti_inclusa, true);
      assert.equal(activity.data.metadata.finanziamenti_inclusi, 1);
    });

    await t.test('stessi controlli sulla relazione anche per il collaboratore', async () => {
      const result = await send({ copy_only: true, copy_to: 'collaborator@example.invalid' }, { missingRelation: true });
      assert.equal(result.res.statusCode, 422);
      assert.equal(result.emails.length, 0);
    });

    await t.test('la copia non richiede un indirizzo principale banca', async () => {
      const result = await send({ copy_only: true, copy_to: 'collaborator@example.invalid' }, { missingBankEmail: true });
      assert.equal(result.res.statusCode, 200);
      assert.deepEqual(result.emails[0].to, ['collaborator@example.invalid']);
    });

    await t.test('integrazioni: solo file del ciclo più situazione finanziamenti', async () => {
      const result = await send({ integration_request_id: 'integration-test' });
      assert.equal(result.res.statusCode, 200);
      assert.match(result.emails[0].html, /bilancio\.pdf/);
      assert.doesNotMatch(result.emails[0].html, /visura\.pdf|Relazione Commerciale/);
      assert.match(result.emails[0].html, /Situazione finanziamenti/);
    });

    await t.test('errore lettura finanziamenti blocca tutte le email', async () => {
      const result = await send({ copy_only: true, copy_to: 'collaborator@example.invalid' }, { financingError: true });
      assert.equal(result.res.statusCode, 502);
      assert.match(result.res.payload.error, /Nessuna email inviata/);
      assert.equal(result.emails.length, 0);
    });

    await t.test('assenza dati non viene presentata come assenza debiti', async () => {
      const result = await send({}, { emptyFinancing: true });
      assert.equal(result.res.statusCode, 200);
      assert.match(result.emails[0].html, /Questo non attesta l’assenza di finanziamenti/);
      assert.equal(result.res.payload.financing_rows, 0);
    });
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});
