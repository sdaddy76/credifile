import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, UserCog, Pencil, ShieldCheck, Link2, Trash2, KeyRound, AlertTriangle, Eye, EyeOff, Activity, Monitor, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { Navigate } from 'react-router-dom';

interface AdminProfile {
  id: string;
  email: string;
  nome?: string;
  ruolo: string;
  created_at: string;
}

interface AccessLog {
  id: string;
  user_id: string;
  ip_address: string;
  user_agent: string;
  is_new_ip: boolean;
  created_at: string;
}

const RUOLI = [
  { value: 'agente', label: 'Agente', desc: 'Gestisce propri clienti, carica documenti, invia codice accesso al cliente', icon: ShieldCheck, color: 'bg-blue-100 text-blue-800' },
  { value: 'supervisore_segreteria', label: 'Segreteria', desc: 'Pratiche agenti assegnati, gestisce banche, cambia stato pratiche, richiede integrazioni', icon: UserCog, color: 'bg-teal-100 text-teal-800' },
  { value: 'segnalatore', label: 'Segnalatore', desc: 'Commercialista o segnalatore: carica documenti iniziali (visura, bilancio, richiesta), riceve CC email banca', icon: ShieldCheck, color: 'bg-orange-100 text-orange-800' },
];

export default function UtentiPage() {
  const { isSuperAdmin, canManageAll, loading: authLoading, user } = useAuth();
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState<AdminProfile | null>(null);
  const [saving, setSaving] = useState(false);

  // Form crea utente
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNome, setNewNome] = useState('');
  const [newRuolo, setNewRuolo] = useState('agente');

  // Form modifica
  const [editRuolo, setEditRuolo] = useState('');
  const [editNome, setEditNome] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [showEditPwd, setShowEditPwd] = useState(false);
  const [changingPwd, setChangingPwd] = useState(false);

  // Elimina utente
  const [showDelete, setShowDelete] = useState<AdminProfile | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Assegnazioni segreteria ↔ agenti (solo super_admin)
  const [assignments, setAssignments] = useState<Record<string, Set<string>>>({});
  const [savingAssign, setSavingAssign] = useState(false);

  // Log accessi (solo super_admin)
  const [accessLogs,    setAccessLogs]    = useState<AccessLog[]>([]);
  const [logsLoading,   setLogsLoading]   = useState(false);
  const [filterUserId,  setFilterUserId]  = useState('tutti');
  const [logsExpanded,  setLogsExpanded]  = useState(false);

  // ── Tutti gli hook PRIMA di qualsiasi return condizionale ──
  const load = useCallback(async () => {
    const { data } = await supabase
      .from('admin_profiles')
      .select('*')
      .order('created_at');
    setProfiles(data ?? []);
    setLoading(false);
  }, []);

  const loadAssignments = useCallback(async () => {
    const { data } = await supabase
      .from('segreteria_agent_assignments')
      .select('segreteria_user_id, agent_user_id');
    const map: Record<string, Set<string>> = {};
    (data ?? []).forEach((row: { segreteria_user_id: string; agent_user_id: string }) => {
      if (!map[row.segreteria_user_id]) map[row.segreteria_user_id] = new Set();
      map[row.segreteria_user_id].add(row.agent_user_id);
    });
    setAssignments(map);
  }, []);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    const { data } = await supabase
      .from('user_access_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    setAccessLogs((data ?? []) as AccessLog[]);
    setLogsLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    load();
    if (isSuperAdmin) { loadAssignments(); loadLogs(); }
  }, [authLoading, isSuperAdmin, load, loadAssignments, loadLogs]);

  // Return condizionali DOPO tutti gli hook
  if (authLoading) return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!canManageAll) return <Navigate to="/admin/pratiche" replace />;

  const openEdit = (p: AdminProfile) => {
    setShowEdit(p);
    setEditRuolo(p.ruolo);
    setEditNome(p.nome ?? '');
    setEditPassword('');
    setShowEditPwd(false);
  };

  const handleDelete = async () => {
    if (!showDelete) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke('delete-agent', {
      body: { agent_id: showDelete.id },
    });
    setDeleting(false);
    if (error || !data?.success) {
      toast.error(error?.message ?? data?.error ?? 'Errore nella cancellazione');
      return;
    }
    toast.success(`Utente ${showDelete.email} eliminato`);
    setShowDelete(null);
    load();
  };

  const handleChangePassword = async () => {
    if (!showEdit) return;
    if (editPassword.length < 6) { toast.error('Password minimo 6 caratteri'); return; }
    setChangingPwd(true);
    const { data, error } = await supabase.functions.invoke('admin-update-user', {
      body: { user_id: showEdit.id, password: editPassword },
    });
    setChangingPwd(false);
    if (error || !data?.success) {
      toast.error(error?.message ?? data?.error ?? 'Errore cambio password');
      return;
    }
    toast.success('Password aggiornata con successo');
    setEditPassword('');
  };

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

    // Usa Edge Function con service_role — non disconnette l'admin corrente
    const { data, error } = await supabase.functions.invoke('create-admin-user', {
      body: {
        email: newEmail.trim().toLowerCase(),
        password: newPassword,
        nome: newNome || null,
        ruolo: newRuolo,
      },
    });

    if (error || !data?.success) {
      toast.error(error?.message ?? data?.error ?? 'Errore nella creazione utente');
      setSaving(false);
      return;
    }

    toast.success(`Utente ${newEmail} creato con ruolo "${newRuolo}"`);
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

  // Toggle assegnazione agente per una segreteria
  const toggleAssignment = (segreteriaId: string, agentId: string, checked: boolean) => {
    setAssignments(prev => {
      const next = { ...prev };
      if (!next[segreteriaId]) next[segreteriaId] = new Set();
      else next[segreteriaId] = new Set(next[segreteriaId]);
      if (checked) next[segreteriaId].add(agentId);
      else next[segreteriaId].delete(agentId);
      return next;
    });
  };

  const saveAssignments = async () => {
    setSavingAssign(true);
    // Elimina tutte le assegnazioni esistenti e reinserisce
    await supabase.from('segreteria_agent_assignments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const rows: { segreteria_user_id: string; agent_user_id: string }[] = [];
    Object.entries(assignments).forEach(([sId, agentSet]) => {
      agentSet.forEach(aId => rows.push({ segreteria_user_id: sId, agent_user_id: aId }));
    });
    if (rows.length > 0) {
      const { error } = await supabase.from('segreteria_agent_assignments').insert(rows);
      if (error) { toast.error('Errore nel salvataggio assegnazioni'); setSavingAssign(false); return; }
    }
    toast.success('Assegnazioni salvate');
    setSavingAssign(false);
  };

  const getRuoloInfo = (ruolo: string) => RUOLI.find(r => r.value === ruolo) ?? RUOLI[0];

  const segreteriaUsers = profiles.filter(p => p.ruolo === 'supervisore_segreteria');
  const agentiUsers = profiles.filter(p => p.ruolo === 'agente');

  return (
    <div className="space-y-6">
      {/* Header */}
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
                        <p className="font-semibold text-foreground text-sm">{p.nome || p.email}</p>
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
                      title="Modifica ruolo/password"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    {!isSelf && isSuperAdmin && (
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 w-8 p-0 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setShowDelete(p)}
                        title="Elimina utente"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
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

      {/* ── Sezione assegnazioni (solo super_admin) ── */}
      {isSuperAdmin && segreteriaUsers.length > 0 && agentiUsers.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" />
              Assegnazione Agenti a Supervisori Segreteria
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Seleziona quali agenti ogni supervisore di segreteria può visualizzare nelle pratiche.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {segreteriaUsers.map(seg => (
              <div key={seg.id} className="rounded-lg border border-border p-3 space-y-2">
                <p className="text-sm font-semibold text-foreground">
                  {seg.nome || seg.email}
                  <span className="ml-2 text-xs text-muted-foreground font-normal">{seg.email}</span>
                </p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {agentiUsers.map(ag => {
                    const checked = assignments[seg.id]?.has(ag.id) ?? false;
                    return (
                      <label
                        key={ag.id}
                        className="flex items-center gap-2 cursor-pointer text-sm text-foreground hover:text-primary transition-colors"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(val) => toggleAssignment(seg.id, ag.id, !!val)}
                        />
                        <span>{ag.nome || ag.email}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex justify-end pt-1">
              <Button onClick={saveAssignments} disabled={savingAssign} size="sm">
                {savingAssign ? 'Salvataggio...' : 'Salva Assegnazioni'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Log Accessi (solo super_admin) ── */}
      {isSuperAdmin && (
        <Card className="border-border">
          <CardHeader className="pb-2 cursor-pointer" onClick={() => setLogsExpanded(v => !v)}>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                Log Accessi
                {accessLogs.filter(l => l.is_new_ip).length > 0 && (
                  <span className="ml-1 text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">
                    {accessLogs.filter(l => l.is_new_ip).length} IP nuovi
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={e => { e.stopPropagation(); loadLogs(); }}>
                  <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                </Button>
                {logsExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Ultimi 200 accessi — badge rosso = IP mai visto prima per quell'utente</p>
          </CardHeader>

          {logsExpanded && (
            <CardContent className="pt-0 pb-4">
              {/* Filtro per utente */}
              <div className="flex items-center gap-2 mb-3">
                <Select value={filterUserId} onValueChange={setFilterUserId}>
                  <SelectTrigger className="h-8 text-sm w-48">
                    <SelectValue placeholder="Tutti gli utenti" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tutti">Tutti gli utenti</SelectItem>
                    {profiles.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.nome || p.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  {(() => {
                    const filtered = filterUserId === 'tutti' ? accessLogs : accessLogs.filter(l => l.user_id === filterUserId);
                    return `${filtered.length} record`;
                  })()}
                </span>
              </div>

              {logsLoading ? (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : accessLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">Nessun log disponibile</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/60">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Utente</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">IP</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Dispositivo</th>
                        <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Data e ora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(filterUserId === 'tutti' ? accessLogs : accessLogs.filter(l => l.user_id === filterUserId))
                        .map((log, idx) => {
                          const profile = profiles.find(p => p.id === log.user_id);
                          const label = profile ? (profile.nome || profile.email) : log.user_id.slice(0, 8) + '…';
                          const initial = label.charAt(0).toUpperCase();
                          const ua = log.user_agent || '';
                          // Semplifica user-agent
                          const device = ua.includes('Mobile') ? '📱 Mobile' : ua.includes('Windows') ? '🖥 Windows' : ua.includes('Mac') ? '🍎 Mac' : ua.includes('Linux') ? '🐧 Linux' : '💻 Desktop';
                          const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : ua.includes('Edge') ? 'Edge' : '';
                          const ts = new Date(log.created_at);
                          const dateStr = ts.toLocaleDateString('it-IT') + ' ' + ts.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                          return (
                            <tr key={log.id} className={`border-t border-border/50 transition-colors ${log.is_new_ip ? 'bg-red-50/40' : idx % 2 === 0 ? 'bg-white' : 'bg-muted/20'}`}>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[10px] font-bold text-primary">
                                    {initial}
                                  </div>
                                  <span className="truncate max-w-[140px]" title={profile?.email}>{label}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <code className="font-mono text-xs">{log.ip_address}</code>
                                  {log.is_new_ip && (
                                    <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold shrink-0">🔴 Nuovo</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <Monitor className="w-3 h-3 shrink-0" />
                                  <span>{device}{browser ? ` · ${browser}` : ''}</span>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-muted-foreground tabular-nums">{dateStr}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          )}
        </Card>
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
          <DialogHeader><DialogTitle>Modifica Utente</DialogTitle></DialogHeader>
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

            {/* ── Cambio password ── */}
            <div className="border-t border-border pt-4 space-y-2">
              <Label className="flex items-center gap-2 text-sm font-semibold">
                <KeyRound className="w-4 h-4 text-primary" /> Cambia password
              </Label>
              <p className="text-xs text-muted-foreground">Lascia vuoto per non modificare la password.</p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showEditPwd ? 'text' : 'password'}
                    placeholder="Nuova password (min. 6 caratteri)"
                    value={editPassword}
                    onChange={e => setEditPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowEditPwd(v => !v)}
                  >
                    {showEditPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleChangePassword}
                  disabled={changingPwd || editPassword.length < 6}
                  className="shrink-0"
                >
                  {changingPwd ? 'Salvo...' : 'Aggiorna'}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(null)}>Annulla</Button>
            <Button onClick={handleUpdateRole} disabled={saving}>
              {saving ? 'Salvo...' : 'Salva Modifiche'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Dialog conferma eliminazione */}
      <Dialog open={!!showDelete} onOpenChange={() => setShowDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" /> Elimina Utente
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-foreground">
              Stai per eliminare definitivamente l'utente:
            </p>
            <div className="bg-muted/50 rounded-lg px-4 py-3">
              <p className="font-semibold text-sm">{showDelete?.nome || showDelete?.email}</p>
              <p className="text-xs text-muted-foreground">{showDelete?.email}</p>
            </div>
            <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              ⚠️ Questa operazione è irreversibile. Le pratiche create dall'utente resteranno nel sistema ma senza assegnazione.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(null)}>Annulla</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Eliminazione...' : 'Elimina definitivamente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
