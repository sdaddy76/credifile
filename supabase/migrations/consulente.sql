-- ═══════════════════════════════════════════════════════
-- RUOLO CONSULENTE — Migration
-- Eseguire nel Supabase Dashboard SQL Editor
-- ═══════════════════════════════════════════════════════

-- 1. Inviti autonomi consulente (link pubblico)
CREATE TABLE IF NOT EXISTS consulente_invites (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT    NOT NULL UNIQUE,
  email       TEXT    NOT NULL,
  invited_by  UUID    REFERENCES auth.users(id) ON DELETE SET NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Clienti del consulente (separati dalle pratiche)
CREATE TABLE IF NOT EXISTS consulente_clients (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  consulente_id    UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ragione_sociale  TEXT    NOT NULL,
  partita_iva      TEXT,
  codice_fiscale   TEXT,
  email            TEXT,
  telefono         TEXT,
  indirizzo        TEXT,
  codice_ateco     TEXT,
  settore          TEXT,
  note             TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Report di bancabilità generati
CREATE TABLE IF NOT EXISTS consulente_reports (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  consulente_id       UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID    REFERENCES consulente_clients(id) ON DELETE SET NULL,
  client_name         TEXT    NOT NULL,
  client_email        TEXT,
  anno_bilancio       INTEGER,
  kpi_data            JSONB,   -- KPI azienda calcolati
  kpi_scores          JSONB,   -- score 0-100 per ogni KPI
  benchmark_data      JSONB,   -- KPI settore (benchmark Mediobanca/ISTAT)
  ai_suggestions      JSONB,   -- suggerimenti AI per i 3 KPI peggiori
  indice_bancabilita  NUMERIC(5,2),
  top3_kpi            JSONB,
  bottom3_kpi         JSONB,
  report_pdf_path     TEXT,    -- path in Supabase Storage
  sent_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE consulente_invites  ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulente_clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE consulente_reports  ENABLE ROW LEVEL SECURITY;

-- consulente_invites: solo service role scrive, autenticato legge il proprio
CREATE POLICY "service_all_invites"  ON consulente_invites FOR ALL  USING (true) WITH CHECK (true);

-- consulente_clients: consulente vede/modifica solo i propri
CREATE POLICY "own_clients_select" ON consulente_clients FOR SELECT  TO authenticated USING (consulente_id = auth.uid());
CREATE POLICY "own_clients_insert" ON consulente_clients FOR INSERT  TO authenticated WITH CHECK (consulente_id = auth.uid());
CREATE POLICY "own_clients_update" ON consulente_clients FOR UPDATE  TO authenticated USING (consulente_id = auth.uid());
CREATE POLICY "own_clients_delete" ON consulente_clients FOR DELETE  TO authenticated USING (consulente_id = auth.uid());

-- consulente_reports: consulente vede/modifica solo i propri
CREATE POLICY "own_reports_select" ON consulente_reports FOR SELECT  TO authenticated USING (consulente_id = auth.uid());
CREATE POLICY "own_reports_insert" ON consulente_reports FOR INSERT  TO authenticated WITH CHECK (consulente_id = auth.uid());
CREATE POLICY "own_reports_update" ON consulente_reports FOR UPDATE  TO authenticated USING (consulente_id = auth.uid());
CREATE POLICY "own_reports_delete" ON consulente_reports FOR DELETE  TO authenticated USING (consulente_id = auth.uid());
