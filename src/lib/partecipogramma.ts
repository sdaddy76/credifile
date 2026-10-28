import type { Amministratore, Socio } from './types';

export interface OwnershipCompanyDetails {
  piva?: string;
  capitaleSociale?: number;
  soci: Socio[];
  amministratori: Amministratore[];
}

export interface OwnershipDocument {
  id: string;
  name: string;
  uploadedAt: string;
  documentDate?: string;
  companyName: string;
  identifiers: string[];
  soci: Socio[];
  piva?: string;
  capitaleSociale?: number;
  amministratori?: Amministratore[];
}

export interface OwnershipNode {
  id: string;
  name: string;
  identifier: string;
  kind: 'company' | 'person' | 'unknown';
  isClient: boolean;
  source?: OwnershipDocument;
  details?: OwnershipCompanyDetails;
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

export function ownershipCompanyIdentity(text: string): { codiceFiscale: string; piva: string } {
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
  return { codiceFiscale: normalizeTaxId(cf), piva: normalizeTaxId(vat) };
}

export function ownershipCompanyIdentifiers(text: string): string[] {
  const identity = ownershipCompanyIdentity(text);
  return [...new Set([identity.codiceFiscale, identity.piva].filter(Boolean))];
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
  client: {
    id: string;
    ragione_sociale: string;
    codice_fiscale?: string;
    piva?: string;
    capitale_sociale?: number;
    soci?: Socio[];
    amministratori?: Amministratore[];
  },
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
    details: {
      piva: client.piva,
      capitaleSociale: client.capitale_sociale,
      soci: client.soci ?? [],
      amministratori: client.amministratori ?? [],
    },
  });
  activeDocuments.forEach(doc => {
    const key = find(identifiers(doc.identifiers)[0]);
    nodes.set(key, {
      id: key, name: key === clientKey ? client.ragione_sociale : doc.companyName,
      identifier: identifiers(doc.identifiers)[0], kind: 'company',
      isClient: key === clientKey, source: doc,
      details: {
        piva: doc.piva,
        capitaleSociale: doc.capitaleSociale,
        soci: doc.soci.filter(socio => {
          const taxId = normalizeTaxId(socio.codice_fiscale);
          return !taxId || find(taxId) !== key;
        }),
        amministratori: doc.amministratori ?? [],
      },
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
      if (owner === company) {
        warnings.push(`${doc.companyName}: esclusa una riga con il CF/P.IVA della società stessa (${socio.percentuale || 'quota n.d.'}). Possibile intestazione o piè di pagina interpretato come socio; verificare la visura.`);
        return;
      }
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

export interface OwnershipSlice {
  id: string;
  name: string;
  percentage: number | null;
  missing: boolean;
}

export function ownershipBreakdown(node: OwnershipNode) {
  const slices: OwnershipSlice[] = (node.details?.soci ?? []).map((socio, index) => ({
    id: normalizeTaxId(socio.codice_fiscale) || `${node.id}:${index}`,
    name: socio.nome,
    percentage: parseOwnershipPercentage(socio.percentuale ?? ''),
    missing: false,
  }));
  const total = slices.reduce((sum, slice) => sum + (slice.percentage ?? 0), 0);
  const invalid = total > 100 + 0.000001;
  const incomplete = !slices.length || slices.some(slice => slice.percentage === null) || total < 100 - 0.000001;
  // La fetta grigia rappresenta una quota NON attribuita, non un socio inventato.
  if (!invalid && total < 100 - 0.000001) slices.push({
    id: `${node.id}:missing`, name: 'Quota non determinata',
    percentage: Math.round((100 - total) * 1000000) / 1000000, missing: true,
  });
  return { slices, total, invalid, incomplete, hasSource: Boolean(node.source) };
}

/** Una sola scheda per società; le persone fisiche sono nella torta e nella legenda. */
export function layoutOwnershipCompanies(graph: OwnershipGraph) {
  const companies = graph.nodes.filter(node => node.kind === 'company');
  const ids = new Set(companies.map(node => node.id));
  const relations = graph.edges.filter(edge => ids.has(edge.owner) && ids.has(edge.company));
  const outgoing = new Map<string, OwnershipEdge[]>();
  relations.forEach(edge => outgoing.set(edge.owner, [...(outgoing.get(edge.owner) ?? []), edge]));
  const visiting = new Set<string>(), visited = new Set<string>(), cycles = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    visiting.add(id);
    (outgoing.get(id) ?? []).forEach(edge => {
      if (visiting.has(edge.company)) cycles.add(edge.id);
      else visit(edge.company);
    });
    visiting.delete(id);
    visited.add(id);
  };
  companies.forEach(node => visit(node.id));
  const indegrees = new Map(companies.map(node => [node.id, 0]));
  relations.filter(edge => !cycles.has(edge.id)).forEach(edge => indegrees.set(edge.company, indegrees.get(edge.company)! + 1));
  const levels = new Map(companies.map(node => [node.id, 0]));
  const queue = companies.filter(node => indegrees.get(node.id) === 0).map(node => node.id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    (outgoing.get(id) ?? []).filter(edge => !cycles.has(edge.id)).forEach(edge => {
      levels.set(edge.company, Math.max(levels.get(edge.company)!, levels.get(id)! + 1));
      indegrees.set(edge.company, indegrees.get(edge.company)! - 1);
      if (indegrees.get(edge.company) === 0) queue.push(edge.company);
    });
  }
  const rows = new Map<number, OwnershipNode[]>();
  companies.forEach(node => rows.set(levels.get(node.id)!, [...(rows.get(levels.get(node.id)!) ?? []), node]));
  const width = Math.max(580, ...[...rows.values()].map(row => row.length * 560 + 40));
  const nodes: { node: OwnershipNode; x: number; y: number; width: number; height: number }[] = [];
  let y = 24;
  [...rows.entries()].sort(([a], [b]) => a - b).forEach(([, row]) => {
    const heights = row.map(node => Math.max(270, 164 + ownershipBreakdown(node).slices.length * 25));
    row.forEach((node, index) => nodes.push({
      node, x: (width - row.length * 560) / 2 + index * 560 + 20, y,
      width: 520, height: heights[index],
    }));
    y += Math.max(...heights) + 110;
  });
  const byId = new Map(nodes.map(item => [item.node.id, item]));
  const links = relations.map(edge => {
    const owner = byId.get(edge.owner)!, company = byId.get(edge.company)!;
    return { edge, cycle: cycles.has(edge.id), x1: owner.x + owner.width / 2, y1: owner.y + owner.height,
      x2: company.x + company.width / 2, y2: company.y };
  });
  return { nodes, links, width, height: Math.max(280, y - 70) };
}
