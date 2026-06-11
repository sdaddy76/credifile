import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Plus, Building2, Pencil, Trash2, ChevronDown, ChevronUp, FileText, BarChart3, Upload, FileDown, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Bank, BankDocumentRequirement } from '@/lib/types';

// Catalogo KPI — stesso ordine del report (per area)
const KPI_CATALOG = [
  // Liquidità
  { key: 'current_ratio',       area: 'liquidita',     label: 'Current Ratio' },
  { key: 'quick_ratio',         area: 'liquidita',     label: 'Quick Ratio' },
  // Solidità Patrimoniale
  { key: 'debt_equity',         area: 'solidita',      label: 'Debt/Equity' },
  { key: 'leverage',            area: 'solidita',      label: 'Leverage' },
  { key: 'pn_su_ta',            area: 'solidita',      label: 'PN / Totale Attivo (%)' },
  { key: 'grado_indebitamento', area: 'solidita',      label: 'Grado Indebitamento' },
  // Redditività
  { key: 'roe',                 area: 'redditivita',   label: 'ROE (%)' },
  { key: 'roi',                 area: 'redditivita',   label: 'ROI (%)' },
  { key: 'ros',                 area: 'redditivita',   label: 'ROS (%)' },
  { key: 'ebitda_margin',       area: 'redditivita',   label: 'EBITDA Margin (%)' },
  { key: 'ebitda_eur',          area: 'redditivita',   label: 'EBITDA (€)' },
  { key: 'fatturato',           area: 'redditivita',   label: 'Fatturato / Ricavi (€)' },
  { key: 'utile_netto',         area: 'redditivita',   label: 'Utile Netto (€)' },
  // Indebitamento
  { key: 'pfn_ebitda',          area: 'indebitamento', label: 'PFN / EBITDA' },
  { key: 'pfn_pn',              area: 'indebitamento', label: 'PFN / PN' },
  // Efficienza Operativa
  { key: 'dso',                 area: 'efficienza',    label: 'DSO (gg crediti)' },
  // Copertura
  { key: 'interest_coverage',   area: 'copertura',     label: 'Interest Coverage' },
  { key: 'dscr',                area: 'copertura',     label: 'DSCR' },
];
interface KpiReq { id: string; kpi_key: string; kpi_area: string; kpi_label: string; min_value: number | null; max_value: number | null }
interface AtecoReq { id: string; codice: string; tipo: 'incluso' | 'escluso'; descrizione: string | null }
interface BankModulo { id: string; nome: string; descrizione: string | null; file_path: string; created_at: string }

const emptyBank = { nome: '', codice: '', contatto: '', email: '', email_invio_banca: '', note: '', attiva: true, logo_url: '' };
const emptyReq = { nome: '', descrizione: '', obbligatorio: true };

export default function BanchePage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | null>(null);
  const [bankForm, setBankForm] = useState(emptyBank);
  const [ccEmails, setCcEmails] = useState<string[]>(['']);
  const [bccEmails, setBccEmails] = useState<string[]>(['']);
  const [saving, setSaving] = useState(false);

  const [expandedBank, setExpandedBank] = useState<string | null>(null);
  const [requirements, setRequirements] = useState<Record<string, BankDocumentRequirement[]>>({});
  const [showReqForm, setShowReqForm] = useState<string | null>(null);
  const [reqForm, setReqForm] = useState(emptyReq);

  // KPI requirements
  const [kpiRequirements, setKpiRequirements] = useState<Record<string, KpiReq[]>>({});
  const [showKpiForm, setShowKpiForm] = useState<string | null>(null);
  const [kpiFormKey, setKpiFormKey] = useState('');
  const [kpiFormMin, setKpiFormMin] = useState('');
  const [kpiFormMax, setKpiFormMax] = useState('');

  async function loadBanks() {
    const { data } = await supabase.from('banks').select('*').order('nome');
    setBanks(data ?? []);
    setLoading(false);
  }

  async function loadRequirements(bankId: string) {
    const { data } = await supabase.from('bank_document_requirements').select('*').eq('bank_id', bankId).order('ordine');
    setRequirements(prev => ({ ...prev, [bankId]: data ?? [] }));
  }

  async function loadKpiRequirements(bankId: string) {
    const { data } = await supabase.from('bank_kpi_requirements').select('*').eq('bank_id', bankId).order('kpi_area');
    setKpiRequirements(prev => ({ ...prev, [bankId]: data ?? [] }));
  }

  async function handleSaveKpiReq(bankId: string) {
    if (!kpiFormKey) { toast.error('Seleziona un KPI'); return; }
    const kpi = KPI_CATALOG.find(k => k.key === kpiFormKey);
    if (!kpi) return;
    const minVal = kpiFormMin !== '' ? parseFloat(kpiFormMin) : null;
    const maxVal = kpiFormMax !== '' ? parseFloat(kpiFormMax) : null;
    if (minVal === null && maxVal === null) { toast.error('Inserisci almeno un valore min o max'); return; }
    const { error } = await supabase.from('bank_kpi_requirements').upsert({
      bank_id: bankId, kpi_key: kpi.key, kpi_area: kpi.area, kpi_label: kpi.label,
      min_value: minVal, max_value: maxVal,
    }, { onConflict: 'bank_id,kpi_key' });
    if (error) { toast.error('Errore salvataggio KPI'); return; }
    toast.success('Requisito KPI salvato');
    setShowKpiForm(null); setKpiFormKey(''); setKpiFormMin(''); setKpiFormMax('');
    loadKpiRequirements(bankId);
  }

  async function handleDeleteKpiReq(id: string, bankId: string) {
    await supabase.from('bank_kpi_requirements').delete().eq('id', id);
    toast.success('Requisito KPI rimosso');
    loadKpiRequirements(bankId);
  }

  // ── ATECO ──────────────────────────────────────────────────────────────────
  const [atecoRequirements, setAtecoRequirements] = useState<Record<string, AtecoReq[]>>({});
  const [showAtecoForm, setShowAtecoForm] = useState<string | null>(null);
  const [atecoFormCodice, setAtecoFormCodice] = useState('');
  const [atecoFormTipo, setAtecoFormTipo] = useState<'incluso' | 'escluso'>('incluso');
  const [atecoFormDesc, setAtecoFormDesc] = useState('');

  async function loadAtecoRequirements(bankId: string) {
    const { data } = await supabase.from('bank_ateco_requirements').select('*').eq('bank_id', bankId).order('tipo').order('codice');
    setAtecoRequirements(prev => ({ ...prev, [bankId]: data ?? [] }));
  }

  async function handleSaveAtecoReq(bankId: string) {
    const codice = atecoFormCodice.trim().toUpperCase();
    if (!codice) { toast.error('Inserisci il codice ATECO'); return; }
    const { error } = await supabase.from('bank_ateco_requirements').insert({
      bank_id: bankId, codice, tipo: atecoFormTipo, descrizione: atecoFormDesc.trim() || null,
    });
    if (error) { toast.error('Errore salvataggio ATECO'); return; }
    toast.success('Codice ATECO aggiunto');
    setShowAtecoForm(null); setAtecoFormCodice(''); setAtecoFormTipo('incluso'); setAtecoFormDesc('');
    loadAtecoRequirements(bankId);
  }

  async function handleDeleteAtecoReq(id: string, bankId: string) {
    await supabase.from('bank_ateco_requirements').delete().eq('id', id);
    toast.success('Codice ATECO rimosso');
    loadAtecoRequirements(bankId);
  }

  // ── MODULI DA COMPILARE ────────────────────────────────────────────────────
  const [bankModuli,      setBankModuli]      = useState<Record<string, BankModulo[]>>({});
  const [showModuloForm,  setShowModuloForm]  = useState<string | null>(null);
  const [moduloFormNome,  setModuloFormNome]  = useState('');
  const [moduloFormDesc,  setModuloFormDesc]  = useState('');
  const [moduloFormFile,  setModuloFormFile]  = useState<File | null>(null);
  const [uploadingModulo, setUploadingModulo] = useState<string | null>(null);

  // Creazione account banca
  const [showAccountDialog, setShowAccountDialog] = useState<Bank | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);

  async function loadModuli(bankId: string) {
    const { data } = await supabase.from('bank_moduli').select('*').eq('bank_id', bankId).order('created_at');
    setBankModuli(prev => ({ ...prev, [bankId]: data ?? [] }));
  }

  async function handleCreateBankAccount() {
    if (!showAccountDialog || !accountEmail.trim() || accountPassword.length < 8) {
      toast.error('Email e password (min 8 caratteri) obbligatorie');
      return;
    }
    setCreatingAccount(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-admin-user', {
        body: { email: accountEmail.trim().toLowerCase(), password: accountPassword, nome: showAccountDialog.nome, ruolo: 'banca' },
      });
      if (error || data?.error) { toast.error(data?.error ?? error?.message); return; }
      const userId: string = data?.id;
      if (!userId) { toast.error('Account creato ma ID non ricevuto'); return; }
      await supabase.from('banks').update({ bank_user_id: userId }).eq('id', showAccountDialog.id);
      setBanks(prev => prev.map(b => b.id === showAccountDialog.id ? { ...b, bank_user_id: userId } : b));
      toast.success(`Account banca creato: ${accountEmail}`);
      setShowAccountDialog(null);
      setAccountEmail('');
      setAccountPassword('');
    } finally {
      setCreatingAccount(false);
    }
  }

  async function handleUploadModulo(bankId: string) {
    if (!moduloFormFile || !moduloFormNome.trim()) { toast.error('Nome e file obbligatori'); return; }
    setUploadingModulo(bankId);
    const ext  = moduloFormFile.name.split('.').pop() ?? 'pdf';
    const path = `${bankId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('bank-moduli').upload(path, moduloFormFile, { upsert: false });
    if (upErr) { toast.error('Errore upload: ' + upErr.message); setUploadingModulo(null); return; }
    const { error: dbErr } = await supabase.from('bank_moduli').insert({
      bank_id: bankId, nome: moduloFormNome.trim(),
      descrizione: moduloFormDesc.trim() || null, file_path: path,
    });
    if (dbErr) { toast.error('Errore salvataggio'); setUploadingModulo(null); return; }
    toast.success('Modulo caricato');
    setUploadingModulo(null);
    setShowModuloForm(null); setModuloFormNome(''); setModuloFormDesc(''); setModuloFormFile(null);
    loadModuli(bankId);
  }

  async function handleDeleteModulo(id: string, bankId: string, filePath: string) {
    if (!confirm('Eliminare questo modulo?')) return;
    await supabase.storage.from('bank-moduli').remove([filePath]);
    await supabase.from('bank_moduli').delete().eq('id', id);
    toast.success('Modulo eliminato');
    loadModuli(bankId);
  }

  async function downloadModulo(filePath: string, nome: string) {
    const { data } = await supabase.storage.from('bank-moduli').createSignedUrl(filePath, 300);
    if (!data?.signedUrl) { toast.error('Impossibile scaricare il file'); return; }
    const a = document.createElement('a'); a.href = data.signedUrl; a.download = nome; a.click();
  }

  // ── Carica le banche al mount ──
  useEffect(() => {
    loadBanks();
  }, []);

  const toggleExpand = (id: string) => {
    if (expandedBank === id) { setExpandedBank(null); return; }
    setExpandedBank(id);
    loadRequirements(id);
    loadKpiRequirements(id);
    loadAtecoRequirements(id);
    loadModuli(id);
  };

  const openCreateBank = () => { setEditingBank(null); setBankForm(emptyBank); setCcEmails(['']); setBccEmails(['']); setShowBankForm(true); };
  const openEditBank = (b: Bank) => {
    setEditingBank(b);
    setBankForm({ nome: b.nome, codice: b.codice, contatto: b.contatto ?? '', email: b.email ?? '', email_invio_banca: (b as Bank & { email_invio_banca?: string }).email_invio_banca ?? '', note: b.note ?? '', attiva: b.attiva, logo_url: (b as Bank & { logo_url?: string }).logo_url ?? '' });
    const parsedCc  = (b.email_cc  || '').split(',').map(e => e.trim()).filter(Boolean);
    const parsedBcc = (b.email_bcc || '').split(',').map(e => e.trim()).filter(Boolean);
    setCcEmails(parsedCc.length  > 0 ? parsedCc  : ['']);
    setBccEmails(parsedBcc.length > 0 ? parsedBcc : ['']);
    setShowBankForm(true);
  };

  const handleSaveBank = async () => {
    if (!bankForm.nome.trim() || !bankForm.codice.trim()) { toast.error('Nome e codice obbligatori'); return; }
    setSaving(true);
    const payload = {
      ...bankForm,
      contatto: bankForm.contatto || null,
      email: bankForm.email || null,
      note: bankForm.note || null,
      email_cc:  ccEmails.filter(e => e.trim()).join(',') || null,
      email_bcc: bccEmails.filter(e => e.trim()).join(',') || null,
    };
    if (editingBank) {
      const { error } = await supabase.from('banks').update(payload).eq('id', editingBank.id);
      if (error) { toast.error('Codice già esistente'); setSaving(false); return; }
      toast.success('Banca aggiornata');
    } else {
      const { error } = await supabase.from('banks').insert(payload);
      if (error) { toast.error('Codice già esistente'); setSaving(false); return; }
      toast.success('Banca creata');
    }
    setSaving(false); setShowBankForm(false); loadBanks();
  };

  const handleDeleteBank = async (id: string, nome: string) => {
    if (!confirm(`Eliminare la banca "${nome}"?`)) return;
    await supabase.from('banks').delete().eq('id', id);
    toast.success('Banca eliminata');
    loadBanks();
  };

  const handleSaveReq = async (bankId: string) => {
    if (!reqForm.nome.trim()) { toast.error('Nome documento obbligatorio'); return; }
    const existing = requirements[bankId] ?? [];
    await supabase.from('bank_document_requirements').insert({
      bank_id: bankId, nome: reqForm.nome, descrizione: reqForm.descrizione || null,
      obbligatorio: reqForm.obbligatorio, ordine: existing.length,
    });
    toast.success('Documento aggiunto');
    setShowReqForm(null);
    setReqForm(emptyReq);
    loadRequirements(bankId);
  };

  const handleDeleteReq = async (id: string, bankId: string) => {
    await supabase.from('bank_document_requirements').delete().eq('id', id);
    toast.success('Documento rimosso');
    loadRequirements(bankId);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Banche</h1>
          <p className="text-muted-foreground text-sm mt-1">Configurazione banche e documenti richiesti</p>
        </div>
        <Button onClick={openCreateBank} className="gap-2"><Plus className="w-4 h-4" /> Nuova Banca</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : banks.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-muted-foreground">Nessuna banca configurata</p>
          <Button variant="outline" className="mt-4" onClick={openCreateBank}>Aggiungi la prima banca</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {banks.map(b => (
            <Card key={b.id} className="border-border">
              <CardContent className="py-0">
                <div className="flex items-center gap-3 py-3 px-1">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-foreground">{b.nome}</p>
                      <code className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">{b.codice}</code>
                      <Badge className={b.attiva ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}>
                        {b.attiva ? 'Attiva' : 'Inattiva'}
                      </Badge>
                    </div>
                    {b.email && <p className="text-xs text-muted-foreground mt-0.5">{b.email}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-8 px-2 text-xs gap-1" onClick={() => toggleExpand(b.id)}>
                      <FileText className="w-3.5 h-3.5" />
                      {expandedBank === b.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </Button>
                    <Button
                      variant="ghost" size="sm"
                      className={`h-8 px-2 text-xs gap-1 ${(b as Bank & { bank_user_id?: string }).bank_user_id ? 'text-green-600' : 'text-blue-600'}`}
                      title={(b as Bank & { bank_user_id?: string }).bank_user_id ? 'Account banca già configurato' : 'Crea account portale banche'}
                      onClick={() => { setShowAccountDialog(b); setAccountEmail(b.email ?? ''); setAccountPassword(''); }}>
                      <UserPlus className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditBank(b)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10" onClick={() => handleDeleteBank(b.id, b.nome)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </div>

                {expandedBank === b.id && (
                  <div className="border-t border-border px-1 py-3">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Documenti Specifici Richiesti</p>
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setShowReqForm(b.id); setReqForm(emptyReq); }}>
                        <Plus className="w-3 h-3" /> Aggiungi
                      </Button>
                    </div>
                    {(requirements[b.id] ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-3">Nessun documento specifico configurato</p>
                    ) : (
                      <div className="space-y-1.5">
                        {(requirements[b.id] ?? []).map(r => (
                          <div key={r.id} className="flex items-center gap-3 bg-muted/50 rounded-lg px-3 py-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground">{r.nome}</p>
                              {r.descrizione && <p className="text-xs text-muted-foreground">{r.descrizione}</p>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {r.obbligatorio && <span className="text-xs text-red-500 font-medium">Obbl.</span>}
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDeleteReq(r.id, b.id)}><Trash2 className="w-3 h-3" /></Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {showReqForm === b.id && (
                      <div className="mt-3 p-3 bg-accent/30 rounded-lg space-y-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Nome Documento *</Label>
                          <Input placeholder="es. Perizia immobile" value={reqForm.nome} onChange={e => setReqForm(f => ({ ...f, nome: e.target.value }))} className="h-8 text-sm" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Descrizione</Label>
                          <Input placeholder="Istruzioni per il cliente..." value={reqForm.descrizione} onChange={e => setReqForm(f => ({ ...f, descrizione: e.target.value }))} className="h-8 text-sm" />
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch checked={reqForm.obbligatorio} onCheckedChange={v => setReqForm(f => ({ ...f, obbligatorio: v }))} />
                          <Label className="text-xs">Obbligatorio</Label>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveReq(b.id)}>Salva</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowReqForm(null)}>Annulla</Button>
                        </div>
                      </div>
                    )}

                    {/* ── Sezione KPI Richiesti ── */}
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <BarChart3 className="w-3.5 h-3.5" /> KPI Richiesti per Bancabilità
                        </p>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                          onClick={() => { setShowKpiForm(b.id); setKpiFormKey(''); setKpiFormMin(''); setKpiFormMax(''); }}>
                          <Plus className="w-3 h-3" /> Aggiungi
                        </Button>
                      </div>

                      {(kpiRequirements[b.id] ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-2">Nessun requisito KPI configurato</p>
                      ) : (
                        <div className="space-y-1.5">
                          {(kpiRequirements[b.id] ?? []).map(r => (
                            <div key={r.id} className="flex items-center gap-3 bg-muted/50 rounded-lg px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground">{r.kpi_label}</p>
                                <p className="text-xs text-muted-foreground">
                                  {r.min_value !== null && <span>Min: <strong>{r.min_value}</strong></span>}
                                  {r.min_value !== null && r.max_value !== null && <span className="mx-1">·</span>}
                                  {r.max_value !== null && <span>Max: <strong>{r.max_value}</strong></span>}
                                  <span className="ml-2 opacity-60 capitalize">[{r.kpi_area}]</span>
                                </p>
                              </div>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive"
                                onClick={() => handleDeleteKpiReq(r.id, b.id)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      {showKpiForm === b.id && (
                        <div className="mt-3 p-3 bg-accent/30 rounded-lg space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">KPI *</Label>
                            <Select value={kpiFormKey} onValueChange={setKpiFormKey}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Seleziona KPI..." /></SelectTrigger>
                              <SelectContent>
                                {(() => {
                                  const AREA_LABELS: Record<string, string> = {
                                    liquidita: '💧 Liquidità',
                                    solidita: '🏛️ Solidità Patrimoniale',
                                    redditivita: '📈 Redditività',
                                    indebitamento: '⚖️ Indebitamento',
                                    efficienza: '⚙️ Efficienza Operativa',
                                    copertura: '🛡️ Copertura',
                                  };
                                  const grouped: Record<string, typeof KPI_CATALOG> = {};
                                  KPI_CATALOG.forEach(k => {
                                    if (!grouped[k.area]) grouped[k.area] = [];
                                    grouped[k.area].push(k);
                                  });
                                  return Object.entries(grouped).map(([area, items]) => (
                                    <div key={area}>
                                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/50 select-none">
                                        {AREA_LABELS[area] ?? area}
                                      </div>
                                      {items.map(k => (
                                        <SelectItem key={k.key} value={k.key} className="pl-4">
                                          {k.label}
                                        </SelectItem>
                                      ))}
                                    </div>
                                  ));
                                })()}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Valore Minimo</Label>
                              <Input type="number" step="0.01" placeholder="es. 1.0" value={kpiFormMin}
                                onChange={e => setKpiFormMin(e.target.value)} className="h-8 text-sm" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Valore Massimo</Label>
                              <Input type="number" step="0.01" placeholder="es. 5.0" value={kpiFormMax}
                                onChange={e => setKpiFormMax(e.target.value)} className="h-8 text-sm" />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">Lascia vuoto il campo non vincolato (es. solo Min per KPI da massimizzare).</p>
                          <div className="flex gap-2">
                            <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveKpiReq(b.id)}>Salva</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowKpiForm(null)}>Annulla</Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Sezione ATECO ── */}
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Codici ATECO</p>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                          onClick={() => { setShowAtecoForm(b.id); setAtecoFormCodice(''); setAtecoFormTipo('incluso'); setAtecoFormDesc(''); }}>
                          <Plus className="w-3 h-3" /> Aggiungi
                        </Button>
                      </div>

                      {(atecoRequirements[b.id] ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-2">Nessun codice ATECO configurato</p>
                      ) : (
                        <div className="space-y-1.5">
                          {/* Prima inclusi, poi esclusi */}
                          {(['incluso', 'escluso'] as const).map(tipo => {
                            const items = (atecoRequirements[b.id] ?? []).filter(a => a.tipo === tipo);
                            if (items.length === 0) return null;
                            return (
                              <div key={tipo}>
                                <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${tipo === 'incluso' ? 'text-green-600' : 'text-red-600'}`}>
                                  {tipo === 'incluso' ? '✅ Inclusi (ammessi)' : '❌ Esclusi (non ammessi)'}
                                </p>
                                {items.map(a => (
                                  <div key={a.id} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 mb-1 ${tipo === 'incluso' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                                    <code className={`text-sm font-bold font-mono ${tipo === 'incluso' ? 'text-green-800' : 'text-red-800'}`}>{a.codice}</code>
                                    {a.descrizione && <span className="text-xs text-muted-foreground flex-1 truncate">{a.descrizione}</span>}
                                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive ml-auto"
                                      onClick={() => handleDeleteAtecoReq(a.id, b.id)}><Trash2 className="w-3 h-3" /></Button>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {showAtecoForm === b.id && (
                        <div className="mt-3 p-3 bg-accent/30 rounded-lg space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Codice ATECO *</Label>
                              <Input placeholder="es. 47.11" value={atecoFormCodice}
                                onChange={e => setAtecoFormCodice(e.target.value)} className="h-8 text-sm font-mono" />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Tipo *</Label>
                              <Select value={atecoFormTipo} onValueChange={v => setAtecoFormTipo(v as 'incluso' | 'escluso')}>
                                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="incluso">✅ Incluso (ammesso)</SelectItem>
                                  <SelectItem value="escluso">❌ Escluso (non ammesso)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Descrizione (opzionale)</Label>
                            <Input placeholder="es. Commercio al dettaglio" value={atecoFormDesc}
                              onChange={e => setAtecoFormDesc(e.target.value)} className="h-8 text-sm" />
                          </div>
                          <p className="text-xs text-muted-foreground">Usa prefissi per categorie: es. "47" copre tutti i codici 47.xx</p>
                          <div className="flex gap-2">
                            <Button size="sm" className="h-7 text-xs" onClick={() => handleSaveAtecoReq(b.id)}>Salva</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAtecoForm(null)}>Annulla</Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Sezione Moduli da Compilare ── */}
                    <div className="mt-4 border-t border-border pt-3">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" /> Moduli da Compilare
                        </p>
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                          onClick={() => { setShowModuloForm(b.id); setModuloFormNome(''); setModuloFormDesc(''); setModuloFormFile(null); }}>
                          <Plus className="w-3 h-3" /> Carica modulo
                        </Button>
                      </div>

                      {(bankModuli[b.id] ?? []).length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-2">Nessun modulo caricato</p>
                      ) : (
                        <div className="space-y-1.5">
                          {(bankModuli[b.id] ?? []).map(m => (
                            <div key={m.id} className="flex items-center gap-3 bg-muted/50 rounded-lg px-3 py-2">
                              <FileText className="w-4 h-4 text-primary shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{m.nome}</p>
                                {m.descrizione && <p className="text-xs text-muted-foreground truncate">{m.descrizione}</p>}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1 text-primary"
                                  onClick={() => downloadModulo(m.file_path, m.nome)}>
                                  <FileDown className="w-3 h-3" /> Scarica
                                </Button>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive"
                                  onClick={() => handleDeleteModulo(m.id, b.id, m.file_path)}>
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {showModuloForm === b.id && (
                        <div className="mt-3 p-3 bg-accent/30 rounded-lg space-y-3">
                          <div className="space-y-1.5">
                            <Label className="text-xs">Nome modulo *</Label>
                            <Input placeholder="es. Modulo antiriciclaggio" value={moduloFormNome}
                              onChange={e => setModuloFormNome(e.target.value)} className="h-8 text-sm" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Istruzioni per il cliente</Label>
                            <Input placeholder="es. Compilare in ogni sua parte e firmare" value={moduloFormDesc}
                              onChange={e => setModuloFormDesc(e.target.value)} className="h-8 text-sm" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">File (PDF, Word, ODT) *</Label>
                            <input type="file" accept=".pdf,.doc,.docx,.odt"
                              className="text-sm text-muted-foreground file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-primary file:text-primary-foreground cursor-pointer"
                              onChange={e => setModuloFormFile(e.target.files?.[0] ?? null)} />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" className="h-7 text-xs gap-1" disabled={uploadingModulo === b.id}
                              onClick={() => handleUploadModulo(b.id)}>
                              {uploadingModulo === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                              {uploadingModulo === b.id ? 'Caricamento...' : 'Carica'}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs"
                              onClick={() => setShowModuloForm(null)}>Annulla</Button>
                          </div>
                        </div>
                      )}
                    </div>

                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showBankForm} onOpenChange={setShowBankForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editingBank ? 'Modifica Banca' : 'Nuova Banca'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nome *</Label>
                <Input placeholder="Banca Intesa" value={bankForm.nome} onChange={e => setBankForm(f => ({ ...f, nome: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Codice Interno *</Label>
                <Input placeholder="INTESA" value={bankForm.codice} onChange={e => setBankForm(f => ({ ...f, codice: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" placeholder="istruttoria@banca.it" value={bankForm.email} onChange={e => setBankForm(f => ({ ...f, email: e.target.value }))} />
              </div>

              {/* Sezione invio pratica: A: / CC: / BCC: */}
              <div className="space-y-3 p-3 bg-muted/30 rounded-lg border border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Invio Pratica</p>

                {/* A: */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-9 h-7 rounded text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 shrink-0">A:</span>
                    <Input type="email" placeholder="documenti@banca.it" value={bankForm.email_invio_banca} onChange={e => setBankForm(f => ({ ...f, email_invio_banca: e.target.value }))} className="flex-1" />
                  </div>
                  <p className="text-xs text-muted-foreground pl-11">Destinatario principale. Se vuoto, verrà usata l'email di contatto.</p>
                </div>

                {/* CC: */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">CC (Copia)</p>
                  {ccEmails.map((email, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-9 h-7 rounded text-xs font-bold bg-blue-100 text-blue-700 border border-blue-200 shrink-0">CC:</span>
                      <Input
                        type="email"
                        placeholder="cc@banca.it"
                        value={email}
                        onChange={e => setCcEmails(prev => prev.map((v, i) => i === idx ? e.target.value : v))}
                        className="flex-1"
                      />
                      {ccEmails.length > 1 && (
                        <button type="button" onClick={() => setCcEmails(prev => prev.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-600 text-lg leading-none px-1">×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setCcEmails(prev => [...prev, ''])}
                    className="text-xs text-blue-600 hover:text-blue-800 underline ml-11">+ Aggiungi CC</button>
                </div>

                {/* BCC: */}
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">BCC (Copia nascosta)</p>
                  {bccEmails.map((email, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-9 h-7 rounded text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200 shrink-0">BCC:</span>
                      <Input
                        type="email"
                        placeholder="bcc@banca.it"
                        value={email}
                        onChange={e => setBccEmails(prev => prev.map((v, i) => i === idx ? e.target.value : v))}
                        className="flex-1"
                      />
                      {bccEmails.length > 1 && (
                        <button type="button" onClick={() => setBccEmails(prev => prev.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-600 text-lg leading-none px-1">×</button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setBccEmails(prev => [...prev, ''])}
                    className="text-xs text-slate-500 hover:text-slate-700 underline ml-11">+ Aggiungi BCC</button>
                </div>
              </div>
            <div className="space-y-1.5">
              <Label>URL Logo</Label>
              <div className="flex gap-2 items-center">
                <Input placeholder="https://logo.clearbit.com/banca.it" value={bankForm.logo_url}
                  onChange={e => setBankForm(f => ({ ...f, logo_url: e.target.value }))} />
                {bankForm.logo_url && (
                  <img src={bankForm.logo_url} alt="logo" className="w-8 h-8 object-contain rounded border shrink-0"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
              </div>
              {!bankForm.logo_url && bankForm.email && (
                <button type="button" className="text-xs text-primary underline mt-0.5"
                  onClick={() => {
                    const domain = bankForm.email.split('@')[1];
                    if (domain) setBankForm(f => ({ ...f, logo_url: `https://logo.clearbit.com/${domain}` }));
                  }}>
                  ↗ Usa dominio email ({bankForm.email.split('@')[1]})
                </button>
              )}
              <p className="text-xs text-muted-foreground">Logo usato nella verifica bancabilità. Usa <code>https://logo.clearbit.com/dominio.it</code> per logo automatico.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Contatto</Label>
              <Input placeholder="Referente istruttoria" value={bankForm.contatto} onChange={e => setBankForm(f => ({ ...f, contatto: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Note</Label>
              <Textarea placeholder="Note interne..." rows={2} value={bankForm.note} onChange={e => setBankForm(f => ({ ...f, note: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={bankForm.attiva} onCheckedChange={v => setBankForm(f => ({ ...f, attiva: v }))} />
              <Label>Banca attiva</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBankForm(false)}>Annulla</Button>
            <Button onClick={handleSaveBank} disabled={saving}>{saving ? 'Salvo...' : (editingBank ? 'Salva' : 'Crea')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog crea account portale banca */}
      <Dialog open={!!showAccountDialog} onOpenChange={(o) => { if (!o) setShowAccountDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>🏦 Crea Account Portale Banche</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Crea le credenziali di accesso per <strong>{showAccountDialog?.nome}</strong>.
              La banca accederà al portale anonimo per visualizzare le pratiche.
            </p>
            {showAccountDialog && (showAccountDialog as Bank & { bank_user_id?: string }).bank_user_id && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
                ✅ Account già configurato per questa banca. Crearne uno nuovo sovrascriverà il collegamento.
              </div>
            )}
            <div className="space-y-2">
              <Label>Email accesso</Label>
              <Input type="email" placeholder="banca@esempio.it" value={accountEmail} onChange={e => setAccountEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Password (min 8 caratteri)</Label>
              <Input type="password" placeholder="Password sicura..." value={accountPassword} onChange={e => setAccountPassword(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Comunica manualmente le credenziali alla banca. Il link di accesso è: <code className="bg-muted px-1 rounded">/#/login</code>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAccountDialog(null)}>Annulla</Button>
            <Button
              onClick={handleCreateBankAccount}
              disabled={creatingAccount || !accountEmail.trim() || accountPassword.length < 8}
              className="gap-1.5">
              <UserPlus className="w-3.5 h-3.5" />
              {creatingAccount ? 'Creazione...' : 'Crea Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
