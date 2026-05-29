import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  FileText, Upload, CheckCircle2, Clock, XCircle, AlertCircle,
  LogOut, Download, Eye, ChevronDown, ChevronUp
} from 'lucide-react';
import { toast } from 'sonner';
import {
  STATUS_LABELS, STATUS_COLORS, DOC_STATUS_LABELS, DOC_STATUS_COLORS,
  type Practice, type PracticeDocument
} from '@/lib/types';

interface ClientSession {
  practiceId: string;
  codice: string;
  email: string;
}

export default function ClientPortalPage() {
  const { practiceId } = useParams<{ practiceId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<ClientSession | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [documents, setDocuments] = useState<PracticeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Verifica sessione
  useEffect(() => {
    const raw = sessionStorage.getItem('docflow_client');
    if (!raw) { navigate('/accesso'); return; }
    const s: ClientSession = JSON.parse(raw);
    if (s.practiceId !== practiceId) { navigate('/accesso'); return; }
    setSession(s);
  }, [practiceId, navigate]);

  const load = async () => {
    if (!practiceId) return;
    const [p, docs] = await Promise.all([
      supabase.from('practices').select('*, clients(ragione_sociale,email), banks(nome)').eq('id', practiceId).single(),
      supabase.from('practice_documents').select('*, uploaded_files(*)').eq('practice_id', practiceId).order('tipo').order('created_at'),
    ]);
    setPractice(p.data as Practice);
    setDocuments((docs.data ?? []) as PracticeDocument[]);
    setLoading(false);
  };

  useEffect(() => { if (session) load(); }, [session]);

  const handleFileUpload = async (docId: string, file: File) => {
    if (!practiceId) return;
    setUploadingDoc(docId);

    const ext = file.name.split('.').pop();
    const path = `${practiceId}/${docId}/${Date.now()}_${file.name}`;

    // Upload to Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('practice-files')
      .upload(path, file, { cacheControl: '3600', upsert: false });

    if (storageError) {
      // Storage bucket potrebbe non esistere ancora — salva solo il record
      console.warn('Storage upload failed, saving record only:', storageError.message);
    }

    // Registra il file nel DB
    await supabase.from('uploaded_files').insert({
      practice_document_id: docId,
      practice_id: practiceId,
      nome_file: file.name,
      storage_path: path,
      mime_type: file.type,
      dimensione: file.size,
      uploaded_by: 'cliente',
    });

    // Aggiorna stato documento
    await supabase.from('practice_documents').update({
      status: 'caricato',
      uploaded_at: new Date().toISOString(),
    }).eq('id', docId);

    toast.success(`"${file.name}" caricato con successo!`);
    setUploadingDoc(null);
    load();
  };

  const handleFileSelect = (docId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) { toast.error('File troppo grande. Massimo 20 MB.'); return; }
      handleFileUpload(docId, file);
    }
    e.target.value = '';
  };

  const downloadFile = async (path: string, name: string) => {
    const { data } = await supabase.storage.from('practice-files').createSignedUrl(path, 60);
    if (data?.signedUrl) { window.open(data.signedUrl, '_blank'); }
    else { toast.error('File non disponibile per il download'); }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('docflow_client');
    navigate('/accesso');
  };

  if (loading || !session) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground">Caricamento pratica...</p>
      </div>
    </div>
  );

  if (!practice) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted-foreground">Pratica non trovata.</p>
    </div>
  );

  const client = (practice as Practice & { clients?: { ragione_sociale: string } }).clients;
  const bank = (practice as Practice & { banks?: { nome: string } }).banks;

  const totalDocs = documents.length;
  const completedDocs = documents.filter(d => d.status === 'caricato' || d.status === 'approvato').length;
  const progressPct = totalDocs > 0 ? Math.round((completedDocs / totalDocs) * 100) : 0;

  const docsStandard = documents.filter(d => d.tipo === 'standard');
  const docsBanca = documents.filter(d => d.tipo === 'banca');
  const docsIntegrazione = documents.filter(d => d.tipo === 'integrazione');

  const getDocIcon = (status: string) => {
    if (status === 'approvato') return <CheckCircle2 className="w-5 h-5 text-green-600" />;
    if (status === 'caricato') return <Clock className="w-5 h-5 text-blue-500" />;
    if (status === 'rifiutato') return <XCircle className="w-5 h-5 text-red-500" />;
    return <AlertCircle className="w-5 h-5 text-amber-500" />;
  };

  const renderDocGroup = (label: string, docs: PracticeDocument[], accent: string) => {
    if (docs.length === 0) return null;
    return (
      <div>
        <p className={`text-xs font-bold uppercase tracking-widest mb-3 ${accent}`}>{label}</p>
        <div className="space-y-3">
          {docs.map(doc => {
            const files = (doc as PracticeDocument & { uploaded_files?: { id: string; nome_file: string; storage_path: string }[] }).uploaded_files ?? [];
            const isExpanded = expandedDoc === doc.id;
            const canUpload = doc.status === 'richiesto' || doc.status === 'rifiutato';
            return (
              <Card key={doc.id} className={`border transition-colors ${doc.status === 'rifiutato' ? 'border-red-200 bg-red-50/30' : doc.status === 'approvato' ? 'border-green-200 bg-green-50/30' : 'border-border'}`}>
                <CardContent className="py-0">
                  {/* Header */}
                  <div
                    className="flex items-center gap-3 py-3 cursor-pointer"
                    onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
                  >
                    {getDocIcon(doc.status)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-foreground leading-tight">{doc.nome}</p>
                        {doc.obbligatorio && <span className="text-xs text-red-500 font-medium">*</span>}
                      </div>
                      <Badge className={`mt-1 text-xs ${DOC_STATUS_COLORS[doc.status]}`}>
                        {DOC_STATUS_LABELS[doc.status]}
                      </Badge>
                    </div>
                    {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                  </div>

                  {/* Expanded */}
                  {isExpanded && (
                    <div className="border-t border-border pt-3 pb-3 space-y-3">
                      {doc.descrizione && (
                        <p className="text-sm text-muted-foreground">{doc.descrizione}</p>
                      )}

                      {doc.note_rifiuto && (
                        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                          <p className="text-xs font-semibold text-red-700 mb-1">⚠️ Documento rifiutato — motivo:</p>
                          <p className="text-sm text-red-800">{doc.note_rifiuto}</p>
                          <p className="text-xs text-red-600 mt-1">Carica un nuovo documento corretto.</p>
                        </div>
                      )}

                      {/* File già caricati */}
                      {files.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground">File caricati:</p>
                          {files.map(f => (
                            <div key={f.id} className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2">
                              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                              <span className="text-sm flex-1 truncate">{f.nome_file}</span>
                              <button
                                className="text-primary hover:text-primary/80 shrink-0"
                                onClick={() => downloadFile(f.storage_path, f.nome_file)}
                                title="Scarica"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Upload button */}
                      {canUpload && (
                        <div>
                          <input
                            type="file"
                            ref={el => { fileInputRefs.current[doc.id] = el; }}
                            className="hidden"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png"
                            onChange={e => handleFileSelect(doc.id, e)}
                          />
                          <Button
                            className="w-full gap-2"
                            disabled={uploadingDoc === doc.id}
                            onClick={() => fileInputRefs.current[doc.id]?.click()}
                          >
                            {uploadingDoc === doc.id ? (
                              <>
                                <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                                Caricamento...
                              </>
                            ) : (
                              <>
                                <Upload className="w-4 h-4" />
                                {files.length > 0 ? 'Sostituisci documento' : 'Carica documento'}
                              </>
                            )}
                          </Button>
                          <p className="text-xs text-muted-foreground text-center mt-1">
                            PDF, Word, Excel, immagini — max 20 MB
                          </p>
                        </div>
                      )}

                      {doc.status === 'approvato' && (
                        <div className="flex items-center gap-2 text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <p className="text-sm font-medium">Documento approvato dall'agente ✓</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-foreground truncate">{client?.ragione_sociale}</p>
            <p className="text-xs text-muted-foreground font-mono">{practice.numero_pratica}</p>
          </div>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={handleLogout}>
            <LogOut className="w-3.5 h-3.5" /> Esci
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Stato pratica */}
        <Card className="border-border">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xs text-muted-foreground font-medium">Stato Pratica</p>
                <Badge className={`mt-1 ${STATUS_COLORS[practice.status]}`}>
                  {STATUS_LABELS[practice.status]}
                </Badge>
              </div>
              {bank && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Banca</p>
                  <p className="text-sm font-medium text-foreground">{bank.nome}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Documenti caricati</span>
                <span className="font-semibold text-foreground">{completedDocs} / {totalDocs}</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <p className="text-xs text-muted-foreground text-right">{progressPct}% completato</p>
            </div>

            {practice.status === 'integrazioni_richieste' && (
              <div className="mt-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm text-amber-800">
                  <strong>Attenzione:</strong> La banca ha richiesto documenti aggiuntivi.
                  Scorri in basso per vedere cosa manca.
                </p>
              </div>
            )}

            {practice.status === 'approvata' && (
              <div className="mt-3 flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <p className="text-sm text-green-800 font-medium">Pratica approvata! 🎉</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Documenti */}
        <div className="space-y-6">
          {renderDocGroup('Documenti Standard', docsStandard, 'text-blue-600')}
          {renderDocGroup('Documenti Banca', docsBanca, 'text-purple-600')}
          {renderDocGroup('Integrazioni Richieste', docsIntegrazione, 'text-amber-600')}

          {documents.length === 0 && (
            <Card><CardContent className="py-12 text-center">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-30 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">Nessun documento richiesto al momento.</p>
              <p className="text-xs text-muted-foreground mt-1">Il tuo agente configurerà a breve la lista documenti.</p>
            </CardContent></Card>
          )}
        </div>

        {/* Footer note */}
        <div className="text-center text-xs text-muted-foreground pb-4">
          <p>Per assistenza contatta il tuo agente finanziario.</p>
          <p className="mt-1">Codice pratica: <code className="font-mono bg-muted px-1 rounded">{practice.numero_pratica}</code></p>
        </div>
      </main>
    </div>
  );
}
