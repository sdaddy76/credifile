-- Fix: can_access_practice ora include assigned_to
-- In precedenza gli agenti ASSEGNATI (ma non creatori) non potevano eliminare file
CREATE OR REPLACE FUNCTION can_access_practice(practice_row practices)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT ruolo INTO user_role FROM admin_profiles WHERE id = auth.uid();
  IF user_role = 'super_admin' THEN RETURN TRUE; END IF;
  IF practice_row.created_by = auth.uid() THEN RETURN TRUE; END IF;
  IF practice_row.assigned_to = auth.uid() THEN RETURN TRUE; END IF;
  IF EXISTS (
    SELECT 1 FROM segreteria_agent_assignments
    WHERE segreteria_user_id = auth.uid()
      AND agent_user_id = practice_row.created_by
  ) THEN RETURN TRUE; END IF;
  RETURN FALSE;
END;
$$;
