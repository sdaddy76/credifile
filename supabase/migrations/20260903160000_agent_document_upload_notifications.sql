CREATE TABLE IF NOT EXISTS public.agent_document_upload_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  practice_document_id uuid REFERENCES public.practice_documents(id) ON DELETE SET NULL,
  uploaded_file_id uuid REFERENCES public.uploaded_files(id) ON DELETE SET NULL,
  notification_type text NOT NULL
    CHECK (notification_type IN ('file_uploaded', 'all_documents_completed')),
  notification_key text NOT NULL,
  recipient_email text NOT NULL,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 1,
  resend_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, notification_type, notification_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_doc_upload_notifications_practice
  ON public.agent_document_upload_notifications(practice_id, created_at DESC);

ALTER TABLE public.agent_document_upload_notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_agent_document_upload_notification(
  p_practice_id uuid,
  p_practice_document_id uuid,
  p_uploaded_file_id uuid,
  p_notification_type text,
  p_notification_key text,
  p_recipient_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  INSERT INTO public.agent_document_upload_notifications (
    practice_id,
    practice_document_id,
    uploaded_file_id,
    notification_type,
    notification_key,
    recipient_email
  )
  VALUES (
    p_practice_id,
    p_practice_document_id,
    p_uploaded_file_id,
    p_notification_type,
    p_notification_key,
    lower(trim(p_recipient_email))
  )
  ON CONFLICT (practice_id, notification_type, notification_key)
  DO UPDATE SET
    practice_document_id = EXCLUDED.practice_document_id,
    uploaded_file_id = EXCLUDED.uploaded_file_id,
    recipient_email = EXCLUDED.recipient_email,
    status = 'processing',
    attempt_count = public.agent_document_upload_notifications.attempt_count + 1,
    error = NULL,
    updated_at = now()
  WHERE public.agent_document_upload_notifications.status = 'failed'
     OR (
       public.agent_document_upload_notifications.status = 'processing'
       AND public.agent_document_upload_notifications.updated_at < now() - interval '5 minutes'
     )
  RETURNING id INTO claimed_id;

  RETURN claimed_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_document_upload_notification(
  uuid, uuid, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_agent_document_upload_notification(
  uuid, uuid, uuid, text, text, text
) TO service_role;
