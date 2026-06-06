import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { ArrowLeft, Upload, User, Save } from 'lucide-react';

export default function ProfiloConsulentePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [nome,       setNome]       = useState('');
  const [telefono,   setTelefono]   = useState('');
  const [logoUrl,    setLogoUrl]    = useState('');
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('admin_profiles').select('nome,telefono,logo_url').eq('id', user.id).maybeSingle().then(({ data }) => {
      if (data) { setNome(data.nome ?? ''); setTelefono(data.telefono ?? ''); setLogoUrl(data.logo_url ?? ''); }
      setLoading(false);
    });
  }, [user]);

  const uploadLogo = async (file: File) => {
    if (!user) return;
    setUploading(true);
    const ext  = file.name.split('.').pop() ?? 'png';
    const path = `${user.id}/logo.${ext}`;
    const { error } = await supabase.storage.from('profile-logos').upload(path, file, { upsert: true });
    if (error) { toast.error('Errore upload logo'); setUploading(false); return; }
    const { data } = supabase.storage.from('profile-logos').getPublicUrl(path);
    setLogoUrl(data.publicUrl + '?t=' + Date.now());
    setUploading(false);
    toast.success('Logo caricato');
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('admin_profiles')
      .update({ nome: nome || null, telefono: telefono || null, logo_url: logoUrl || null })
      .eq('id', user.id);
    setSaving(false);
    if (error) { toast.error('Errore salvataggio'); return; }
    toast.success('Profilo salvato');
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-slate-400">Caricamento...</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50/40 to-slate-50">
      <div className="bg-teal-700 text-white px-6 py-3 flex items-center gap-3">
        <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={() => navigate('/consulente')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Dashboard
        </Button>
        <span className="text-sm font-medium">Profilo Consulente</span>
      </div>

      <div className="max-w-lg mx-auto px-4 py-8 space-y-5">
        <div className="bg-white rounded-xl border p-6 space-y-5">
          {/* Logo */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Logo studio / firma (apparirà nel report PDF)</label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden bg-slate-50">
                {logoUrl
                  ? <img src={logoUrl} alt="logo" className="w-full h-full object-contain p-1" />
                  : <User className="w-8 h-8 text-slate-300" />
                }
              </div>
              <div>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Upload className="w-3.5 h-3.5 mr-1.5" /> {uploading ? 'Upload...' : 'Carica logo'}
                </Button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
                <p className="text-xs text-slate-400 mt-1">PNG o JPG, max 2MB</p>
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600">Nome / Studio</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5 focus:ring-2 ring-teal-400 outline-none"
              value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Telefono</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5 focus:ring-2 ring-teal-400 outline-none"
              value={telefono} onChange={e => setTelefono(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Email</label>
            <input disabled className="w-full border rounded-lg px-3 py-2 text-sm mt-0.5 bg-slate-50 text-slate-400" value={user?.email ?? ''} />
          </div>

          <Button className="w-full bg-teal-600 hover:bg-teal-700" onClick={save} disabled={saving}>
            <Save className="w-4 h-4 mr-2" /> {saving ? 'Salvataggio...' : 'Salva profilo'}
          </Button>
        </div>
      </div>
    </div>
  );
}
