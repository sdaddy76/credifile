import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import SchedaValutazioneRischio from '@/components/SchedaValutazioneRischio';
import {
  ArrowLeft, Copy, Plus, Link2, CheckCircle, XCircle,
  FileText, Clock, Download, Upload, RefreshCw, Building2, User, Euro, AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';
import {
  STATUS_LABELS, STATUS_COLORS, DOC_STATUS_LABELS, DOC_STATUS_COLORS,
  type Practice, type PracticeDocument, type PracticeStatusLog,
  type Bank, type PracticeAccessCode
} from '@/lib/types';

export default function PraticaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAgente, canEdit, canApprove, user } = useAuth();
  const adminFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingAdminDoc, setUploadingAdminDoc] = useState<string | null>(null);

  const [practice, setPractice] = useState<Practice | null>(null);
  const [documents, setDocuments] = useState<PracticeDocument[]>([]);
  const [logs, setLogs] = useState<PracticeStatusLog[]>([]);
  const [accessCode, setAccessCode] = useState<PracticeAccessCode | null>(null);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialogs
  const [showStatusChange, setShowStatusChange] = useState(false);
  const [showAddDoc, setShowAddDoc] = useState(false);
  const [showRejectDoc, setShowRejectDoc] = useState<string | null>(null);
  const [showIntegration, setShowIntegration] = useState(false);

  const [newStatus, setNewStatus] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [newDocName, setNewDocName] = useState('');
  const [newDocDesc, setNewDocDesc] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [integrationName, setIntegrationName] = useState('');
  const [integrationDesc, setIntegrationDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [p, docs, l, ac] = await Promise.all([
      supabase.from('practices').select('*, clients(*), banks(*)').eq('id', id).single(),
      supabase.from('practice_documents').select('*, uploaded_files(*)').eq('practice_id', id).order('created_at'),
      supabase.from('practice_status_log').select('*').eq('practice_id', id).order('created_at', { ascending: false }),
      supabase.from('practice_access_codes').select('*').eq('practice_id', id).maybeSingle(),
    ]);
    setPractice(p.data as Practice);
    setDocuments(docs.data as PracticeDocument[] ?? []);
    setLogs(l.data ?? []);
    setAccessCode(ac.data);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
    supabase.from('banks').select('*').eq('attiva', true).then(r => setBanks(r.data ?? []));
  }, [load]);

  // Genera codice accesso cliente + invia email
  const generateAccessCode = async () => {
    if (!practice) return;
    const client = (practice as Practice & { clients?: { email: string } }).clients;
    if (!client?.email) { toast.error('Il cliente non ha un email'); return; }

    const codice = Math.random().toString(36).substring(2, 8).toUpperCase();
    const scadenza = new Date();
    scadenza.setDate(scadenza.getDate() + 30);

    if (accessCode) {
      await supabase.from('practice_access_codes').update({ codice, email_cliente: client.email, scadenza: scadenza.toISOString() }).eq('id', accessCode.id);
    } else {
      await supabase.from('practice_access_codes').insert({
        practice_id: practice.id, codice, email_cliente: client.email, scadenza: scadenza.toISOString(),
      });
    }
    await load();
    toast.success('Codice accesso generato!');

    // Recupera nome consulente
    const { data: profile } = await supabase.from('admin_profiles').select('nome').eq('id', user?.id ?? '').maybeSingle();
    const consultantName = profile?.nome ?? user?.email ?? 'Il tuo consulente';

    // Costruisci link
    const link = `${window.location.origin}${window.location.pathname}#/accesso?p=${practice.id}`;

    // Lista documenti richiesti
    const { data: docs } = await supabase.from('practice_documents').select('nome').eq('practice_id', practice.id);
    const docNames = (docs ?? []).map((d: { nome: string }) => d.nome);

    // Invia email via edge function
    const { error: emailError } = await supabase.functions.invoke('send-client-email', {
      body: {
        to: client.email,
        consultant_name: consultantName,
        documents: docNames,
        link,
        code: codice,
        practice_number: practice.numero_pratica,
      },
    });
    if (emailError) {
      toast.warning('Codice generato ma email non inviata. Controlla la configurazione email.');
    } else {
      toast.success(`Email inviata a ${client.email}!`);
    }
  };

  // Upload documento da admin (per conto del cliente)
  const handleAdminUpload = async (docId: string, file: File) => {
    if (!id) return;
    if (file.size > 20 * 1024 * 1024) { toast.error('File troppo grande. Max 20 MB.'); return; }
    setUploadingAdminDoc(docId);
    const path = `${id}/${docId}/${Date.now()}_${file.name}`;
    try { await supabase.storage.from('practice-files').upload(path, file, { upsert: false }); } catch (_e) { /* ignora errori storage */ }
    await supabase.from('uploaded_files').insert({
      practice_document_id: docId, practice_id: id,
      nome_file: file.name, storage_path: path,
      mime_type: file.type, dimensione: file.size, uploaded_by: 'admin',
    });
    await supabase.from('practice_documents').update({ status: 'caricato', uploaded_at: new Date().toISOString() }).eq('id', docId);
    toast.success(`"${file.name}" caricato con successo`);
    setUploadingAdminDoc(null);
    load();
  };

  const copyLink = () => {
    const url = `${window.location.origin}${window.location.pathname}#/accesso?p=${id}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copiato negli appunti');
  };

  const copyCode = () => {
    if (accessCode) { navigator.clipboard.writeText(accessCode.codice); toast.success('Codice copiato'); }
  };

  // Cambio stato pratica
  const handleStatusChange = async () => {
    if (!practice || !newStatus) return;
    setSaving(true);
    await supabase.from('practices').update({ status: newStatus }).eq('id', practice.id);
    await supabase.from('practice_status_log').insert({
      practice_id: practice.id, old_status: practice.status, new_status: newStatus,
      note: statusNote || null, created_by: 'admin',
    });
    toast.success('Stato aggiornato');
    setSaving(false);
    setShowStatusChange(false);
    setStatusNote('');
    load();
  };

  // Approva/rifiuta documento
  const approveDoc = async (docId: string) => {
    await supabase.from('practice_documents').update({ status: 'approvato' }).eq('id', docId);
    toast.success('Documento approvato');
    load();
  };

  const rejectDoc = async () => {
    if (!showRejectDoc) return;
    await supabase.from('practice_documents').update({ status: 'rifiutato', note_rifiuto: rejectNote }).eq('id', showRejectDoc);
    toast.success('Documento rifiutato — il cliente verrà informato');
    setShowRejectDoc(null);
    setRejectNote('');
    load();
  };

  // Aggiunta doc manuale
  const handleAddDoc = async () => {
    if (!newDocName.trim()) { toast.error('Inserisci il nome del documento'); return; }
    setSaving(true);
    await supabase.from('practice_documents').insert({
      practice_id: id, nome: newDocName, descrizione: newDocDesc, tipo: 'standard',
      obbligatorio: true, status: 'richiesto',
    });
    toast.success('Documento aggiunto');
    setSaving(false);
    setShowAddDoc(false);
    setNewDocName(''); setNewDocDesc('');
    load();
  };

  // Aggiunta integrazione
  const handleAddIntegration = async () => {
    if (!integrationName.trim()) { toast.error('Inserisci il nome del documento'); return; }
    setSaving(true);
    await supabase.from('practice_documents').insert({
      practice_id: id, nome: integrationName, descrizione: integrationDesc,
      tipo: 'integrazione', obbligatorio: true, status: 'richiesto',
    });
    // Aggiorna stato pratica
    await supabase.from('practices').update({ status: 'integrazioni_richieste' }).eq('id', id);
    await supabase.from('practice_status_log').insert({
      practice_id: id, old_status: practice?.status, new_status: 'integrazioni_richieste',
      note: `Richiesta integrazione: ${integrationName}`, created_by: 'admin',
    });
    toast.success('Integrazione richiesta — stato pratica aggiornato');
    setSaving(false);
    setShowIntegration(false);
    setIntegrationName(''); setIntegrationDesc('');
    load();
  };

  const downloadFile = async (path: string, name: string) => {
    const { data } = await supabase.storage.from('practice-files').createSignedUrl(path, 60);
    if (data?.signedUrl) {
      const a = document.createElement('a');
      a.href = data.signedUrl;
      a.download = name;
      a.click();
    }
  };

  if (loading) return (
    <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
  );
  if (!practice) return <div className="text-center py-20 text-muted-foreground">Pratica non trovata</div>;

  const client = (practice as Practice & { clients?: { ragione_sociale: string; email: string; piva?: string; telefono?: string } }).clients;
  const bank = (practice as Practice & { banks?: { nome: string } }).banks;
  const docsStandard = documents.filter(d => d.tipo === 'standard');
  const docsBanca = documents.filter(d => d.tipo === 'banca');
  const docsIntegrazione = documents.filter(d => d.tipo === 'integrazione');
  const completedDocs = documents.filter(d => d.status === 'caricato' || d.status === 'approvato').length;

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" className="mt-0.5" onClick={() => navigate('/admin/pratiche')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-foreground">{client?.ragione_sociale}</h1>
            <code className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded font-mono">{practice.numero_pratica}</code>
            <Badge className={STATUS_COLORS[practice.status]}>{STATUS_LABELS[practice.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Creata il {new Date(practice.created_at).toLocaleDateString('it-IT')}
            {bank && ` · ${bank.nome}`}
          </p>
        </div>
        {canApprove && (
          <Button variant="outline" size="sm" onClick={() => { setNewStatus(practice.status); setShowStatusChange(true); }}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Cambia Stato
          </Button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Info cliente */}
        <div className="space-y-4">
          <Card className="border-border">
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><User className="w-4 h-4 text-primary" />Dati Cliente</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><p className="text-muted-foreground text-xs">Ragione Sociale</p><p className="font-medium">{client?.ragione_sociale}</p></div>
              <div><p className="text-muted-foreground text-xs">Email</p><p>{client?.email}</p></div>
              {client?.piva && <div><p className="text-muted-foreground text-xs">P.IVA</p><p className="font-mono">{client.piva}</p></div>}
              {client?.telefono && <div><p className="text-muted-foreground text-xs">Telefono</p><p>{client.telefono}</p></div>}
              {bank && <div><p className="text-muted-foreground text-xs">Banca</p><p className="flex items-center gap-1"><Building2 className="w-3 h-3" />{bank.nome}</p></div>}
              {practice.importo_richiesto && <div><p className="text-muted-foreground text-xs">Importo</p><p className="flex items-center gap-1 font-semibold"><Euro className="w-3 h-3" />{practice.importo_richiesto.toLocaleString('it-IT')}</p></div>}
              {practice.motivazione && <div><p className="text-muted-foreground text-xs">Motivazione Richiesta</p><p className="text-sm mt-0.5 bg-muted/50 rounded p-2 leading-relaxed">{practice.motivazione}</p></div>}
            </CardContent>
          </Card>

          {/* Avanzamento documenti */}
          <Card className="border-border">
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FileText className="w-4 h-4 text-primary" />Avanzamento</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-end gap-2 mb-2">
                <span className="text-2xl font-bold text-foreground">{completedDocs}</span>
                <span className="text-muted-foreground text-sm mb-0.5">/ {documents.length} documenti</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${documents.length > 0 ? (completedDocs / documents.length) * 100 : 0}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {documents.length > 0 ? Math.round((completedDocs / documents.length) * 100) : 0}% completato
              </p>
            </CardContent>
          </Card>

          {/* Link cliente — solo agente */}
          {isAgente && (
          <Card className="border-border">
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" />Portale Cliente</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {accessCode ? (
                <>
                  <div className="bg-muted rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Codice Accesso</span>
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={copyCode}>
                        <Copy className="w-3 h-3" /> Copia
                      </Button>
                    </div>
                    <code className="text-lg font-bold font-mono text-foreground tracking-widest">{accessCode.codice}</code>
                    <p className="text-xs text-muted-foreground">Email: {accessCode.email_cliente}</p>
                    {accessCode.last_access && <p className="text-xs text-muted-foreground">Ultimo accesso: {new Date(accessCode.last_access).toLocaleDateString('it-IT')}</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={copyLink}>
                      <Copy className="w-3 h-3" /> Copia Link
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1 gap-1 text-xs" onClick={generateAccessCode}>
                      <RefreshCw className="w-3 h-3" /> Rigenera
                    </Button>
                  </div>
                </>
              ) : (
                <Button className="w-full gap-2" size="sm" onClick={generateAccessCode}>
                  <Link2 className="w-3.5 h-3.5" /> Genera Link Cliente
                </Button>
              )}
            </CardContent>
          </Card>
          )} {/* fine isAgente portale cliente */}
        </div>

        {/* Documenti + Log */}
        <div className="lg:col-span-2 space-y-4">
          <Tabs defaultValue="documenti">
            <TabsList>
              <TabsTrigger value="documenti">Documenti ({documents.length})</TabsTrigger>
              <TabsTrigger value="scheda">Scheda Rischio</TabsTrigger>
              <TabsTrigger value="log">Storico Stati</TabsTrigger>
            </TabsList>

            <TabsContent value="documenti" className="space-y-3 mt-3">
              {/* Actions */}
              {(canEdit || canApprove) && (
              <div className="flex gap-2 flex-wrap">
                {canEdit && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAddDoc(true)}>
                  <Plus className="w-3.5 h-3.5" /> Aggiungi Documento
                </Button>
                )}
                {canApprove && (
                <Button size="sm" variant="outline" className="gap-1.5 text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => setShowIntegration(true)}>
                  <AlertCircle className="w-3.5 h-3.5" /> Richiedi Integrazione
                </Button>
                )}
              </div>
              )}

              {/* Documenti per tipo */}
              {[
                { label: 'Documenti Standard', docs: docsStandard, color: 'text-blue-600' },
                { label: 'Documenti Banca', docs: docsBanca, color: 'text-purple-600' },
                { label: 'Integrazioni', docs: docsIntegrazione, color: 'text-amber-600' },
              ].filter(g => g.docs.length > 0).map(group => (
                <div key={group.label}>
                  <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${group.color}`}>{group.label}</p>
                  <div className="space-y-2">
                    {group.docs.map(doc => {
                      const files = (doc as PracticeDocument & { uploaded_files?: { id: string; nome_file: string; storage_path: string }[] }).uploaded_files ?? [];
                      return (
                        <Card key={doc.id} className="border-border">
                          <CardContent className="py-3 px-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-medium text-foreground">{doc.nome}</p>
                                  {doc.obbligatorio && <span className="text-xs text-red-500">*</span>}
                                  <Badge className={`text-xs ${DOC_STATUS_COLORS[doc.status]}`}>{DOC_STATUS_LABELS[doc.status]}</Badge>
                                </div>
                                {doc.descrizione && <p className="text-xs text-muted-foreground mt-0.5">{doc.descrizione}</p>}
                                {doc.note_rifiuto && <p className="text-xs text-red-600 mt-1 bg-red-50 px-2 py-1 rounded">Motivo rifiuto: {doc.note_rifiuto}</p>}
                                {files.length > 0 && (
                                  <div className="mt-2 space-y-1">
                                    {files.map(f => (
                                      <button
                                        key={f.id}
                                        className="flex items-center gap-2 text-xs text-primary hover:underline"
                                        onClick={() => downloadFile(f.storage_path, f.nome_file)}
                                      >
                                        <Download className="w-3 h-3" /> {f.nome_file}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {doc.status === 'caricato' && canApprove && (
                                <div className="flex gap-1 shrink-0">
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600 hover:bg-green-50" onClick={() => approveDoc(doc.id)}>
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:bg-red-50" onClick={() => setShowRejectDoc(doc.id)}>
                                    <XCircle className="w-3.5 h-3.5" />
                                  </Button>
                                </div>
                              )}
                              {canEdit && (
                                <div className="shrink-0">
                                  <input type="file" className="hidden"
                                    ref={el => { adminFileRefs.current[doc.id] = el; }}
                                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                                    onChange={e => { const f = e.target.files?.[0]; if (f) handleAdminUpload(doc.id, f); e.target.value = ''; }}
                                  />
                                  <Button size="sm" variant="outline" className="h-7 px-2 gap-1 text-xs"
                                    disabled={uploadingAdminDoc === doc.id}
                                    onClick={() => adminFileRefs.current[doc.id]?.click()}
                                    title="Carica per il cliente"
                                  >
                                    {uploadingAdminDoc === doc.id
                                      ? <span className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" />
                                      : <><Upload className="w-3 h-3" /> Upload</>}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))}

              {documents.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  Nessun documento richiesto
                </div>
              )}
            </TabsContent>

            <TabsContent value="scheda" className="mt-3">
              {id && <SchedaValutazioneRischio practiceId={id} />}
            </TabsContent>

            <TabsContent value="log" className="mt-3">
              <div className="space-y-2">
                {logs.map(log => (
                  <div key={log.id} className="flex gap-3 items-start py-2">
                    <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {log.old_status && <Badge variant="outline" className="text-xs">{STATUS_LABELS[log.old_status as keyof typeof STATUS_LABELS] ?? log.old_status}</Badge>}
                        {log.old_status && <span className="text-xs text-muted-foreground">→</span>}
                        <Badge className={`text-xs ${STATUS_COLORS[log.new_status as keyof typeof STATUS_COLORS] ?? 'bg-muted text-muted-foreground'}`}>{STATUS_LABELS[log.new_status as keyof typeof STATUS_LABELS] ?? log.new_status}</Badge>
                      </div>
                      {log.note && <p className="text-xs text-muted-foreground mt-0.5">{log.note}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" />{new Date(log.created_at).toLocaleString('it-IT')}
                      </p>
                    </div>
                  </div>
                ))}
                {logs.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Nessun cambio di stato registrato</p>}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Dialog cambio stato */}
      <Dialog open={showStatusChange} onOpenChange={setShowStatusChange}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cambia Stato Pratica</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nuovo Stato</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Note (opzionale)</Label>
              <Textarea placeholder="Aggiungi una nota per questo cambio di stato..." rows={3} value={statusNote} onChange={e => setStatusNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStatusChange(false)}>Annulla</Button>
            <Button onClick={handleStatusChange} disabled={saving}>Conferma</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog aggiungi doc */}
      <Dialog open={showAddDoc} onOpenChange={setShowAddDoc}>
        <DialogContent>
          <DialogHeader><DialogTitle>Aggiungi Documento Richiesto</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome Documento *</Label>
              <Input placeholder="es. Dichiarazione dei redditi 2023" value={newDocName} onChange={e => setNewDocName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Descrizione (opzionale)</Label>
              <Textarea placeholder="Istruzioni per il cliente..." rows={2} value={newDocDesc} onChange={e => setNewDocDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDoc(false)}>Annulla</Button>
            <Button onClick={handleAddDoc} disabled={saving}>Aggiungi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog integrazione */}
      <Dialog open={showIntegration} onOpenChange={setShowIntegration}>
        <DialogContent>
          <DialogHeader><DialogTitle>Richiedi Integrazione Banca</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Il documento verrà aggiunto alla lista richieste e lo stato pratica diventerà "Integrazioni Richieste".</p>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome Documento *</Label>
              <Input placeholder="es. Piano di rientro finanziamenti" value={integrationName} onChange={e => setIntegrationName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Descrizione / Istruzioni</Label>
              <Textarea placeholder="Dettagli sulla richiesta..." rows={2} value={integrationDesc} onChange={e => setIntegrationDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowIntegration(false)}>Annulla</Button>
            <Button onClick={handleAddIntegration} disabled={saving} className="bg-amber-600 hover:bg-amber-700">Richiedi Integrazione</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog rifiuto documento */}
      <Dialog open={!!showRejectDoc} onOpenChange={() => setShowRejectDoc(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rifiuta Documento</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <Label>Motivo del rifiuto *</Label>
            <Textarea placeholder="Spiega al cliente cosa non va e cosa deve caricare..." rows={3} value={rejectNote} onChange={e => setRejectNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDoc(null)}>Annulla</Button>
            <Button variant="destructive" onClick={rejectDoc}>Rifiuta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
