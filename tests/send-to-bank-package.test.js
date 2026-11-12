import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDocumentSender } from '../api/send-to-bank.js';

test('mittente documentale: daddino.com sostituisce il dominio precedente', () => {
  assert.equal(resolveDocumentSender({}), 'Credifile <docflow@daddino.com>');
  assert.equal(resolveDocumentSender({ FROM_EMAIL: 'Credifile <docflow@stedasrls.it>' }), 'Credifile <docflow@daddino.com>');
  assert.equal(resolveDocumentSender({ FROM_EMAIL: 'pratiche.credifile@gmail.com' }), 'Credifile <docflow@daddino.com>');
  assert.equal(resolveDocumentSender({ FROM_EMAIL: 'Credifile <posta@daddino.com>' }), 'Credifile <posta@daddino.com>');
  assert.equal(resolveDocumentSender({
    DOCUMENT_FROM_EMAIL: 'Credifile <documenti@daddino.com>',
    FROM_EMAIL: 'Credifile <docflow@stedasrls.it>',
  }), 'Credifile <documenti@daddino.com>');
  for (const invalid of [
    'Credifile <posta@daddino.com.evil.invalid>',
    'Credifile <posta@daddino.com>\r\nBcc: external@example.invalid',
    'Credifile <posta@daddino.com',
    'posta@daddino.com>',
  ]) {
    assert.equal(resolveDocumentSender({ DOCUMENT_FROM_EMAIL: invalid }), 'Credifile <docflow@daddino.com>');
  }
});

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
  const defaultProfiles = [
    { id: 'secretary-test', ruolo: 'supervisore_segreteria', nome: 'Segreteria prova', email: 'secretary@example.invalid' },
    { id: 'stefano-test', ruolo: 'super_admin', nome: "Stefano D'Addino", email: 'stefano@daddino.com' },
  ];

  async function send(body, options = {}) {
    const emails = [];
    const writes = [];
    const reads = [];
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
      reads.push({ path, search: url.searchParams });
      if (path.endsWith('/admin_profiles')) {
        if (url.searchParams.get('ruolo') === 'eq.super_admin') {
          if (options.replyProfilesError) return json({ message: 'database unavailable' }, false);
          return json(options.replyProfiles ?? defaultProfiles);
        }
        return json([{ id: 'user-test', ruolo: 'super_admin', nome: 'Test', email: 'admin@example.invalid' }]);
      }
      if (path.endsWith('/segreteria_agent_assignments')) {
        if (options.replyAssignmentsError) return json({ message: 'database unavailable' }, false);
        return json(options.secretaryAssignments ?? []);
      }
      if (path.endsWith('/practices')) {
        return json([{
          id: 'practice-test',
          numero_pratica: 'TEST-ONLY',
          clients: { id: 'client-test', ragione_sociale: 'Società di prova' },
          agent: options.agent ?? null,
          assigned_to: options.agent?.id ?? null,
          created_by: options.createdBy ?? null,
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
    return { res, emails, writes, reads };
  }

  try {
    await t.test('banca, collaboratore e archivio ricevono lo stesso contenuto', async () => {
      const bank = await send({});
      const copy = await send({ copy_only: true, copy_to: 'collaborator@example.invalid' });
      assert.equal(bank.res.statusCode, 200);
      assert.equal(copy.res.statusCode, 200);
      assert.equal(bank.emails.length, 2);
      assert.equal(copy.emails.length, 2);
      assert.equal(copy.emails[0].from, 'Credifile <docflow@daddino.com>');
      assert.equal(copy.emails[1].from, copy.emails[0].from);
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

    await t.test('invio forzato senza relazione: trasmette i documenti senza allegarla', async () => {
      const result = await send({ force_without_relation: true }, { missingRelation: true });
      assert.equal(result.res.statusCode, 200);
      assert.equal(result.emails.length, 2);
      assert.match(result.emails[0].html, /visura\.pdf/);
      assert.doesNotMatch(result.emails[0].html, /Relazione Commerciale/);
      assert.equal(result.res.payload.relation_linked, false);
      const activity = result.writes.find(write => write.path.endsWith('/practice_activity_log'));
      assert.equal(activity.data.metadata.relazione_forzatamente_esclusa, true);
    });

    await t.test('invio normale senza relazione resta bloccato prima dell’invio', async () => {
      const result = await send({}, { missingRelation: true });
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

    await t.test('risposte: agente prioritario per banca, collaboratore, integrazioni e archivio', async () => {
      for (const body of [
        {},
        { copy_only: true, copy_to: 'collaborator@example.invalid' },
        { integration_request_id: 'integration-test' },
      ]) {
        const result = await send(body, {
          agent: { id: 'agent-test', nome: 'Agente <Prova>', email: ' agent@example.invalid ' },
          replyProfilesError: true, // Il fallback non deve essere consultato.
        });
        assert.equal(result.res.statusCode, 200);
        assert.equal(result.res.payload.reply_to, 'agent@example.invalid');
        assert.equal(result.res.payload.reply_to_role, 'agente');
        assert.equal(result.emails.length, 2);
        for (const email of result.emails) {
          assert.equal(email.reply_to, 'agent@example.invalid');
          assert.match(email.html, /Referente per le risposte \(Agente\)/);
          assert.match(email.html, /Agente &lt;Prova&gt;/);
        }
      }
    });

    await t.test('senza agente usa sempre Stefano, non la segreteria o il superadmin che invia', async () => {
      for (const body of [
        {},
        { copy_only: true, copy_to: 'collaborator@example.invalid' },
        { integration_request_id: 'integration-test' },
      ]) {
        const result = await send(body);
        assert.equal(result.res.statusCode, 200);
        assert.equal(result.res.payload.reply_to_role, 'super_admin');
        assert.ok(result.emails.every(email => email.reply_to === 'stefano@daddino.com'));
        assert.match(result.emails[0].html, /Referente per le risposte \(Superadmin\)/);
        const activity = result.writes.find(write => write.path.endsWith('/practice_activity_log'));
        assert.equal(activity.data.metadata.reply_to, 'stefano@daddino.com');
        assert.equal(activity.data.metadata.reply_to_profile_id, 'stefano-test');
      }
    });

    await t.test('agente senza email: usa Stefano anche se c’è una segreteria assegnata', async () => {
      const result = await send({}, {
        agent: { id: 'agent-test', email: ' ' },
        replyProfiles: [
          ...defaultProfiles,
          { id: 'assigned-secretary', ruolo: 'supervisore_segreteria', email: 'assigned@example.invalid' },
        ],
        secretaryAssignments: [{ segreteria_user_id: 'assigned-secretary' }],
      });
      assert.equal(result.res.statusCode, 200);
      assert.ok(result.emails.every(email => email.reply_to === 'stefano@daddino.com'));
      assert.equal(result.reads.some(read => read.path.endsWith('/segreteria_agent_assignments')), false);
    });

    await t.test('non sceglie la segreteria che ha creato la pratica come referente implicito', async () => {
      const result = await send({}, {
        createdBy: 'creator-secretary',
        replyProfiles: [
          ...defaultProfiles,
          { id: 'creator-secretary', ruolo: 'supervisore_segreteria', email: 'creator@example.invalid' },
        ],
      });
      assert.equal(result.res.statusCode, 200);
      assert.equal(result.emails[0].reply_to, 'stefano@daddino.com');
    });

    await t.test('senza agente valido sceglie Stefano, anche se ci sono altri superadmin', async () => {
      for (const invalid of [null, '', 'non-valida', 'a@example.invalid,external@example.invalid', 'a@example.invalid\r\nBcc: external@example.invalid']) {
        const result = await send({}, {
          agent: { id: 'agent-test', email: invalid },
          replyProfiles: [
            { id: 'invalid-secretary', ruolo: 'supervisore_segreteria', email: invalid },
            { id: 'valid-admin', ruolo: 'super_admin', nome: 'Altro amministratore', email: ' admin@example.invalid ' },
            { id: 'stefano-test', ruolo: 'super_admin', nome: "Stefano D'Addino", email: ' stefano@daddino.com ' },
          ],
        });
        assert.equal(result.res.statusCode, 200);
        assert.equal(result.res.payload.reply_to_role, 'super_admin');
        assert.ok(result.emails.every(email => email.reply_to === 'stefano@daddino.com'));
        assert.match(result.emails[0].html, /Referente per le risposte \(Superadmin\)/);
      }
    });

    await t.test('se il profilo Stefano manca usa il recapito predefinito verificato', async () => {
      const result = await send({}, { replyProfiles: [] });
      assert.equal(result.res.statusCode, 200);
      assert.equal(result.emails[0].reply_to, 'stefano@daddino.com');
    });

    await t.test('errore di lettura referenti o associazioni: nessun fallback silenzioso', async () => {
      for (const options of [
        { replyProfilesError: true },
      ]) {
        const result = await send({}, options);
        assert.equal(result.res.statusCode, 502);
        assert.match(result.res.payload.error, /Impossibile verificare il destinatario delle risposte/);
        assert.equal(result.emails.length, 0);
        assert.equal(result.writes.length, 0);
      }
    });
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});
