import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserPlus, Upload, Copy, Check, Phone, Mail, Pencil, Link2, Trash2, AlertTriangle, SendHorizonal, Download } from 'lucide-react';
import { toast } from 'sonner';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface AgentProfile {
  id: string;
  email: string;
  nome?: string;
  telefono?: string;
  logo_url?: string;
}

export default function MieiAgentiPage() {
  const { user, isSuperAdmin } = useAuth();
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [loading, setLoading] = useState(true);

  // Invito
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNome, setInviteNome] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Modifica agente
  const [showEdit, setShowEdit] = useState<AgentProfile | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editTel, setEditTel] = useState('');
  const [editLogo, setEditLogo] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoRef = useRef<HTMLInputElement | null>(null);

  // Elimina agente
  const [showDelete, setShowDelete] = useState<AgentProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reassignTo, setReassignTo] = useState<string>('none');
  const [segreterie, setSegreterie] = useState<{ id: string; nome?: string; email: string }[]>([]);
  const [sendingResend, setSendingResend] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);
  const [backupProgress, setBackupProgress] = useState('');

  // ── Backup ZIP ──
  const handleBackupZip = async () => {
    if (!user?.id) return;
    setBackingUp(true);
    setBackupProgress('Recupero pratiche...');
    try {
      // 1. Ottieni ID agenti
      let agentIds: string[] = [];
      if (isSuperAdmin) {
        const { data } = await supabase.from('admin_profiles').select('id').eq('ruolo', 'agente');
        agentIds = (data ?? []).map((r: { id: string }) => r.id);
      } else {
        const { data } = await supabase.from('segreteria_agent_assignments').select('agent_user_id').eq('segreteria_user_id', user.id);
        agentIds = (data ?? []).map((r: { agent_user_id: string }) => r.agent_user_id);
      }
      if (!agentIds.length) { toast.info('Nessun agente trovato'); setBackingUp(false); return; }

      // 2. Ottieni tutte le pratiche degli agenti
      setBackupProgress('Recupero documenti...');
      const { data: practices } = await supabase
        .from('practices')
        .select('id, numero_pratica, nome_richiedente, clients(ragione_sociale)')
        .in('created_by', agentIds);
      if (!practices?.length) { toast.info('Nessuna pratica trovata'); setBackingUp(false); return; }

      const practiceIds = practices.map((p: { id: string }) => p.id);

      // 3. Ottieni tutti i file caricati
      const { data: files } = await supabase
        .from('uploaded_files')
        .select('id, nome_file, storage_path, practice_id')
        .in('practice_id', practiceIds);
      if (!files?.length) { toast.info('Nessun file trovato da scaricare'); setBackingUp(false); return; }

      // 4. Costruisci mappa pratica → info
      type Practice = { id: string; numero_pratica: string; nome_richiedente?: string; clients?: { ragione_sociale?: string } };
      const practiceMap: Record<string, Practice> = {};
      (practices as Practice[]).forEach(p => { practiceMap[p.id] = p; });

      // 5. Crea ZIP
      const zip = new JSZip();
      let downloaded = 0;

      for (const f of files as { id: string; nome_file: string; storage_path: string; practice_id: string }[]) {
        setBackupProgress(`Download file ${downloaded + 1}/${files.length}...`);
        try {
          const { data: signedUrl } = await supabase.storage.from('practice-files').createSignedUrl(f.storage_path, 300);
          if (!signedUrl?.signedUrl) continue;
          const resp = await fetch(signedUrl.signedUrl);
          if (!resp.ok) continue;
          const blob = await resp.blob();
          const pr = practiceMap[f.practice_id];
          const folderName = pr ? `${pr.numero_pratica} - ${pr.clients?.ragione_sociale ?? pr.nome_richiedente ?? pr.id}`.replace(/[/\\?%*:|"<>]/g, '_') : f.practice_id;
          zip.folder(folderName)!.file(f.nome_file, blob);
          downloaded++;
        } catch { /* skip file on error */ }
      }

      if (!downloaded) { toast.error('Nessun file scaricabile'); setBackingUp(false); setBackupProgress(''); return; }

      setBackupProgress('Creazione ZIP...');
      const today = new Date().toISOString().split('T')[0];
      const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      saveAs(zipBlob, `credifile_backup_${today}.zip`);
      toast.success(`Backup completato: ${downloaded} file scaricati`);
    } catch (e) {
      toast.error('Errore backup: ' + String(e));
    }
    setBackingUp(false);
    setBackupProgress('');
  };

  const handleResendInvite = async (ag: AgentProfile) => {
    setSendingResend(ag.id);
    const { data, error } = await supabase.functions.invoke('invite-agent', {
      body: { email: ag.email, nome: ag.nome || null, segreteria_user_id: !isSuperAdmin ? user?.id : null, resend: true },
    });
    if (error || !data?.success) toast.error('Errore: ' + (error?.message ?? data?.error));
    else toast.success(`Link reinviato a ${ag.email}`);
    setSendingResend(null);
  };

  const loadAgents = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    let agentIds: string[] = [];
    if (isSuperAdmin) {
      const { data } = await supabase.from('admin_profiles').select('id').eq('ruolo', 'agente');
      agentIds = (data ?? []).map((r: { id: string }) => r.id);
    } else {
      const { data } = await supabase.from('segreteria_agent_assignments').select('agent_user_id').eq('segreteria_user_id', user.id);
      agentIds = (data ?? []).map((r: { agent_user_id: string }) => r.agent_user_id);
    }
    if (agentIds.length === 0) { setAgents([]); setLoading(false); return; }
    const { data } = await supabase.from('admin_profiles').select('id,email,nome,telefono,logo_url').in('id', agentIds).order('nome');
    setAgents((data ?? []) as AgentProfile[]);
    setLoading(false);
  }, [user?.id, isSuperAdmin]);

  const loadSegreterie = useCallback(async () => {
    const { data } = await supabase.from('admin_profiles').select('id,nome,email').eq('ruolo', 'supervisore_segreteria').order('nome');
    setSegreterie((data ?? []) as { id: string; nome?: string; email: string }[]);
  }, []);

  useEffect(() => { loadAgents(); loadSegreterie(); }, [loadAgents, loadSegreterie]);

  // ── Invito ──
  const handleInvite = async () => {
    if (!inviteEmail.trim()) { toast.error('Email obbligatoria'); return; }
    setInviting(true); setInviteLink('');
    const { data, error } = await supabase.functions.invoke('invite-agent', {
      body: { email: inviteEmail.trim().toLowerCase(), nome: inviteNome || null, segreteria_user_id: !isSuperAdmin ? user?.id : null },
    });
    if (error || !data?.success) { toast.error(error?.message ?? data?.error ?? 'Errore'); setInviting(false); return; }
    setInviteLink(data.invite_link);
    setInviting(false);
    toast.success('Link di invito generato — email inviata all\'agente');
    loadAgents();
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true); toast.success('Link copiato');
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Modifica agente ──
  const openEdit = (ag: AgentProfile) => {
    setShowEdit(ag); setEditNome(ag.nome ?? ''); setEditEmail(ag.email); setEditTel(ag.telefono ?? ''); setEditLogo(ag.logo_url ?? '');
  };

  const handleLogoUpload = async (file: File) => {
    if (!showEdit) return;
    setUploadingLogo(true);
    const ext = file.name.split('.').pop();
    const path = `${showEdit.id}/logo.${ext}`;
    const { error } = await supabase.storage.from('profile-logos').upload(path, file, { upsert: true });
    if (error) { toast.error('Errore upload logo'); setUploadingLogo(false); return; }
    const { data } = supabase.storage.from('profile-logos').getPublicUrl(path);
    setEditLogo(data.publicUrl + '?t=' + Date.now());
    setUploadingLogo(false); toast.success('Logo caricato');
  };

  const handleSaveAgent = async () => {
    if (!showEdit) return;
    setSavingEdit(true);
    // Aggiorna email se modificata
    if (editEmail.trim().toLowerCase() !== showEdit.email) {
      const { data, error } = await supabase.functions.invoke('update-agent-email', {
        body: { agent_id: showEdit.id, new_email: editEmail.trim().toLowerCase() },
      });
      if (error || !data?.success) { toast.error('Errore aggiornamento email: ' + (error?.message ?? data?.error)); setSavingEdit(false); return; }
    }
    await supabase.from('admin_profiles')
      .update({ nome: editNome || null, telefono: editTel || null, logo_url: editLogo || null, email: editEmail.trim().toLowerCase() })
      .eq('id', showEdit.id);
    toast.success('Agente aggiornato');
    setSavingEdit(false); setShowEdit(null); loadAgents();
  };

  // ── Elimina agente ──
  const openDelete = (ag: AgentProfile) => { setShowDelete(ag); setReassignTo('none'); };

  const handleDeleteAgent = async () => {
    if (!showDelete) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke('delete-agent', {
      body: { agent_id: showDelete.id, reassign_to: reassignTo !== 'none' ? reassignTo : null },
    });
    if (error || !data?.success) { toast.error('Errore eliminazione: ' + (error?.message ?? data?.error)); setDeleting(false); return; }
    toast.success(`Agente ${showDelete.nome || showDelete.email} eliminato`);
    setDeleting(false); setShowDelete(null); loadAgents();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Miei Agenti</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestisci gli agenti, invia inviti e riassegna pratiche</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" className="gap-2" onClick={handleBackupZip} disabled={backingUp}>
            <Download className="w-4 h-4" />
            {backingUp ? (backupProgress || 'Backup...') : 'Scarica Backup ZIP'}
          </Button>
          <Button className="gap-2" onClick={() => { setShowInvite(true); setInviteLink(''); setInviteEmail(''); setInviteNome(''); }}>
            <UserPlus className="w-4 h-4" /> Invita Agente
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : agents.length === 0 ? (
        <Card><CardContent className="py-14 text-center">
          <UserPlus className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Nessun agente assegnato.</p>
          <p className="text-muted-foreground text-xs mt-1">Usa "Invita Agente" per inviare il link di registrazione.</p>
        </CardContent></Card>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {agents.map(ag => (
            <Card key={ag.id} className="border-border">
              <CardContent className="py-4 px-4">
                <div className="flex items-center gap-3">
                  <Avatar className="w-12 h-12 rounded-xl shrink-0">
                    <AvatarImage src={ag.logo_url ?? ''} className="object-contain" />
                    <AvatarFallback className="rounded-xl bg-primary/10 text-primary font-bold text-lg">
                      {(ag.nome || ag.email).charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{ag.nome || '—'}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" />{ag.email}</p>
                    {ag.telefono && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" />{ag.telefono}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-primary hover:bg-primary/10" onClick={() => handleResendInvite(ag)} disabled={sendingResend === ag.id} title="Reinvia invito">
                      {sendingResend === ag.id ? <span className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin" /> : <SendHorizonal className="w-3.5 h-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => openEdit(ag)} title="Modifica">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10" onClick={() => openDelete(ag)} title="Elimina">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog invita */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="w-4 h-4" />Invita Nuovo Agente</DialogTitle></DialogHeader>
          {!inviteLink ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2"><Label>Nome (opzionale)</Label><Input placeholder="Mario Rossi" value={inviteNome} onChange={e => setInviteNome(e.target.value)} /></div>
              <div className="space-y-2"><Label>Email *</Label><Input type="email" placeholder="agente@email.it" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} /></div>
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                L'agente riceverà un'email con il link per impostare la password e accedere al sistema.
                {!isSuperAdmin && ' Sarà automaticamente assegnato alla tua segreteria.'}
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 text-green-600 bg-green-50 rounded-lg px-3 py-2">
                <Check className="w-4 h-4 shrink-0" /><p className="text-sm font-medium">Email inviata all'agente! Link disponibile anche qui:</p>
              </div>
              <div className="space-y-2">
                <Label>Link di invito</Label>
                <div className="flex gap-2">
                  <Input readOnly value={inviteLink} className="text-xs font-mono bg-muted/50" />
                  <Button size="sm" variant="outline" onClick={copyLink} className="shrink-0 gap-1">
                    {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Copiato' : 'Copia'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Il link scade dopo 24 ore.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>Chiudi</Button>
            {!inviteLink && <Button onClick={handleInvite} disabled={inviting} className="gap-2"><Link2 className="w-4 h-4" />{inviting ? 'Invio...' : 'Invia Invito'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog modifica */}
      <Dialog open={!!showEdit} onOpenChange={() => setShowEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Modifica Agente</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-4">
              <Avatar className="w-14 h-14 rounded-xl shrink-0">
                <AvatarImage src={editLogo} className="object-contain" />
                <AvatarFallback className="rounded-xl bg-primary/10 text-primary font-bold text-xl">
                  {(showEdit?.nome || showEdit?.email || '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }} />
                <Button size="sm" variant="outline" className="gap-2" onClick={() => logoRef.current?.click()} disabled={uploadingLogo}>
                  <Upload className="w-3.5 h-3.5" />{uploadingLogo ? 'Caricamento...' : 'Carica logo'}
                </Button>
              </div>
            </div>
            <div className="space-y-2"><Label>Nome e Cognome</Label><Input placeholder="Mario Rossi" value={editNome} onChange={e => setEditNome(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">La modifica aggiorna l'email di accesso dell'agente.</p>
            </div>
            <div className="space-y-2"><Label>Cellulare</Label><Input placeholder="+39 333 1234567" value={editTel} onChange={e => setEditTel(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(null)}>Annulla</Button>
            <Button onClick={handleSaveAgent} disabled={savingEdit}>{savingEdit ? 'Salvataggio...' : 'Salva'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog elimina */}
      <Dialog open={!!showDelete} onOpenChange={() => setShowDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />Elimina Agente
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-foreground">
              Stai per eliminare <strong>{showDelete?.nome || showDelete?.email}</strong>. Questa azione è irreversibile.
            </p>
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-800">Pratiche dell'agente</CardTitle></CardHeader>
              <CardContent>
                <p className="text-xs text-amber-700 mb-3">Vuoi riassegnare le pratiche di questo agente a una segreteria?</p>
                <Select value={reassignTo} onValueChange={setReassignTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Scegli destinazione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Non riassegnare (le pratiche restano visibili)</SelectItem>
                    {segreterie.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.nome || s.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(null)}>Annulla</Button>
            <Button variant="destructive" onClick={handleDeleteAgent} disabled={deleting} className="gap-2">
              <Trash2 className="w-4 h-4" />{deleting ? 'Eliminazione...' : 'Elimina Agente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
