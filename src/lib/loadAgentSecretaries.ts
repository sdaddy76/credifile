import { supabase } from '@/lib/supabase';

export interface AgentSecretary {
  nome?: string;
  email: string;
}

/** Non richiede una FK fra assegnazioni e profili: entrambe le letture rispettano RLS. */
export async function loadAgentSecretaries(agentId?: string): Promise<Record<string, AgentSecretary>> {
  let query = supabase.from('segreteria_agent_assignments')
    .select('agent_user_id,segreteria_user_id')
    .order('created_at', { ascending: true });
  if (agentId) query = query.eq('agent_user_id', agentId);
  const { data: assignments, error: assignmentError } = await query;
  if (assignmentError) throw new Error(assignmentError.message);
  if (!assignments?.length) return {};

  const ids = [...new Set(assignments.map(row => row.segreteria_user_id))];
  const { data: profiles, error: profileError } = await supabase.from('admin_profiles')
    .select('id,nome,email').in('id', ids);
  if (profileError) throw new Error(profileError.message);
  const byId = new Map((profiles ?? []).map(profile => [profile.id, profile]));
  const result: Record<string, AgentSecretary> = {};
  for (const assignment of assignments) {
    const profile = byId.get(assignment.segreteria_user_id);
    if (profile && !result[assignment.agent_user_id]) {
      result[assignment.agent_user_id] = { nome: profile.nome || undefined, email: profile.email || '' };
    }
  }
  return result;
}
