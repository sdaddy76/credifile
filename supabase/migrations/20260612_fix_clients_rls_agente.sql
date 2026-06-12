-- Fix RLS clients_select: agente può vedere i clienti delle pratiche a lui assegnate
-- o segnalate, non solo quelli da lui creati
DROP POLICY IF EXISTS clients_select ON clients;
CREATE POLICY clients_select ON clients FOR SELECT TO authenticated USING (
  (created_by = auth.uid())
  OR (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND ruolo = 'super_admin'))
  OR ((EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND ruolo = 'supervisore_segreteria'))
      AND (EXISTS (SELECT 1 FROM segreteria_agent_assignments WHERE segreteria_user_id = auth.uid() AND agent_user_id = clients.created_by)))
  -- Agente: clienti delle pratiche assegnate a lui
  OR (EXISTS (SELECT 1 FROM practices WHERE practices.client_id = clients.id AND practices.assigned_to = auth.uid()))
  -- Segnalatore: clienti delle pratiche da lui segnalate
  OR (EXISTS (SELECT 1 FROM practices WHERE practices.client_id = clients.id AND practices.segnalatore_id = auth.uid()))
);
