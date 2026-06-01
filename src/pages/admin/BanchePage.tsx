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
import { Plus, Building2, Pencil, Trash2, ChevronDown, ChevronUp, FileText, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Bank, BankDocumentRequirement } from '@/lib/types';

// Catalogo KPI disponibili per requisiti banca
const KPI_CATALOG = [
  { key: 'current_ratio', area: 'liquidita', label: 'Current Ratio' },
  { key: 'quick_ratio', area: 'liquidita', label: 'Quick Ratio' },
  { key: 'debt_equity', area: 'solidita', label: 'Debt/Equity' },
  { key: 'leverage', area: 'solidita', label: 'Leverage' },
  { key: 'pn_su_ta', area: 'solidita', label: 'PN / Totale Attivo (%)' },
  { key: 'grado_indebitamento', area: 'solidita', label: 'Grado Indebitamento' },
  { key: 'roe', area: 'redditivita', label: 'ROE (%)' },
  { key: 'roi', area: 'redditivita', label: 'ROI (%)' },
  { key: 'ros', area: 'redditivita', label: 'ROS (%)' },
  { key: 'ebitda_margin', area: 'redditivita', label: 'EBITDA Margin (%)' },
  { key: 'pfn_ebitda', area: 'indebitamento', label: 'PFN / EBITDA' },
  { key: 'pfn_pn', area: 'indebitamento', label: 'PFN / PN' },
  { key: 'dso', area: 'efficienza', label: 'DSO (gg crediti)' },
  { key: 'interest_coverage', area: 'copertura', label: 'Interest Coverage' },
  { key: 'dscr', area: 'copertura', label: 'DSCR' },
];
interface KpiReq { id: string; kpi_key: string; kpi_area: string; kpi_label: string; min_value: number | null; max_value: number | null }

const emptyBank = { nome: '', codice: '', contatto: '', email: '', email_invio_banca: '', note: '', attiva: true };
const emptyReq = { nome: '', descrizione: '', obbligatorio: true };

export default function BanchePage() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBankForm, setShowBankForm] = useState(false);
  const [editingBank, setEditingBank] = useState<Bank | null>(null);
  const [bankForm, setBankForm] = useState(emptyBank);
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

  useEffect(() => { loadBanks(); }, []);

  const toggleExpand = (id: string) => {
    if (expandedBank === id) { setExpandedBank(null); return; }
    setExpandedBank(id);
    loadRequirements(id);
    loadKpiRequirements(id);
  };

  const openCreateBank = () => { setEditingBank(null); setBankForm(emptyBank); setShowBankForm(true); };
  const openEditBank = (b: Bank) => {
    setEditingBank(b);
    setBankForm({ nome: b.nome, codice: b.codice, contatto: b.contatto ?? '', email: b.email ?? '', email_invio_banca: (b as Bank & { email_invio_banca?: string }).email_invio_banca ?? '', note: b.note ?? '', attiva: b.attiva });
    setShowBankForm(true);
  };

  const handleSaveBank = async () => {
    if (!bankForm.nome.trim() || !bankForm.codice.trim()) { toast.error('Nome e codice obbligatori'); return; }
    setSaving(true);
    const payload = { ...bankForm, contatto: bankForm.contatto || null, email: bankForm.email || null, note: bankForm.note || null };
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
                                {KPI_CATALOG.map(k => (
                                  <SelectItem key={k.key} value={k.key}>
                                    {k.label} <span className="text-muted-foreground ml-1 text-xs capitalize">({k.area})</span>
                                  </SelectItem>
                                ))}
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
              <div className="space-y-2">
                <Label>Email Invio Documenti Pratica</Label>
                <Input type="email" placeholder="documenti@banca.it" value={bankForm.email_invio_banca} onChange={e => setBankForm(f => ({ ...f, email_invio_banca: e.target.value }))} />
                <p className="text-xs text-muted-foreground">Email a cui la segreteria invia la pratica completa.</p>
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
    </div>
  );
}
