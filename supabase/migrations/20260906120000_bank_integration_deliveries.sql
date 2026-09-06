-- Collega ogni ciclo di approfondimento alla singola banca richiedente
-- e conserva uno storico verificabile dei documenti inoltrati.

ALTER TABLE public.practice_integration_requests
  ADD COLUMN IF NOT EXISTS practice_bank_id uuid
    REFERENCES public.practice_banks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS bank_sent_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bank_delivery_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_practice_integration_requests_bank
  ON public.practice_integration_requests(practice_bank_id, requested_at DESC)
  WHERE practice_bank_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_integration_request_bank()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.practice_bank_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.practice_banks pb
      WHERE pb.id = NEW.practice_bank_id
        AND pb.practice_id = NEW.practice_id
    )
  THEN
    RAISE EXCEPTION 'La banca selezionata non appartiene alla pratica';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_integration_request_bank_assignment
  ON public.practice_integration_requests;
CREATE TRIGGER validate_integration_request_bank_assignment
  BEFORE INSERT OR UPDATE OF practice_id, practice_bank_id
  ON public.practice_integration_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_integration_request_bank();

ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS integration_request_id uuid
    REFERENCES public.practice_integration_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'pratica',
  ADD COLUMN IF NOT EXISTS uploaded_file_ids uuid[];

ALTER TABLE public.email_send_log
  DROP CONSTRAINT IF EXISTS email_send_log_delivery_type_check;

ALTER TABLE public.email_send_log
  ADD CONSTRAINT email_send_log_delivery_type_check
  CHECK (delivery_type IN ('pratica', 'approfondimento'));

CREATE INDEX IF NOT EXISTS idx_email_send_log_integration_request
  ON public.email_send_log(integration_request_id, created_at DESC)
  WHERE integration_request_id IS NOT NULL;
