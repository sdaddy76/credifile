-- Il segnalatore deve poter consultare le proprie segnalazioni pubbliche,
-- comprese quelle ancora non trasferite in una pratica.
ALTER TABLE public.segnalazioni_pubbliche ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "segnalazioni_segnalatore_select" ON public.segnalazioni_pubbliche;

CREATE POLICY "segnalazioni_segnalatore_select"
  ON public.segnalazioni_pubbliche
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles viewer
      WHERE viewer.id = auth.uid()
        AND viewer.ruolo = 'segnalatore'
        AND segnalazioni_pubbliche.segnalatore_id = auth.uid()
    )
  );
