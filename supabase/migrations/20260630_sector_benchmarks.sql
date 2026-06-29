-- Migration: sector_benchmarks
-- Tabella per benchmark settoriali usati nel report del consulente
-- Aggiornabile mensile via Edge Function update-sector-benchmarks

CREATE TABLE IF NOT EXISTS sector_benchmarks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ateco_macro     TEXT NOT NULL UNIQUE,
  ateco_label     TEXT NOT NULL,
  kpi_data        JSONB NOT NULL,
  commento_settore TEXT,
  fonte           TEXT DEFAULT 'Mediobanca/Banca d''Italia',
  aggiornato_il   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Popolamento iniziale dai valori hardcoded di AnalisiFinanziariaTab
INSERT INTO sector_benchmarks (ateco_macro, ateco_label, kpi_data, aggiornato_il) VALUES
  ('commercio', 'Commercio (G)', '{"Current Ratio":1.2,"Quick Ratio":0.7,"Debt/Equity":2.2,"Leverage":3.2,"PN / Totale Attivo":31,"ROE":9,"ROI":6,"ROS":2,"EBITDA Margin":5,"PFN / EBITDA":3.8,"DSO":65,"Interest Coverage":2.8,"DSCR":1.15}', CURRENT_DATE),
  ('manifattura', 'Manifattura (C)', '{"Current Ratio":1.4,"Quick Ratio":1.0,"Debt/Equity":1.8,"Leverage":2.8,"PN / Totale Attivo":36,"ROE":8,"ROI":5,"ROS":4,"EBITDA Margin":9,"PFN / EBITDA":3.2,"DSO":85,"Interest Coverage":3.5,"DSCR":1.2}', CURRENT_DATE),
  ('costruzioni', 'Costruzioni (F)', '{"Current Ratio":1.3,"Quick Ratio":1.1,"Debt/Equity":3.0,"Leverage":4.0,"PN / Totale Attivo":25,"ROE":10,"ROI":5,"ROS":3,"EBITDA Margin":8,"PFN / EBITDA":4.5,"DSO":110,"Interest Coverage":2.2,"DSCR":1.1}', CURRENT_DATE),
  ('ict', 'ICT / Comunicazioni (J)', '{"Current Ratio":1.8,"Quick Ratio":1.7,"Debt/Equity":0.8,"Leverage":1.8,"PN / Totale Attivo":55,"ROE":14,"ROI":10,"ROS":10,"EBITDA Margin":18,"PFN / EBITDA":2.0,"DSO":65,"Interest Coverage":5.5,"DSCR":1.4}', CURRENT_DATE),
  ('professionali', 'Servizi Professionali (M)', '{"Current Ratio":1.6,"Quick Ratio":1.5,"Debt/Equity":1.0,"Leverage":2.0,"PN / Totale Attivo":50,"ROE":12,"ROI":8,"ROS":8,"EBITDA Margin":15,"PFN / EBITDA":2.0,"DSO":80,"Interest Coverage":5.0,"DSCR":1.35}', CURRENT_DATE),
  ('trasporti', 'Trasporti (H)', '{"Current Ratio":1.1,"Quick Ratio":1.0,"Debt/Equity":2.5,"Leverage":3.5,"PN / Totale Attivo":29,"ROE":7,"ROI":4,"ROS":3,"EBITDA Margin":10,"PFN / EBITDA":5.0,"DSO":55,"Interest Coverage":2.2,"DSCR":1.1}', CURRENT_DATE),
  ('ristorazione', 'Ristorazione/Alloggio (I)', '{"Current Ratio":0.9,"Quick Ratio":0.8,"Debt/Equity":2.8,"Leverage":3.8,"PN / Totale Attivo":26,"ROE":6,"ROI":4,"ROS":5,"EBITDA Margin":14,"PFN / EBITDA":5.5,"DSO":30,"Interest Coverage":2.0,"DSCR":1.05}', CURRENT_DATE),
  ('agricoltura', 'Agricoltura (A)', '{"Current Ratio":1.3,"Quick Ratio":0.8,"Debt/Equity":1.5,"Leverage":2.5,"PN / Totale Attivo":40,"ROE":5,"ROI":3,"ROS":5,"EBITDA Margin":12,"PFN / EBITDA":4.5,"DSO":60,"Interest Coverage":2.8,"DSCR":1.1}', CURRENT_DATE),
  ('immobiliare', 'Immobiliare (L)', '{"Current Ratio":1.1,"Quick Ratio":0.9,"Debt/Equity":2.0,"Leverage":3.0,"PN / Totale Attivo":33,"ROE":5,"ROI":3,"ROS":20,"EBITDA Margin":35,"PFN / EBITDA":8.0,"DSO":40,"Interest Coverage":2.0,"DSCR":1.1}', CURRENT_DATE),
  ('sanita', 'Sanità / Sociale (Q)', '{"Current Ratio":1.4,"Quick Ratio":1.3,"Debt/Equity":1.2,"Leverage":2.2,"PN / Totale Attivo":45,"ROE":8,"ROI":5,"ROS":6,"EBITDA Margin":12,"PFN / EBITDA":2.5,"DSO":70,"Interest Coverage":4.0,"DSCR":1.3}', CURRENT_DATE),
  ('default', 'Media PMI Italiane', '{"Current Ratio":1.3,"Quick Ratio":1.0,"Debt/Equity":2.0,"Leverage":3.0,"PN / Totale Attivo":33,"ROE":8,"ROI":5,"ROS":4,"EBITDA Margin":10,"PFN / EBITDA":3.5,"DSO":75,"Interest Coverage":3.0,"DSCR":1.2}', CURRENT_DATE)
ON CONFLICT (ateco_macro) DO NOTHING;

ALTER TABLE sector_benchmarks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sector_benchmarks' AND policyname = 'public_read_benchmarks'
  ) THEN
    CREATE POLICY "public_read_benchmarks" ON sector_benchmarks FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'sector_benchmarks' AND policyname = 'service_write_benchmarks'
  ) THEN
    CREATE POLICY "service_write_benchmarks" ON sector_benchmarks FOR ALL USING (auth.role() = 'service_role');
  END IF;
END
$$;
