-- Priorità 5: sicurezza operativa, notifiche centralizzate e audit invii.
-- Le API server-side continuano a operare con service_role; gli utenti
-- autenticati possono leggere e gestire esclusivamente le proprie notifiche.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_notifications_practice_created
  ON public.notifications(practice_id, created_at DESC)
  WHERE practice_id IS NOT NULL;

DROP POLICY IF EXISTS "own_notif" ON public.notifications;
DROP POLICY IF EXISTS "staff_notif_ins" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_staff" ON public.notifications;

CREATE POLICY "notifications_select_own"
  ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "notifications_update_own"
  ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "notifications_delete_own"
  ON public.notifications
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Solo super admin/segreteria possono creare una notifica per un altro
-- membro dello staff. Un utente può comunque creare una propria notifica
-- per mantenere compatibili i percorsi interni già esistenti.
CREATE POLICY "notifications_insert_staff"
  ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.admin_profiles actor
      WHERE actor.id = auth.uid()
        AND actor.ruolo IN ('super_admin', 'supervisore_segreteria')
    )
  );

-- I log email contengono destinatari e metadati operativi: non devono essere
-- leggibili da un utente autenticato privo di accesso alla pratica.
DROP POLICY IF EXISTS "staff_email_log" ON public.email_send_log;
DROP POLICY IF EXISTS "email_log_staff_select" ON public.email_send_log;
DROP POLICY IF EXISTS "email_log_staff_insert" ON public.email_send_log;

CREATE POLICY "email_log_staff_select"
  ON public.email_send_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id = email_send_log.practice_id
        AND public.can_access_practice(p.*)
    )
  );

CREATE POLICY "email_log_staff_insert"
  ON public.email_send_log
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.practices p
      WHERE p.id = email_send_log.practice_id
        AND public.can_access_practice(p.*)
    )
  );

-- Gli aggiornamenti dei log arrivano dai webhook/API con service_role.
-- Nessuna policy UPDATE/DELETE per authenticated evita alterazioni arbitrarie.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    -- Ambienti locali privi della pubblicazione realtime: la migrazione resta
    -- applicabile e il client utilizza il polling come fallback.
    NULL;
END
$$;
