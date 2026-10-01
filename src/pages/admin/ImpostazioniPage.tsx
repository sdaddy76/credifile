import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Download, Settings, RefreshCw, CloudUpload, CheckCircle, RotateCcw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatRomeDateTime } from '@/lib/dateTime';

const INTERVALLI = [
  { value: '1',  label: 'Ogni giorno' },
  { value: '2',  label: 'Ogni 2 giorni' },
  { value: '3',  label: 'Ogni 3 giorni' },
  { value: '7',  label: 'Ogni settimana' },
  { value: '14', label: 'Ogni 2 settimane' },
  { value: '30', label: 'Ogni mese' },
];

interface DropboxBackup {
  name: string;
  path: string;
  size?: number | null;
  server_modified?: string | null;
}

interface DropboxVerification {
  backup_date?: string | null;
  backup_json_bytes?: number;
  backup_file_count?: number;
  backup_files_ok?: number;
  backup_files_err?: number;
  backup_files_pending?: number;
  current_storage_files?: number;
  dropbox_files?: number;
  dropbox_files_bytes?: number;
  missing_current_files?: number;
  missing_current_paths?: string[];
  complete_at_backup?: boolean;
  current_files_present_on_dropbox?: boolean;
}

function formatBackupSize(size?: number | null) {
  if (!size || size < 1024) return size ? `${size} B` : '';
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ImpostazioniPage() {
  const { user, session, isSegreteria, isSuperAdmin } = useAuth();
  const [intervalDays, setIntervalDays]         = useState('1');
  const [lastBackup, setLastBackup]             = useState<string | null>(null);
  const [saving, setSaving]                     = useState(false);
  const [downloading, setDownloading]           = useState(false);
  const [dropboxLoading, setDropboxLoading]     = useState(false);
  const [lastDropboxBackup, setLastDropboxBackup] = useState<string | null>(null);
  const [dropboxBackups, setDropboxBackups] = useState<DropboxBackup[]>([]);
  const [dropboxBackupsLoading, setDropboxBackupsLoading] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState<string | null>(null);
  const [dropboxVerification, setDropboxVerification] = useState<DropboxVerification | null>(null);
  const [dropboxVerificationLoading, setDropboxVerificationLoading] = useState(false);

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
        total: practices?.length ?? 0,
        practices,
      }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `credifile_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      const now = new Date().toISOString();
      await supabase.from('backup_preferences').upsert(
        { user_id: user.id, last_backup_at: now }, { onConflict: 'user_id' }
      );
      setLastBackup(now);
      toast.success(`Backup scaricato — ${practices?.length ?? 0} pratiche`);
    } catch {
      toast.error('Errore durante il backup');
    }
    setDownloading(false);
  };

  const backupToDropbox = async () => {
    setDropboxLoading(true);
    try {
      // Chiama la Vercel Serverless Function (stessa origine, niente CORS)
      const res = await fetch('/api/dropbox-backup', {
        method: 'POST',
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });
      const json = await res.json();
      if (json.ok) {
        const now = new Date().toISOString();
        setLastDropboxBackup(now);
        await loadDropboxBackups();
        toast.success(
          `Backup Dropbox completato — ${json.tables_total ?? 0} tabelle e ${json.files_ok ?? 0}/${json.files_total ?? 0} file salvati`,
        );
      } else if (json.partial) {
        const firstError = Array.isArray(json.errors) && json.errors.length > 0
          ? ` (${json.errors[0]})`
          : '';
        toast.error(
          `Backup incompleto: ${json.files_ok ?? 0}/${json.files_total ?? 0} file salvati; ${json.files_err ?? 0} errori, ${json.files_pending ?? 0} ancora da completare${firstError}`,
          { duration: 12000 },
        );
      } else {
        toast.error('Errore backup Dropbox: ' + (json.error ?? 'sconosciuto'));
      }
    } catch (e) {
      toast.error('Errore di connessione: ' + String(e));
    }
    setDropboxLoading(false);
  };

  const loadDropboxBackups = async () => {
    if (!session?.access_token) return;
    setDropboxBackupsLoading(true);
    try {
      const res = await fetch('/api/dropbox-backup?action=list', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Elenco non disponibile');
      const backups = Array.isArray(json.backups) ? json.backups as DropboxBackup[] : [];
      setDropboxBackups(backups);
      if (json.latest?.server_modified) setLastDropboxBackup(json.latest.server_modified);
      else if (backups[0]?.server_modified) setLastDropboxBackup(backups[0].server_modified);
    } catch (error) {
      toast.error(`Impossibile caricare gli ultimi backup: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDropboxBackupsLoading(false);
    }
  };

  const restoreDropboxBackup = async (backup: DropboxBackup) => {
    if (!session?.access_token || restoringBackup) return;
    const confirmed = window.confirm(
      `Ripristinare il backup ${backup.name}?\n\n` +
      'I dati del backup verranno reinseriti nel sistema e i file disponibili verranno ripristinati. ' +
      'Le righe create dopo quella data non verranno cancellate automaticamente.',
    );
    if (!confirmed) return;
    setRestoringBackup(backup.path);
    try {
      const res = await fetch('/api/dropbox-backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'restore', path: backup.path }),
      });
      const json = await res.json();
      if (!res.ok && res.status !== 207) throw new Error(json.error ?? 'Ripristino non riuscito');
      const tableCount = Array.isArray(json.tables) ? json.tables.length : 0;
      const message = `Ripristino completato: ${tableCount} tabelle, ${json.files_restored ?? 0}/${json.files_available ?? 0} file.`;
      if (json.partial) {
        toast.warning(`${message} Alcuni elementi non sono stati ripristinati.`, { duration: 12000 });
      } else {
        toast.success(message);
      }
    } catch (error) {
      toast.error(`Errore ripristino: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRestoringBackup(null);
    }
  };

  const verifyDropboxBackup = async () => {
    if (!session?.access_token) return;
    setDropboxVerificationLoading(true);
    try {
      const res = await fetch('/api/dropbox-backup?action=verify', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Verifica non disponibile');
      setDropboxVerification(json as DropboxVerification);
      if (json.complete_at_backup && json.current_files_present_on_dropbox) {
        toast.success('Verifica completata: i documenti risultano presenti su Dropbox');
      } else {
        toast.warning('Verifica completata: sono presenti documenti da controllare', { duration: 10000 });
      }
    } catch (error) {
      toast.error(`Impossibile verificare i documenti: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDropboxVerificationLoading(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin && session?.access_token) void loadDropboxBackups();
  }, [isSuperAdmin, session?.access_token]);

  if (!isSegreteria && !isSuperAdmin) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="w-6 h-6 text-primary" /> Impostazioni
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Preferenze di sistema e backup automatico</p>
      </div>

      {/* ── Card Backup locale ─────────────────────────────────────────────── */}
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
              <span>Ultimo backup: <strong>{formatRomeDateTime(lastBackup)}</strong></span>
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

      {/* ── Card Backup Dropbox (solo super_admin) ─────────────────────────── */}
      {isSuperAdmin && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CloudUpload className="w-4 h-4 text-blue-600" />
              <span>Backup su Dropbox</span>
              <span className="ml-auto text-[11px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5 font-medium">
                Automatico ogni giorno
              </span>
              {lastDropboxBackup && (
                <span className="text-[11px] text-muted-foreground font-normal">
                  Ultimo: {formatRomeDateTime(lastDropboxBackup)}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Esporta i dati delle pratiche, comprese note e report, e copia tutti i file presenti
              nell'archivio delle pratiche su Dropbox ogni giorno a mezzanotte (fuso orario italiano).
              Puoi eseguire un backup manuale in qualsiasi momento.
            </p>

            <div className="bg-white rounded-lg border border-blue-100 px-4 py-3 space-y-1">
              <div className="flex items-center gap-2 font-medium text-foreground text-sm">
                <span>📁</span> Percorso Dropbox
              </div>
              <code className="block bg-muted rounded px-2 py-1 text-xs mt-1">
                /Apps/Credifile/backups/backup_YYYY-MM-DD.json
              </code>
              <p className="text-xs text-muted-foreground mt-1">
                Il file <code>backup_latest.json</code> contiene sempre l'ultimo backup disponibile.
              </p>
            </div>

            {lastDropboxBackup && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                Ultimo backup Dropbox: <strong>{formatRomeDateTime(lastDropboxBackup)}</strong>
              </div>
            )}

            <div className="border border-blue-100 bg-white rounded-lg px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-sm text-foreground">Ultimi backup disponibili</div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={loadDropboxBackups}
                    disabled={dropboxBackupsLoading}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${dropboxBackupsLoading ? 'animate-spin' : ''}`} />
                    Aggiorna
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={verifyDropboxBackup}
                    disabled={dropboxVerificationLoading}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <CheckCircle className={`w-3.5 h-3.5 ${dropboxVerificationLoading ? 'animate-pulse' : ''}`} />
                    {dropboxVerificationLoading ? 'Verifica...' : 'Verifica documenti'}
                  </Button>
                </div>
              </div>
              {dropboxBackupsLoading && dropboxBackups.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Caricamento elenco...
                </div>
              ) : dropboxBackups.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">Nessun backup giornaliero trovato.</p>
              ) : (
                <div className="divide-y divide-blue-50">
                  {dropboxBackups.map(backup => (
                    <div key={backup.path} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{backup.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {backup.server_modified ? formatRomeDateTime(backup.server_modified) : 'Data non disponibile'}
                          {backup.size ? ` · ${formatBackupSize(backup.size)}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline disabled:opacity-50"
                        onClick={() => restoreDropboxBackup(backup)}
                        disabled={Boolean(restoringBackup)}
                      >
                        {restoringBackup === backup.path
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <RotateCcw className="w-3.5 h-3.5" />}
                        {restoringBackup === backup.path ? 'Ripristino...' : 'Ripristina'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground pt-1">
                Il ripristino reinserisce i dati e i file disponibili senza cancellare automaticamente quelli creati dopo il backup.
              </p>
            </div>

            {dropboxVerification && (
              <div className={`rounded-lg border px-4 py-3 space-y-2 ${
                dropboxVerification.complete_at_backup && dropboxVerification.current_files_present_on_dropbox
                  ? 'border-green-200 bg-green-50/70'
                  : 'border-amber-200 bg-amber-50/70'
              }`}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  Verifica documenti del backup {dropboxVerification.backup_date ?? 'più recente'}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>File previsti dal backup</span>
                  <strong className="text-foreground">{dropboxVerification.backup_file_count ?? 0}</strong>
                  <span>File caricati senza errore</span>
                  <strong className="text-foreground">{dropboxVerification.backup_files_ok ?? 0}</strong>
                  <span>File fisici presenti oggi nello Storage</span>
                  <strong className="text-foreground">{dropboxVerification.current_storage_files ?? 0}</strong>
                  <span>File presenti su Dropbox</span>
                  <strong className="text-foreground">
                    {dropboxVerification.dropbox_files ?? 0}
                    {dropboxVerification.dropbox_files_bytes
                      ? ` · ${formatBackupSize(dropboxVerification.dropbox_files_bytes)}`
                      : ''}
                  </strong>
                </div>
                {(dropboxVerification.backup_files_err ?? 0) > 0 || (dropboxVerification.backup_files_pending ?? 0) > 0 ? (
                  <p className="text-xs text-amber-800">
                    Il backup segnala {dropboxVerification.backup_files_err ?? 0} errori e {dropboxVerification.backup_files_pending ?? 0} file non completati.
                  </p>
                ) : (dropboxVerification.missing_current_files ?? 0) > 0 ? (
                  <p className="text-xs text-amber-800">
                    Mancano su Dropbox {dropboxVerification.missing_current_files} file presenti oggi nello Storage.
                  </p>
                ) : (
                  <p className="text-xs text-green-800">
                    Tutti i file fisici risultano presenti nell’archivio Dropbox.
                  </p>
                )}
              </div>
            )}

            <Button
              onClick={backupToDropbox}
              disabled={dropboxLoading}
              className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <CloudUpload className="w-4 h-4" />
              {dropboxLoading ? 'Backup in corso...' : 'Esegui backup Dropbox ora'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
