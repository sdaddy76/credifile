-- Verifiche di coerenza tra visura, bilancio, finanziamenti, Centrale Rischi ed estratti conto.

CREATE TABLE IF NOT EXISTS public.document_coherence_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('alta', 'media', 'bassa')),
  confidence text NOT NULL CHECK (confidence IN ('alta', 'media', 'bassa')),
  finding jsonb NOT NULL,
  source_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open',
      'answered_by_consultant',
      'client_requested',
      'client_answered',
      'ignored'
    )),
  consultant_response text,
  ignore_reason text,
  client_question_id uuid REFERENCES public.practice_client_questions(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  resolved_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, check_key)
);

CREATE INDEX IF NOT EXISTS document_coherence_alerts_practice_idx
  ON public.document_coherence_alerts(practice_id, active, status);

CREATE INDEX IF NOT EXISTS document_coherence_alerts_question_idx
  ON public.document_coherence_alerts(client_question_id)
  WHERE client_question_id IS NOT NULL;

DROP TRIGGER IF EXISTS document_coherence_alerts_updated_at
  ON public.document_coherence_alerts;
CREATE TRIGGER document_coherence_alerts_updated_at
  BEFORE UPDATE ON public.document_coherence_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.document_coherence_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_access_document_coherence_alerts"
  ON public.document_coherence_alerts;
CREATE POLICY "staff_access_document_coherence_alerts"
  ON public.document_coherence_alerts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id = document_coherence_alerts.practice_id
        AND public.can_access_practice(p.*)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id = document_coherence_alerts.practice_id
        AND public.can_access_practice(p.*)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.document_coherence_alerts TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_document_coherence_alert_from_client_answer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stato = 'risposta'
     AND NEW.risposta IS NOT NULL
     AND btrim(NEW.risposta) <> ''
     AND (
       OLD.stato IS DISTINCT FROM NEW.stato
       OR OLD.risposta IS DISTINCT FROM NEW.risposta
     )
  THEN
    UPDATE public.document_coherence_alerts
    SET
      status = 'client_answered',
      resolved_at = COALESCE(NEW.answered_at, now()),
      updated_at = now()
    WHERE client_question_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolve_document_coherence_alert_after_client_answer
  ON public.practice_client_questions;
CREATE TRIGGER resolve_document_coherence_alert_after_client_answer
  AFTER UPDATE OF risposta, stato ON public.practice_client_questions
  FOR EACH ROW EXECUTE FUNCTION public.resolve_document_coherence_alert_from_client_answer();
