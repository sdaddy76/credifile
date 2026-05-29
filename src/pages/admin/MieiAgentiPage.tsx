import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Upload, Copy, Check, Phone, Mail, Pencil, Link2 } from 'lucide-react';
import { toast } from 'sonner';

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

  // Dialog invita nuovo agente
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteNome, setInviteNome] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Dialog modifica agente
  const [showEdit, setShowEdit] = useState<AgentProfile | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editTel, setEditTel] = useState('');
  const [editLogo, setEditLogo] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoRef = useRef<HTMLInputElement | null>(null);

  const loadAgents = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);

    let agentIds: string[] = [];

    if (isSuperAdmin) {
      // Super admin vede tutti gli agenti
      const { data } = await supabase.from('admin_profiles').select('id').eq('ruolo', 'agente');
      agentIds = (data ?? []).map((r: { id: string }) => r.id);
    } else {
      // Segreteria: carica solo gli agenti assegnati
      const { data: asgn } = await supabase
        .from('segreteria_agent_assignments')
        .select('agent_user_id')
        .eq('segreteria_user_id', user.id);
      agentIds = (asgn ?? []).map((r: { agent_user_id: string }) => r.agent_user_id);
    }

    if (agentIds.length === 0) { setAgents([]); setLoading(false); return; }

    const { data } = await supabase
      .from('admin_profiles')
      .select('id,email,nome,telefono,logo_url')
      .in('id', agentIds)
      .order('nome');
    setAgents((data ?? []) as AgentProfile[]);
    setLoading(false);
  }, [user?.id, isSuperAdmin]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // ── Invito nuovo agente ──
  const handleInvite = async () => {
    if (!inviteEmail.trim()) { toast.error('Email obbligatoria'); return; }
    setInviting(true);
    setInviteLink('');
    const { data, error } = await supabase.functions.invoke('invite-agent', {
      body: { email: inviteEmail.trim().toLowerCase(), nome: inviteNome || null },
    });
    if (error || !data?.success) {
      toast.error(error?.message ?? data?.error ?? 'Errore generazione invito');
      setInviting(false); return;
    }
    setInviteLink(data.invite_link);
    setInviting(false);

    // Se segreteria, assegna automaticamente il nuovo agente
    if (!isSuperAdmin && user?.id && data.agent_id) {
      await supabase.from('segreteria_agent_assignments').upsert({
        segreteria_user_id: user.id,
        agent_user_id: data.agent_id,
      });
    }
    toast.success('Link di invito generato');
    loadAgents();
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('Link copiato');
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Modifica agente ──
  const openEdit = (ag: AgentProfile) => {
    setShowEdit(ag);
    setEditNome(ag.nome ?? '');
    setEditTel(ag.telefono ?? '');
    setEditLogo(ag.logo_url ?? '');
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
    setUploadingLogo(false);
    toast.success('Logo caricato');
  };

  const handleSaveAgent = async () => {
    if (!showEdit) return;
    setSavingEdit(true);
    await supabase.from('admin_profiles')
      .update({ nome: editNome || null, telefono: editTel || null, logo_url: editLogo || null })
      .eq('id', showEdit.id);
    toast.success('Agente aggiornato');
    setSavingEdit(false);
    setShowEdit(null);
    loadAgents();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Miei Agenti</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestisci il profilo degli agenti e invia inviti di registrazione</p>
        </div>
        <Button className="gap-2" onClick={() => { setShowInvite(true); setInviteLink(''); setInviteEmail(''); setInviteNome(''); }}>
          <UserPlus className="w-4 h-4" /> Invita Agente
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
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
                    <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                      <Mail className="w-3 h-3 shrink-0" />{ag.email}
                    </p>
                    {ag.telefono && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3 shrink-0" />{ag.telefono}
                      </p>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={() => openEdit(ag)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog invita agente */}
      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><UserPlus className="w-4 h-4" />Invita Nuovo Agente</DialogTitle></DialogHeader>
          {!inviteLink ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Nome (opzionale)</Label>
                <Input placeholder="Mario Rossi" value={inviteNome} onChange={e => setInviteNome(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Email *</Label>
                <Input type="email" placeholder="agente@email.it" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                Verrà generato un link di invito da inviare all'agente. L'agente cliccherà il link per impostare la propria password e accedere al sistema.
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 text-green-600 bg-green-50 rounded-lg px-3 py-2">
                <Check className="w-4 h-4 shrink-0" />
                <p className="text-sm font-medium">Link generato con successo!</p>
              </div>
              <div className="space-y-2">
                <Label>Link di invito da inviare all'agente</Label>
                <div className="flex gap-2">
                  <Input readOnly value={inviteLink} className="text-xs font-mono bg-muted/50" />
                  <Button size="sm" variant="outline" onClick={copyLink} className="shrink-0 gap-1">
                    {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copiato' : 'Copia'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Invia questo link via email o WhatsApp all'agente. Il link scade dopo 24 ore.</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInvite(false)}>Chiudi</Button>
            {!inviteLink && (
              <Button onClick={handleInvite} disabled={inviting} className="gap-2">
                <Link2 className="w-4 h-4" />{inviting ? 'Generazione...' : 'Genera Link Invito'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog modifica agente */}
      <Dialog open={!!showEdit} onOpenChange={() => setShowEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Modifica Agente</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <Avatar className="w-14 h-14 rounded-xl shrink-0">
                <AvatarImage src={editLogo} className="object-contain" />
                <AvatarFallback className="rounded-xl bg-primary/10 text-primary font-bold text-xl">
                  {(showEdit?.nome || showEdit?.email || '?').charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <input ref={logoRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }} />
                <Button size="sm" variant="outline" className="gap-2" onClick={() => logoRef.current?.click()} disabled={uploadingLogo}>
                  <Upload className="w-3.5 h-3.5" />{uploadingLogo ? 'Caricamento...' : 'Carica logo'}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Nome e Cognome</Label>
              <Input placeholder="Mario Rossi" value={editNome} onChange={e => setEditNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={showEdit?.email ?? ''} disabled className="bg-muted/50 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Label>Cellulare</Label>
              <Input placeholder="+39 333 1234567" value={editTel} onChange={e => setEditTel(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(null)}>Annulla</Button>
            <Button onClick={handleSaveAgent} disabled={savingEdit}>
              {savingEdit ? 'Salvataggio...' : 'Salva'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
