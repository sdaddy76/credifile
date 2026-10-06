-- Visibilità per ruolo:
-- - le segnalazioni senza agente sono presidiate esclusivamente dal Super Admin;
-- - agenti e segreterie vedono soltanto le segnalazioni/pratiche assegnate;
-- - il Super Admin mantiene la visibilità completa.

ALTER TABLE public.segnalazioni_pubbliche ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sp_admin_all" ON public.segnalazioni_pubbliche;
DROP POLICY IF EXISTS "sp_agente_select" ON public.segnalazioni_pubbliche;
DROP POLICY IF EXISTS "staff_read_segnalazioni_pubbliche" ON public.segnalazioni_pubbliche;
DROP POLICY IF EXISTS "staff_update_segnalazioni_pubbliche" ON public.segnalazioni_pubbliche;
DROP POLICY IF EXISTS "staff_delete_segnalazioni_pubbliche" ON public.segnalazioni_pubbliche;

CREATE POLICY "segnalazioni_staff_select"
  ON public.segnalazioni_pubbliche
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles viewer
      WHERE viewer.id = auth.uid()
        AND (
          viewer.ruolo = 'super_admin'
          OR (
            viewer.ruolo = 'agente'
            AND agente_id = auth.uid()
          )
          OR (
            viewer.ruolo = 'supervisore_segreteria'
            AND agente_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.segreteria_agent_assignments saa
              WHERE saa.segreteria_user_id = auth.uid()
                AND saa.agent_user_id = segnalazioni_pubbliche.agente_id
            )
          )
        )
    )
  );

CREATE POLICY "segnalazioni_staff_update"
  ON public.segnalazioni_pubbliche
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles viewer
      WHERE viewer.id = auth.uid()
        AND (
          viewer.ruolo = 'super_admin'
          OR (viewer.ruolo = 'agente' AND agente_id = auth.uid())
          OR (
            viewer.ruolo = 'supervisore_segreteria'
            AND agente_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.segreteria_agent_assignments saa
              WHERE saa.segreteria_user_id = auth.uid()
                AND saa.agent_user_id = segnalazioni_pubbliche.agente_id
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles viewer
      WHERE viewer.id = auth.uid()
        AND (
          viewer.ruolo = 'super_admin'
          OR (viewer.ruolo = 'agente' AND agente_id = auth.uid())
          OR (
            viewer.ruolo = 'supervisore_segreteria'
            AND agente_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.segreteria_agent_assignments saa
              WHERE saa.segreteria_user_id = auth.uid()
                AND saa.agent_user_id = segnalazioni_pubbliche.agente_id
            )
          )
        )
    )
  );

CREATE POLICY "segnalazioni_superadmin_delete"
  ON public.segnalazioni_pubbliche
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles
      WHERE id = auth.uid()
        AND ruolo = 'super_admin'
    )
  );

-- Le segnalazioni pubbliche continuano a essere create dall'endpoint anonimo
-- che usa il service role per i controlli e il salvataggio.

DROP POLICY IF EXISTS "practices_select" ON public.practices;
CREATE POLICY "practices_select"
  ON public.practices
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.admin_profiles viewer
      WHERE viewer.id = auth.uid()
        AND (
          viewer.ruolo = 'super_admin'
          OR (
            viewer.ruolo = 'agente'
            AND (
              assigned_to = auth.uid()
              OR (created_by = auth.uid() AND segnalatore_id IS NULL)
            )
          )
          OR (
            viewer.ruolo = 'supervisore_segreteria'
            AND EXISTS (
              SELECT 1
              FROM public.segreteria_agent_assignments saa
              WHERE saa.segreteria_user_id = auth.uid()
                AND saa.agent_user_id IN (practices.created_by, practices.assigned_to)
            )
          )
          OR (
            viewer.ruolo = 'segnalatore'
            AND segnalatore_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS "practices_update" ON public.practices;
CREATE POLICY "practices_update"
  ON public.practices
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.admin_profiles
      WHERE id = auth.uid() AND ruolo = 'super_admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.segreteria_agent_assignments saa
      WHERE saa.segreteria_user_id = auth.uid()
        AND saa.agent_user_id IN (practices.created_by, practices.assigned_to)
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.admin_profiles
      WHERE id = auth.uid() AND ruolo = 'super_admin'
    )
    OR EXISTS (
      SELECT 1
      FROM public.segreteria_agent_assignments saa
      WHERE saa.segreteria_user_id = auth.uid()
        AND saa.agent_user_id IN (practices.created_by, practices.assigned_to)
    )
  );
