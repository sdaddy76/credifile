export interface BalanceDocumentSections {
  full: string;
  attivo: string;
  passivo: string;
  contoEconomico: string;
}

export const BALANCE_VALUE_PATTERNS = {
  costiMaterie: [
    '6) per materie prime, sussidiarie, di consumo e di merci',
    'per materie prime, sussidiarie, di consumo e di merci',
    'per materie prime',
    'Materie prime',
  ],
} as const;

function normalizeLabel(value: string): string {
  return value
    .toLocaleLowerCase('it-IT')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseItalianBalanceNumber(raw: string | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  const compact = raw.trim().replace(/\s/g, '');
  if (!compact) return null;
  if (compact === '-' || compact === '—') return 0;
  const negative = compact.startsWith('(') && compact.endsWith(')');
  const unsigned = negative ? compact.slice(1, -1) : compact;
  const normalized = unsigned.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

function valueTokens(value: string): string[] {
  return value.match(
    /(?:\(\s*\d+(?:\.\d{3})*(?:,\d+)?\s*\)|-?\d+(?:\.\d{3})*(?:,\d+)?|(?<!\S)[-—](?!\S))/g,
  ) ?? [];
}

function patternPosition(line: string, pattern: string): number {
  const normalizedLine = normalizeLabel(line);
  const normalizedPattern = normalizeLabel(pattern);
  let fromIndex = 0;

  while (fromIndex < normalizedLine.length) {
    const index = normalizedLine.indexOf(normalizedPattern, fromIndex);
    if (index < 0) return -1;
    const before = index === 0 ? '' : normalizedLine[index - 1];
    const after = normalizedLine.slice(index + normalizedPattern.length).trimStart();
    const afterQualifier = after.replace(/^\([^)]{1,160}\)\s*/, '');
    const validBefore = !before || /[\s|:;()[\]/-]/.test(before);
    const validAfter = !afterQualifier
      || /^[|:]/.test(afterQualifier)
      || valueTokens(afterQualifier).some(token => afterQualifier.startsWith(token));
    if (validBefore && validAfter) return index;
    fromIndex = index + normalizedPattern.length;
  }

  return -1;
}

export function extractBalanceValue(text: string, patterns: string[]): number | null {
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim() || line.length > 500) continue;

    if (line.includes('|')) {
      const columns = line.split('|').map(column => column.trim()).filter(Boolean);
      const label = columns[0] ?? '';
      const matchingPattern = patterns.find(pattern => patternPosition(label, pattern) >= 0);
      if (!matchingPattern) continue;
      for (const column of columns.slice(1)) {
        const value = parseItalianBalanceNumber(column);
        if (value !== null) return value;
      }
      continue;
    }

    for (const pattern of patterns) {
      const position = patternPosition(line, pattern);
      if (position < 0) continue;
      const normalizedLine = normalizeLabel(line);
      const normalizedPattern = normalizeLabel(pattern);
      const afterLabel = normalizedLine
        .slice(position + normalizedPattern.length)
        .trimStart()
        .replace(/^\([^)]{1,160}\)\s*/, '')
        .replace(/^[|:]\s*/, '');
      const token = valueTokens(afterLabel)[0];
      if (token !== undefined) {
        const value = parseItalianBalanceNumber(token);
        if (value !== null) return value;
      }
    }
  }

  return null;
}

const BANK_DEBT_LABEL = /debiti?\s+verso\s+banche|debiti?\s+bancari|banche\b/i;
const SHORT_DEBT_MATURITY = /entro\s+(?:i\s+)?12\s+mesi|entro\s+l['’]?esercizio|a\s+breve|breve\s+termine/i;
const LONG_DEBT_MATURITY = /oltre\s+(?:i\s+)?12\s+mesi|oltre\s+l['’]?esercizio|a\s+medio[-\s]?lungo\s+termine|a\s+lungo\s+termine|medio[-\s]?lungo\s+termine/i;

/**
 * Estrae una quota del debito bancario solo quando la scadenza è esplicita.
 * Se la tabella contiene una riga generica "Debiti verso banche", il valore
 * generico viene gestito dal chiamante come fallback e non viene duplicato
 * anche nella quota a medio-lungo termine.
 */
export function extractBankDebtByMaturity(
  text: string,
  maturity: 'breve' | 'lungo',
): number | null {
  const lines = text.split(/\r?\n/);
  const maturityPattern = maturity === 'breve' ? SHORT_DEBT_MATURITY : LONG_DEBT_MATURITY;

  const valueAfterMaturity = (line: string, maturityMatch: RegExpMatchArray): number | null => {
    const after = line.slice((maturityMatch.index ?? 0) + maturityMatch[0].length);
    return parseItalianBalanceNumber(valueTokens(after)[0]);
  };

  // Caso più comune: etichetta e scadenza sono sulla stessa riga.
  for (const line of lines) {
    if (!BANK_DEBT_LABEL.test(line) || !maturityPattern.test(line)) continue;
    const match = line.match(maturityPattern);
    if (!match) continue;
    const value = valueAfterMaturity(line, match);
    if (value !== null) return value;
  }

  // Alcuni PDF separano la descrizione ("Debiti verso banche") dalla riga
  // "entro/oltre 12 mesi". Cerchiamo quindi nelle righe immediatamente vicine,
  // senza associare valori lontani da una voce bancaria.
  for (let index = 0; index < lines.length; index += 1) {
    if (!BANK_DEBT_LABEL.test(lines[index])) continue;
    const start = Math.max(0, index - 2);
    const end = Math.min(lines.length, index + 4);
    for (let candidateIndex = start; candidateIndex < end; candidateIndex += 1) {
      const candidate = lines[candidateIndex];
      const match = candidate.match(maturityPattern);
      if (!match) continue;
      const value = valueAfterMaturity(candidate, match);
      if (value !== null) return value;
      // Se la maturità è sulla riga precedente e il valore sulla riga bancaria,
      // prendi il primo importo dopo l'etichetta.
      if (candidateIndex < index) {
        const valueOnBankLine = extractBalanceValue(lines[index], ['Debiti verso banche', 'Debiti bancari', 'Banche']);
        if (valueOnBankLine !== null) return valueOnBankLine;
      }
    }
  }

  return null;
}

export function extractBalanceCompanyName(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const balanceHeading = /bilancio di esercizio al/i;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index].trim();
    if (!balanceHeading.test(rawLine)) continue;
    if (/^<!--.*-->$/.test(rawLine)) continue;

    const cleanLine = rawLine.replace(/^#+\s*/, '');
    const headingPosition = cleanLine.search(balanceHeading);
    const inlineCandidate = headingPosition > 0
      ? cleanLine.slice(0, headingPosition).trim().replace(/[-–—:|]+$/, '').trim()
      : '';
    if (inlineCandidate.length >= 2 && /[a-zà-ÿ]/i.test(inlineCandidate)) {
      return inlineCandidate;
    }

    for (let previous = index - 1; previous >= Math.max(0, index - 8); previous -= 1) {
      const candidateLine = lines[previous].trim();
      if (!candidateLine || /^<!--.*-->$/.test(candidateLine)) continue;
      const candidate = candidateLine.replace(/^#+\s*/, '').trim();
      if (
        candidate.length >= 2
        && candidate.length <= 160
        && /[a-zà-ÿ]/i.test(candidate)
        && !balanceHeading.test(candidate)
        && !/^v\.\d/i.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

export function splitBalanceDocument(text: string): BalanceDocumentSections {
  const full = text.replace(/\r/g, '');
  const stateIndex = full.search(/(?:^|\n)\s*stato patrimoniale\b/i);
  const contoIndex = full.search(/(?:^|\n)\s*conto economico\b/i);
  const stateText = stateIndex >= 0
    ? full.slice(stateIndex, contoIndex > stateIndex ? contoIndex : full.length)
    : full;
  const attivoIndex = stateText.search(/\battivo\b/i);
  const passivoIndex = stateText.search(/\bpassivo\b/i);
  const attivo = attivoIndex >= 0
    ? stateText.slice(attivoIndex, passivoIndex > attivoIndex ? passivoIndex : stateText.length)
    : stateText;
  const passivo = passivoIndex >= 0 ? stateText.slice(passivoIndex) : stateText;
  const contoEconomico = contoIndex >= 0 ? full.slice(contoIndex) : full;

  return { full, attivo, passivo, contoEconomico };
}
