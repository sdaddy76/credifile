import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { UserPlus, Trash2, Users, Mail } from 'lucide-react';
import { toast } from 'sonner';
import type { AdminProfile, AgentSegnalatore } from '@/lib/types';

export default function MieiSegnalPage() {
  const { user } = useAuth();
  const [assegnazioni, setAssegnazioni] = useState<AgentSegnalatore[]>([]);
  const [disponibili, setDisponibili]   = useState<AdminProfile[]>([]);
  const [loading, setLoading]           = useState(true);
  const [adding, setAdding]             = useState(false);
  const [selectedId, setSelectedId]     = useState('');

  async function load() {
    if (!user?.id) return;
    const [{ data: asgn }, { data: all }] = await Promise.all([
      supabase.from('agent_segnalatori')
        .select('*, segnalatore:segnalatore_id(id,email,ruolo,nome)')
        .eq('agent_id', user.id),
      supabase.from('admin_profiles')
        .select('id,email,ruolo,nome')
        .eq('ruolo', 'segnalatore'),
    ]);
    setAssegnazioni((asgn ?? []) as AgentSegnalatore[]);
    const assignedIds = new Set((asgn ?? []).map((a: AgentSegnalatore) => a.segnalatore_id));
    setDisponibili(((all ?? []) as AdminProfile[]).filter(s => !assignedIds.has(s.id)));
    setLoading(false);
  }

  useEffect(() => { load(); }, [user?.id]);

  const handleAdd = async () => {
    if (!selectedId || !user?.id) return;
    setAdding(true);
    const { error } = await supabase.from('agent_segnalatori')
      .insert({ agent_id: user.id, segnalatore_id: selectedId });
    if (error) toast.error('Errore: ' + error.message);
    else { toast.success('Segnalatore aggiunto'); setSelectedId(''); load(); }
    setAdding(false);
  };

  const handleRemove = async (id: string, nome: string) => {
    if (!confirm(`Rimuovere il segnalatore "${nome}"?`)) return;
    await supabase.from('agent_segnalatori').delete().eq('id', id);
    toast.success('Segnalatore rimosso'); load();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Miei Segnalatori</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Commercialisti e segnalatori associati al tuo account
        </p>
      </div>

      {/* Aggiungi segnalatore */}
      <Card>
        <CardHeader><CardTitle className="text-base">Aggiungi Segnalatore</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <select
              className="flex-1 border border-input rounded-md px-3 py-2 text-sm bg-background"
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
            >
              <option value="">— Seleziona segnalatore —</option>
              {disponibili.map(s => (
                <option key={s.id} value={s.id}>
                  {s.nome || s.email} ({s.email})
                </option>
              ))}
            </select>
            <Button onClick={handleAdd} disabled={!selectedId || adding} className="gap-2">
              <UserPlus className="w-4 h-4" /> Aggiungi
            </Button>
          </div>
          {disponibili.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Nessun segnalatore disponibile. Il super admin deve prima creare account con ruolo Segnalatore.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Lista assegnazioni */}
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : assegnazioni.length === 0 ? (
        <Card><CardContent className="py-14 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-muted-foreground text-sm">Nessun segnalatore associato</p>
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
    </div>
  );
}
