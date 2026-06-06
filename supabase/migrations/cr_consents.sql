-- ═══════════════════════════════════════════════════════
-- CONSENSO CENTRALE RISCHI — Migration
-- Eseguire nel Supabase Dashboard SQL Editor
-- ═══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS consulente_cr_consents (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  consulente_id   UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       UUID    REFERENCES consulente_clients(id) ON DELETE SET NULL,
  client_name     TEXT    NOT NULL,
  client_email    TEXT    NOT NULL,
  consulente_nome TEXT    NOT NULL,
  token           TEXT    NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  status          TEXT    NOT NULL DEFAULT 'pending', -- pending / accepted / declined
  ip_address      TEXT,
  user_agent      TEXT,
  consent_text    TEXT,   -- testo esatto del consenso accettato
  accepted_at     TIMESTAMPTZ,
  declined_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE consulente_cr_consents ENABLE ROW LEVEL SECURITY;

-- Il consulente vede solo i propri consensi
CREATE POLICY "own_consents_select" ON consulente_cr_consents FOR SELECT TO authenticated USING (consulente_id = auth.uid());
CREATE POLICY "own_consents_insert" ON consulente_cr_consents FOR INSERT TO authenticated WITH CHECK (consulente_id = auth.uid());
CREATE POLICY "own_consents_update" ON consulente_cr_consents FOR UPDATE TO authenticated USING (consulente_id = auth.uid());

-- La pagina pubblica può leggere/aggiornare per token (via service role in edge function)
CREATE POLICY "service_all_consents" ON consulente_cr_consents FOR ALL USING (true) WITH CHECK (true);
