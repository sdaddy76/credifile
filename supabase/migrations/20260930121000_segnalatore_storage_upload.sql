-- Consente agli utenti Segnalatore di caricare i documenti della propria
-- segnalazione nel prefisso segnalazioni/{user_id}/...

DROP POLICY IF EXISTS pf_segnalatore_insert ON storage.objects;
CREATE POLICY pf_segnalatore_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'practice-files'
  AND split_part(name, '/', 1) = 'segnalazioni'
  AND split_part(name, '/', 2) = auth.uid()::text
  AND EXISTS (
    SELECT 1
    FROM public.admin_profiles
    WHERE id = auth.uid()
      AND ruolo = 'segnalatore'
  )
);

DROP POLICY IF EXISTS pf_segnalatore_select ON storage.objects;
CREATE POLICY pf_segnalatore_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'practice-files'
  AND split_part(name, '/', 1) = 'segnalazioni'
  AND (
    split_part(name, '/', 2) = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.admin_profiles
      WHERE id = auth.uid()
        AND ruolo IN ('super_admin', 'supervisore_segreteria', 'agente')
    )
  )
);
