import type { Socio } from './types';

export interface OwnershipDocument {
  id: string;
  name: string;
  uploadedAt: string;
  documentDate?: string;
  companyName: string;
  identifiers: string[];
  soci: Socio[];
}

export interface OwnershipNode {
  id: string;
  name: string;
  identifier: string;
  kind: 'company' | 'person' | 'unknown';
  isClient: boolean;
  source?: OwnershipDocument;
}

export interface OwnershipEdge {
  id: string;
  owner: string;
  company: string;
  percentage: number | null;
  rawPercentage: string;
  source: OwnershipDocument;
}

export interface OwnershipGraph {
  nodes: OwnershipNode[];
  edges: OwnershipEdge[];
  activeDocuments: OwnershipDocument[];
  warnings: string[];
}

export function normalizeTaxId(value?: string): string {
  const normalized = (value ?? '').toUpperCase().replace(/[\s.-]/g, '').replace(/^IT(?=\d{11}$)/, '');
  return /^(?:\d{11}|[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])$/.test(normalized) ? normalized : '';
}

export function parseOwnershipPercentage(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,3}(?:[.,]\d+)?)\s*%?$/);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  return value >= 0 && value <= 100 ? value : null;
}

export function ownershipCompanyIdentifiers(text: string): string[] {
  // Non permettere al CF di un socio di diventare un alias della partecipata.
  // L'identità deve essere nell'anagrafica, prima della sezione proprietaria.
  const headings = [...text.matchAll(/^\s*ANAGRAFICA\s+IMPRESA\s*$/gim)];
  const anagrafica = headings[headings.length - 1];
  const start = anagrafica?.index ?? 0;
  const body = text.slice(start);
  const heading = /^\s*(?:(?:sezione\s+)?(?:[IVX]+|\d+)[\s.)-]+)?(?:soci\s+e\s+titolari|elenco\s+(?:dei\s+)?soci|sintesi\s+della\s+composizione\s+societaria|composizione\s+societaria|compagine\s+societaria|assetto\s+proprietario|titolari\s+di\s+quote|socio|titolare|quotista)\b/im;
  const boundary = body.search(heading);
  const header = boundary >= 0 ? body.slice(0, boundary) : body;
  const cf = header.match(/(?:codice\s+fiscale(?:\s+e\s+numero\s+d['’]iscrizione)?|C\.?\s*F\.?)\s*[:-]?\s*([A-Z0-9]{11,16})\b/i)?.[1];
  const vat = header.match(/(?:partita\s+IVA|P\.?\s*IVA)\s*[:-]?\s*(\d{11})\b/i)?.[1];
  return [...new Set([cf, vat].map(normalizeTaxId).filter(Boolean))];
}

/** La data è quella esplicita di estrazione, non una data di nascita o di costituzione. */
export function ownershipDocumentDate(text: string): string | undefined {
  const match = text.match(/(?:data\s+(?:di\s+)?estrazione|estratt[ao]\s+(?:dal\s+registro\s+imprese\s+)?(?:il|in\s+data))\s*:?\s*(\d{2})[/.](\d{2})[/.](\d{4})/i);
  if (!match) return undefined;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(iso) ? iso : undefined;
}

export function buildOwnershipGraph(
  client: { id: string; ragione_sociale: string; codice_fiscale?: string; piva?: string },
  documents: OwnershipDocument[],
  preferred: string[] = [],
): OwnershipGraph {
  // Unione soltanto per identificativi fiscali, mai per semplice omonimia.
  const parents = new Map<string, string>();
  const find = (id: string): string => {
    if (!parents.has(id)) parents.set(id, id);
    const parent = parents.get(id)!;
    if (parent === id) return id;
    const root = find(parent);
    parents.set(id, root);
    return root;
  };
  const identifiers = (values: string[]) => [...new Set(values.map(normalizeTaxId).filter(Boolean))];
  const clientIds = identifiers([client.codice_fiscale ?? '', client.piva ?? '']);
  const union = (values: string[]) => {
    const ids = identifiers(values);
    ids.slice(1).forEach(id => parents.set(find(id), find(ids[0])));
  };
  union(clientIds);
  documents.forEach(doc => union(doc.identifiers));
  const clientKey = clientIds.length ? find(clientIds[0]) : `client:${client.id}`;
  const groups = new Map<string, OwnershipDocument[]>();
  documents.forEach(doc => {
    const ids = identifiers(doc.identifiers);
    if (!ids.length) return;
    const key = find(ids[0]);
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  });
  const warnings: string[] = [];
  const effectiveTime = (doc: OwnershipDocument) => Date.parse(doc.documentDate ?? doc.uploadedAt) || 0;
  const activeDocuments = [...groups.values()].map(versions => {
    versions.sort((a, b) => effectiveTime(b) - effectiveTime(a) || b.uploadedAt.localeCompare(a.uploadedAt) || a.id.localeCompare(b.id));
    const chosen = [...preferred].reverse().map(id => versions.find(doc => doc.id === id)).find(Boolean) ?? versions[0];
    if (versions.length > 1) warnings.push(`${chosen.companyName}: presenti ${versions.length} visure. È usata una sola versione; le quote delle altre non vengono sommate.`);
    return chosen;
  });
  const nodes = new Map<string, OwnershipNode>();
  nodes.set(clientKey, {
    id: clientKey, name: client.ragione_sociale, identifier: clientIds[0] ?? '',
    kind: 'company', isClient: true,
  });
  activeDocuments.forEach(doc => {
    const key = find(identifiers(doc.identifiers)[0]);
    nodes.set(key, {
      id: key, name: key === clientKey ? client.ragione_sociale : doc.companyName,
      identifier: identifiers(doc.identifiers)[0], kind: 'company',
      isClient: key === clientKey, source: doc,
    });
  });
  const edges: OwnershipEdge[] = [];
  activeDocuments.forEach(doc => {
    const company = find(identifiers(doc.identifiers)[0]);
    const seen = new Set<string>();
    doc.soci.forEach((socio, index) => {
      if (!socio.nome?.trim()) return;
      const taxId = normalizeTaxId(socio.codice_fiscale);
      // Senza CF il nome è locale alla fonte: nessuna fusione con omonimi.
      const owner = taxId ? find(taxId) : `unknown:${doc.id}:${index}`;
      if (!nodes.has(owner)) nodes.set(owner, {
        id: owner, name: socio.nome, identifier: taxId,
        kind: /^\d{11}$/.test(taxId) ? 'company' : taxId ? 'person' : 'unknown',
        isClient: false,
      });
      const existing = nodes.get(owner)!;
      if (existing.name === `Società CF ${existing.identifier}`) existing.name = socio.nome;
      const percentage = parseOwnershipPercentage(socio.percentuale ?? '');
      const signature = `${owner}:${socio.percentuale}:${socio.valore}`;
      if (seen.has(signature)) return;
      seen.add(signature);
      edges.push({
        id: `${doc.id}:${index}`, owner, company, percentage,
        rawPercentage: socio.percentuale ?? '', source: doc,
      });
    });
    if (!doc.soci.length) warnings.push(`${doc.companyName}: compagine soci non rilevata nella visura.`);
  });
  if (edges.some(edge => edge.percentage === null)) warnings.push('Alcune percentuali non sono disponibili o non sono valide: non vengono calcolate da importi nominali.');
  if ([...nodes.values()].some(node => node.kind === 'unknown')) warnings.push('I soggetti senza codice fiscale non sono unificati, anche se hanno lo stesso nome.');
  if (activeDocuments.length && !nodes.get(clientKey)?.source) warnings.push('Nessuna visura è stata associata con certezza al CF/P.IVA del cliente. Verificare gli identificativi in anagrafica: i collegamenti non sono dedotti dal solo nome.');
  return { nodes: [...nodes.values()], edges, activeDocuments, warnings };
}

export interface OwnershipTreeNode {
  key: string;
  node: OwnershipNode;
  via?: OwnershipEdge;
  reference: boolean;
  cycle: boolean;
  children: OwnershipTreeNode[];
}

/** Albero dall'azionista alla partecipata. I nodi condivisi e i cicli sono riferimenti. */
export function buildOwnershipForest(graph: OwnershipGraph): OwnershipTreeNode[] {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const expanded = new Set<string>();
  const outgoing = new Map<string, OwnershipEdge[]>();
  graph.edges.forEach(edge => outgoing.set(edge.owner, [...(outgoing.get(edge.owner) ?? []), edge]));
  const visit = (id: string, path: Set<string>, key: string, via?: OwnershipEdge): OwnershipTreeNode => {
    const cycle = path.has(id);
    const reference = expanded.has(id);
    const result: OwnershipTreeNode = { key, node: byId.get(id)!, via, cycle, reference, children: [] };
    if (cycle || reference) return result;
    expanded.add(id);
    const next = new Set([...path, id]);
    result.children = (outgoing.get(id) ?? []).map(edge => visit(edge.company, next, `${key}/${edge.id}`, edge));
    return result;
  };
  const incoming = new Set(graph.edges.map(edge => edge.company));
  const roots = graph.nodes.filter(node => !incoming.has(node.id));
  const forest = roots.map(node => visit(node.id, new Set(), node.id));
  // Anche componenti circolari senza capostipite e società non collegate.
  graph.nodes.forEach(node => {
    if (!expanded.has(node.id)) forest.push(visit(node.id, new Set(), node.id));
  });
  return forest;
}
