-- Ogni invio documentale verso una banca o un suo collaboratore può essere
-- distinto nello storico e nella timeline della pratica.

ALTER TABLE public.email_send_log
  DROP CONSTRAINT IF EXISTS email_send_log_delivery_type_check;

ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_delivery_type_check
  CHECK (delivery_type IN ('pratica', 'approfondimento', 'copia'));

COMMENT ON COLUMN public.email_send_log.delivery_type IS
  'Tipo invio: pratica, approfondimento oppure copia documentale a un collaboratore/terzo';

CREATE INDEX IF NOT EXISTS idx_email_send_log_practice_created
  ON public.email_send_log(practice_id, created_at DESC);
