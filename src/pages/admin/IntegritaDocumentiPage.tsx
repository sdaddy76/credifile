import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertTriangle, CheckCircle2, FileWarning, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type RowKind = 'ok' | 'file_mancante' | 'voce_senza_file';

type IntegrityRow = {
  id: string;
  kind: RowKind;
  practiceId: string;
  practiceDocumentId: string | null;
  uploadedFileId: string | null;
  storagePath: string | null;
  pratica: string;
  voceDocumentale: string;
  nomeFile: string;
  statoDb: string;
  statoStorage: string;
  canDeleteRecord: boolean;
  canMarkReload: boolean;
};

type UploadedFileRow = {
  id: string;
  practice_id: string;
  practice_document_id: string | null;
  storage_path: string | null;
  nome_file: string | null;
  practice_documents?: { id: string; nome: string | null; status: string | null } | { id: string; nome: string | null; status: string | null }[] | null;
  practices?: { id: string; numero_pratica: string | null; clients?: { ragione_sociale: string | null } | { ragione_sociale: string | null }[] | null } | { id: string; numero_pratica: string | null; clients?: { ragione_sociale: string | null } | { ragione_sociale: string | null }[] | null }[] | null;
};

type PracticeDocumentRow = {
  id: string;
  practice_id: string;
  nome: string | null;
  status: string | null;
  uploaded_files?: { id: string }[] | null;
  practices?: { id: string; numero_pratica: string | null; clients?: { ragione_sociale: string | null } | { ragione_sociale: string | null }[] | null } | { id: string; numero_pratica: string | null; clients?: { ragione_sociale: string | null } | { ragione_sociale: string | null }[] | null }[] | null;
};

function first<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function practiceLabel(practice: UploadedFileRow['practices'] | PracticeDocumentRow['practices'], fallbackId: string) {
  const p = first(practice);
  const client = first(p?.clients);
  const numero = p?.numero_pratica ? `#${p.numero_pratica}` : `#${fallbackId.slice(0, 8)}`;
  return client?.ragione_sociale ? `${numero} · ${client.ragione_sociale}` : numero;
}

function isStorageNotFound(errorMessage: string) {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes('not_found') || normalized.includes('not found') || normalized.includes('object not found') || normalized.includes('does not exist') || normalized.includes('404');
}

function StatusBadge({ kind }: { kind: RowKind }) {
  if (kind === 'ok') {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">✅ OK</Badge>;
  }
  if (kind === 'file_mancante') {
    return <Badge variant="destructive">❌ File mancante</Badge>;
  }
  return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">⚠️ Voce senza file</Badge>;
}

export default function IntegritaDocumentiPage() {
  const { role, loading: authLoading, isSuperAdmin, isSegreteria } = useAuth();
  const [checking, setChecking] = useState(false);
  const [rows, setRows] = useState<IntegrityRow[]>([]);
  const [hasRun, setHasRun] = useState(false);
  const isAdmin = isSuperAdmin || isSegreteria;

  const stats = useMemo(() => {
    const totale = rows.filter(r => r.uploadedFileId).length;
    const ok = rows.filter(r => r.kind === 'ok').length;
    const mancanti = rows.filter(r => r.kind === 'file_mancante').length;
    const senzaFile = rows.filter(r => r.kind === 'voce_senza_file').length;
    return { totale, ok, mancanti, senzaFile };
  }, [rows]);

  const runCheck = async () => {
    if (!isAdmin) {
      toast.error('Accesso non autorizzato');
      return;
    }

    setChecking(true);
    setHasRun(true);
    try {
      const { data: uploadedData, error: uploadedError } = await supabase
        .from('uploaded_files')
        .select('id, practice_id, practice_document_id, storage_path, nome_file, practice_documents(id,nome,status), practices(id,numero_pratica,clients(ragione_sociale))')
        .order('created_at', { ascending: false });

      if (uploadedError) throw uploadedError;

      const fileRows: IntegrityRow[] = [];
      for (const file of ((uploadedData ?? []) as UploadedFileRow[])) {
        const doc = first(file.practice_documents);
        const storagePath = file.storage_path ?? '';
        let exists = false;
        let storageLabel = '❌ File mancante';

        if (!storagePath) {
          storageLabel = '❌ Percorso storage assente';
        } else {
          const { error } = await supabase.storage.from('practice-files').createSignedUrl(storagePath, 60);
          if (!error) {
            exists = true;
            storageLabel = '✅ Presente';
          } else {
            storageLabel = isStorageNotFound(error.message) ? '❌ File mancante' : `❌ ${error.message}`;
          }
        }

        fileRows.push({
          id: `file-${file.id}`,
          kind: exists ? 'ok' : 'file_mancante',
          practiceId: file.practice_id,
          practiceDocumentId: file.practice_document_id ?? doc?.id ?? null,
          uploadedFileId: file.id,
          storagePath: storagePath || null,
          pratica: practiceLabel(file.practices, file.practice_id),
          voceDocumentale: doc?.nome ?? 'Voce non collegata',
          nomeFile: file.nome_file ?? storagePath.split('/').pop() ?? 'N/D',
          statoDb: exists ? 'Record DB presente' : '🗑️ Da eliminare',
          statoStorage: storageLabel,
          canDeleteRecord: !exists,
          canMarkReload: !exists && Boolean(file.practice_document_id ?? doc?.id),
        });
      }

      const { data: docsData, error: docsError } = await supabase
        .from('practice_documents')
        .select('id, practice_id, nome, status, uploaded_files(id), practices(id,numero_pratica,clients(ragione_sociale))')
        .eq('status', 'caricato')
        .order('created_at', { ascending: false });

      if (docsError) throw docsError;

      const missingDocRows: IntegrityRow[] = ((docsData ?? []) as PracticeDocumentRow[])
        .filter(doc => !doc.uploaded_files || doc.uploaded_files.length === 0)
        .map((doc): IntegrityRow => ({
          id: `doc-${doc.id}`,
          kind: 'voce_senza_file',
          practiceId: doc.practice_id,
          practiceDocumentId: doc.id,
          uploadedFileId: null,
          storagePath: null,
          pratica: practiceLabel(doc.practices, doc.practice_id),
          voceDocumentale: doc.nome ?? 'Voce documentale',
          nomeFile: '—',
          statoDb: "Status 'caricato' senza file collegati",
          statoStorage: '⚠️ Nessun uploaded_files',
          canDeleteRecord: false,
          canMarkReload: true,
        }));

      setRows([...fileRows, ...missingDocRows]);
      toast.success('Verifica integrità completata');
    } catch (error) {
      toast.error('Errore verifica documenti: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setChecking(false);
    }
  };

  const deleteUploadedRecord = async (row: IntegrityRow) => {
    if (!row.uploadedFileId) return;
    if (!confirm(`Eliminare il record DB del file "${row.nomeFile}"? Il file non è stato trovato nello storage.`)) return;

    const { error } = await supabase.from('uploaded_files').delete().eq('id', row.uploadedFileId);
    if (error) {
      toast.error('Errore eliminazione record: ' + error.message);
      return;
    }

    setRows(prev => prev.filter(r => r.id !== row.id));
    toast.success('Record DB eliminato');
  };

  const markAsReload = async (row: IntegrityRow) => {
    if (!row.practiceDocumentId) return;
    if (!confirm(`Segnare "${row.voceDocumentale}" come documento da ricaricare?`)) return;

    const { error } = await supabase
      .from('practice_documents')
      .update({ status: 'richiesto', uploaded_at: null, note_rifiuto: null })
      .eq('id', row.practiceDocumentId);

    if (error) {
      toast.error('Errore aggiornamento voce: ' + error.message);
      return;
    }

    setRows(prev => prev.map(r => r.id === row.id ? { ...r, statoDb: "Status ripristinato a 'richiesto'", canMarkReload: false } : r));
    toast.success('Voce segnata come da ricaricare');
  };

  if (authLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <AlertTriangle className="w-10 h-10 mx-auto text-amber-500" />
          <h1 className="text-xl font-semibold">Accesso riservato agli amministratori</h1>
          <p className="text-sm text-muted-foreground">Il tuo ruolo attuale è: {role ?? 'non disponibile'}.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="w-6 h-6 text-primary" />
            Integrità Documenti
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Verifica che ogni record documentale del database abbia il file effettivamente presente nello storage.
          </p>
        </div>
        <Button onClick={runCheck} disabled={checking} className="gap-2">
          {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {checking ? 'Verifica in corso…' : 'Avvia verifica'}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Totale file verificati</p>
            <p className="text-2xl font-bold mt-1">{stats.totale}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">File OK</p>
            <p className="text-2xl font-bold mt-1 text-green-700">{stats.ok}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">File mancanti</p>
            <p className="text-2xl font-bold mt-1 text-red-700">{stats.mancanti}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Voci senza file</p>
            <p className="text-2xl font-bold mt-1 text-amber-700">{stats.senzaFile}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileWarning className="w-4 h-4" />
            Esito verifica
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!hasRun ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Premi “Avvia verifica” per controllare tutti i file caricati nelle pratiche.
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 mx-auto text-green-600" />
              <p className="font-medium">Nessuna anomalia trovata.</p>
              <p className="text-sm text-muted-foreground">Non sono presenti record documentali da mostrare.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pratica</TableHead>
                  <TableHead>Voce documentale</TableHead>
                  <TableHead>Nome file</TableHead>
                  <TableHead>Stato DB</TableHead>
                  <TableHead>Stato Storage</TableHead>
                  <TableHead>Azione</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-[180px] font-medium">{row.pratica}</TableCell>
                    <TableCell className="min-w-[180px]">{row.voceDocumentale}</TableCell>
                    <TableCell className="min-w-[180px] break-all">{row.nomeFile}</TableCell>
                    <TableCell className="min-w-[170px]">
                      <div className="space-y-1">
                        <StatusBadge kind={row.kind} />
                        <p className="text-xs text-muted-foreground">{row.statoDb}</p>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[160px] text-sm">{row.statoStorage}</TableCell>
                    <TableCell className="min-w-[220px]">
                      {row.kind === 'ok' ? (
                        <span className="text-xs text-muted-foreground">Nessuna azione</span>
                      ) : (
                        <div className="flex flex-col sm:flex-row gap-2">
                          {row.canDeleteRecord && (
                            <Button variant="destructive" size="sm" className="gap-1" onClick={() => deleteUploadedRecord(row)}>
                              <Trash2 className="w-3.5 h-3.5" /> Elimina record DB
                            </Button>
                          )}
                          {row.canMarkReload && (
                            <Button variant="outline" size="sm" onClick={() => markAsReload(row)}>
                              Segna come da ricaricare
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
