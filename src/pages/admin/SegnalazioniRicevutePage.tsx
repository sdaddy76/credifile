// @section: segnalazioni-ricevute
// Pannello super_admin / segreteria per gestire le segnalazioni pubbliche ricevute.
// Permette di assegnare ogni segnalazione a un agente.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Inbox, RefreshCw, User, Building2, Phone, Mail, FileText, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

// ── Tipi ──────────────────────────────────────────────────────────────────────
interface Segnalazione {
  id: string;
  ragione_sociale: string;
  nome_referente?: string | null;
  email_referente?: string | null;
  telefono?: string | null;
  note?: string | null;
  stato: string;
  agente_id?: string | null;
  note_interne?: string | null;
  created_at: string;
  file_urls?: { nome: string; url: string }[] | null;
  agente?: { nome: string; nome_cognome: string } | null;
}

interface Agente {
  id: string;
  nome: string;
  nome_cognome: string;
  ruolo: string;
}

const STATO_COLOR: Record<string, string> = {
  nuova:       'bg-orange-100 text-orange-800',
  assegnata:   'bg-blue-100 text-blue-800',
  lavorazione: 'bg-purple-100 text-purple-800',
  chiusa:      'bg-green-100 text-green-800',
  annullata:   'bg-gray-100 text-gray-600',
};

export default function SegnalazioniRicevutePage() {
  const { isSuperAdmin, isSegreteria } = useAuth();
  const [segnalazioni, setSegnalazioni] = useState<Segnalazione[]>([]);
  const [agenti, setAgenti]             = useState<Agente[]>([]);
  const [loading, setLoading]           = useState(true);
  const [filtroStato, setFiltroStato]   = useState('nuova');
  const [assigning, setAssigning]       = useState<string | null>(null);
  const [noteInterne, setNoteInterne]   = useState<Record<string, string>>({});
  const [selectedAgente, setSelectedAgente] = useState<Record<string, string>>({});

  // Carica lista agenti per assegnazione
  const loadAgenti = async () => {
    const { data } = await supabase
      .from('admin_profiles')
      .select('id, nome, nome_cognome, ruolo')
      .in('ruolo', ['agente', 'super_admin'])
      .order('nome_cognome');
    setAgenti((data ?? []) as Agente[]);
  };

  // Carica segnalazioni
  const load = async () => {
    setLoading(true);
    let q = supabase
      .from('segnalazioni_pubbliche')
      .select('*, agente:agente_id(nome, nome_cognome)')
      .order('created_at', { ascending: false });
    if (filtroStato && filtroStato !== 'tutte') q = q.eq('stato', filtroStato);
    const { data, error } = await q.limit(100);
    if (error) { toast.error('Errore caricamento: ' + error.message); }
    setSegnalazioni((data ?? []) as Segnalazione[]);
    setLoading(false);
  };

  useEffect(() => { loadAgenti(); }, []);
  useEffect(() => { load(); }, [filtroStato]);

  // Assegna segnalazione a un agente
  const assegna = async (seg: Segnalazione) => {
    const agenteId = selectedAgente[seg.id];
    if (!agenteId) { toast.error('Seleziona un agente'); return; }
    setAssigning(seg.id);
    const { error } = await supabase
      .from('segnalazioni_pubbliche')
      .update({
        agente_id:    agenteId,
        stato:        'assegnata',
        note_interne: noteInterne[seg.id] ?? seg.note_interne ?? null,
        updated_at:   new Date().toISOString(),
      })
      .eq('id', seg.id);
    if (error) { toast.error('Errore assegnazione: ' + error.message); }
    else {
      toast.success('Segnalazione assegnata!');
      await load();
    }
    setAssigning(null);
  };

  // Aggiorna stato
  const cambiaStato = async (id: string, stato: string) => {
    await supabase.from('segnalazioni_pubbliche').update({ stato, updated_at: new Date().toISOString() }).eq('id', id);
    setSegnalazioni(prev => prev.map(s => s.id === id ? { ...s, stato } : s));
  };

  if (!isSuperAdmin && !isSegreteria) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <AlertCircle className="w-10 h-10 mb-3 opacity-30" />
        <p>Accesso non consentito</p>
      </div>
    );
  }

  const counts = {
    nuova:       segnalazioni.filter(s => s.stato === 'nuova').length,
    assegnata:   segnalazioni.filter(s => s.stato === 'assegnata').length,
    lavorazione: segnalazioni.filter(s => s.stato === 'lavorazione').length,
    chiusa:      segnalazioni.filter(s => s.stato === 'chiusa').length,
    tutte:       segnalazioni.length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Inbox className="w-6 h-6 text-orange-500" /> Segnalazioni Ricevute
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Segnalazioni inviate dal modulo pubblico — assegna ogni lead a un agente
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Aggiorna
        </Button>
      </div>

      {/* Filtri stato */}
      <div className="flex gap-1 flex-wrap">
        {(['nuova','assegnata','lavorazione','chiusa','tutte'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFiltroStato(s)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
              filtroStato === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            {s === 'nuova' ? '🟠 Nuove' : s === 'assegnata' ? '🔵 Assegnate' : s === 'lavorazione' ? '🟣 In lavorazione' : s === 'chiusa' ? '🟢 Chiuse' : 'Tutte'}
            {counts[s] > 0 && <span className="ml-1.5 opacity-70">({counts[s]})</span>}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : segnalazioni.length === 0 ? (
        <div className="text-center py-16 border rounded-lg bg-muted/20">
          <Inbox className="w-10 h-10 mx-auto text-muted-foreground mb-3 opacity-20" />
          <p className="text-sm text-muted-foreground">
            Nessuna segnalazione {filtroStato !== 'tutte' ? `con stato "${filtroStato}"` : ''}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Il link pubblico è: <code className="bg-muted px-1 rounded">/#/segnala</code>
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {segnalazioni.map(seg => (
            <Card key={seg.id} className={`border ${seg.stato === 'nuova' ? 'border-orange-200 bg-orange-50/30' : ''}`}>
              <CardContent className="pt-4 pb-4">
                <div className="flex flex-col gap-3">
                  {/* Riga superiore */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Building2 className="w-4 h-4 text-orange-500 shrink-0" />
                        <span className="font-semibold text-sm">{seg.ragione_sociale}</span>
                        <Badge className={`text-[10px] ${STATO_COLOR[seg.stato] ?? 'bg-gray-100'}`}>
                          {seg.stato}
                        </Badge>
                        {seg.agente && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <User className="w-3 h-3" /> {seg.agente.nome_cognome}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {seg.nome_referente && <span className="flex items-center gap-1"><User className="w-3 h-3" />{seg.nome_referente}</span>}
                        {seg.telefono && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{seg.telefono}</span>}
                        {seg.email_referente && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{seg.email_referente}</span>}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(seg.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {seg.note && (
                        <p className="text-xs text-muted-foreground mt-1.5 max-w-xl bg-muted/50 rounded px-2 py-1 flex gap-1">
                          <FileText className="w-3 h-3 shrink-0 mt-0.5" />
                          {seg.note}
                        </p>
                      )}
                      {/* Documenti allegati */}
                      {seg.file_urls && seg.file_urls.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {seg.file_urls.map((f, i) => (
                            <a
                              key={i}
                              href={f.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors max-w-[220px]"
                            >
                              <FileText className="w-3 h-3 shrink-0" />
                              <span className="truncate">{f.nome}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Cambio stato rapido */}
                    <div className="flex items-center gap-1 shrink-0">
                      {seg.stato !== 'lavorazione' && seg.stato !== 'chiusa' && (
                        <button onClick={() => cambiaStato(seg.id, 'lavorazione')} className="text-xs px-2 py-1 rounded border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors">
                          In lavorazione
                        </button>
                      )}
                      {seg.stato !== 'chiusa' && (
                        <button onClick={() => cambiaStato(seg.id, 'chiusa')} className="p-1.5 rounded hover:bg-accent transition-colors" title="Chiudi">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sezione assegnazione (visibile solo se non chiusa/annullata) */}
                  {seg.stato !== 'chiusa' && seg.stato !== 'annullata' && (
                    <div className="flex items-end gap-2 flex-wrap border-t pt-3">
                      <div className="flex-1 min-w-[160px]">
                        <label className="text-xs text-muted-foreground mb-1 block">Assegna ad agente</label>
                        <Select
                          value={selectedAgente[seg.id] ?? (seg.agente_id ?? '')}
                          onValueChange={v => setSelectedAgente(prev => ({ ...prev, [seg.id]: v }))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Seleziona agente…" />
                          </SelectTrigger>
                          <SelectContent>
                            {agenti.map(a => (
                              <SelectItem key={a.id} value={a.id} className="text-xs">
                                {a.nome_cognome} ({a.ruolo})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex-1 min-w-[180px]">
                        <label className="text-xs text-muted-foreground mb-1 block">Note interne (opzionale)</label>
                        <Textarea
                          value={noteInterne[seg.id] ?? (seg.note_interne ?? '')}
                          onChange={e => setNoteInterne(prev => ({ ...prev, [seg.id]: e.target.value }))}
                          rows={1}
                          placeholder="Aggiungi note interne…"
                          className="text-xs h-8 resize-none py-1.5"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={() => assegna(seg)}
                        disabled={assigning === seg.id || !selectedAgente[seg.id]}
                        className="gap-1.5 h-8 text-xs shrink-0"
                      >
                        {assigning === seg.id
                          ? <><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Salvo…</>
                          : <><User className="w-3 h-3" /> Assegna</>
                        }
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
