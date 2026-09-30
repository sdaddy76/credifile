-- Dati strutturati delle segnalazioni inviate dagli utenti Segnalatore.
-- Restano separati dai documenti standard delle pratiche: vengono usati
-- nella presa in carico iniziale e poi riportati nella pratica quando avviata.

ALTER TABLE public.segnalazioni_pubbliche
  ADD COLUMN IF NOT EXISTS segnalatore_id uuid
    REFERENCES public.admin_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS financing_amount numeric(15,2),
  ADD COLUMN IF NOT EXISTS financing_type text,
  ADD COLUMN IF NOT EXISTS financing_request text;

CREATE INDEX IF NOT EXISTS idx_segnalazioni_pubbliche_segnalatore
  ON public.segnalazioni_pubbliche(segnalatore_id, created_at DESC);

COMMENT ON COLUMN public.segnalazioni_pubbliche.segnalatore_id IS
  'Utente con ruolo segnalatore che ha inviato la segnalazione.';
COMMENT ON COLUMN public.segnalazioni_pubbliche.financing_amount IS
  'Importo richiesto per il finanziamento o leasing.';
COMMENT ON COLUMN public.segnalazioni_pubbliche.financing_type IS
  'Tipologia del prodotto finanziario richiesto.';
COMMENT ON COLUMN public.segnalazioni_pubbliche.financing_request IS
  'Descrizione della richiesta e della motivazione dell''operazione.';
