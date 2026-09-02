-- Richieste documentali evolute:
-- domande testuali al cliente e situazione bancaria strutturata.

CREATE TABLE IF NOT EXISTS practice_client_questions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  domanda text NOT NULL,
  risposta text,
  stato text NOT NULL DEFAULT 'richiesta'
    CHECK (stato IN ('richiesta', 'risposta')),
  created_by uuid,
  answered_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_questions_practice
  ON practice_client_questions(practice_id, created_at);

DROP TRIGGER IF EXISTS practice_client_questions_updated_at
  ON practice_client_questions;
CREATE TRIGGER practice_client_questions_updated_at
  BEFORE UPDATE ON practice_client_questions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE practice_client_questions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'practice_client_questions'
      AND policyname = 'staff_all_client_questions'
  ) THEN
    CREATE POLICY "staff_all_client_questions"
      ON practice_client_questions
      FOR ALL TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'practice_client_questions'
      AND policyname = 'anon_read_client_questions'
  ) THEN
    CREATE POLICY "anon_read_client_questions"
      ON practice_client_questions
      FOR SELECT TO anon
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'practice_client_questions'
      AND policyname = 'anon_answer_client_questions'
  ) THEN
    CREATE POLICY "anon_answer_client_questions"
      ON practice_client_questions
      FOR UPDATE TO anon
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON practice_client_questions TO authenticated;
GRANT SELECT ON practice_client_questions TO anon;
GRANT UPDATE (risposta, stato, answered_at, updated_at)
  ON practice_client_questions TO anon;


CREATE TABLE IF NOT EXISTS practice_client_banks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  banca text NOT NULL,
  tipo_rapporto text,
  accordato numeric(15,2),
  utilizzato numeric(15,2),
  saldo numeric(15,2),
  note text,
  ordinamento integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_banks_practice
  ON practice_client_banks(practice_id, ordinamento, created_at);

DROP TRIGGER IF EXISTS practice_client_banks_updated_at
  ON practice_client_banks;
CREATE TRIGGER practice_client_banks_updated_at
  BEFORE UPDATE ON practice_client_banks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE practice_client_banks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'practice_client_banks'
      AND policyname = 'staff_all_client_banks'
  ) THEN
    CREATE POLICY "staff_all_client_banks"
      ON practice_client_banks
      FOR ALL TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'practice_client_banks'
      AND policyname = 'anon_all_client_banks'
  ) THEN
    CREATE POLICY "anon_all_client_banks"
      ON practice_client_banks
      FOR ALL TO anon
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON practice_client_banks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON practice_client_banks TO anon;
