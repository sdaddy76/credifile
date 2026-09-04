export interface BalanceDocumentSections {
  full: string;
  attivo: string;
  passivo: string;
  contoEconomico: string;
}

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
    const validBefore = !before || /[\s|:;()[\]/-]/.test(before);
    const validAfter = !after || /^[|:]/.test(after) || valueTokens(after).some(token => after.startsWith(token));
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
      const afterLabel = normalizedLine.slice(position + normalizedPattern.length).trimStart().replace(/^[|:]\s*/, '');
      const token = valueTokens(afterLabel)[0];
      if (token !== undefined) {
        const value = parseItalianBalanceNumber(token);
        if (value !== null) return value;
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
