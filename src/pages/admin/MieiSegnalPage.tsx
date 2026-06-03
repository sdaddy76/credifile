import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mail, Trash2, Users, Clock, CheckCircle2, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { AgentSegnalatore } from '@/lib/types';

interface Invite {
  id: string;
  email: string;
  used: boolean;
  expires_at: string;
  created_at: string;
}

export default function MieiSegnalPage() {
  const { user } = useAuth();

  // Segnalatori già registrati
  const [assegnazioni, setAssegnazioni] = useState<AgentSegnalatore[]>([]);
  // Inviti pendenti (non ancora usati)
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  // Form invito
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  async function load() {
    if (!user?.id) return;
    const [{ data: asgn }, { data: inv }] = await Promise.all([
      supabase
        .from('agent_segnalatori')
        .select('*, segnalatore:segnalatore_id(id,email,ruolo,nome)')
        .eq('agent_id', user.id),
      supabase
        .from('segnalatore_invites')
        .select('id,email,used,expires_at,created_at')
        .eq('agent_id', user.id)
        .eq('used', false)
        .order('created_at', { ascending: false }),
    ]);
    setAssegnazioni((asgn ?? []) as AgentSegnalatore[]);
    setInvites((inv ?? []) as Invite[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, [user?.id]);

  const handleInvite = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error('Inserisci un indirizzo email valido'); return;
    }
    setSending(true);

    // Recupera nome agente per personalizzare l'email
    const { data: profile } = await supabase
      .from('admin_profiles').select('nome').eq('id', user?.id ?? '').maybeSingle();
    const agentName = profile?.nome ?? user?.email ?? 'Il tuo agente';

    const { data, error } = await supabase.functions.invoke('invite-segnalatore', {
      body: { agent_id: user?.id, agent_name: agentName, email: trimmed },
    });

    setSending(false);
    if (error || !data?.success) {
      toast.error(data?.error ?? error?.message ?? 'Errore nell\'invio'); return;
    }
    toast.success(`Invito inviato a ${trimmed}`);
    setEmail('');
    load();
  };

  const handleRemove = async (id: string, nome: string) => {
    if (!confirm(`Rimuovere il segnalatore "${nome}"?`)) return;
    await supabase.from('agent_segnalatori').delete().eq('id', id);
    toast.success('Segnalatore rimosso'); load();
  };

  const handleRevokeInvite = async (id: string, inv_email: string) => {
    if (!confirm(`Annullare l'invito per "${inv_email}"?`)) return;
    await supabase.from('segnalatore_invites').delete().eq('id', id);
    toast.success('Invito annullato'); load();
  };

  const isExpired = (expires_at: string) => new Date(expires_at) < new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Miei Segnalatori</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Commercialisti e segnalatori associati al tuo account
        </p>
      </div>

      {/* Form invito */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Send className="w-4 h-4 text-primary" /> Invita Segnalatore
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Email del segnalatore</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="commercialista@studio.it"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleInvite()}
                className="flex-1"
              />
              <Button onClick={handleInvite} disabled={sending || !email.trim()} className="gap-2 shrink-0">
                <Send className="w-4 h-4" />
                {sending ? 'Invio…' : 'Invia Invito'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Verrà inviata un'email con un link di registrazione valido 7 giorni. Il segnalatore imposterà la propria password.
            </p>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Inviti pendenti */}
          {invites.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Inviti in attesa ({invites.length})
              </h2>
              {invites.map(inv => {
                const expired = isExpired(inv.expires_at);
                return (
                  <Card key={inv.id} className={expired ? 'border-red-200 bg-red-50/30' : 'border-amber-200 bg-amber-50/30'}>
                    <CardContent className="py-3 px-4 flex items-center gap-3">
                      <Clock className={`w-4 h-4 shrink-0 ${expired ? 'text-red-400' : 'text-amber-500'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{inv.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {expired
                            ? 'Scaduto — invia un nuovo invito'
                            : `Scade il ${new Date(inv.expires_at).toLocaleDateString('it-IT')}`}
                        </p>
                      </div>
                      <Badge className={expired ? 'bg-red-100 text-red-700 text-xs' : 'bg-amber-100 text-amber-700 text-xs'}>
                        {expired ? 'Scaduto' : 'In attesa'}
                      </Badge>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        title="Annulla invito"
                        onClick={() => handleRevokeInvite(inv.id, inv.email)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Segnalatori registrati */}
          {assegnazioni.length === 0 && invites.length === 0 ? (
            <Card>
              <CardContent className="py-14 text-center">
                <Users className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
                <p className="text-muted-foreground text-sm">Nessun segnalatore ancora associato.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Inserisci l'email e clicca "Invia Invito" per iniziare.
                </p>
              </CardContent>
            </Card>
          ) : assegnazioni.length > 0 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Segnalatori attivi ({assegnazioni.length})
              </h2>
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
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        <Badge className="bg-orange-100 text-orange-800 text-xs">Segnalatore</Badge>
                        <Button
                          variant="ghost" size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemove(a.id, s?.nome || s?.email || '')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
