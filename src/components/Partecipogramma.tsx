import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, Building2, Check, GitBranch, Loader2, RefreshCw, RotateCcw, Save, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { loadOwnershipDocuments } from '@/lib/loadOwnershipDocuments';
import {
  buildOwnershipGraph, layoutOwnershipCompanies, ownershipBreakdown,
  ownershipShareOverrideKey, parseOwnershipPercentage,
  type OwnershipDocument, type OwnershipNode, type OwnershipShareOverrides,
} from '@/lib/partecipogramma';
import { supabase } from '@/lib/supabase';
import type { Client } from '@/lib/types';
import { toast } from 'sonner';

const dateLabel = (date: string) => {
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('it-IT') : 'non disponibile';
};
const percentageLabel = (percentage: number | null) =>
  percentage === null ? 'Quota n.d.' : `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 4 }).format(percentage)}%`;
const moneyLabel = (value?: number) =>
  value == null ? 'Non rilevato' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value);

interface CompanyRevenue {
  amount: number;
  year: number;
}

function readShareOverrides(value: Record<string, unknown> | null | undefined): OwnershipShareOverrides {
  const candidate = value?.partecipogramma_quote_overrides;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
  return Object.fromEntries(Object.entries(candidate)
    .filter((entry): entry is [string, string | number] =>
      typeof entry[1] === 'string' || typeof entry[1] === 'number')
    .filter(([, percentage]) => parseOwnershipPercentage(String(percentage)) !== null)
    .map(([key, percentage]) => [key, String(percentage)]));
}

function companyNameKey(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const slicePalette = ['#2563eb', '#0d9488', '#9333ea', '#d97706', '#e11d48', '#4f46e5', '#65a30d', '#0891b2', '#c026d3', '#a16207'];

function CompanyOwnership({
  node, colors, overrides, drafts, savingKey, onDraftChange, onSave, onReset,
}: {
  node: OwnershipNode;
  colors: Map<string, string>;
  overrides: OwnershipShareOverrides;
  drafts: Record<string, string>;
  savingKey: string | null;
  onDraftChange: (key: string, value: string) => void;
  onSave: (key: string) => void;
  onReset: (key: string) => void;
}) {
  const breakdown = ownershipBreakdown(node);
  let end = 0;
  const color = (id: string, missing: boolean) => missing ? 'var(--muted-foreground)' : colors.get(id) ?? slicePalette[0];
  const segments = breakdown.slices.filter(slice => (slice.percentage ?? 0) > 0).map(slice => {
    const start = end;
    end += slice.percentage!;
    return `${color(slice.id, slice.missing)} ${start}% ${end}%`;
  });
  const unavailable = !breakdown.hasSource || breakdown.invalid;
  return (
    <div className="mt-3 flex items-start gap-4">
      <span className="shrink-0 text-center">
        <span role="img" aria-label={unavailable ? 'Quote non rappresentabili' : `Quote dei soci di ${node.name}, dettagli nella legenda`}
          className="block h-28 w-28 rounded-full border border-border"
          style={{ background: unavailable || !segments.length ? 'var(--muted)' : `conic-gradient(${segments.join(', ')})` }} />
        <span className="mt-2 block text-[10px] text-muted-foreground">Quote dei soci</span>
      </span>
      <div className="min-w-0 flex-1">
        {!breakdown.hasSource ? (
        <div className="block text-xs text-muted-foreground">Visura della società non disponibile. Caricala per visualizzare i suoi soci.</div>
      ) : (
        <>
            {breakdown.slices.map((slice, index) => {
              const socio = node.details?.soci[index];
              const documentIndex = socio && node.source ? node.source.soci.indexOf(socio) : index;
              const companyIdentifier = node.source?.identifiers.find(identifier => identifier.trim()) || node.identifier;
              const key = socio ? ownershipShareOverrideKey(companyIdentifier, socio, documentIndex) : '';
              const editable = Boolean(socio && (
                !(socio.percentuale ?? '').trim()
                || parseOwnershipPercentage(socio.percentuale ?? '') === null
              ));
              const draft = key ? (drafts[key] ?? overrides[key] ?? '') : '';
              const draftIsValid = parseOwnershipPercentage(draft) !== null;
              return (
                <div key={`${slice.id}:${index}`} className="flex min-h-[25px] items-center gap-2 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color(slice.id, slice.missing) }} />
                  <span className={`min-w-0 flex-1 truncate ${slice.missing ? 'italic text-muted-foreground' : ''}`} title={slice.name}>{slice.name}</span>
                  {editable ? (
                    <>
                      <Input
                        aria-label={`Quota percentuale di ${socio?.nome || 'socio'} in ${node.name}`}
                        type="text" inputMode="decimal"
                        className="h-7 w-20 px-2 text-right text-xs"
                        placeholder="n.d."
                        value={draft}
                        onChange={event => onDraftChange(key, event.target.value)}
                      />
                      <span className="shrink-0">%</span>
                      <Button
                        type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0"
                        aria-label={`Salva quota di ${socio?.nome || 'socio'}`}
                        title="Salva quota"
                        disabled={!draftIsValid || savingKey !== null || draft === overrides[key]}
                        onClick={() => onSave(key)}
                      >
                        {overrides[key] === undefined ? <Save className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                      </Button>
                      {overrides[key] !== undefined && (
                        <Button
                          type="button" size="icon" variant="ghost" className="h-7 w-7 shrink-0"
                          aria-label={`Ripristina quota non determinata di ${socio?.nome || 'socio'}`}
                          title="Ripristina n.d."
                          disabled={savingKey !== null}
                          onClick={() => onReset(key)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="shrink-0 font-semibold tabular-nums">{percentageLabel(slice.percentage)}</span>
                  )}
                </div>
              );
            })}
            {breakdown.invalid ? (
              <div className="mt-1 block text-[11px] text-amber-700 dark:text-amber-400">Quote incoerenti: totale {percentageLabel(breakdown.total)}. Torta sospesa, verificare la visura.</div>
            ) : breakdown.incomplete && (
              <div className="mt-1 block text-[10px] text-muted-foreground">Il grigio indica quote non determinate, non un socio aggiuntivo.</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Partecipogramma({ client, practiceId }: { client: Client; practiceId?: string }) {
  const [documents, setDocuments] = useState<OwnershipDocument[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fileCount, setFileCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState('Ricerca delle visure caricate…');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [preferred, setPreferred] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [selectedKey, setSelectedKey] = useState('');
  const [shareOverrides, setShareOverrides] = useState<OwnershipShareOverrides>(() => readShareOverrides(client.visura_json));
  const [shareDrafts, setShareDrafts] = useState<Record<string, string>>({});
  const [savingShareKey, setSavingShareKey] = useState<string | null>(null);
  const [companyRevenues, setCompanyRevenues] = useState<Map<string, CompanyRevenue>>(new Map());
  const [revenueLoadError, setRevenueLoadError] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const arrowId = useId().replace(/:/g, '');
  const clientId = client.id;
  const visuraJson = client.visura_json;

  useEffect(() => {
    setShareOverrides(readShareOverrides(visuraJson));
    setShareDrafts({});
    let active = true;
    supabase.from('clients').select('visura_json').eq('id', clientId).maybeSingle()
      .then(({ data, error: readError }) => {
        if (active && !readError && data) setShareOverrides(readShareOverrides(data.visura_json));
      });
    return () => { active = false; };
  }, [clientId, visuraJson]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setDocuments([]);
    setWarnings([]);
    setPreferred([]);
    setSelectedKey('');
    setProgress('Ricerca delle visure caricate…');
    loadOwnershipDocuments(client, message => {
      if (!controller.signal.aborted) setProgress(message);
    }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setDocuments(result.documents);
      setWarnings(result.warnings);
      setFileCount(result.fileCount);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Impossibile leggere le visure.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
    // Il caricamento dipende dal cliente e dal riferimento del documento salvato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, visuraJson, refresh]);

  useEffect(() => {
    let active = true;
    let query = supabase.from('bilanci_kpi')
      .select('ragione_sociale,ricavi_vendite,anno_esercizio,created_at,uploaded_files!inner(id),practices!inner(client_id)')
      .order('anno_esercizio', { ascending: false })
      .order('created_at', { ascending: false });
    query = practiceId
      ? query.eq('practice_id', practiceId)
      : query.eq('practices.client_id', client.id);
    query.then(({ data, error: queryError }) => {
      if (!active) return;
      if (queryError) {
        setRevenueLoadError(true);
        setCompanyRevenues(new Map());
        return;
      }
      const revenues = new Map<string, CompanyRevenue>();
      (data ?? []).forEach(row => {
        const nameKey = companyNameKey(row.ragione_sociale ?? '');
        if (row.ricavi_vendite == null || row.ricavi_vendite === '') return;
        const amount = Number(row.ricavi_vendite);
        const year = Number(row.anno_esercizio);
        if (nameKey && Number.isFinite(amount) && Number.isFinite(year) && !revenues.has(nameKey)) {
          revenues.set(nameKey, { amount, year });
        }
      });
      setRevenueLoadError(false);
      setCompanyRevenues(revenues);
    });
    return () => { active = false; };
  }, [client.id, practiceId]);

  const graph = useMemo(() => buildOwnershipGraph(client, documents, preferred, shareOverrides), [client, documents, preferred, shareOverrides]);
  const layout = useMemo(() => layoutOwnershipCompanies(graph), [graph]);
  const selected = layout.nodes.find(item => item.node.id === selectedKey);
  const colors = useMemo(() => {
    const ids = [...new Set(graph.nodes.flatMap(node => ownershipBreakdown(node).slices.filter(slice => !slice.missing).map(slice => slice.id)))].sort();
    return new Map(ids.map((id, index) => [id, slicePalette[index % slicePalette.length]]));
  }, [graph]);
  const activeIds = new Set(graph.activeDocuments.map(doc => doc.id));

  const persistShareOverrides = async (nextOverrides: OwnershipShareOverrides, key: string) => {
    setSavingShareKey(key);
    try {
      const { data: currentClient, error: readError } = await supabase.from('clients')
        .select('visura_json').eq('id', client.id).single();
      if (readError) throw readError;
      const currentJson = currentClient.visura_json && typeof currentClient.visura_json === 'object'
        && !Array.isArray(currentClient.visura_json)
        ? currentClient.visura_json as Record<string, unknown> : {};
      const { error: writeError } = await supabase.from('clients').update({
        visura_json: { ...currentJson, partecipogramma_quote_overrides: nextOverrides },
      }).eq('id', client.id);
      if (writeError) throw writeError;
      setShareOverrides(nextOverrides);
      setShareDrafts(value => { const copy = { ...value }; delete copy[key]; return copy; });
      return true;
    } catch {
      return false;
    } finally {
      setSavingShareKey(null);
    }
  };

  const saveShare = async (key: string) => {
    const raw = shareDrafts[key] ?? shareOverrides[key] ?? '';
    const percentage = parseOwnershipPercentage(raw);
    if (percentage === null) return;
    const nextOverrides = { ...shareOverrides, [key]: String(percentage) };
    if (await persistShareOverrides(nextOverrides, key)) toast.success('Quota salvata');
    else toast.error('Quota non salvata. Verifica i permessi e riprova.');
  };

  const resetShare = async (key: string) => {
    const nextOverrides = { ...shareOverrides };
    delete nextOverrides[key];
    if (await persistShareOverrides(nextOverrides, key)) toast.success('Quota ripristinata come non determinata');
    else toast.error('Impossibile ripristinare la quota');
  };

  return (
    <Card>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold flex items-center gap-2"><GitBranch className="h-5 w-5 text-primary" /> Partecipogramma</h2>
            <p className="text-sm text-muted-foreground mt-1">{client.ragione_sociale} · partecipazioni dalle visure caricate</p>
          </div>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Rileggi visure
          </Button>
        </div>

        {loading ? (
          <div className="py-14 flex flex-col items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="w-6 h-6 animate-spin text-primary" /><p className="text-sm">{progress}</p>
          </div>
        ) : error ? (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium">Impossibile generare il partecipogramma</p><p className="mt-1">{error}</p>
            <Button variant="outline" className="mt-3" onClick={() => setRefresh(value => value + 1)}>Riprova</Button>
          </div>
        ) : (
          <>
            {!documents.length ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <GitBranch className="w-9 h-9 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium">Nessuna visura utilizzabile per il grafico</p>
                <p className="text-sm text-muted-foreground mt-2 max-w-xl mx-auto">
                  Carica la visura nell’anagrafica cliente oppure nei documenti di una sua pratica, usando una voce o un nome file che contenga “visura”.
                  Per estendere l’albero, carica anche le visure delle società collegate. Sono supportati PDF con testo selezionabile.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                  <p>{graph.activeDocuments.length} società con visura · {graph.edges.length} partecipazioni · {fileCount} file esaminati</p>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" aria-label="Riduci grafico" disabled={zoom <= 0.25} onClick={() => setZoom(value => Math.max(0.25, value - 0.25))}><ZoomOut className="h-4 w-4" /></Button>
                    <span className="w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                    <Button variant="outline" size="sm" aria-label="Ingrandisci grafico" disabled={zoom >= 1.5} onClick={() => setZoom(value => Math.min(1.5, value + 0.25))}><ZoomIn className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => setZoom(Math.max(0.25, Math.min(1,
                      (viewport.current?.clientWidth ?? 800) / layout.width,
                      (viewport.current?.clientHeight ?? 600) / layout.height,
                    )))}>Adatta</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Dall’alto verso il basso: società socia → società partecipata, con la quota diretta sul ramo.
                  Ogni società compare una sola volta; accanto trovi la torta con tutti i suoi soci, comprese le persone fisiche. Clicca sulla scheda per i dettagli.
                  {layout.links.some(link => link.cycle) && ' I rami tratteggiati indicano partecipazioni circolari da verificare.'}
                </p>
                <div ref={viewport} tabIndex={0} role="region" aria-label="Grafico ad albero delle partecipazioni, scorribile. Seleziona un nodo per i dettagli."
                  className="max-h-[60vh] min-h-64 overflow-auto rounded-xl border bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div style={{ width: layout.width * zoom, height: layout.height * zoom, margin: '0 auto' }}>
                    <div className="relative origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
                      <svg width={layout.width} height={layout.height} className="absolute inset-0 text-primary/50" aria-hidden="true">
                        <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
                        {layout.links.map(link => (
                          <g key={link.edge.id}>
                            <path d={link.cycle
                              ? `M ${link.x1} ${link.y1} H ${layout.width - 12} V ${link.y2 - 18} H ${link.x2} V ${link.y2 - 5}`
                              : `M ${link.x1} ${link.y1} V ${link.y1 + 40} H ${link.x2} V ${link.y2 - 5}`}
                              fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={link.cycle ? '6 4' : undefined} markerEnd={`url(#${arrowId})`} />
                            <rect x={link.x2 - 59} y={link.y2 - 42} width="118" height="26" rx="13" className="fill-background stroke-border" />
                            <text x={link.x2} y={link.y2 - 24} textAnchor="middle" className="fill-foreground text-[12px] font-semibold">{percentageLabel(link.edge.percentage)}</text>
                          </g>
                        ))}
                      </svg>
                      {layout.nodes.map(({ node, x, y, width, height }) => (
                          <div key={node.id} role="group" aria-label={`Società ${node.name}`}
                            className={`absolute rounded-xl border p-4 text-left shadow-sm hover:border-primary transition-colors ${node.isClient ? 'border-primary bg-card' : 'bg-card'} ${selectedKey === node.id ? 'ring-2 ring-primary' : ''}`}
                            style={{ left: x, top: y, width, height }}>
                            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              <Building2 className="h-3.5 w-3.5 shrink-0" />{node.isClient ? 'Società cliente' : 'Società collegata'}
                            </span>
                            <button type="button" onClick={() => setSelectedKey(node.id)}
                              aria-pressed={selectedKey === node.id}
                              aria-label={`Dettagli di ${node.name}`}
                              className="mt-1.5 block w-full truncate text-left text-sm font-semibold leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              title={node.name}>{node.name}</button>
                            <span className="mt-1 block text-[11px] font-mono text-muted-foreground">CF {node.identifier || 'non rilevato'}</span>
                            <span className="mt-1 block truncate text-[10px] text-muted-foreground" title={`Amministratore: ${node.details?.amministratori[0]?.nome || 'non rilevato'}`}>
                              Amministratore: {node.details?.amministratori[0]?.nome || 'non rilevato'}
                              {node.details?.amministratori[0]?.carica ? ` · ${node.details.amministratori[0].carica}` : ''}
                              {(node.details?.amministratori.length ?? 0) > 1 ? ` +${(node.details?.amministratori.length ?? 1) - 1}` : ''}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground" title="Dato ricavato dai bilanci caricati nella pratica">
                              Fatturato{companyRevenues.get(companyNameKey(node.name))
                                ? ` ${companyRevenues.get(companyNameKey(node.name))?.year}: ${moneyLabel(companyRevenues.get(companyNameKey(node.name))?.amount)}`
                                : revenueLoadError ? ': non disponibile' : ': non rilevato'}
                            </span>
                            <CompanyOwnership
                              node={node} colors={colors} overrides={shareOverrides} drafts={shareDrafts}
                              savingKey={savingShareKey}
                              onDraftChange={(key, value) => setShareDrafts(current => ({ ...current, [key]: value }))}
                              onSave={saveShare} onReset={resetShare}
                            />
                          </div>
                      ))}
                    </div>
                  </div>
                </div>
                {selected && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1" role="status">
                    <p className="font-semibold">{selected.node.name}</p>
                    {selected.node.source && <p className="text-muted-foreground">Visura della società: {selected.node.source.name}</p>}
                    {selected.node.source?.sourceText && (
                      <details className="rounded border bg-background p-3">
                        <summary className="cursor-pointer text-xs font-medium">Verifica il testo letto dalla visura</summary>
                        <p className="mt-2 text-xs text-muted-foreground">Testo estratto dal PDF, senza modificare il documento originale. Utile per controllare nominativi e quote.</p>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs font-mono">{selected.node.source.sourceText}</pre>
                      </details>
                    )}
                    {selected.node.kind === 'company' && selected.node.details && (
                      <div className="mt-3 rounded-lg border bg-background p-3 space-y-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">P.IVA</p>
                            <p className="font-mono font-medium">{selected.node.details.piva || 'Non rilevata'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Capitale sociale</p>
                            <p className="font-medium">{moneyLabel(selected.node.details.capitaleSociale)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Soci / amministratori</p>
                            <p className="font-medium">{selected.node.details.soci.length} / {selected.node.details.amministratori.length}</p>
                          </div>
                        </div>
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <p className="mb-1.5 font-semibold">Elenco soci</p>
                            {selected.node.details.soci.length ? (
                              <div className="overflow-x-auto rounded border">
                                <table className="w-full text-xs text-left">
                                  <thead className="bg-muted/50"><tr><th className="p-2">Nome</th><th className="p-2">CF/P.IVA</th><th className="p-2">Quota</th></tr></thead>
                                  <tbody>{selected.node.details.soci.map((socio, index) => (
                                    <tr key={`${socio.codice_fiscale || socio.nome}-${index}`} className="border-t">
                                      <td className="p-2 font-medium">{socio.nome || 'Non rilevato'}</td>
                                      <td className="p-2 font-mono text-muted-foreground">{socio.codice_fiscale || 'Non rilevato'}</td>
                                      <td className="p-2 whitespace-nowrap">{socio.percentuale || 'n.d.'}</td>
                                    </tr>
                                  ))}</tbody>
                                </table>
                              </div>
                            ) : <p className="text-xs text-muted-foreground">Elenco soci non rilevato nella visura selezionata.</p>}
                          </div>
                          <div>
                            <p className="mb-1.5 font-semibold">Amministratori</p>
                            {selected.node.details.amministratori.length ? (
                              <div className="space-y-2">
                                {selected.node.details.amministratori.map((amministratore, index) => (
                                  <div key={`${amministratore.codice_fiscale || amministratore.nome}-${index}`} className="rounded border px-3 py-2">
                                    <p className="font-medium">{amministratore.nome || 'Non rilevato'}</p>
                                    <p className="text-xs text-muted-foreground">{amministratore.carica || 'Carica non rilevata'}{amministratore.codice_fiscale ? ` · CF ${amministratore.codice_fiscale}` : ''}</p>
                                  </div>
                                ))}
                              </div>
                            ) : <p className="text-xs text-muted-foreground">Amministratori non rilevati nella visura selezionata.</p>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {(warnings.length > 0 || graph.warnings.length > 0) && (
              <details className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm" open={!documents.length}>
                <summary className="cursor-pointer font-medium"><AlertCircle className="inline w-4 h-4 mr-1.5" />Avvisi e documenti da verificare ({warnings.length + graph.warnings.length})</summary>
                <ul className="mt-2 list-disc pl-5 space-y-1 text-xs">{[...warnings, ...graph.warnings].map((warning, index) => <li key={index}>{warning}</li>)}</ul>
              </details>
            )}

            {documents.length > 0 && (
              <details className="rounded-lg border p-3 text-sm">
                <summary className="font-medium cursor-pointer">Visure e versioni utilizzate ({documents.length})</summary>
                <p className="text-xs text-muted-foreground mt-2">Per ogni società viene usata una sola visura: la più recente per data di estrazione, se riconosciuta, altrimenti per data di caricamento. Puoi scegliere una versione diversa per questa consultazione.</p>
                <div className="mt-3 divide-y">{documents.map(doc => (
                  <div key={doc.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium break-words">{doc.companyName} <span className="text-xs font-normal text-muted-foreground">· {activeIds.has(doc.id) ? 'In uso' : 'Altra versione'}</span></p>
                      <p className="text-xs text-muted-foreground break-words">{doc.name} · {doc.documentDate ? `Estratta il ${dateLabel(doc.documentDate)}` : `Data estrazione n.d. · caricata il ${dateLabel(doc.uploadedAt)}`}</p>
                    </div>
                    {!activeIds.has(doc.id) && <Button size="sm" variant="outline" onClick={() => setPreferred(value => [...value.filter(id => id !== doc.id), doc.id])}>Usa questa versione</Button>}
                  </div>
                ))}</div>
              </details>
            )}

            {graph.edges.length > 0 && (
              <details className="rounded-lg border p-3 text-sm">
                <summary className="font-medium cursor-pointer">Elenco accessibile delle partecipazioni ({graph.edges.length})</summary>
                <div className="overflow-x-auto mt-3">
                  <table className="w-full text-xs text-left">
                    <caption className="sr-only">Soci, società partecipate, quote dirette e documenti di provenienza</caption>
                    <thead><tr className="border-b"><th scope="col" className="p-2">Socio</th><th scope="col" className="p-2">Società partecipata</th><th scope="col" className="p-2">Quota</th><th scope="col" className="p-2">Visura fonte</th></tr></thead>
                    <tbody>{graph.edges.map(edge => <tr key={edge.id} className="border-b last:border-0">
                      <td className="p-2">{graph.nodes.find(node => node.id === edge.owner)?.name}</td><td className="p-2">{graph.nodes.find(node => node.id === edge.company)?.name}</td>
                      <td className="p-2 whitespace-nowrap">{percentageLabel(edge.percentage)}</td><td className="p-2">{edge.source.name}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </details>
            )}
            <p className="text-xs text-muted-foreground">Lettura automatica da verificare sulle visure originali. I rami rappresentano quote e diritti estratti, non certificano controllo societario o titolarità effettiva. Nessuna percentuale mancante viene inventata.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
