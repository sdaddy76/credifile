-- Permette agli utenti operativi autenticati di materializzare nella pratica
-- i PDF ricevuti tramite una segnalazione pubblica.
--
-- La policy è aggiuntiva e non rende la tabella pubblicamente scrivibile:
-- l'accesso resta limitato al ruolo applicativo salvato in admin_profiles.
-- La materializzazione principale dei PDF segnalati avviene comunque nella
-- Edge Function con service role, dopo la verifica dell'utente e della fonte.

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "uploaded_files_signal_authenticated_select" ON public.uploaded_files;
CREATE POLICY "uploaded_files_signal_authenticated_select"
  ON public.uploaded_files
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles profile
      WHERE profile.id = auth.uid()
        AND profile.ruolo IN (
          'super_admin',
          'agente',
          'supervisore_segreteria',
          'consulente'
        )
    )
  );

DROP POLICY IF EXISTS "uploaded_files_signal_authenticated_insert" ON public.uploaded_files;
CREATE POLICY "uploaded_files_signal_authenticated_insert"
  ON public.uploaded_files
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles profile
      WHERE profile.id = auth.uid()
        AND profile.ruolo IN (
          'super_admin',
          'agente',
          'supervisore_segreteria',
          'consulente'
        )
    )
  );
