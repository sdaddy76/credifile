-- Percorso "Report autonomo impresa":
-- una richiesta di ricerca banca collegata alla pratica, assegnabile dal Super Admin.

ALTER TABLE public.segnalazioni_pubbliche
  ADD COLUMN IF NOT EXISTS practice_id uuid REFERENCES public.practices(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tipo_richiesta text NOT NULL DEFAULT 'segnalazione_pubblica',
  ADD COLUMN IF NOT EXISTS disclaimer_pagamento_accettato_at timestamptz,
  ADD COLUMN IF NOT EXISTS disclaimer_pagamento_version text,
  ADD COLUMN IF NOT EXISTS disclaimer_pagamento_text text;

CREATE INDEX IF NOT EXISTS idx_segnalazioni_pubbliche_practice_tipo
  ON public.segnalazioni_pubbliche(practice_id, tipo_richiesta, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_segnalazioni_ricerca_banca_aperta
  ON public.segnalazioni_pubbliche(practice_id, tipo_richiesta)
  WHERE tipo_richiesta = 'ricerca_banca'
    AND stato IN ('nuova', 'assegnata', 'lavorazione');

-- Le richieste create dall'endpoint server-side usano il service role.
-- Gli utenti autenticati (Super Admin, segreteria e agenti) possono leggerle,
-- assegnarle e aggiornarne lo stato tramite il pannello esistente.
ALTER TABLE public.segnalazioni_pubbliche ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_read_segnalazioni_pubbliche" ON public.segnalazioni_pubbliche;
CREATE POLICY "staff_read_segnalazioni_pubbliche"
  ON public.segnalazioni_pubbliche
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff_update_segnalazioni_pubbliche" ON public.segnalazioni_pubbliche;
CREATE POLICY "staff_update_segnalazioni_pubbliche"
  ON public.segnalazioni_pubbliche
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "staff_delete_segnalazioni_pubbliche" ON public.segnalazioni_pubbliche;
CREATE POLICY "staff_delete_segnalazioni_pubbliche"
  ON public.segnalazioni_pubbliche
  FOR DELETE TO authenticated
  USING (true);
