-- La P.IVA è l'identificativo univoco per intercettare richieste di valutazione
-- relative a una pratica già in lavorazione.

ALTER TABLE public.segnalazioni_pubbliche
  ADD COLUMN IF NOT EXISTS piva text;

CREATE INDEX IF NOT EXISTS idx_segnalazioni_pubbliche_piva
  ON public.segnalazioni_pubbliche(piva);

