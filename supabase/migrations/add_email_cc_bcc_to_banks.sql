-- Aggiunge campi email_cc e email_bcc alla tabella banks
-- email_cc: destinatari in copia (CC), separati da virgola
-- email_bcc: destinatari in copia nascosta (BCC), separati da virgola
ALTER TABLE banks
  ADD COLUMN IF NOT EXISTS email_cc  text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS email_bcc text DEFAULT NULL;

COMMENT ON COLUMN banks.email_cc  IS 'Destinatari CC per invio pratica (separati da virgola)';
COMMENT ON COLUMN banks.email_bcc IS 'Destinatari BCC per invio pratica (separati da virgola)';