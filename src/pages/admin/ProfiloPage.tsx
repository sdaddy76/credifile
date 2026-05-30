import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Phone, Mail, Upload, Trash2, Save, Lock, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export default function ProfiloPage() {
  const { user, profileNome } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [nome, setNome] = useState('');
  const [telefono, setTelefono] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Cambio password
  const [nuovaPassword, setNuovaPassword] = useState('');
  const [confermaPwd, setConfermaPwd] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  const handleChangePassword = async () => {
    if (!nuovaPassword) { toast.error('Inserisci la nuova password'); return; }
    if (nuovaPassword.length < 6) { toast.error('La password deve avere almeno 6 caratteri'); return; }
    if (nuovaPassword !== confermaPwd) { toast.error('Le password non coincidono'); return; }
    setSavingPwd(true);
    const { error } = await supabase.auth.updateUser({ password: nuovaPassword });
    setSavingPwd(false);
    if (error) { toast.error('Errore: ' + error.message); return; }
    toast.success('Password aggiornata con successo');
    setNuovaPassword(''); setConfermaPwd('');
  };

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('admin_profiles').select('nome,telefono,logo_url').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setNome(data.nome ?? '');
          setTelefono(data.telefono ?? '');
          setLogoUrl(data.logo_url ?? '');
        }
      });
  }, [user?.id]);

  const handleLogoUpload = async (file: File) => {
    if (!user?.id) return;
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${user.id}/logo.${ext}`;
    const { error } = await supabase.storage.from('profile-logos').upload(path, file, { upsert: true });
    if (error) { toast.error('Errore upload logo'); setUploading(false); return; }
    const { data: urlData } = supabase.storage.from('profile-logos').getPublicUrl(path);
    setLogoUrl(urlData.publicUrl + '?t=' + Date.now());
    setUploading(false);
    toast.success('Logo caricato');
  };

  const handleRemoveLogo = async () => {
    if (!user?.id) return;
    setLogoUrl('');
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    const { error } = await supabase.from('admin_profiles')
      .update({ nome: nome || null, telefono: telefono || null, logo_url: logoUrl || null })
      .eq('id', user.id);
    if (error) toast.error('Errore salvataggio');
    else toast.success('Profilo salvato');
    setSaving(false);
  };

  const initials = (nome || user?.email || '?').charAt(0).toUpperCase();

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold">Il mio profilo</h1>
        <p className="text-muted-foreground text-sm mt-1">Modifica i tuoi dati e il logo aziendale</p>
      </div>

      {/* Logo */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Logo aziendale</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar className="w-16 h-16 rounded-xl">
            <AvatarImage src={logoUrl} className="object-contain" />
            <AvatarFallback className="rounded-xl bg-primary/10 text-primary text-xl font-bold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); }} />
            <Button size="sm" variant="outline" className="gap-2" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <Upload className="w-3.5 h-3.5" /> {uploading ? 'Caricamento...' : 'Carica logo'}
            </Button>
            {logoUrl && (
              <Button size="sm" variant="ghost" className="gap-2 text-destructive hover:text-destructive" onClick={handleRemoveLogo}>
                <Trash2 className="w-3.5 h-3.5" /> Rimuovi
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dati */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Dati personali</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" />Nome e Cognome</Label>
            <Input placeholder="Mario Rossi" value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />Email</Label>
            <Input value={user?.email ?? ''} disabled className="bg-muted/50 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">L'email non può essere modificata da qui.</p>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" />Cellulare</Label>
            <Input placeholder="+39 333 1234567" value={telefono} onChange={e => setTelefono(e.target.value)} />
          </div>
          <Button className="w-full gap-2" onClick={handleSave} disabled={saving}>
            <Save className="w-4 h-4" /> {saving ? 'Salvataggio...' : 'Salva modifiche'}
          </Button>
        </CardContent>
      </Card>
      {/* Cambio password */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Lock className="w-3.5 h-3.5" />Cambia Password</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nuova Password</Label>
            <div className="relative">
              <Input type={showPwd ? 'text' : 'password'} placeholder="Minimo 6 caratteri" value={nuovaPassword} onChange={e => setNuovaPassword(e.target.value)} className="pr-10" autoComplete="new-password" />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPwd(!showPwd)}>
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Conferma Password</Label>
            <Input type={showPwd ? 'text' : 'password'} placeholder="Ripeti la nuova password" value={confermaPwd} onChange={e => setConfermaPwd(e.target.value)} autoComplete="new-password" />
          </div>
          <Button className="w-full gap-2" onClick={handleChangePassword} disabled={savingPwd}>
            <Lock className="w-4 h-4" /> {savingPwd ? 'Aggiornamento...' : 'Aggiorna Password'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
