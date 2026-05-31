import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

/** Genera e scarica il backup JSON delle pratiche visibili all'utente */
async function generateBackup(userId: string, isSegreteria: boolean) {
  try {
    // Carica pratiche (con cliente e documenti)
    let q = supabase
      .from('practices')
      .select('*, clients(*), practice_documents(nome,tipo,status,obbligatorio), practice_banks(bank_id,status)');

    if (isSegreteria) {
      const { data: asgn } = await supabase
        .from('segreteria_agent_assignments')
        .select('agent_user_id')
        .eq('segreteria_user_id', userId);
      const ids = (asgn ?? []).map((a: { agent_user_id: string }) => a.agent_user_id);
      if (ids.length > 0) q = q.in('created_by', ids);
      else return; // nessun agente assegnato
    }

    const { data: practices } = await q.order('created_at', { ascending: false });
    if (!practices || practices.length === 0) return;

    const payload = {
      backup_at: new Date().toISOString(),
      generated_by: userId,
      total_practices: practices.length,
      practices,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    a.href     = url;
    a.download = `credifile_backup_${date}.json`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`Backup scaricato — ${practices.length} pratiche`);
  } catch (e) {
    console.error('Backup error:', e);
  }
}

/** Hook: controlla al login se è dovuto un backup automatico */
export function useAutoBackup(userId: string | undefined, isSegreteria: boolean, authReady: boolean) {
  const ran = useRef(false); // evita doppie esecuzioni in StrictMode

  useEffect(() => {
    if (!authReady || !userId || !isSegreteria || ran.current) return;
    ran.current = true;

    (async () => {
      // Leggi preferenze (upsert default se non esistono)
      const { data: prefs } = await supabase
        .from('backup_preferences')
        .select('interval_days,last_backup_at')
        .eq('user_id', userId)
        .single();

      const intervalDays  = prefs?.interval_days ?? 1;
      const lastBackup    = prefs?.last_backup_at ? new Date(prefs.last_backup_at) : null;
      const now           = new Date();
      const hoursSinceLast = lastBackup
        ? (now.getTime() - lastBackup.getTime()) / 3600000
        : Infinity;
      const thresholdHours = intervalDays * 24;

      if (hoursSinceLast < thresholdHours) return; // non ancora dovuto

      // Genera backup e aggiorna last_backup_at
      await generateBackup(userId, isSegreteria);
      await supabase.from('backup_preferences').upsert(
        { user_id: userId, last_backup_at: now.toISOString() },
        { onConflict: 'user_id' }
      );
    })();
  }, [authReady, userId, isSegreteria]);
}
