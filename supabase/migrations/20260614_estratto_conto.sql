-- Migration: tabella estratto_conto_transactions
-- Applicare dal Supabase Dashboard > SQL Editor se non già presente

CREATE TABLE IF NOT EXISTS estratto_conto_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  data_valuta DATE,
  data_contabile DATE,
  importo NUMERIC(12,2) NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('entrata', 'uscita')),
  categoria TEXT NOT NULL CHECK (categoria IN ('cliente', 'stipendio', 'fornitore', 'tributo', 'altro')),
  descrizione TEXT,
  beneficiario_ordinante TEXT,
  saldo_progressivo NUMERIC(12,2),
  file_nome TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE estratto_conto_transactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='estratto_conto_transactions'
    AND policyname='Allow all for authenticated'
  ) THEN
    CREATE POLICY "Allow all for authenticated"
      ON estratto_conto_transactions FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
