-- Motore deterministico di anomalie di bilancio.
-- Le segnalazioni sono indicatori da verificare e non costituiscono prova di frode.

ALTER TABLE bilanci_kpi
  ADD COLUMN IF NOT EXISTS anomaly_analysis JSONB,
  ADD COLUMN IF NOT EXISTS anomaly_score NUMERIC,
  ADD COLUMN IF NOT EXISTS anomaly_level TEXT,
  ADD COLUMN IF NOT EXISTS anomaly_engine_version TEXT;

ALTER TABLE consulente_reports
  ADD COLUMN IF NOT EXISTS anomaly_analysis JSONB,
  ADD COLUMN IF NOT EXISTS anomaly_score NUMERIC,
  ADD COLUMN IF NOT EXISTS anomaly_level TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bilanci_kpi_anomaly_level_check'
  ) THEN
    ALTER TABLE bilanci_kpi
      ADD CONSTRAINT bilanci_kpi_anomaly_level_check
      CHECK (anomaly_level IS NULL OR anomaly_level IN ('basso', 'attenzione', 'elevato', 'critico'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'consulente_reports_anomaly_level_check'
  ) THEN
    ALTER TABLE consulente_reports
      ADD CONSTRAINT consulente_reports_anomaly_level_check
      CHECK (anomaly_level IS NULL OR anomaly_level IN ('basso', 'attenzione', 'elevato', 'critico'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS bilanci_kpi_anomaly_level_idx
  ON bilanci_kpi (practice_id, anomaly_level);
