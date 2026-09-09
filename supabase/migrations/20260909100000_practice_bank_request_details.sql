-- Importo e motivazione possono variare per ogni banca assegnata.
ALTER TABLE public.practice_banks
  ADD COLUMN IF NOT EXISTS importo_richiesto NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS motivazione TEXT;

-- Compatibilità con le pratiche già esistenti: il valore globale viene usato
-- come predefinito soltanto dove non è già presente un valore specifico banca.
UPDATE public.practice_banks pb
SET importo_richiesto = p.importo_richiesto
FROM public.practices p
WHERE p.id = pb.practice_id
  AND pb.importo_richiesto IS NULL
  AND p.importo_richiesto IS NOT NULL;

UPDATE public.practice_banks pb
SET motivazione = p.motivazione
FROM public.practices p
WHERE p.id = pb.practice_id
  AND pb.motivazione IS NULL
  AND p.motivazione IS NOT NULL;

COMMENT ON COLUMN public.practice_banks.importo_richiesto IS
  'Importo richiesto specifico per questa assegnazione pratica-banca';
COMMENT ON COLUMN public.practice_banks.motivazione IS
  'Motivazione della richiesta specifica per questa assegnazione pratica-banca';

-- Il portale banca può leggere esclusivamente la propria assegnazione,
-- necessaria per mostrare importo e motivazione corretti senza esporre dati
-- di altre banche assegnate alla stessa pratica.
DROP POLICY IF EXISTS "Banca legge propria assegnazione pratica" ON public.practice_banks;
CREATE POLICY "Banca legge propria assegnazione pratica"
  ON public.practice_banks
  FOR SELECT
  TO authenticated
  USING (
    bank_id IN (
      SELECT b.id
      FROM public.banks b
      WHERE b.bank_user_id = auth.uid()
    )
  );
