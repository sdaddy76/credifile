-- Alert operativi per le anomalie di bilancio da approfondire.

CREATE TABLE IF NOT EXISTS public.balance_anomaly_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bilancio_id uuid NOT NULL REFERENCES public.bilanci_kpi(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  finding_id text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL,
  confidence text NOT NULL,
  finding jsonb NOT NULL,
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
  UNIQUE (bilancio_id, finding_id)
);

CREATE INDEX IF NOT EXISTS balance_anomaly_alerts_practice_idx
  ON public.balance_anomaly_alerts(practice_id, active, status);

CREATE INDEX IF NOT EXISTS balance_anomaly_alerts_question_idx
  ON public.balance_anomaly_alerts(client_question_id)
  WHERE client_question_id IS NOT NULL;

DROP TRIGGER IF EXISTS balance_anomaly_alerts_updated_at
  ON public.balance_anomaly_alerts;
CREATE TRIGGER balance_anomaly_alerts_updated_at
  BEFORE UPDATE ON public.balance_anomaly_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.balance_anomaly_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_access_balance_anomaly_alerts"
  ON public.balance_anomaly_alerts;
CREATE POLICY "staff_access_balance_anomaly_alerts"
  ON public.balance_anomaly_alerts
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id = balance_anomaly_alerts.practice_id
        AND public.can_access_practice(p.*)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id = balance_anomaly_alerts.practice_id
        AND public.can_access_practice(p.*)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.balance_anomaly_alerts TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_balance_anomaly_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_finding jsonb;
BEGIN
  UPDATE public.balance_anomaly_alerts
  SET active = false
  WHERE bilancio_id = NEW.id;

  FOR v_finding IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(NEW.anomaly_analysis->'findings', '[]'::jsonb))
  LOOP
    INSERT INTO public.balance_anomaly_alerts (
      bilancio_id,
      practice_id,
      finding_id,
      title,
      category,
      severity,
      confidence,
      finding,
      active
    )
    VALUES (
      NEW.id,
      NEW.practice_id,
      v_finding->>'id',
      COALESCE(v_finding->>'title', 'Anomalia di bilancio da approfondire'),
      COALESCE(v_finding->>'category', 'posta_da_chiarire'),
      COALESCE(v_finding->>'severity', 'bassa'),
      COALESCE(v_finding->>'confidence', 'bassa'),
      v_finding,
      true
    )
    ON CONFLICT (bilancio_id, finding_id)
    DO UPDATE SET
      title = EXCLUDED.title,
      category = EXCLUDED.category,
      severity = EXCLUDED.severity,
      confidence = EXCLUDED.confidence,
      finding = EXCLUDED.finding,
      active = true,
      updated_at = now();
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_balance_anomaly_alerts_after_analysis
  ON public.bilanci_kpi;
CREATE TRIGGER sync_balance_anomaly_alerts_after_analysis
  AFTER INSERT OR UPDATE OF anomaly_analysis ON public.bilanci_kpi
  FOR EACH ROW EXECUTE FUNCTION public.sync_balance_anomaly_alerts();

CREATE OR REPLACE FUNCTION public.resolve_balance_alert_from_client_answer()
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
    UPDATE public.balance_anomaly_alerts
    SET
      status = 'client_answered',
      resolved_at = COALESCE(NEW.answered_at, now()),
      updated_at = now()
    WHERE client_question_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resolve_balance_alert_after_client_answer
  ON public.practice_client_questions;
CREATE TRIGGER resolve_balance_alert_after_client_answer
  AFTER UPDATE OF risposta, stato ON public.practice_client_questions
  FOR EACH ROW EXECUTE FUNCTION public.resolve_balance_alert_from_client_answer();

-- Genera gli alert anche per le analisi già presenti.
UPDATE public.bilanci_kpi
SET anomaly_analysis = anomaly_analysis
WHERE anomaly_analysis IS NOT NULL;
