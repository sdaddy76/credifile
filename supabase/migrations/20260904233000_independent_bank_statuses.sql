-- Stato e storico indipendenti per ogni banca assegnata alla pratica.

ALTER TABLE public.practice_banks
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.practice_banks
  DROP CONSTRAINT IF EXISTS practice_banks_status_check;

ALTER TABLE public.practice_banks
  ADD CONSTRAINT practice_banks_status_check
  CHECK (status IN (
    'assegnata',
    'inviata',
    'istruttoria',
    'in_delibera',
    'deliberata',
    'erogata',
    'rifiutata'
  ));

CREATE TABLE IF NOT EXISTS public.practice_bank_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_bank_id uuid NOT NULL REFERENCES public.practice_banks(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES public.practices(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  note text,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS practice_bank_status_log_practice_idx
  ON public.practice_bank_status_log(practice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS practice_bank_status_log_assignment_idx
  ON public.practice_bank_status_log(practice_bank_id, created_at DESC);

ALTER TABLE public.practice_bank_status_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_access_practice_bank_status_log"
  ON public.practice_bank_status_log;
CREATE POLICY "staff_access_practice_bank_status_log"
  ON public.practice_bank_status_log
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id = practice_bank_status_log.practice_id
        AND public.can_access_practice(p.*)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id = practice_bank_status_log.practice_id
        AND public.can_access_practice(p.*)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.practice_bank_status_log TO authenticated;

CREATE OR REPLACE FUNCTION public.track_practice_bank_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.status_updated_at := now();
    NEW.status_updated_by := COALESCE(NEW.status_updated_by, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_practice_bank_status_metadata
  ON public.practice_banks;
CREATE TRIGGER set_practice_bank_status_metadata
  BEFORE UPDATE OF status ON public.practice_banks
  FOR EACH ROW EXECUTE FUNCTION public.track_practice_bank_status();

CREATE OR REPLACE FUNCTION public.log_practice_bank_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.practice_bank_status_log (
      practice_bank_id,
      practice_id,
      bank_id,
      old_status,
      new_status,
      note,
      changed_by
    )
    VALUES (
      NEW.id,
      NEW.practice_id,
      NEW.bank_id,
      OLD.status,
      NEW.status,
      NEW.note,
      NEW.status_updated_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_practice_bank_status_change
  ON public.practice_banks;
CREATE TRIGGER log_practice_bank_status_change
  AFTER UPDATE OF status ON public.practice_banks
  FOR EACH ROW EXECUTE FUNCTION public.log_practice_bank_status();
