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

export interface CurrentLiabilitiesExtraction {
  value: number | null;
  source: 'explicit' | 'short_debt_proxy' | 'unavailable';
  note: string;
}

export const LIQUIDITY_EXTRACTION_VERSION = 'liquidity-v2';

/**
 * Read an explicit current-liabilities total, or an auditable short-debt proxy.
 * Never treat all debts as short-term, fill missing maturities with zero, sum
 * a subtotal with its children, or take a maturity from the asset section.
 */
export function extractCurrentLiabilities(text: string): CurrentLiabilitiesExtraction {
  // Some PDF readers put the amount on the immediately following line. Join
  // only number-only rows after recognised liability labels/maturities; never
  // scan ahead across creditor headings or take an asset maturity.
  const section = splitBalanceDocument(text).passivo.replace(
    /((?:passivit[aà] correnti|passivo corrente|passivit[aà] a breve|(?:entro|oltre) (?:l['’]esercizio successivo|(?:i )?12 mesi))[^\S\n]*)\n\s*([|\s]*(?:\(?-?\d[\d.,]*\)?|[—-])(?:[|\s]+(?:\(?-?\d[\d.,]*\)?|[—-]))*[|\s]*)(?=\n|$)/gi,
    '$1 $2',
  );
  const lines = section.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const unavailable = (note: string): CurrentLiabilitiesExtraction => ({
    value: null, source: 'unavailable', note: `${LIQUIDITY_EXTRACTION_VERSION}: ${note}`,
  });
  const explicit = extractBalanceValue(section, [
    'Totale passività correnti', 'Totale passivita correnti',
    'Passività correnti', 'Passivita correnti', 'Totale passivo corrente',
    'Passivo corrente', 'Totale passività a breve', 'Totale passivita a breve',
  ]);
  if (explicit !== null) {
    return explicit < 0 ? unavailable('Totale passività correnti negativo: verificare il documento.') : {
      value: explicit, source: 'explicit',
      note: `${LIQUIDITY_EXTRACTION_VERSION}: totale passività correnti esplicito nel bilancio.`,
    };
  }

  const short = /(?:esigibili\s+)?entro\s+(?:(?:i\s+)?12\s+mesi|(?:l['’]\s*|il\s+)?(?:esercizio|anno)\s+successivo)/i;
  const long = /(?:esigibili\s+)?oltre\s+(?:(?:i\s+)?12\s+mesi|(?:l['’]\s*|il\s+)?(?:esercizio|anno)\s+successivo)/i;
  const amountAfterShort = (line: string): number | null => {
    const match = short.exec(line);
    if (!match) return null;
    const suffix = line.slice(match.index + match[0].length)
      .replace(/^[\s|:;)]+/, '');
    return parseItalianBalanceNumber(valueTokens(suffix)[0]);
  };
  const proxy = (value: number, detail: string): CurrentLiabilitiesExtraction => ({
    value, source: 'short_debt_proxy',
    note: `${LIQUIDITY_EXTRACTION_VERSION}: PROXY delle passività correnti: ${detail}. `
      + 'Usati esclusivamente debiti con scadenza breve documentata; fondi, TFR e ratei/risconti non classificati per scadenza non sono inclusi. Non è un totale completo delle passività correnti.',
  });

  // Prefer an explicitly labelled total; a bank/supplier maturity is not a total.
  for (const line of lines) {
    if (!/^(?:[|#\s]*)?(?:totale\s+)?debiti\s+(?:complessivi\s+)?(?:esigibili\s+)?entro\b/i.test(line)) continue;
    const value = amountAfterShort(line);
    const debtTotal = extractBalanceValue(section, ['Totale debiti']);
    if (value !== null && value >= 0) {
      return debtTotal !== null && value > debtTotal + 1
        ? unavailable('Debiti a breve superiori al totale debiti: verificare il documento.')
        : proxy(value, 'totale debiti esigibili a breve riportato nel documento');
    }
  }

  // In abbreviated civil-law statements the D) Debiti section has the two
  // maturity rows followed by Totale debiti. In ordinary statements collect
  // each uniquely numbered creditor category, only if all maturities are known.
  const start = lines.findIndex(line => /^(?:[|#\s]*)?(?:D\s*[).:-]\s*)?Debiti\s*(?:[|:]|$)/i.test(line));
  if (start < 0) return unavailable('Nessun totale esplicito o prospetto debiti per scadenza riconoscibile.');
  const end = lines.findIndex((line, index) => index > start && /\bTotale debiti\b|^(?:[|#\s]*)?E\s*[).:-]\s*Ratei|^Nota integrativa\b/i.test(line));
  if (end < 0) return unavailable('Prospetto debiti senza totale di chiusura: impossibile verificarne la completezza.');
  const block = lines.slice(start + 1, end);
  const category = /^(?:[|\s]*)?(\d{1,2}(?:[-.]\w+)?)\s*[).]\s*([a-zà-ÿ].+)/i;
  const categories = block.map((line, index) => ({ match: line.match(category), index })).filter(item => item.match);
  const total = extractBalanceValue(lines[end], ['Totale debiti']);
  let value: number | null = null;
  if (!categories.length) {
    const candidates = block.filter(line => short.test(line));
    // Multiple unnamed short rows may be details or repeated annualities.
    if (candidates.length === 1 && !block.some(line => /debiti\s+(?:verso|per)\b/i.test(line))) {
      value = amountAfterShort(candidates[0]);
    }
  } else {
    const seen = new Set<string>();
    let sum = 0;
    let categoryTotals = 0;
    let complete = true;
    for (let i = 0; i < categories.length; i++) {
      const { match, index } = categories[i];
      const key = match![1];
      if (seen.has(key)) { complete = false; break; }
      seen.add(key);
      const group = block.slice(index, categories[i + 1]?.index ?? block.length);
      const candidates = group.filter(line => short.test(line));
      // A zero total explicitly proves a zero short portion. Otherwise a
      // missing short portion remains unknown, even if a long portion exists.
      const label = match![2].split('|')[0].replace(/\s+[-(]?\d.*$/, '').trim();
      const headerTotal = short.test(group[0]) || long.test(group[0]) ? null : extractBalanceValue(group[0], [label]);
      const longRows = group.filter(line => long.test(line));
      const longMatch = longRows.length === 1 ? long.exec(longRows[0]) : null;
      const longValue = longMatch
        ? parseItalianBalanceNumber(valueTokens(longRows[0].slice(longMatch.index + longMatch[0].length))[0])
        : null;
      const shortValue = candidates.length === 1 ? amountAfterShort(candidates[0]) : null;
      const categoryTotal = headerTotal ?? (shortValue !== null && longValue !== null ? shortValue + longValue : null);
      const portion = candidates.length === 1 ? amountAfterShort(candidates[0])
        : candidates.length === 0 && categoryTotal === 0 ? 0 : null;
      if (portion === null || portion < 0 || categoryTotal === null || categoryTotal < 0 || portion > categoryTotal + 1) {
        complete = false; break;
      }
      sum += portion;
      categoryTotals += categoryTotal;
    }
    if (complete && total !== null && Math.abs(categoryTotals - total) <= 1) value = sum;
  }
  if (value === null) return unavailable('Scadenze dei debiti incomplete o ambigue: nessuna quota breve inventata.');
  if (value < 0 || total === null || value > total + 1) {
    return unavailable('Quota breve non verificabile rispetto al totale debiti.');
  }
  return proxy(value, categories.length ? 'somma delle quote brevi esplicite di tutte le categorie di debiti' : 'quota entro l’esercizio successivo della sezione D) Debiti');
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
  const full = text.replace(/\r/g, '').replace(/^\s*#{1,6}\s+/gm, '');
  const stateIndex = full.search(/(?:^|\n)\s*stato patrimoniale\b/i);
  const contoIndex = full.search(/(?:^|\n)\s*conto economico\b/i);
  const notesIndex = full.search(/(?:^|\n)\s*nota integrativa\b/i);
  const stateEnds = [contoIndex, notesIndex].filter(index => index > Math.max(0, stateIndex));
  const stateText = stateIndex >= 0
    ? full.slice(stateIndex, stateEnds.length ? Math.min(...stateEnds) : full.length)
    : full.slice(0, stateEnds.length ? Math.min(...stateEnds) : full.length);
  const attivoIndex = stateText.search(/\battivo\b/i);
  const passivoIndex = stateText.search(/\bpassivo\b/i);
  const attivo = attivoIndex >= 0
    ? stateText.slice(attivoIndex, passivoIndex > attivoIndex ? passivoIndex : stateText.length)
    : stateText;
  const passivo = passivoIndex >= 0 ? stateText.slice(passivoIndex) : stateText;
  const contoEconomico = contoIndex >= 0 ? full.slice(contoIndex) : full;

  return { full, attivo, passivo, contoEconomico };
}
