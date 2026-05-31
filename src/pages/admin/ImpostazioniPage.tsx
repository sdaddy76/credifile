import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Download, Settings, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

const INTERVALLI = [
  { value: '1',  label: 'Ogni giorno' },
  { value: '2',  label: 'Ogni 2 giorni' },
  { value: '3',  label: 'Ogni 3 giorni' },
  { value: '7',  label: 'Ogni settimana' },
  { value: '14', label: 'Ogni 2 settimane' },
  { value: '30', label: 'Ogni mese' },
];

export default function ImpostazioniPage() {
  const { user, isSegreteria, isSuperAdmin } = useAuth();
  const [intervalDays, setIntervalDays] = useState('1');
  const [lastBackup, setLastBackup]     = useState<string | null>(null);
  const [saving, setSaving]             = useState(false);
  const [downloading, setDownloading]   = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('backup_preferences')
      .select('interval_days,last_backup_at')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setIntervalDays(String(data.interval_days));
          setLastBackup(data.last_backup_at);
        }
      });
  }, [user?.id]);

  const savePrefs = async () => {
    if (!user?.id) return;
    setSaving(true);
    await supabase.from('backup_preferences').upsert(
      { user_id: user.id, interval_days: Number(intervalDays) },
      { onConflict: 'user_id' }
    );
    setSaving(false);
    toast.success('Preferenze salvate');
  };

  const downloadNow = async () => {
    if (!user?.id) return;
    setDownloading(true);
    try {
      let q = supabase.from('practices')
        .select('*, clients(*), practice_documents(nome,tipo,status), practice_banks(bank_id,status)');
      if (isSegreteria) {
        const { data: asgn } = await supabase.from('segreteria_agent_assignments')
          .select('agent_user_id').eq('segreteria_user_id', user.id);
        const ids = (asgn ?? []).map((a: { agent_user_id: string }) => a.agent_user_id);
        if (ids.length) q = q.in('created_by', ids);
      }
      const { data: practices } = await q.order('created_at', { ascending: false });
      const blob = new Blob([JSON.stringify({
        backup_at: new Date().toISOString(),
        total: practices?.length ?? 0, practices,
      }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `credifile_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      // aggiorna last_backup_at
      const now = new Date().toISOString();
      await supabase.from('backup_preferences').upsert(
        { user_id: user.id, last_backup_at: now }, { onConflict: 'user_id' }
      );
      setLastBackup(now);
      toast.success(`Backup scaricato — ${practices?.length ?? 0} pratiche`);
    } catch { toast.error('Errore durante il backup'); }
    setDownloading(false);
  };

  if (!isSegreteria && !isSuperAdmin) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" /> Impostazioni
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Preferenze di sistema e backup automatico</p>
      </div>

      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Download className="w-4 h-4 text-primary" /> Backup Automatico
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Il backup viene scaricato automaticamente al primo accesso del giorno (o secondo l'intervallo
            impostato). Contiene tutte le pratiche con clienti e documenti in formato JSON.
          </p>

          {lastBackup && (
            <div className="bg-muted/50 rounded-lg px-4 py-2 text-sm flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-muted-foreground shrink-0" />
              <span>Ultimo backup: <strong>{new Date(lastBackup).toLocaleString('it-IT')}</strong></span>
            </div>
          )}

          <div className="space-y-2">
            <Label>Frequenza backup automatico</Label>
            <div className="flex gap-3 items-end">
              <Select value={intervalDays} onValueChange={setIntervalDays}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALLI.map(i => (
                    <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={savePrefs} disabled={saving} size="sm">
                {saving ? 'Salvo...' : 'Salva'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Il sistema scaricherà il backup automaticamente al login, rispettando questo intervallo.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <Button onClick={downloadNow} disabled={downloading} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              {downloading ? 'Download in corso...' : 'Scarica backup adesso'}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Esegui un backup manuale immediato indipendentemente dall'intervallo impostato.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
