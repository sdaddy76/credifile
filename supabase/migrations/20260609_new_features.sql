-- bank_watchlist
CREATE TABLE IF NOT EXISTS bank_watchlist (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_id uuid NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(bank_id, practice_id)
);
ALTER TABLE bank_watchlist ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_watchlist' AND policyname='banca_watchlist') THEN
    CREATE POLICY "banca_watchlist" ON bank_watchlist
      USING (bank_id IN (SELECT id FROM banks WHERE bank_user_id = auth.uid()))
      WITH CHECK (bank_id IN (SELECT id FROM banks WHERE bank_user_id = auth.uid()));
  END IF;
END $$;

-- practice_activity_log
CREATE TABLE IF NOT EXISTS practice_activity_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  actor_nome text,
  actor_ruolo text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_practice ON practice_activity_log(practice_id, created_at DESC);
ALTER TABLE practice_activity_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practice_activity_log' AND policyname='staff_activity_sel') THEN
    CREATE POLICY "staff_activity_sel" ON practice_activity_log FOR SELECT USING (auth.role()='authenticated');
    CREATE POLICY "staff_activity_ins" ON practice_activity_log FOR INSERT WITH CHECK (auth.role()='authenticated');
  END IF;
END $$;

-- document_deadlines
CREATE TABLE IF NOT EXISTS document_deadlines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  documento text NOT NULL,
  data_scadenza date NOT NULL,
  note text,
  notificato boolean DEFAULT false,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE document_deadlines ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='document_deadlines' AND policyname='staff_deadlines') THEN
    CREATE POLICY "staff_deadlines" ON document_deadlines
      USING (auth.role()='authenticated') WITH CHECK (auth.role()='authenticated');
  END IF;
END $$;
