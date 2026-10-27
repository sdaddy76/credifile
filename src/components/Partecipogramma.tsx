import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertCircle, Building2, GitBranch, Loader2, RefreshCw, UserRound, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { loadOwnershipDocuments } from '@/lib/loadOwnershipDocuments';
import { buildOwnershipForest, buildOwnershipGraph, type OwnershipDocument, type OwnershipTreeNode } from '@/lib/partecipogramma';
import type { Client } from '@/lib/types';

function layoutForest(forest: OwnershipTreeNode[]) {
  const widths = new Map<string, number>();
  const measure = (tree: OwnershipTreeNode): number => {
    const width = Math.max(272, tree.children.reduce((sum, child) => sum + measure(child), 0));
    widths.set(tree.key, width);
    return width;
  };
  const width = forest.reduce((sum, tree) => sum + measure(tree), 0) + 32;
  const nodes: { tree: OwnershipTreeNode; x: number; y: number }[] = [];
  const links: { tree: OwnershipTreeNode; x1: number; y1: number; x2: number; y2: number }[] = [];
  let maxY = 0;
  const place = (tree: OwnershipTreeNode, left: number, level: number) => {
    const x = left + widths.get(tree.key)! / 2;
    const y = 24 + level * 208;
    maxY = Math.max(maxY, y);
    nodes.push({ tree, x, y });
    let childLeft = left;
    tree.children.forEach(child => {
      const childX = childLeft + widths.get(child.key)! / 2;
      links.push({ tree: child, x1: x, y1: y + 120, x2: childX, y2: y + 208 });
      place(child, childLeft, level + 1);
      childLeft += widths.get(child.key)!;
    });
  };
  let left = 16;
  forest.forEach(tree => { place(tree, left, 0); left += widths.get(tree.key)!; });
  return { nodes, links, width: Math.max(width, 304), height: maxY + 152 };
}

const dateLabel = (date: string) => {
  const parsed = new Date(date);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('it-IT') : 'non disponibile';
};
const percentageLabel = (percentage: number | null) =>
  percentage === null ? 'Quota n.d.' : `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 4 }).format(percentage)}%`;

export default function Partecipogramma({ client }: { client: Client }) {
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
  const viewport = useRef<HTMLDivElement>(null);
  const arrowId = useId().replace(/:/g, '');
  const clientId = client.id;
  const visuraJson = client.visura_json;

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

  const graph = useMemo(() => buildOwnershipGraph(client, documents, preferred), [client, documents, preferred]);
  const forest = useMemo(() => buildOwnershipForest(graph), [graph]);
  const layout = useMemo(() => layoutForest(forest), [forest]);
  const selected = layout.nodes.find(item => item.tree.key === selectedKey)?.tree;
  const activeIds = new Set(graph.activeDocuments.map(doc => doc.id));

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
                    <Button variant="ghost" size="sm" onClick={() => setZoom(Math.max(0.25, Math.min(1, (viewport.current?.clientWidth ?? 800) / layout.width)))}>Adatta</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Dall’alto verso il basso: socio → società partecipata. La percentuale sul ramo è la quota diretta nella società sottostante, non una quota indiretta calcolata.
                  {forest.length > 1 && ' I nodi “Rif.” indicano soggetti condivisi fra rami diversi. Non vengono dedotti legami assenti nelle visure.'}
                </p>
                <div ref={viewport} tabIndex={0} role="region" aria-label="Grafico ad albero delle partecipazioni, scorribile. Seleziona un nodo per i dettagli."
                  className="max-h-[60vh] min-h-64 overflow-auto rounded-xl border bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div style={{ width: layout.width * zoom, height: layout.height * zoom, margin: '0 auto' }}>
                    <div className="relative origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
                      <svg width={layout.width} height={layout.height} className="absolute inset-0 text-primary/50" aria-hidden="true">
                        <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
                        {layout.links.map(link => (
                          <g key={link.tree.key}>
                            <path d={`M ${link.x1} ${link.y1} V ${link.y1 + 24} H ${link.x2} V ${link.y2 - 5}`} fill="none" stroke="currentColor" strokeWidth="1.5" markerEnd={`url(#${arrowId})`} />
                            <rect x={link.x2 - 59} y={link.y2 - 42} width="118" height="26" rx="13" className="fill-background stroke-border" />
                            <text x={link.x2} y={link.y2 - 24} textAnchor="middle" className="fill-foreground text-[12px] font-semibold">{percentageLabel(link.tree.via!.percentage)}</text>
                          </g>
                        ))}
                      </svg>
                      {layout.nodes.map(({ tree, x, y }) => {
                        const Icon = tree.node.kind === 'person' ? UserRound : Building2;
                        return (
                          <button key={tree.key} type="button" onClick={() => setSelectedKey(tree.key)}
                            aria-pressed={selectedKey === tree.key}
                            title={`${tree.node.name}${tree.via ? ` · quota ${percentageLabel(tree.via.percentage)}` : ''}`}
                            className={`absolute rounded-xl border p-3 text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-primary transition-colors ${tree.node.isClient ? 'border-primary bg-primary/10' : 'bg-card'} ${selectedKey === tree.key ? 'ring-2 ring-primary' : ''}`}
                            style={{ left: x - 120, top: y, width: 240, height: 120 }}>
                            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              <Icon className="h-3.5 w-3.5 shrink-0" />{tree.node.isClient ? 'Cliente' : tree.node.kind === 'person' ? 'Persona fisica' : tree.node.kind === 'unknown' ? 'Soggetto da verificare' : 'Società'}
                              {tree.reference && <span className="ml-auto normal-case text-primary">{tree.cycle ? 'Ciclo ↗' : 'Rif. ↗'}</span>}
                            </span>
                            <span className="mt-1.5 block line-clamp-2 text-sm font-semibold leading-tight">{tree.node.name}</span>
                            <span className="mt-1 block text-[11px] font-mono text-muted-foreground">{tree.node.identifier || 'CF/P.IVA non rilevato'}</span>
                            <span className="mt-1 block text-[10px] text-muted-foreground">{tree.node.source ? 'Visura disponibile' : 'Dati dalla visura della partecipata'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {selected && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1" role="status">
                    <p className="font-semibold">{selected.node.name}</p>
                    {selected.via && <p>Quota diretta: {percentageLabel(selected.via.percentage)} · Fonte: {selected.via.source.name} ({selected.via.source.companyName})</p>}
                    {selected.node.source && <p className="text-muted-foreground">Visura della società: {selected.node.source.name}</p>}
                    {selected.reference && <p className="text-muted-foreground">Soggetto già presente nell’albero: il riferimento evita di duplicare i rami o creare un ciclo infinito.</p>}
                    {selected.reference && <Button variant="outline" size="sm" onClick={() => {
                      const original = layout.nodes.find(item => item.tree.node.id === selected.node.id && !item.tree.reference);
                      if (!original) return;
                      setSelectedKey(original.tree.key);
                      viewport.current?.scrollTo({
                        left: original.x * zoom - viewport.current.clientWidth / 2,
                        top: original.y * zoom - 24, behavior: 'smooth',
                      });
                    }}>Vai al nodo completo</Button>}
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
