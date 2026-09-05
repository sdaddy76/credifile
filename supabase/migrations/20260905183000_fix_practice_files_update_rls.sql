-- Consente la rigenerazione dei documenti già presenti nel bucket
-- practice-files. L'upload con upsert richiede una policy UPDATE oltre
-- alle policy INSERT e SELECT già configurate.

DROP POLICY IF EXISTS pf_update ON storage.objects;

CREATE POLICY pf_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'practice-files'
  AND (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles
      WHERE id = auth.uid()
        AND ruolo = 'super_admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id::text = split_part(storage.objects.name, '/', 1)
        AND (
          p.created_by = auth.uid()
          OR p.assigned_to = auth.uid()
        )
    )
  )
)
WITH CHECK (
  bucket_id = 'practice-files'
  AND (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles
      WHERE id = auth.uid()
        AND ruolo = 'super_admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id::text = split_part(storage.objects.name, '/', 1)
        AND (
          p.created_by = auth.uid()
          OR p.assigned_to = auth.uid()
        )
    )
  )
);
