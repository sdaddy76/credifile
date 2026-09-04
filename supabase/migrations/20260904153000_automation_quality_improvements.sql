-- Automazione mensile benchmark, provenienza dati e qualità analisi.
-- Il controllo mensile non sovrascrive i KPI se la fonte numerica è assente,
-- incompleta o non valida.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

ALTER TABLE sector_benchmarks
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_dataset TEXT,
  ADD COLUMN IF NOT EXISTS source_version TEXT,
  ADD COLUMN IF NOT EXISTS source_published_at DATE,
  ADD COLUMN IF NOT EXISTS effective_period TEXT,
  ADD COLUMN IF NOT EXISTS data_hash TEXT,
  ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_commentary_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_update_status TEXT NOT NULL DEFAULT 'baseline';

COMMENT ON COLUMN sector_benchmarks.aggiornato_il IS
  'Data dell’ultimo aggiornamento numerico dei KPI. Non cambia quando viene aggiornato solo il commento.';
COMMENT ON COLUMN sector_benchmarks.last_checked_at IS
  'Data dell’ultimo controllo automatico della fonte, anche se non erano disponibili nuovi dati.';

UPDATE sector_benchmarks
SET
  source_dataset = COALESCE(source_dataset, 'Baseline Credifile da fonti aggregate'),
  source_version = COALESCE(source_version, 'baseline-2023'),
  effective_period = COALESCE(effective_period, '2023'),
  source_published_at = COALESCE(source_published_at, aggiornato_il),
  data_hash = COALESCE(
    data_hash,
    encode(extensions.digest(convert_to(kpi_data::TEXT, 'UTF8'), 'sha256'), 'hex')
  )
WHERE source_dataset IS NULL
   OR source_version IS NULL
   OR effective_period IS NULL
   OR source_published_at IS NULL
   OR data_hash IS NULL;

CREATE TABLE IF NOT EXISTS sector_benchmark_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benchmark_id UUID NOT NULL REFERENCES sector_benchmarks(id) ON DELETE CASCADE,
  ateco_macro TEXT NOT NULL,
  ateco_label TEXT NOT NULL,
  kpi_data JSONB NOT NULL,
  fonte TEXT,
  source_url TEXT,
  source_dataset TEXT,
  source_version TEXT,
  source_published_at DATE,
  effective_period TEXT,
  data_hash TEXT NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replaced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ateco_macro, data_hash)
);

CREATE TABLE IF NOT EXISTS benchmark_update_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type TEXT NOT NULL DEFAULT 'cron'
    CHECK (trigger_type IN ('cron', 'manual', 'test')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  source_name TEXT,
  source_url TEXT,
  source_version TEXT,
  source_published_at DATE,
  effective_period TEXT,
  sectors_checked INTEGER NOT NULL DEFAULT 0,
  sectors_updated INTEGER NOT NULL DEFAULT 0,
  comments_updated INTEGER NOT NULL DEFAULT 0,
  warnings JSONB NOT NULL DEFAULT '[]'::JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS benchmark_automation_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  numeric_source_url TEXT,
  numeric_source_format TEXT NOT NULL DEFAULT 'credifile-json-v1',
  source_name TEXT NOT NULL DEFAULT 'BACH - Bank for the Accounts of Companies Harmonised',
  source_landing_url TEXT NOT NULL DEFAULT 'https://www.bach.banque-france.fr/',
  cron_secret_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sector_benchmark_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_update_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_automation_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_benchmark_history" ON sector_benchmark_history;
CREATE POLICY "authenticated_read_benchmark_history"
  ON sector_benchmark_history FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "service_manage_benchmark_history" ON sector_benchmark_history;
CREATE POLICY "service_manage_benchmark_history"
  ON sector_benchmark_history FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "authenticated_read_benchmark_runs" ON benchmark_update_runs;
CREATE POLICY "authenticated_read_benchmark_runs"
  ON benchmark_update_runs FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS "service_manage_benchmark_runs" ON benchmark_update_runs;
CREATE POLICY "service_manage_benchmark_runs"
  ON benchmark_update_runs FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "service_manage_benchmark_settings" ON benchmark_automation_settings;
CREATE POLICY "service_manage_benchmark_settings"
  ON benchmark_automation_settings FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

INSERT INTO sector_benchmark_history (
  benchmark_id, ateco_macro, ateco_label, kpi_data, fonte, source_url,
  source_dataset, source_version, source_published_at, effective_period, data_hash
)
SELECT
  id, ateco_macro, ateco_label, kpi_data, fonte, source_url,
  source_dataset, source_version, source_published_at, effective_period, data_hash
FROM sector_benchmarks
ON CONFLICT (ateco_macro, data_hash) DO NOTHING;

DO $$
DECLARE
  secret_value TEXT;
BEGIN
  SELECT decrypted_secret
  INTO secret_value
  FROM vault.decrypted_secrets
  WHERE name = 'benchmark_cron_secret'
  LIMIT 1;

  IF secret_value IS NULL THEN
    secret_value := encode(extensions.gen_random_bytes(32), 'hex');
    PERFORM vault.create_secret(
      secret_value,
      'benchmark_cron_secret',
      'Firma interna per il cron mensile dei benchmark Credifile'
    );
  END IF;

  INSERT INTO benchmark_automation_settings (id, cron_secret_hash)
  VALUES (
    TRUE,
    encode(extensions.digest(convert_to(secret_value, 'UTF8'), 'sha256'), 'hex')
  )
  ON CONFLICT (id) DO UPDATE SET
    cron_secret_hash = EXCLUDED.cron_secret_hash,
    updated_at = NOW();
END
$$;

DO $$
DECLARE
  existing_job BIGINT;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'credifile-monthly-sector-benchmarks'
  LIMIT 1;

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;
END
$$;

SELECT cron.schedule(
  'credifile-monthly-sector-benchmarks',
  '15 4 1 * *',
  $cron$
    SELECT net.http_post(
      url := 'https://fhieppjqlefdlanvrpik.supabase.co/functions/v1/update-sector-benchmarks',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'benchmark_cron_secret'
          LIMIT 1
        )
      ),
      body := jsonb_build_object('trigger', 'cron', 'requested_at', NOW()),
      timeout_milliseconds := 60000
    );
  $cron$
);

ALTER TABLE estratto_conto_transactions
  DROP CONSTRAINT IF EXISTS estratto_conto_transactions_categoria_check;

ALTER TABLE estratto_conto_transactions
  ADD CONSTRAINT estratto_conto_transactions_categoria_check
  CHECK (
    categoria IN (
      'incasso_cliente', 'anticipo_sbf', 'versamento', 'altro_entrata',
      'fornitore', 'rata_finanziamento', 'tributo', 'stipendio',
      'spesa_bancaria', 'prelievo', 'altro_uscita', 'cliente', 'altro'
    )
  );

ALTER TABLE estratto_conto_transactions
  ADD COLUMN IF NOT EXISTS classification_confidence TEXT
    CHECK (classification_confidence IN ('alta', 'media', 'bassa')),
  ADD COLUMN IF NOT EXISTS classification_rule TEXT,
  ADD COLUMN IF NOT EXISTS parse_confidence TEXT
    CHECK (parse_confidence IN ('alta', 'media', 'bassa')),
  ADD COLUMN IF NOT EXISTS source_format TEXT;

CREATE INDEX IF NOT EXISTS estratto_conto_transactions_review_idx
  ON estratto_conto_transactions (practice_id, classification_confidence, parse_confidence);
