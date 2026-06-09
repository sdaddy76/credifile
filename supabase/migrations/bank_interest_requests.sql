
CREATE TABLE IF NOT EXISTS bank_interest_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id   uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  bank_id       uuid NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  requested_by  uuid REFERENCES admin_profiles(id),
  status        text NOT NULL DEFAULT 'in_attesa' CHECK (status IN ('in_attesa','approvata','rifiutata')),
  note_banca    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bir_practice ON bank_interest_requests(practice_id);
CREATE INDEX IF NOT EXISTS idx_bir_bank     ON bank_interest_requests(bank_id);
CREATE INDEX IF NOT EXISTS idx_bir_status   ON bank_interest_requests(status);

ALTER TABLE bank_interest_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_interest_requests' AND policyname='bir_select') THEN
    CREATE POLICY bir_select ON bank_interest_requests FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_interest_requests' AND policyname='bir_insert') THEN
    CREATE POLICY bir_insert ON bank_interest_requests FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_interest_requests' AND policyname='bir_update') THEN
    CREATE POLICY bir_update ON bank_interest_requests FOR UPDATE USING (true);
  END IF;
END $$;
