import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { UserPlus, Trash2, Users, Mail, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentSegnalatore } from '@/lib/types';

export default function MieiSegnalPage() {
  const { user } = useAuth();
  const [assegnazioni, setAssegnazioni] = useState<AgentSegnalatore[]>([]);
  const [loading, setLoading]           = useState(true);
  const [showCreate, setShowCreate]     = useState(false);
  const [saving, setSaving]             = useState(false);
  const [showPwd, setShowPwd]           = useState(false);

  // Form nuovo segnalatore
  const [email,  setEmail]  = useState('');
  const [pwd,    setPwd]    = useState('');
  const [nome,   setNome]   = useState('');

  async function load() {
    if (!user?.id) return;
    const { data } = await supabase
      .from('agent_segnalatori')
      .select('*, segnalatore:segnalatore_id(id,email,ruolo,nome)')
      .eq('agent_id', user.id);
    setAssegnazioni((data ?? []) as AgentSegnalatore[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [user?.id]);

  const handleCreate = async () => {
    if (!email.trim() || !pwd.trim()) { toast.error('Email e password obbligatorie'); return; }
    if (pwd.length < 6) { toast.error('Password minimo 6 caratteri'); return; }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('create-admin-user', {
      body: { email: email.trim().toLowerCase(), password: pwd, nome: nome || null, ruolo: 'segnalatore', agent_id: user?.id },
    });
    setSaving(false);
    if (error || !data?.success) {
      toast.error(error?.message ?? data?.error ?? 'Errore creazione'); return;
    }
    toast.success(`Segnalatore ${email} creato e collegato`);
    setShowCreate(false); setEmail(''); setPwd(''); setNome('');
    load();
  };

  const handleRemove = async (id: string, nome: string) => {
    if (!confirm(`Rimuovere il segnalatore "${nome}"?`)) return;
    await supabase.from('agent_segnalatori').delete().eq('id', id);
    toast.success('Segnalatore rimosso'); load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Miei Segnalatori</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Commercialisti e segnalatori associati al tuo account
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <UserPlus className="w-4 h-4" /> Crea Segnalatore
        </Button>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : assegnazioni.length === 0 ? (
        <Card><CardContent className="py-14 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Nessun segnalatore associato.</p>
          <p className="text-xs text-muted-foreground mt-1">Crea il primo segnalatore con il pulsante in alto a destra.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {assegnazioni.map(a => {
            const s = a.segnalatore;
            return (
              <Card key={a.id}>
                <CardContent className="py-3 px-4 flex items-center gap-4">
                  <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-orange-700">
                      {(s?.nome || s?.email || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{s?.nome || s?.email}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Mail className="w-3 h-3" />{s?.email}
                    </p>
                  </div>
                  <Badge className="bg-orange-100 text-orange-800 text-xs">Segnalatore</Badge>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemove(a.id, s?.nome || s?.email || '')}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog crea segnalatore */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Crea Segnalatore</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" placeholder="email@esempio.it" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Password *</Label>
              <div className="relative">
                <Input type={showPwd ? 'text' : 'password'} placeholder="Minimo 6 caratteri" value={pwd} onChange={e => setPwd(e.target.value)} className="pr-10" />
                <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPwd(v => !v)}>
                  {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Nome (opzionale)</Label>
              <Input placeholder="Nome e Cognome" value={nome} onChange={e => setNome(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground bg-orange-50 border border-orange-200 rounded p-2">
              Il segnalatore verrà automaticamente collegato al tuo account e potrà accedere alla sezione Clienti per caricare i documenti iniziali.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Annulla</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Creazione...' : 'Crea'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
