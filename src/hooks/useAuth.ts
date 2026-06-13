import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { User, Session } from '@supabase/supabase-js';

export type UserRole = 'super_admin' | 'agente' | 'supervisore_segreteria' | 'segnalatore' | 'consulente' | 'banca' | null;

// Email protette: il ruolo super_admin è garantito anche in caso di timeout/errore DB
const PROTECTED_SUPER_ADMINS = ['stefano@daddino.com'];

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

  async function fetchRole(userId: string, userEmail?: string | null): Promise<void> {
    // Protezione frontend: se l'email è nell'elenco protetto, forza super_admin
    // indipendentemente da quello che restituisce il DB (la vera protezione è il trigger DB)
    const isProtected = userEmail && PROTECTED_SUPER_ADMINS.includes(userEmail.toLowerCase());

    try {
      // Timeout: se la query admin_profiles non risponde in 6s, fallback
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000));
      const query = supabase
        .from('admin_profiles')
        .select('ruolo, nome')
        .eq('id', userId)
        .maybeSingle();

      const data = await Promise.race([
        query.then(r => r.data as AuthProfile | null),
        timeout,
      ]);

      // Se email protetta, ignora il ruolo dal DB e forza super_admin
      const resolvedRole: UserRole = isProtected ? 'super_admin' : (data?.ruolo ?? 'agente');
      setRole(resolvedRole);
      setProfileNome(data?.nome ?? null);
    } catch {
      // Su errori di rete: email protetta → super_admin, altrimenti fallback sicuro a null
      setRole(isProtected ? 'super_admin' : null);
    }
  }

  useEffect(() => {
    // Timeout di sicurezza assoluto: dopo 8s forziamo loading=false
    // Evita spinner infinito su mobile con rete lenta
    const safetyTimer = setTimeout(() => setLoading(false), 8000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchRole(session.user.id, session.user.email).finally(() => {
            clearTimeout(safetyTimer);
            setLoading(false);
          });
        } else {
          clearTimeout(safetyTimer);
          setLoading(false);
        }
      })
      .catch(() => {
        clearTimeout(safetyTimer);
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        // Non blocchiamo il loading qui (già gestito da getSession),
        // ma aggiorniamo ruolo se cambia sessione
        fetchRole(session.user.id, session.user.email).finally(() => setLoading(false));
      } else {
        setRole(null);
        setProfileNome(null);
        setLoading(false);
      }
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(safetyTimer);
    };
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

  const isSuperAdmin   = role === 'super_admin';
  const isAgente       = role === 'agente';
  const isSegreteria   = role === 'supervisore_segreteria';
  const isSegnalatore  = role === 'segnalatore';
  const isConsulente   = role === 'consulente';
  const isBanca        = role === 'banca';

  return {
    user, session, loading, role, profileNome,
    isSuperAdmin, isAgente, isSegreteria, isSegnalatore, isConsulente, isBanca,
    canEdit:        isSuperAdmin || isAgente,
    canApprove:     isSuperAdmin || isSegreteria,
    canManageBanks: isSuperAdmin || isSegreteria,
    canManageAll:   isSuperAdmin,
    signIn, signOut,
  };
}
