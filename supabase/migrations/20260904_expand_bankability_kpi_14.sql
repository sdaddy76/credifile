-- Porta l'indice di bancabilità da 7 a 14 KPI.
-- I pesi globali sommano a 100 e sono condivisi tra pratiche e report consulente.

CREATE TABLE IF NOT EXISTS sector_benchmarks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ateco_macro      TEXT NOT NULL UNIQUE,
  ateco_label      TEXT NOT NULL,
  kpi_data         JSONB NOT NULL,
  commento_settore TEXT,
  fonte            TEXT DEFAULT 'Mediobanca/Banca d''Italia',
  aggiornato_il    DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sector_benchmarks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'sector_benchmarks'
      AND policyname = 'public_read_benchmarks'
  ) THEN
    CREATE POLICY "public_read_benchmarks"
      ON sector_benchmarks
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'sector_benchmarks'
      AND policyname = 'service_write_benchmarks'
  ) THEN
    CREATE POLICY "service_write_benchmarks"
      ON sector_benchmarks
      FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END
$$;

WITH ranked_defaults AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY kpi_key
      ORDER BY created_at ASC NULLS LAST, id
    ) AS row_number
  FROM bancabilita_pesi
  WHERE banca_id IS NULL
)
DELETE FROM bancabilita_pesi
WHERE id IN (
  SELECT id
  FROM ranked_defaults
  WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS bancabilita_pesi_default_kpi_unique
  ON bancabilita_pesi (kpi_key)
  WHERE banca_id IS NULL;

INSERT INTO bancabilita_pesi
  (banca_id, kpi_key, kpi_area, kpi_label, peso, soglia_ottimo, soglia_suff, soglia_critica, inverso, attivo)
VALUES
  (NULL, 'dscr',               'copertura',     'DSCR',                    18, 1.25, 1.00, 0.80, FALSE, TRUE),
  (NULL, 'pfn_ebitda',         'indebitamento', 'PFN / EBITDA',            12, 3.00, 5.00, 7.00, TRUE,  TRUE),
  (NULL, 'ebitda_margin',      'redditivita',   'EBITDA Margin (%)',       10, 15.0, 5.00, 0.00, FALSE, TRUE),
  (NULL, 'current_ratio',      'liquidita',     'Current Ratio',            7, 1.50, 1.00, 0.80, FALSE, TRUE),
  (NULL, 'quick_ratio',        'liquidita',     'Quick Ratio',              5, 1.00, 0.80, 0.50, FALSE, TRUE),
  (NULL, 'roe',                'redditivita',   'ROE (%)',                  6, 10.0, 3.00, 0.00, FALSE, TRUE),
  (NULL, 'roi',                'redditivita',   'ROI (%)',                  6, 8.00, 3.00, 0.00, FALSE, TRUE),
  (NULL, 'ros',                'redditivita',   'ROS (%)',                  5, 8.00, 3.00, 0.00, FALSE, TRUE),
  (NULL, 'leverage',           'solidita',      'Leverage',                 7, 2.50, 4.00, 6.00, TRUE,  TRUE),
  (NULL, 'pfn_pn',             'indebitamento', 'PFN / PN',                 6, 1.00, 2.00, 4.00, TRUE,  TRUE),
  (NULL, 'debt_equity',        'solidita',      'Debt/Equity',              6, 1.50, 3.00, 5.00, TRUE,  TRUE),
  (NULL, 'pn_su_ta',           'solidita',      'PN / Totale Attivo (%)',   5, 40.0, 25.0, 15.0, FALSE, TRUE),
  (NULL, 'dso',                'efficienza',    'DSO (giorni)',             3, 60.0, 90.0, 120.0, TRUE,  TRUE),
  (NULL, 'interest_coverage',  'copertura',     'Interest Coverage',        4, 3.00, 1.50, 1.00, FALSE, TRUE)
ON CONFLICT (kpi_key) WHERE banca_id IS NULL
DO UPDATE SET
  kpi_area = EXCLUDED.kpi_area,
  kpi_label = EXCLUDED.kpi_label,
  peso = EXCLUDED.peso,
  soglia_ottimo = EXCLUDED.soglia_ottimo,
  soglia_suff = EXCLUDED.soglia_suff,
  soglia_critica = EXCLUDED.soglia_critica,
  inverso = EXCLUDED.inverso,
  attivo = TRUE,
  updated_at = NOW();

INSERT INTO sector_benchmarks (ateco_macro, ateco_label, kpi_data, aggiornato_il)
VALUES
  ('agricoltura', 'Agricoltura (A)', '{"Current Ratio":1.3,"Quick Ratio":0.8,"Debt/Equity":1.5,"Leverage":2.5,"PN / Totale Attivo":40,"Grado Indebitamento":0.9,"ROE":5,"ROI":3,"ROS":5,"EBITDA Margin":12,"PFN / EBITDA":4.5,"PFN / PN":1.2,"DSO":60,"Interest Coverage":2.8,"DSCR":1.1}', CURRENT_DATE),
  ('estrazione', 'Estrazione (B)', '{"Current Ratio":1.4,"Quick Ratio":1.1,"Debt/Equity":1.8,"Leverage":2.8,"PN / Totale Attivo":36,"Grado Indebitamento":1.0,"ROE":7,"ROI":5,"ROS":8,"EBITDA Margin":18,"PFN / EBITDA":3.8,"PFN / PN":1.4,"DSO":70,"Interest Coverage":3.5,"DSCR":1.2}', CURRENT_DATE),
  ('manifattura', 'Manifattura (C)', '{"Current Ratio":1.4,"Quick Ratio":1.0,"Debt/Equity":1.8,"Leverage":2.8,"PN / Totale Attivo":36,"Grado Indebitamento":1.1,"ROE":8,"ROI":5,"ROS":4,"EBITDA Margin":9,"PFN / EBITDA":3.2,"PFN / PN":1.2,"DSO":85,"Interest Coverage":3.5,"DSCR":1.2}', CURRENT_DATE),
  ('energia', 'Energia (D)', '{"Current Ratio":1.2,"Quick Ratio":1.1,"Debt/Equity":2.5,"Leverage":3.5,"PN / Totale Attivo":29,"Grado Indebitamento":1.5,"ROE":9,"ROI":5,"ROS":6,"EBITDA Margin":20,"PFN / EBITDA":5.0,"PFN / PN":1.8,"DSO":80,"Interest Coverage":2.5,"DSCR":1.1}', CURRENT_DATE),
  ('acqua_rifiuti', 'Acqua/Rifiuti (E)', '{"Current Ratio":1.2,"Quick Ratio":1.0,"Debt/Equity":2.2,"Leverage":3.2,"PN / Totale Attivo":31,"Grado Indebitamento":1.2,"ROE":7,"ROI":4,"ROS":5,"EBITDA Margin":16,"PFN / EBITDA":4.5,"PFN / PN":1.5,"DSO":75,"Interest Coverage":2.8,"DSCR":1.1}', CURRENT_DATE),
  ('costruzioni', 'Costruzioni (F)', '{"Current Ratio":1.3,"Quick Ratio":1.1,"Debt/Equity":3.0,"Leverage":4.0,"PN / Totale Attivo":25,"Grado Indebitamento":1.4,"ROE":10,"ROI":5,"ROS":3,"EBITDA Margin":8,"PFN / EBITDA":4.5,"PFN / PN":2.0,"DSO":110,"Interest Coverage":2.2,"DSCR":1.1}', CURRENT_DATE),
  ('commercio', 'Commercio (G)', '{"Current Ratio":1.2,"Quick Ratio":0.7,"Debt/Equity":2.2,"Leverage":3.2,"PN / Totale Attivo":31,"Grado Indebitamento":1.2,"ROE":9,"ROI":6,"ROS":2,"EBITDA Margin":5,"PFN / EBITDA":3.8,"PFN / PN":1.4,"DSO":65,"Interest Coverage":2.8,"DSCR":1.15}', CURRENT_DATE),
  ('trasporti', 'Trasporti (H)', '{"Current Ratio":1.1,"Quick Ratio":1.0,"Debt/Equity":2.5,"Leverage":3.5,"PN / Totale Attivo":29,"Grado Indebitamento":1.3,"ROE":7,"ROI":4,"ROS":3,"EBITDA Margin":10,"PFN / EBITDA":5.0,"PFN / PN":1.6,"DSO":55,"Interest Coverage":2.2,"DSCR":1.1}', CURRENT_DATE),
  ('ristorazione', 'Ristorazione/Alloggio (I)', '{"Current Ratio":0.9,"Quick Ratio":0.8,"Debt/Equity":2.8,"Leverage":3.8,"PN / Totale Attivo":26,"Grado Indebitamento":1.5,"ROE":6,"ROI":4,"ROS":5,"EBITDA Margin":14,"PFN / EBITDA":5.5,"PFN / PN":1.8,"DSO":30,"Interest Coverage":2.0,"DSCR":1.05}', CURRENT_DATE),
  ('ict', 'ICT / Comunicazioni (J)', '{"Current Ratio":1.8,"Quick Ratio":1.7,"Debt/Equity":0.8,"Leverage":1.8,"PN / Totale Attivo":55,"Grado Indebitamento":0.5,"ROE":14,"ROI":10,"ROS":10,"EBITDA Margin":18,"PFN / EBITDA":2.0,"PFN / PN":0.6,"DSO":65,"Interest Coverage":5.5,"DSCR":1.4}', CURRENT_DATE),
  ('finanza', 'Finanza / Assicurazioni (K)', '{"Current Ratio":1.5,"Quick Ratio":1.4,"Debt/Equity":4.0,"Leverage":5.0,"PN / Totale Attivo":20,"Grado Indebitamento":2.0,"ROE":10,"ROI":3,"ROS":15,"EBITDA Margin":20,"PFN / EBITDA":null,"PFN / PN":2.0,"DSO":45,"Interest Coverage":3.0,"DSCR":1.2}', CURRENT_DATE),
  ('immobiliare', 'Immobiliare (L)', '{"Current Ratio":1.1,"Quick Ratio":0.9,"Debt/Equity":2.0,"Leverage":3.0,"PN / Totale Attivo":33,"Grado Indebitamento":1.5,"ROE":5,"ROI":3,"ROS":20,"EBITDA Margin":35,"PFN / EBITDA":8.0,"PFN / PN":1.8,"DSO":40,"Interest Coverage":2.0,"DSCR":1.1}', CURRENT_DATE),
  ('professionali', 'Servizi Professionali (M)', '{"Current Ratio":1.6,"Quick Ratio":1.5,"Debt/Equity":1.0,"Leverage":2.0,"PN / Totale Attivo":50,"Grado Indebitamento":0.6,"ROE":12,"ROI":8,"ROS":8,"EBITDA Margin":15,"PFN / EBITDA":2.0,"PFN / PN":0.7,"DSO":80,"Interest Coverage":5.0,"DSCR":1.35}', CURRENT_DATE),
  ('amministrativi', 'Servizi Amministrativi (N)', '{"Current Ratio":1.3,"Quick Ratio":1.2,"Debt/Equity":1.5,"Leverage":2.5,"PN / Totale Attivo":40,"Grado Indebitamento":0.8,"ROE":10,"ROI":7,"ROS":5,"EBITDA Margin":10,"PFN / EBITDA":2.5,"PFN / PN":0.9,"DSO":55,"Interest Coverage":4.0,"DSCR":1.25}', CURRENT_DATE),
  ('sanita', 'Sanità / Sociale (Q)', '{"Current Ratio":1.4,"Quick Ratio":1.3,"Debt/Equity":1.2,"Leverage":2.2,"PN / Totale Attivo":45,"Grado Indebitamento":0.7,"ROE":8,"ROI":5,"ROS":6,"EBITDA Margin":12,"PFN / EBITDA":2.5,"PFN / PN":0.8,"DSO":70,"Interest Coverage":4.0,"DSCR":1.3}', CURRENT_DATE),
  ('default', 'Media PMI Italiane', '{"Current Ratio":1.3,"Quick Ratio":1.0,"Debt/Equity":2.0,"Leverage":3.0,"PN / Totale Attivo":33,"Grado Indebitamento":1.2,"ROE":8,"ROI":5,"ROS":4,"EBITDA Margin":10,"PFN / EBITDA":3.5,"PFN / PN":1.2,"DSO":75,"Interest Coverage":3.0,"DSCR":1.2}', CURRENT_DATE)
ON CONFLICT (ateco_macro)
DO UPDATE SET
  ateco_label = EXCLUDED.ateco_label,
  kpi_data = EXCLUDED.kpi_data,
  aggiornato_il = EXCLUDED.aggiornato_il;
