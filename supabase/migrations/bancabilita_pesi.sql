
-- Tabella pesi KPI per calcolo indice di bancabilità
-- banca_id NULL = pesi globali di default
CREATE TABLE IF NOT EXISTS bancabilita_pesi (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  banca_id        UUID    REFERENCES banks(id) ON DELETE CASCADE,
  kpi_key         TEXT    NOT NULL,
  kpi_area        TEXT    NOT NULL,
  kpi_label       TEXT    NOT NULL,
  peso            NUMERIC(5,2) NOT NULL DEFAULT 0,   -- peso % 0-100
  soglia_ottimo   NUMERIC(15,4),  -- valore → score 100
  soglia_suff     NUMERIC(15,4),  -- valore → score 55
  soglia_critica  NUMERIC(15,4),  -- valore → score 10
  inverso         BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE = valore più basso = meglio
  attivo          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(banca_id, kpi_key)
);

-- RLS
ALTER TABLE bancabilita_pesi ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read bancabilita_pesi"
  ON bancabilita_pesi FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert bancabilita_pesi"
  ON bancabilita_pesi FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update bancabilita_pesi"
  ON bancabilita_pesi FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete bancabilita_pesi"
  ON bancabilita_pesi FOR DELETE TO authenticated USING (true);

-- Pesi globali di default (banca_id NULL, somma pesi = 100)
INSERT INTO bancabilita_pesi
  (banca_id, kpi_key, kpi_area, kpi_label, peso, soglia_ottimo, soglia_suff, soglia_critica, inverso)
VALUES
  (NULL, 'dscr',         'copertura',     'DSCR',               30, 1.25,  1.0,  0.80, FALSE),
  (NULL, 'pfn_ebitda',   'indebitamento', 'PFN / EBITDA',       20, 3.0,   5.0,  7.0,  TRUE),
  (NULL, 'ebitda_margin','redditivita',   'EBITDA Margin (%)',   15, 15.0,  5.0,  0.0,  FALSE),
  (NULL, 'current_ratio','liquidita',     'Current Ratio',       10, 1.50,  1.0,  0.80, FALSE),
  (NULL, 'roe',          'redditivita',   'ROE (%)',             10, 10.0,  3.0,  0.0,  FALSE),
  (NULL, 'leverage',     'solidita',      'Leverage',            10, 2.0,   4.0,  6.0,  TRUE),
  (NULL, 'pfn_pn',       'indebitamento', 'PFN / PN',            5,  1.0,   3.0,  5.0,  TRUE)
ON CONFLICT (banca_id, kpi_key) DO NOTHING;
