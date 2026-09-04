-- Le integrazioni documentali sono eventi trasversali al workflow.
-- La fase principale resta in practices.status; ogni richiesta viene tracciata
-- separatamente e può essere aperta/completata più volte durante la pratica.

ALTER TABLE public.practices
  DROP CONSTRAINT IF EXISTS practices_status_check;

ALTER TABLE public.practices
  ADD CONSTRAINT practices_status_check
  CHECK (status IN (
    'bozza',
    'raccolta_documenti',
    'inviata_banca',
    'istruttoria',
    'in_delibera',
    'deliberata',
    'erogata',
    -- Stati legacy mantenuti per compatibilità con dati e viste storiche.
    'integrazioni_richieste',
    'completata',
    'approvata',
    'rifiutata',
    'declinata'
  ));

-- Uniforma gli stati storici ai passaggi oggi mostrati nel workflow.
UPDATE public.practices
SET status = CASE status
  WHEN 'completata' THEN 'istruttoria'
  WHEN 'approvata' THEN 'deliberata'
  WHEN 'rifiutata' THEN 'declinata'
  ELSE status
END
WHERE status IN ('completata', 'approvata', 'rifiutata');

DROP POLICY IF EXISTS "Banca legge pratiche visibili" ON public.practices;
CREATE POLICY "Banca legge pratiche visibili"
  ON public.practices
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles
      WHERE id = auth.uid() AND ruolo = 'banca'
    )
    AND status IN (
      'raccolta_documenti',
      'inviata_banca',
      'istruttoria',
      'in_delibera',
      'deliberata',
      'erogata',
      'declinata',
      'integrazioni_richieste',
      'completata',
      'approvata'
    )
  );

CREATE TABLE IF NOT EXISTS public.practice_integration_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  origin_status text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'cancelled')),
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_practice_integration_requests_practice
  ON public.practice_integration_requests(practice_id, requested_at);

CREATE INDEX IF NOT EXISTS idx_practice_integration_requests_open
  ON public.practice_integration_requests(practice_id, status)
  WHERE status = 'open';

ALTER TABLE public.practice_documents
  ADD COLUMN IF NOT EXISTS integration_request_id uuid
  REFERENCES public.practice_integration_requests(id) ON DELETE CASCADE;

ALTER TABLE public.practice_client_questions
  ADD COLUMN IF NOT EXISTS integration_request_id uuid
  REFERENCES public.practice_integration_requests(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_practice_documents_integration_request
  ON public.practice_documents(integration_request_id)
  WHERE integration_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_practice_client_questions_integration_request
  ON public.practice_client_questions(integration_request_id)
  WHERE integration_request_id IS NOT NULL;

DROP TRIGGER IF EXISTS practice_integration_requests_updated_at
  ON public.practice_integration_requests;
CREATE TRIGGER practice_integration_requests_updated_at
  BEFORE UPDATE ON public.practice_integration_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.practice_integration_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'practice_integration_requests'
      AND policyname = 'staff_access_integration_requests'
  ) THEN
    CREATE POLICY "staff_access_integration_requests"
      ON public.practice_integration_requests
      FOR ALL TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.practices p
          WHERE p.id = practice_integration_requests.practice_id
            AND public.can_access_practice(p.*)
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.practices p
          WHERE p.id = practice_integration_requests.practice_id
            AND public.can_access_practice(p.*)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'practice_integration_requests'
      AND policyname = 'client_portal_read_integration_requests'
  ) THEN
    CREATE POLICY "client_portal_read_integration_requests"
      ON public.practice_integration_requests
      FOR SELECT TO anon
      USING (
        practice_id IN (
          SELECT practice_id FROM public.practice_access_codes
        )
      );
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.practice_integration_requests TO authenticated;
GRANT SELECT ON public.practice_integration_requests TO anon;

CREATE OR REPLACE FUNCTION public.refresh_practice_integration_request(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_items boolean;
  v_has_pending boolean;
BEGIN
  IF p_request_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM public.practice_documents
      WHERE integration_request_id = p_request_id
      UNION ALL
      SELECT 1 FROM public.practice_client_questions
      WHERE integration_request_id = p_request_id
    ),
    EXISTS (
      SELECT 1 FROM public.practice_documents
      WHERE integration_request_id = p_request_id
        AND status IN ('richiesto', 'rifiutato')
      UNION ALL
      SELECT 1 FROM public.practice_client_questions
      WHERE integration_request_id = p_request_id
        AND stato = 'richiesta'
    )
  INTO v_has_items, v_has_pending;

  UPDATE public.practice_integration_requests
  SET
    status = CASE
      WHEN v_has_items AND NOT v_has_pending THEN 'completed'
      ELSE 'open'
    END,
    completed_at = CASE
      WHEN v_has_items AND NOT v_has_pending THEN COALESCE(completed_at, now())
      ELSE NULL
    END
  WHERE id = p_request_id
    AND status <> 'cancelled';
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_related_integration_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_request_id uuid;
  v_new_request_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_request_id := OLD.integration_request_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_request_id := NEW.integration_request_id;
  END IF;

  PERFORM public.refresh_practice_integration_request(v_old_request_id);
  IF v_new_request_id IS DISTINCT FROM v_old_request_id THEN
    PERFORM public.refresh_practice_integration_request(v_new_request_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_integration_after_document_change
  ON public.practice_documents;
CREATE TRIGGER refresh_integration_after_document_change
  AFTER INSERT OR UPDATE OR DELETE ON public.practice_documents
  FOR EACH ROW EXECUTE FUNCTION public.refresh_related_integration_request();

DROP TRIGGER IF EXISTS refresh_integration_after_question_change
  ON public.practice_client_questions;
CREATE TRIGGER refresh_integration_after_question_change
  AFTER INSERT OR UPDATE OR DELETE ON public.practice_client_questions
  FOR EACH ROW EXECUTE FUNCTION public.refresh_related_integration_request();

-- Converte le richieste create con il vecchio modello in un unico ciclo storico
-- per pratica. I nuovi cicli, invece, vengono sempre creati separatamente.
WITH legacy_practices AS (
  SELECT
    p.id AS practice_id,
    CASE COALESCE(
      (
        SELECT l.old_status
        FROM public.practice_status_log l
        WHERE l.practice_id = p.id
          AND l.new_status = 'integrazioni_richieste'
          AND l.old_status IS NOT NULL
          AND l.old_status <> 'integrazioni_richieste'
        ORDER BY l.created_at DESC
        LIMIT 1
      ),
      (
        SELECT l.new_status
        FROM public.practice_status_log l
        WHERE l.practice_id = p.id
          AND l.new_status <> 'integrazioni_richieste'
        ORDER BY l.created_at DESC
        LIMIT 1
      ),
      NULLIF(p.status, 'integrazioni_richieste'),
      'raccolta_documenti'
    )
      WHEN 'completata' THEN 'istruttoria'
      WHEN 'approvata' THEN 'deliberata'
      WHEN 'rifiutata' THEN 'deliberata'
      WHEN 'declinata' THEN 'deliberata'
      ELSE COALESCE(
        (
          SELECT l.old_status
          FROM public.practice_status_log l
          WHERE l.practice_id = p.id
            AND l.new_status = 'integrazioni_richieste'
            AND l.old_status IS NOT NULL
            AND l.old_status <> 'integrazioni_richieste'
          ORDER BY l.created_at DESC
          LIMIT 1
        ),
        (
          SELECT l.new_status
          FROM public.practice_status_log l
          WHERE l.practice_id = p.id
            AND l.new_status <> 'integrazioni_richieste'
          ORDER BY l.created_at DESC
          LIMIT 1
        ),
        NULLIF(p.status, 'integrazioni_richieste'),
        'raccolta_documenti'
      )
    END AS origin_status,
    COALESCE(
      (
        SELECT MAX(l.created_at)
        FROM public.practice_status_log l
        WHERE l.practice_id = p.id
          AND l.new_status = 'integrazioni_richieste'
      ),
      p.updated_at,
      p.created_at,
      now()
    ) AS requested_at
  FROM public.practices p
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.practice_integration_requests ir
    WHERE ir.practice_id = p.id
  )
    AND (
      p.status = 'integrazioni_richieste'
      OR EXISTS (
        SELECT 1 FROM public.practice_documents d
        WHERE d.practice_id = p.id AND d.tipo = 'integrazione'
      )
      OR EXISTS (
        SELECT 1 FROM public.practice_client_questions q
        WHERE q.practice_id = p.id
      )
    )
),
inserted AS (
  INSERT INTO public.practice_integration_requests (
    practice_id,
    origin_status,
    note,
    requested_at
  )
  SELECT
    practice_id,
    origin_status,
    'Richiesta migrata dal precedente sistema di integrazioni',
    requested_at
  FROM legacy_practices
  RETURNING id, practice_id
)
UPDATE public.practice_documents d
SET integration_request_id = i.id
FROM inserted i
WHERE d.practice_id = i.practice_id
  AND d.tipo = 'integrazione'
  AND d.integration_request_id IS NULL;

UPDATE public.practice_client_questions q
SET integration_request_id = ir.id
FROM public.practice_integration_requests ir
WHERE q.practice_id = ir.practice_id
  AND q.integration_request_id IS NULL
  AND ir.note = 'Richiesta migrata dal precedente sistema di integrazioni';

DO $$
DECLARE
  v_request record;
BEGIN
  FOR v_request IN
    SELECT id FROM public.practice_integration_requests
  LOOP
    PERFORM public.refresh_practice_integration_request(v_request.id);
  END LOOP;
END $$;

WITH restored AS (
  UPDATE public.practices p
  SET
    status = ir.origin_status,
    updated_at = now()
  FROM public.practice_integration_requests ir
  WHERE p.id = ir.practice_id
    AND p.status = 'integrazioni_richieste'
  RETURNING p.id, ir.origin_status
)
INSERT INTO public.practice_status_log (
  practice_id,
  old_status,
  new_status,
  note,
  created_by
)
SELECT
  id,
  'integrazioni_richieste',
  origin_status,
  'Ripristinata la fase principale: le integrazioni sono ora tracciate separatamente',
  'migrazione'
FROM restored;
