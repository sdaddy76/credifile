-- Analisi dettagliata dei costi bancari rilevati dagli estratti conto.
-- I campi sono opzionali: i dati non presenti nel documento restano NULL
-- e non vengono stimati automaticamente.

ALTER TABLE public.estratto_conto_transactions
  ADD COLUMN IF NOT EXISTS bank_cost_type TEXT,
  ADD COLUMN IF NOT EXISTS bank_cost_confidence TEXT,
  ADD COLUMN IF NOT EXISTS interest_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS principal_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS interest_rate NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS financing_reference TEXT,
  ADD COLUMN IF NOT EXISTS bank_cost_notes TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'estratto_conto_transactions_bank_cost_type_check'
       AND conrelid = 'public.estratto_conto_transactions'::regclass
  ) THEN
    ALTER TABLE public.estratto_conto_transactions
      DROP CONSTRAINT estratto_conto_transactions_bank_cost_type_check;
  END IF;

  ALTER TABLE public.estratto_conto_transactions
    ADD CONSTRAINT estratto_conto_transactions_bank_cost_type_check
    CHECK (
      bank_cost_type IS NULL OR bank_cost_type IN (
        'tenuta_conto',
        'commissioni',
        'spese_operazione',
        'interessi_debitori',
        'interessi_finanziamento',
        'rata_finanziamento',
        'imposta_bollo',
        'canone',
        'altri_oneri'
      )
    );

  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'estratto_conto_transactions_bank_cost_confidence_check'
       AND conrelid = 'public.estratto_conto_transactions'::regclass
  ) THEN
    ALTER TABLE public.estratto_conto_transactions
      DROP CONSTRAINT estratto_conto_transactions_bank_cost_confidence_check;
  END IF;

  ALTER TABLE public.estratto_conto_transactions
    ADD CONSTRAINT estratto_conto_transactions_bank_cost_confidence_check
    CHECK (
      bank_cost_confidence IS NULL OR bank_cost_confidence IN ('alta', 'media', 'bassa')
    );
END $$;

CREATE INDEX IF NOT EXISTS estratto_conto_transactions_bank_cost_idx
  ON public.estratto_conto_transactions (practice_id, bank_cost_type, data_valuta);

COMMENT ON COLUMN public.estratto_conto_transactions.bank_cost_type IS
  'Classificazione dettagliata del costo bancario rilevato dall’estratto conto.';
COMMENT ON COLUMN public.estratto_conto_transactions.interest_rate IS
  'Tasso esplicitamente rilevato nel documento; non è un tasso stimato.';

CREATE OR REPLACE FUNCTION public.get_practice_bank_cost_transactions(
  p_practice_id UUID,
  p_access_code TEXT,
  p_client_email TEXT
)
RETURNS SETOF public.estratto_conto_transactions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT transaction.*
    FROM public.estratto_conto_transactions transaction
   WHERE transaction.practice_id = p_practice_id
     AND EXISTS (
       SELECT 1
         FROM public.practice_access_codes access_code
        WHERE access_code.practice_id = p_practice_id
          AND lower(access_code.codice) = lower(trim(p_access_code))
          AND lower(access_code.email_cliente) = lower(trim(p_client_email))
          AND (access_code.scadenza IS NULL OR access_code.scadenza > NOW())
          AND access_code.privacy_consent_accepted_at IS NOT NULL
     )
   ORDER BY transaction.data_valuta ASC NULLS LAST, transaction.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.get_practice_bank_cost_transactions(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_practice_bank_cost_transactions(UUID, TEXT, TEXT) TO anon, authenticated;
