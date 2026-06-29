-- Tracking eventi Resend per storico invii banca
ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_email_send_log_resend_id
  ON public.email_send_log(resend_id)
  WHERE resend_id IS NOT NULL;

COMMENT ON COLUMN public.email_send_log.opened_at IS 'Timestamp ultimo evento email.opened ricevuto da Resend';
COMMENT ON COLUMN public.email_send_log.delivered_at IS 'Timestamp evento email.delivered ricevuto da Resend';
