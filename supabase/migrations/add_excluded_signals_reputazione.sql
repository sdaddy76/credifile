-- Aggiunge colonna per segnali esclusi manualmente dall'agente
ALTER TABLE reputational_analyses
  ADD COLUMN IF NOT EXISTS excluded_signals JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN reputational_analyses.excluded_signals IS
  'Array di segnali esclusi manualmente: [{signal_id, subject_name, category, signal_text, reason, excluded_by, excluded_at}]';
