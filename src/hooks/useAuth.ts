import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

export type UserRole = 'super_admin' | 'agente' | 'banca' | 'supervisore_segreteria' | null;

interface AuthProfile {
  ruolo: UserRole;
  nome?: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<UserRole>(null);
  const [profileNome, setProfileNome] = useState<string | null>(null);

  async function fetchRole(userId: string) {
    const { data } = await supabase
      .from('admin_profiles')
      .select('ruolo, nome')
      .eq('id', userId)
      .maybeSingle();
    const profile = data as AuthProfile | null;
    setRole(profile?.ruolo ?? 'agente');
    setProfileNome(profile?.nome ?? null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id);
      } else {
        setRole(null);
        setProfileNome(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setRole(null);
    setProfileNome(null);
  };

  const isSuperAdmin = role === 'super_admin';
  const isAgente     = role === 'agente';
  const isBanca      = role === 'banca';
  const isSegreteria = role === 'supervisore_segreteria';

  return {
    user,
    session,
    loading,
    role,
    profileNome,
    isSuperAdmin,
    isAgente,
    isBanca,
    isSegreteria,
    // canEdit: può creare/modificare pratiche e documenti
    canEdit: isSuperAdmin || isAgente || isSegreteria,
    // canApprove: può approvare/rifiutare documenti
    canApprove: isSuperAdmin || isAgente,
    // canManageAll: accesso a utenti, banche, template
    canManageAll: isSuperAdmin || isAgente,
    signIn,
    signOut,
  };
}
