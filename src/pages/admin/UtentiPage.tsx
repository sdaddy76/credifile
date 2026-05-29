import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, UserCog, Pencil, ShieldCheck, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';

interface AdminProfile {
  id: string;
  email: string;
  nome?: string;
  ruolo: string;
  created_at: string;
}

const RUOLI = [
  { value: 'agente', label: 'Agente', desc: 'Accesso completo: pratiche, clienti, banche, documenti, utenti', icon: ShieldCheck, color: 'bg-blue-100 text-blue-800' },
  { value: 'supervisore_segreteria', label: 'Supervisore Segreteria', desc: 'Dashboard, pratiche (full), clienti — senza banche/template/utenti/approvazioni', icon: UserCog, color: 'bg-teal-100 text-teal-800' },
  { value: 'banca',  label: 'Referente Banca', desc: 'Vede pratiche (stato + motivazione), gestisce banche', icon: Building2, color: 'bg-purple-100 text-purple-800' },
];

export default function UtentiPage() {
  const { isAgente, user } = useAuth();
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit]   = useState<AdminProfile | null>(null);
  const [saving, setSaving] = useState(false);

  // Form crea utente
  const [newEmail, setNewEmail]       = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNome, setNewNome]         = useState('');
  const [newRuolo, setNewRuolo]       = useState('agente');

  // Form modifica ruolo
  const [editRuolo, setEditRuolo] = useState('');
  const [editNome, setEditNome]   = useState('');

  // Solo agenti possono accedere
  if (!isAgente) return <Navigate to="/admin/pratiche" replace />;

  async function load() {
    const { data } = await supabase
      .from('admin_profiles')
      .select('*')
      .order('created_at');
    setProfiles(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const openEdit = (p: AdminProfile) => {
    setShowEdit(p);
    setEditRuolo(p.ruolo);
    setEditNome(p.nome ?? '');
  };

  // Crea utente tramite Supabase Admin API (Edge Function) oppure direttamente
  const handleCreate = async () => {
    if (!newEmail.trim() || !newPassword.trim()) {
      toast.error('Email e password obbligatorie');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Password minimo 6 caratteri');
      return;
    }
    setSaving(true);

    // Crea utente auth con signup (non serve admin API)
    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: newEmail.trim().toLowerCase(),
      password: newPassword,
      options: { data: { nome: newNome } },
    });

    if (signUpError || !signUpData.user) {
      toast.error(signUpError?.message ?? 'Errore nella creazione utente');
      setSaving(false);
      return;
    }

    // Inserisci profilo con ruolo scelto
    const { error: profileError } = await supabase.from('admin_profiles').upsert({
      id: signUpData.user.id,
      email: newEmail.trim().toLowerCase(),
      nome: newNome || null,
      ruolo: newRuolo,
    });

    if (profileError) {
      toast.error('Utente creato ma errore nel profilo: ' + profileError.message);
    } else {
      toast.success(`Utente ${newEmail} creato con ruolo "${newRuolo}"`);
    }

    setSaving(false);
    setShowCreate(false);
    setNewEmail(''); setNewPassword(''); setNewNome(''); setNewRuolo('agente');
    load();
  };

  const handleUpdateRole = async () => {
    if (!showEdit) return;
    setSaving(true);
    await supabase.from('admin_profiles')
      .update({ ruolo: editRuolo, nome: editNome || null })
      .eq('id', showEdit.id);
    toast.success('Ruolo aggiornato');
    setSaving(false);
    setShowEdit(null);
    load();
  };

  const getRuoloInfo = (ruolo: string) => RUOLI.find(r => r.value === ruolo) ?? RUOLI[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Utenti</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestione accessi e ruoli del sistema</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="w-4 h-4" /> Nuovo Utente
        </Button>
      </div>

      {/* Legenda ruoli */}
      <div className="grid sm:grid-cols-2 gap-3">
        {RUOLI.map(r => {
          const Icon = r.icon;
          return (
            <Card key={r.value} className="border-border">
              <CardContent className="py-3 px-4 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{r.label}</p>
                    <Badge className={`text-xs ${r.color}`}>{r.value}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{r.desc}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Lista utenti */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map(p => {
            const info = getRuoloInfo(p.ruolo);
            const Icon = info.icon;
            const isSelf = p.id === user?.id;
            return (
              <Card key={p.id} className="border-border">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm font-bold text-primary">
                        {(p.nome || p.email).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-foreground text-sm">
                          {p.nome || p.email}
                        </p>
                        {isSelf && (
                          <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">Tu</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <p className="text-xs text-muted-foreground">{p.email}</p>
                        <Badge className={`text-xs ${info.color}`}>
                          <Icon className="w-2.5 h-2.5 mr-1" />
                          {info.label}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant="ghost" size="sm"
                      className="h-8 w-8 p-0 shrink-0"
                      onClick={() => openEdit(p)}
                      title="Modifica ruolo"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {profiles.length === 0 && (
            <Card><CardContent className="py-12 text-center">
              <UserCog className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">Nessun utente trovato</p>
            </CardContent></Card>
          )}
        </div>
      )}

      {/* Dialog crea utente */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuovo Utente</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome (opzionale)</Label>
              <Input placeholder="Mario Rossi" value={newNome} onChange={e => setNewNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email *</Label>
              <Input type="email" placeholder="utente@banca.it" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Password temporanea *</Label>
              <Input type="password" placeholder="min. 6 caratteri" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
              <p className="text-xs text-muted-foreground">L'utente potrà cambiarla dopo il primo accesso tramite "Password dimenticata".</p>
            </div>
            <div className="space-y-2">
              <Label>Ruolo *</Label>
              <Select value={newRuolo} onValueChange={setNewRuolo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RUOLI.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <div>
                        <p className="font-medium">{r.label}</p>
                        <p className="text-xs text-muted-foreground">{r.desc}</p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Annulla</Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? 'Creazione...' : 'Crea Utente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog modifica ruolo */}
      <Dialog open={!!showEdit} onOpenChange={() => setShowEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Modifica Utente</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input placeholder="Nome visualizzato" value={editNome} onChange={e => setEditNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Ruolo</Label>
              <Select value={editRuolo} onValueChange={setEditRuolo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RUOLI.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <div>
                        <p className="font-medium">{r.label}</p>
                        <p className="text-xs text-muted-foreground">{r.desc}</p>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              Il cambio ruolo avrà effetto al prossimo accesso dell'utente.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(null)}>Annulla</Button>
            <Button onClick={handleUpdateRole} disabled={saving}>
              {saving ? 'Salvo...' : 'Salva Modifiche'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
