export type BusinessRelationshipKind = 'customers' | 'suppliers';

export type BusinessRelationshipRow = {
  partita_iva: string;
  denominazione_sociale: string;
  percentuale: string;
};

export type BusinessRelationshipsResponse = {
  rows: BusinessRelationshipRow[];
};

export const emptyBusinessRelationshipRow = (): BusinessRelationshipRow => ({
  partita_iva: '',
  denominazione_sociale: '',
  percentuale: '',
});

const parseRow = (value: unknown): BusinessRelationshipRow => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    partita_iva: String(raw.partita_iva ?? ''),
    denominazione_sociale: String(raw.denominazione_sociale ?? ''),
    percentuale: String(raw.percentuale ?? ''),
  };
};

export const readBusinessRelationships = (
  response?: Record<string, unknown> | null,
): BusinessRelationshipRow[] => {
  if (!Array.isArray(response?.rows)) return [emptyBusinessRelationshipRow()];
  const rows = response.rows.map(parseRow);
  return rows.length > 0 ? rows : [emptyBusinessRelationshipRow()];
};

export const hasBusinessRelationshipValue = (row: BusinessRelationshipRow): boolean =>
  Boolean(row.partita_iva.trim() || row.denominazione_sociale.trim() || row.percentuale.trim());

export const isBusinessRelationshipComplete = (row: BusinessRelationshipRow): boolean => (
  Boolean(row.partita_iva.trim() && row.denominazione_sociale.trim() && row.percentuale.trim())
  && Number.isFinite(Number(row.percentuale))
  && Number(row.percentuale) >= 0
  && Number(row.percentuale) <= 100
);

export const buildBusinessRelationshipsResponse = (
  rows: BusinessRelationshipRow[],
): BusinessRelationshipsResponse => ({
  rows: rows
    .filter(hasBusinessRelationshipValue)
    .map(row => ({
      partita_iva: row.partita_iva.trim(),
      denominazione_sociale: row.denominazione_sociale.trim(),
      percentuale: String(Number(row.percentuale)),
    })),
});
