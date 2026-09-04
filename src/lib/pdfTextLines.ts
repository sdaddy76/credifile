interface PositionedPdfTextItem {
  str?: string;
  transform?: number[];
}

interface PdfTextRow {
  y: number;
  parts: Array<{ x: number; text: string }>;
}

export function pdfTextItemsToLines(items: unknown[]): string[] {
  const rows: PdfTextRow[] = [];

  for (const rawItem of items) {
    const item = rawItem as PositionedPdfTextItem;
    const text = item.str?.trim();
    if (!text) continue;
    const x = item.transform?.[4] ?? 0;
    const y = item.transform?.[5];

    if (typeof y !== 'number') {
      rows.push({ y: -rows.length, parts: [{ x, text }] });
      continue;
    }

    let row = rows.find(candidate => Math.abs(candidate.y - y) <= 2);
    if (!row) {
      row = { y, parts: [] };
      rows.push(row);
    }
    row.parts.push({ x, text });
  }

  return rows
    .sort((a, b) => b.y - a.y)
    .map(row => row.parts
      .sort((a, b) => a.x - b.x)
      .map(part => part.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    )
    .filter(Boolean);
}
