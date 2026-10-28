import {
  buildCompanyRevenueHistory, buildOwnershipGraph, companyRevenueNameKey, layoutOwnershipCompanies, normalizeTaxId, ownershipBreakdown,
  ownershipCompanyIdentifiers, ownershipCompanyIdentity, ownershipDocumentDate, ownershipShareOverrideKey, parseOwnershipPercentage,
  type OwnershipDocument,
} from '@/lib/partecipogramma';

const client = { id: 'cliente', ragione_sociale: 'ALFA SRL', piva: '01234567890' };
const doc = (id: string, companyId: string, owners: [string, string, string][], overrides: Partial<OwnershipDocument> = {}): OwnershipDocument => ({
  id, name: `${id}.pdf`, companyName: id, identifiers: [companyId],
  uploadedAt: '2026-10-27T10:00:00Z',
  soci: owners.map(([nome, codice_fiscale, percentuale]) => ({ nome, codice_fiscale, percentuale, valore: '' })),
  amministratori: [],
  ...overrides,
});

describe('partecipogramma: identità e quote', () => {
  it('raccoglie tutte le annualità dei bilanci, ordinate dalla più recente e senza duplicare l’anno', () => {
    const revenues = buildCompanyRevenueHistory([
      { ragione_sociale: 'Alfa S.r.l.', ricavi_vendite: 1200, anno_esercizio: 2023 },
      { ragione_sociale: 'ALFA SRL', ricavi_vendite: 1500, anno_esercizio: 2024 },
      { ragione_sociale: 'Alfa S.r.l.', ricavi_vendite: 1250, anno_esercizio: 2023 },
      { ragione_sociale: 'Beta S.r.l.', ricavi_vendite: 800, anno_esercizio: 2024 },
      { ragione_sociale: 'Alfa S.r.l.', ricavi_vendite: null, anno_esercizio: 2025 },
    ]);

    expect(companyRevenueNameKey('Alfa S.r.l.')).toBe(companyRevenueNameKey('ALFA SRL'));
    expect(revenues.get(companyRevenueNameKey('Alfa S.r.l.'))).toEqual([
      { amount: 1500, year: 2024 },
      { amount: 1200, year: 2023 },
    ]);
    expect(revenues.get(companyRevenueNameKey('Beta S.r.l.'))).toEqual([{ amount: 800, year: 2024 }]);
  });

  it('aumenta la scheda societaria per ospitare più annualità di fatturato', () => {
    const graph = buildOwnershipGraph(client, [
      doc('ALFA SRL', client.piva, [['ROSSI MARIO', 'RSSMRA80A01H501Z', '100%']]),
    ]);
    const company = graph.nodes.find(node => node.isClient)!;
    const baseHeight = layoutOwnershipCompanies(graph).nodes.find(item => item.node.id === company.id)!.height;
    const expandedHeight = layoutOwnershipCompanies(graph, new Map([[company.id, 36]]))
      .nodes.find(item => item.node.id === company.id)!.height;
    expect(expandedHeight).toBe(baseHeight + 36);
  });

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

  it('crea chiavi stabili per le rettifiche manuali anche senza CF del socio', () => {
    expect(ownershipShareOverrideKey('01234567890', {
      nome: 'Società Èlite S.R.L.', codice_fiscale: '',
    }, 2)).toBe('01234567890:societaelitesrl:2');
    expect(ownershipShareOverrideKey('IT 01234567890', {
      nome: 'Mario Rossi', codice_fiscale: 'RSSMRA80A01H501Z',
    }, 2)).toBe('01234567890:RSSMRA80A01H501Z');
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

  it('distingue codice fiscale numerico e partita IVA', () => {
    expect(ownershipCompanyIdentity('Codice fiscale 01234567890\nPartita IVA 11111111111')).toEqual({
      codiceFiscale: '01234567890', piva: '11111111111',
    });
    expect(ownershipCompanyIdentity('Codice fiscale 01234567890').piva).toBe('');
  });

  it('non scambia data costituzione e data estrazione e rifiuta date inesistenti', () => {
    expect(ownershipDocumentDate('Data costituzione 01/01/2000\nVisura estratta il 20/10/2026')).toBe('2026-10-20');
    expect(ownershipDocumentDate('Data costituzione 01/01/2000')).toBeUndefined();
    expect(ownershipDocumentDate('Data estrazione 31/02/2026')).toBeUndefined();
  });
});

describe('partecipogramma: collegamenti e versioni', () => {
  it('collega società con nomi diversi ma stesso CF e mostra i soci nella torta', () => {
    const graph = buildOwnershipGraph(client, [
      doc('ALFA SRL', client.piva, [['BETA HOLDING', '09876543210', '60%']]),
      doc('BETA HOLDING S.P.A.', '09876543210', [['ROSSI MARIO', 'RSSMRA80A01H501Z', '100%']]),
    ]);
    expect(graph.nodes).toHaveLength(3);
    const layout = layoutOwnershipCompanies(graph);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.links).toHaveLength(1);
    expect(layout.links[0].edge.percentage).toBe(60);
    const holding = layout.nodes.find(item => item.node.identifier === '09876543210')!;
    const alfa = layout.nodes.find(item => item.node.isClient)!;
    expect(holding.y).toBeLessThan(alfa.y);
    expect(ownershipBreakdown(holding.node).slices[0].name).toBe('ROSSI MARIO');
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

  it('applica le quote manuali solo quando la visura non ne determina una', () => {
    const source = doc('ALFA SRL', client.piva, [
      ['ROSSI MARIO', 'RSSMRA80A01H501Z', ''],
      ['BIANCHI LUIGI', 'BNCLGU80A01H501X', '60%'],
    ]);
    const overrides = {
      [ownershipShareOverrideKey(client.piva, source.soci[0])]: '40',
      [ownershipShareOverrideKey(client.piva, source.soci[1])]: '50',
    };
    const graph = buildOwnershipGraph(client, [source], [], overrides);
    const company = graph.nodes.find(node => node.isClient)!;
    expect(company.source?.soci.map(socio => socio.percentuale)).toEqual(['40%', '60%']);
    expect(ownershipBreakdown(company).slices.map(slice => slice.percentage)).toEqual([40, 60]);
  });

  it('mostra anche le società partecipate dal cliente e i soci comuni', () => {
    const graph = buildOwnershipGraph(client, [
      doc('ALFA', client.piva, [['ROSSI', 'RSSMRA80A01H501Z', '100%']]),
      doc('BETA', '09876543210', [['ALFA', client.piva, '51%'], ['ROSSI', 'RSSMRA80A01H501Z', '49%']]),
    ]);
    const layout = layoutOwnershipCompanies(graph);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes.filter(entry => entry.node.identifier === '09876543210')).toHaveLength(1);
    expect(layout.links).toHaveLength(1);
    expect(layout.nodes.every(entry => ownershipBreakdown(entry.node).slices.some(slice => slice.name === 'ROSSI'))).toBe(true);
    expect(graph.edges).toHaveLength(3);
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
    expect(layoutOwnershipCompanies(graph).nodes).toHaveLength(2);
  });

  it('esclude autoriferimenti sospetti e disegna cicli societari senza duplicare società', () => {
    const graph = buildOwnershipGraph(client, [
      doc('ALFA', client.piva, [['BETA', '09876543210', '60%'], ['ALFA', client.piva, '1%']]),
      doc('BETA', '09876543210', [['ALFA', client.piva, '40%']]),
    ]);
    const layout = layoutOwnershipCompanies(graph);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.links).toHaveLength(2);
    expect(layout.links.filter(link => link.cycle)).toHaveLength(1);
    expect(graph.edges).toHaveLength(2);
    expect(graph.warnings.some(warning => warning.includes('società stessa'))).toBe(true);
    expect(graph.nodes.find(node => node.isClient)?.details?.soci).toHaveLength(1);
  });
});

describe('torte dei soci: quote esplicite, mai normalizzate', () => {
  const breakdown = (shares: string[]) => {
    const graph = buildOwnershipGraph(client, [doc('ALFA', client.piva,
      shares.map((share, index) => [`Socio ${index}`, '', share]))]);
    return ownershipBreakdown(graph.nodes.find(node => node.isClient)!);
  };

  it('mostra il totale esatto di 100% senza fetta aggiuntiva', () => {
    const result = breakdown(['34,75%', '65,25%']);
    expect(result.total).toBe(100);
    expect(result.slices).toHaveLength(2);
    expect(result.incomplete).toBe(false);
    expect(result.invalid).toBe(false);
  });

  it('espone il residuo non determinato, conservando la quota reale', () => {
    const result = breakdown(['25%', '']);
    expect(result.slices.map(slice => slice.percentage)).toEqual([25, null, 75]);
    expect(result.slices[2].missing).toBe(true);
    expect(result.incomplete).toBe(true);
  });

  it('se il totale supera 100 non ridimensiona le percentuali', () => {
    const result = breakdown(['60%', '60%']);
    expect(result.total).toBe(120);
    expect(result.invalid).toBe(true);
    expect(result.slices.map(slice => slice.percentage)).toEqual([60, 60]);
  });

  it('conserva quote zero e gestisce assenza di soci e di visura', () => {
    expect(breakdown(['0%', '100%']).slices[0].percentage).toBe(0);
    expect(breakdown([]).slices[0]).toEqual(expect.objectContaining({ missing: true, percentage: 100 }));
    const graph = buildOwnershipGraph(client, []);
    expect(ownershipBreakdown(graph.nodes[0]).hasSource).toBe(false);
  });
});
