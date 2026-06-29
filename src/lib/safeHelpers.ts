export function safeSection(content: unknown): string {
  if (content == null) return '';
  const str = String(content).trim();
  if (!str) return '';
  if (/\b(?:NaN|Invalid Date|undefined)\b/i.test(str)) return '';
  const textOnly = str
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!textOnly) return '';
  if (/^(?:null|Non calcolato|N\/D)$/i.test(textOnly)) return '';
  return str;
}
