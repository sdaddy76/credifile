import {
  buildOwnershipForest, buildOwnershipGraph, normalizeTaxId,
  ownershipCompanyIdentifiers, ownershipDocumentDate, parseOwnershipPercentage,
  type OwnershipDocument, type OwnershipTreeNode,
} from '@/lib/partecipogramma';

const client = { id: 'cliente', ragione_sociale: 'ALFA SRL', piva: '01234567890' };
const doc = (id: string, companyId: string, owners: [string, string, string][], overrides: Partial<OwnershipDocument> = {}): OwnershipDocument => ({
  id, name: `${id}.pdf`, companyName: id, identifiers: [companyId],
  uploadedAt: '2026-10-27T10:00:00Z',
  soci: owners.map(([nome, codice_fiscale, percentuale]) => ({ nome, codice_fiscale, percentuale, valore: '' })),
  amministratori: [],
  ...overrides,
});
const flatten = (trees: OwnershipTreeNode[]): OwnershipTreeNode[] => trees.flatMap(tree => [tree, ...flatten(tree.children)]);

describe('partecipogramma: identità e quote', () => {
  it('normalizza CF/P.IVA ma non fonde identificativi non riconoscibili', () => {
    expect(normalizeTaxId('IT 01234567890')).toBe('01234567890');
    expect(normalizeTaxId('rssmra80a01h501z')).toBe('RSSMRA80A01H501Z');
    expect(normalizeTaxId('ALFA SRL')).toBe('');
  });

  it('legge solo percentuali esplicite valide, senza trasformare quote nominali', () => {
    expect(parseOwnershipPercentage('60,125%')).toBe(60.125);
    expect(parseOwnershipPercentage('0%')).toBe(0);
    ['', '10.000,00 Euro', '110%', '-5%', 'n.d.'].forEach(value => expect(parseOwnershipPercentage(value)).toBeNull());
  });

  it('non associa il CF del socio alla P.IVA della partecipata', () => {
    expect(ownershipCompanyIdentifiers(`
      Denominazione ALFA SRL
      Partita IVA: 01234567890
      4 Soci e titolari di quote
      HOLDING BETA SRL
      Codice fiscale: 09876543210
    `)).toEqual(['01234567890']);
  });

  it('riconosce la vera anagrafica di un report dopo l’indice', () => {
    expect(ownershipCompanyIdentifiers(`
      Indice
      4 Soci e titolari .... 6
      ANAGRAFICA IMPRESA
      ALFA SRL
      Codice fiscale 01234567890
      Partita IVA 01234567890
      ELENCO SOCI
      BETA SRL Codice fiscale 09876543210
    `)).toEqual(['01234567890']);
  });

  it('non scambia data costituzione e data estrazione e rifiuta date inesistenti', () => {
    expect(ownershipDocumentDate('Data costituzione 01/01/2000\nVisura estratta il 20/10/2026')).toBe('2026-10-20');
    expect(ownershipDocumentDate('Data costituzione 01/01/2000')).toBeUndefined();
    expect(ownershipDocumentDate('Data estrazione 31/02/2026')).toBeUndefined();
  });
});

describe('partecipogramma: collegamenti e versioni', () => {
  it('costruisce tre livelli e collega società con nomi diversi ma stesso CF', () => {
    const graph = buildOwnershipGraph(client, [
      doc('ALFA SRL', client.piva, [['BETA HOLDING', '09876543210', '60%']]),
      doc('BETA HOLDING S.P.A.', '09876543210', [['ROSSI MARIO', 'RSSMRA80A01H501Z', '100%']]),
    ]);
    expect(graph.nodes).toHaveLength(3);
    const forest = buildOwnershipForest(graph);
    expect(forest).toHaveLength(1);
    expect(forest[0].node.name).toBe('ROSSI MARIO');
    expect(forest[0].children[0].node.name).toBe('BETA HOLDING S.P.A.');
    expect(forest[0].children[0].children[0].node.isClient).toBe(true);
    expect(forest[0].children[0].children[0].via.percentage).toBe(60);
  });

  it('conserva i dati societari per il dettaglio del nodo', () => {
    const graph = buildOwnershipGraph(client, [{
      ...doc('ALFA SRL', client.piva, [['BETA HOLDING', '09876543210', '60%']]),
      piva: client.piva,
      capitaleSociale: 25000,
      amministratori: [{ nome: 'ROSSI MARIO', codice_fiscale: 'RSSMRA80A01H501Z', carica: 'Amministratore unico' }],
    }]);
    const company = graph.nodes.find(node => node.isClient);
    expect(company?.details).toEqual(expect.objectContaining({
      piva: client.piva,
      capitaleSociale: 25000,
      soci: expect.arrayContaining([expect.objectContaining({ nome: 'BETA HOLDING' })]),
      amministratori: [expect.objectContaining({ carica: 'Amministratore unico' })],
    }));
  });

  it('mostra anche le società partecipate dal cliente e i soci comuni', () => {
    const graph = buildOwnershipGraph(client, [
      doc('ALFA', client.piva, [['ROSSI', 'RSSMRA80A01H501Z', '100%']]),
      doc('BETA', '09876543210', [['ALFA', client.piva, '51%'], ['ROSSI', 'RSSMRA80A01H501Z', '49%']]),
    ]);
    const entries = flatten(buildOwnershipForest(graph));
    expect(entries.filter(entry => entry.node.identifier === '09876543210')).toHaveLength(2);
    expect(entries.filter(entry => entry.reference)).toHaveLength(1);
    expect(entries.filter(entry => entry.via)).toHaveLength(3);
  });

  it('non somma le visure storiche e consente la scelta di una versione', () => {
    const docs = [
      doc('storica', client.piva, [['ROSSI', 'RSSMRA80A01H501Z', '30%']], { documentDate: '2024-01-01', uploadedAt: '2026-10-28T10:00:00Z' }),
      doc('recente', client.piva, [['ROSSI', 'RSSMRA80A01H501Z', '60%']], { documentDate: '2026-10-01' }),
    ];
    expect(buildOwnershipGraph(client, docs).edges.map(edge => edge.percentage)).toEqual([60]);
    expect(buildOwnershipGraph(client, docs, ['storica']).edges.map(edge => edge.percentage)).toEqual([30]);
    expect(buildOwnershipGraph(client, docs, ['storica', 'recente']).activeDocuments[0].id).toBe('recente');
  });

  it('unifica CF e P.IVA diversi solo se documentati nella stessa anagrafica', () => {
    const graph = buildOwnershipGraph(client, [
      doc('ALFA', client.piva, [['BETA', '09876543210', '100%']]),
      doc('BETA', '09876543210', [], { identifiers: ['09876543210', '11111111111'] }),
      doc('GAMMA', '22222222222', [['BETA SPA', '11111111111', '50%']]),
    ]);
    expect(graph.edges[0].owner).toBe(graph.edges[1].owner);
  });

  it('non unifica omonimi senza CF e segnala quote mancanti', () => {
    const graph = buildOwnershipGraph(client, [
      doc('ALFA', client.piva, [['OMONIMO SRL', '', '']]),
      doc('BETA', '09876543210', [['OMONIMO SRL', '', '']]),
    ]);
    expect(graph.nodes.filter(node => node.name === 'OMONIMO SRL')).toHaveLength(2);
    expect(graph.edges.every(edge => edge.percentage === null)).toBe(true);
    expect(graph.warnings.some(warning => warning.includes('percentuali'))).toBe(true);
    expect(buildOwnershipForest(graph)).toHaveLength(2);
  });

  it('interrompe cicli e autoriferimenti senza perdere partecipazioni', () => {
    const graph = buildOwnershipGraph(client, [
      doc('ALFA', client.piva, [['BETA', '09876543210', '60%'], ['ALFA', client.piva, '1%']]),
      doc('BETA', '09876543210', [['ALFA', client.piva, '40%']]),
    ]);
    const entries = flatten(buildOwnershipForest(graph));
    expect(entries).toHaveLength(4);
    expect(entries.filter(entry => entry.cycle)).toHaveLength(2);
    expect(entries.filter(entry => entry.via)).toHaveLength(3);
  });
});
