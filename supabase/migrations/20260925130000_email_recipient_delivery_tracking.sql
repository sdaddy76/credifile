-- Tracciamento per singolo destinatario degli eventi Resend.
-- Un'unica email può avere destinatari principali, CC e BCC diversi:
-- lo stato aggregato di email_send_log non è sufficiente per verificare
-- la consegna della singola copia archivio.
ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS recipient_events jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.email_send_log.recipient_events IS
  'Mappa email destinatario -> ultimo evento Resend (stato, evento e timestamp)';
