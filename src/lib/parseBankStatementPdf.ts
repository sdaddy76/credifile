import {
  classificaTransazioneConConfidenza,
  type CategoriaTransazione,
  type ConfidenzaClassificazione,
} from '@/lib/classificaTransazione';
import { inferBankStatementDirection } from '@/lib/bankStatementDirection';

export interface ParsedBankStatementTransaction {
  data_valuta: string;
  importo: number;
  tipo: 'entrata' | 'uscita';
  categoria: CategoriaTransazione;
  descrizione: string;
  saldo_progressivo?: number;
  classification_confidence: ConfidenzaClassificazione;
  classification_rule: string;
  parse_confidence: ConfidenzaClassificazione;
  source_format: 'pdf';
}

export interface PositionedPdfToken {
  value: string;
  x: number;
}

export interface PositionedPdfRow {
  tokens: string[];
  positionedTokens: PositionedPdfToken[];
  page: number;
  y: number;
}

export type BankStatementPdfRow = string[] | PositionedPdfRow;

const RE_DATA = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/;
const RE_IMPORTO = /([+-]?\s*\d{1,3}(?:\.\d{3})*,\d{2})/g;
const DESCRIPTION_X_MIN = 105;
const DESCRIPTION_X_MAX = 335;
const CATEGORY_X_MIN = 385;
const CATEGORY_X_MAX = 495;
const AMOUNT_X_MIN = 470;
const MAX_ASSOCIATION_DISTANCE = 18;
const MAX_DETACHED_AMOUNT_DISTANCE = 9;

function parseImporto(value: string): number | null {
  const clean = value.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function dataISO(giorno: string, mese: string, anno: string): string {
  const fullYear = anno.length === 2 ? `20${anno}` : anno;
  return `${fullYear}-${mese.padStart(2, '0')}-${giorno.padStart(2, '0')}`;
}

function isAmountToken(token: string): boolean {
  RE_IMPORTO.lastIndex = 0;
  return RE_IMPORTO.test(token);
}

function cleanDescription(tokens: string[]): string {
  return tokens
    .filter(token => {
      const value = token.trim();
      if (!value || value.length < 2) return false;
      if (RE_DATA.test(value)) return false;
      if (isAmountToken(value)) return false;
      if (/^[+-]$/.test(value)) return false;
      if (/^(SI|NO|CONTABILIZZATO)$/i.test(value)) return false;
      if (/^(USCIT[AE]|ENTRAT[AE])(?:\s+BUSINESS)?$/i.test(value)) return false;
      if (/^€$/.test(value)) return false;
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTokens(row: BankStatementPdfRow): string[] {
  return Array.isArray(row) ? row : row.tokens;
}

function getPositionedRow(row: BankStatementPdfRow): PositionedPdfRow | null {
  return Array.isArray(row) ? null : row;
}

function getColumnText(
  row: PositionedPdfRow,
  minimumX: number,
  maximumX: number,
): string[] {
  return row.positionedTokens
    .filter(token => token.x >= minimumX && token.x < maximumX)
    .sort((left, right) => left.x - right.x)
    .map(token => token.value.trim())
    .filter(Boolean);
}

function nearestAnchorIndex(
  row: PositionedPdfRow,
  anchors: Array<{ row: PositionedPdfRow; transactionIndex: number }>,
): number | null {
  let nearest: { transactionIndex: number; distance: number } | null = null;

  for (const anchor of anchors) {
    if (anchor.row.page !== row.page) continue;
    const distance = Math.abs(anchor.row.y - row.y);
    if (distance > MAX_ASSOCIATION_DISTANCE) continue;
    if (!nearest || distance < nearest.distance) {
      nearest = { transactionIndex: anchor.transactionIndex, distance };
    }
  }

  return nearest?.transactionIndex ?? null;
}

function findDetachedAmountTokens(
  sourceRow: BankStatementPdfRow,
  rows: BankStatementPdfRow[],
): string[] {
  const positionedSourceRow = getPositionedRow(sourceRow);
  if (!positionedSourceRow) return [];

  let nearest: { distance: number; tokens: string[] } | null = null;
  for (const candidate of rows) {
    const positionedCandidate = getPositionedRow(candidate);
    if (!positionedCandidate || positionedCandidate.page !== positionedSourceRow.page) continue;
    const distance = Math.abs(positionedCandidate.y - positionedSourceRow.y);
    if (distance === 0 || distance > MAX_DETACHED_AMOUNT_DISTANCE) continue;

    const amountTokens = positionedCandidate.positionedTokens
      .filter(token => token.x >= AMOUNT_X_MIN && isAmountToken(token.value))
      .map(token => token.value);
    if (amountTokens.length === 0) continue;

    if (!nearest || distance < nearest.distance) {
      nearest = { distance, tokens: amountTokens };
    }
  }

  return nearest?.tokens ?? [];
}

export function parseBankStatementPdfRows(
  rows: BankStatementPdfRow[],
): ParsedBankStatementTransaction[] {
  const anchors = rows.flatMap((sourceRow, rowIndex) => {
    const tokens = getTokens(sourceRow);
    const originalRow = tokens.join(' ').replace(/\s+/g, ' ').trim();
    const initialDateMatch = RE_DATA.exec(originalRow);
    if (!initialDateMatch) return [];

    const detachedAmountTokens = [...originalRow.matchAll(RE_IMPORTO)].length === 0
      ? findDetachedAmountTokens(sourceRow, rows)
      : [];
    const effectiveTokens = [...tokens, ...detachedAmountTokens];
    const row = effectiveTokens.join(' ').replace(/\s+/g, ' ').trim();
    const dateMatch = RE_DATA.exec(row);
    const amountMatches = [...row.matchAll(RE_IMPORTO)];
    if (!dateMatch || amountMatches.length === 0) return [];
    return [{
      sourceRow,
      rowIndex,
      tokens: effectiveTokens,
      row,
      dateMatch,
      amountMatches,
    }];
  });

  const multilineDescriptions = anchors.map(() => [] as Array<{ y: number; text: string }>);
  const multilineCategories = anchors.map(() => [] as Array<{ y: number; text: string }>);
  const positionedAnchors = anchors.flatMap((anchor, transactionIndex) => {
    const positionedRow = getPositionedRow(anchor.sourceRow);
    return positionedRow ? [{ row: positionedRow, transactionIndex }] : [];
  });

  if (positionedAnchors.length > 0) {
    for (const sourceRow of rows) {
      const positionedRow = getPositionedRow(sourceRow);
      if (!positionedRow) continue;
      const transactionIndex = nearestAnchorIndex(positionedRow, positionedAnchors);
      if (transactionIndex === null) continue;

      const descriptionText = getColumnText(
        positionedRow,
        DESCRIPTION_X_MIN,
        DESCRIPTION_X_MAX,
      ).join(' ');
      if (descriptionText) {
        multilineDescriptions[transactionIndex].push({
          y: positionedRow.y,
          text: descriptionText,
        });
      }

      const categoryText = getColumnText(
        positionedRow,
        CATEGORY_X_MIN,
        CATEGORY_X_MAX,
      ).join(' ');
      if (categoryText) {
        multilineCategories[transactionIndex].push({
          y: positionedRow.y,
          text: categoryText,
        });
      }
    }
  }

  const transactions: ParsedBankStatementTransaction[] = [];

  for (const [transactionIndex, anchor] of anchors.entries()) {
    const { tokens, row, dateMatch, amountMatches } = anchor;

    const amounts = amountMatches
      .map(match => ({
        raw: match[1].replace(/\s/g, ''),
        value: parseImporto(match[1]),
      }))
      .filter((amount): amount is { raw: string; value: number } =>
        amount.value !== null && Math.abs(amount.value) > 0.005
      );
    if (amounts.length === 0) continue;

    let selectedAmount = amounts[0];
    if (amounts.length > 1) {
      const absoluteValues = amounts.map(amount => Math.abs(amount.value));
      const maximum = Math.max(...absoluteValues);
      const minimum = Math.min(...absoluteValues);
      if (maximum / (minimum || 0.01) >= 10) {
        selectedAmount = amounts.find(amount => Math.abs(amount.value) < maximum) ?? amounts[0];
      }
    }
    if (selectedAmount.value === 0) continue;

    const positionedDescription = multilineDescriptions[transactionIndex]
      .sort((left, right) => right.y - left.y)
      .map(item => item.text);
    const positionedCategory = multilineCategories[transactionIndex]
      .sort((left, right) => right.y - left.y)
      .map(item => item.text)
      .join(' ');
    const description = cleanDescription(
      positionedDescription.length > 0 ? positionedDescription : tokens,
    ) || 'Movimento bancario';
    const directionContext = `${row} ${positionedCategory} ${description}`;
    const direction = inferBankStatementDirection(
      directionContext,
      selectedAmount.value,
      selectedAmount.raw,
    );

    const classification = classificaTransazioneConConfidenza(description, direction.tipo);
    const balance = amounts.length >= 2
      ? amounts.reduce((best, current) =>
          Math.abs(current.value) > Math.abs(best.value) ? current : best
        ).value
      : undefined;

    transactions.push({
      data_valuta: dataISO(dateMatch[1], dateMatch[2], dateMatch[3]),
      importo: Math.abs(selectedAmount.value),
      tipo: direction.tipo,
      categoria: classification.categoria,
      descrizione: description.substring(0, 200),
      saldo_progressivo: balance,
      classification_confidence: classification.confidenza,
      classification_rule: `${classification.regola}; DIREZIONE: ${direction.rule}`,
      parse_confidence: direction.confidence,
      source_format: 'pdf',
    });
  }

  // Non deduplicare per data/importo/descrizione: commissioni e bonifici identici
  // possono essere movimenti reali distinti. Il PDF Intesa verificato contiene
  // 237 operazioni, mentre la deduplicazione precedente ne conservava solo 217.
  if (transactions.length >= 2) {
    const sorted = [...transactions].sort((left, right) => right.importo - left.importo);
    const maximum = sorted[0].importo;
    const secondMaximum = sorted[1].importo;
    if (secondMaximum > 0 && maximum / secondMaximum > 100) {
      return transactions.filter(transaction => transaction.importo <= secondMaximum * 100);
    }
  }

  return transactions;
}
