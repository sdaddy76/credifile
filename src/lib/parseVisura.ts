import * as pdfjs from 'pdfjs-dist';
import type { Socio, Amministratore } from './types';
import { pdfTextItemsToLines } from './pdfTextLines';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export type SocioResult = Socio;
export type AmministratoreResult = Amministratore;

export interface VisuraResult {
  ragione_sociale?: string;
  codice_fiscale?: string;
  piva?: string;
  data_costituzione?: string;
  forma_giuridica?: string;
  capitale_sociale?: number;
  capitale_versato?: string;
  codice_ateco?: string;
  ateco_descrizione?: string;
  indirizzo?: string;
  email?: string;
  telefono?: string;
  soci: SocioResult[];
  amministratori: AmministratoreResult[];
  qualita: QualitaImportazione;
}

export interface QualitaImportazione {
  data_costituzione_trovata: boolean;
  soci_trovati: number;
  amministratori_trovati: number;
  capitale_trovato: boolean;
  ateco_trovato: boolean;
  piva_trovata: boolean;
  warnings: string[];
}

const CF_PF_RE = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/g;

function cleanup(s: string): string {
  return s.trim().replace(/\s{2,}/g, ' ').replace(/[,|\/\\]+$/, '').trim();
}

function parseItalianNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

export async function extractPdfText(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const ct = await pg.getTextContent();
    // Conserva le righe ricostruite dalle coordinate PDF: la compagine
    // societaria è spesso una tabella e l'ordine dei campi è significativo.
    pages.push(pdfTextItemsToLines(ct.items).join('\n'));
  }
  return pages.join('\n');
}

export function isolaSezione(text: string, startPatterns: RegExp[], endPattern: RegExp): string {
  let bestIndex = -1;
  for (const pattern of startPatterns) {
    const idx = text.search(pattern);
    if (idx === -1) continue;
    if (bestIndex === -1 || idx < bestIndex) bestIndex = idx;
  }
  if (bestIndex === -1) return '';
  const sub = text.substring(bestIndex);
  const ei = sub.search(endPattern);
  return ei !== -1 ? sub.substring(0, ei) : sub;
}

export function parseDataCostituzione(text: string): string | undefined {
  const flat = text.replace(/\s+/g, ' ');
  const date = String.raw`(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})`;
  const patterns = [
    new RegExp(String.raw`Data\s+atto\s+di\s+costituzione\s*[:\-]?\s*${date}`, 'i'),
    new RegExp(String.raw`Data\s+(?:di\s+)?costituzione\s*[:\-]?\s*${date}`, 'i'),
    new RegExp(String.raw`Data\s+iscrizione\s*[:\-]?\s*${date}`, 'i'),
    new RegExp(String.raw`(?:costituita|costituito)\s+il\s*${date}`, 'i'),
    new RegExp(String.raw`(?:Atto\s+costitutivo|Costituzione)\s*[:\-]?\s*${date}`, 'i'),
    /\b(\d{4}-\d{2}-\d{2})\b/i,
  ];
  for (const re of patterns) {
    const m = flat.match(re);
    if (m?.[1]) return cleanup(m[1]);
  }
  const anno = flat.match(/anno\s+di\s+costituzione\s*[:\-]?\s*(\d{4})/i)?.[1];
  return anno ? `01/01/${anno}` : undefined;
}

export function parseSoci(raw: string): SocioResult[] {
  // Le visure PDF non hanno un formato unico: a seconda del gestore le
  // colonne possono essere nell'ordine nome/CF/valore/% oppure CF/nome/%.
  // Manteniamo quindi le righe e analizziamo una finestra di righe vicine,
  // invece di affidarsi a una sola regex sul testo appiattito.
  const normalized = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n')
    .trim();
  const END_S5 = /(?:sezione\s+(?:V|5)\b|\b5[\s\.\)]\s*(?:Amministrat|Organ|Organi)|organi\s+sociali|organi\s+amministrativi|rappresentanza|persone\s+che\s+esercitano|cariche\s+sociali)/i;
  const s4 = isolaSezione(normalized, [
    /composizione\s+societaria/i,
    /compagine\s+societaria/i,
    /assetto\s+proprietario/i,
    /elenco\s+soci/i,
    /soci\s+e\s+titolari/i,
    /titolari\s+(?:di\s+)?(?:quote|diritti)/i,
  ], END_S5)
    || isolaSezione(normalized, [
      /(?:sezione\s+(?:IV|4)\b|\b4[\s\.\)]\s*Soci|quote\s+sociali|partecipazioni\s+sociali)/i,
    ], END_S5)
    || normalized;

  const lines = s4.split('\n').map(line => line.trim()).filter(Boolean);
  const results: SocioResult[] = [];
  const seen = new Map<string, number>();
  const STOP_WORDS = new Set([
    'SOCIO', 'SOCI', 'TITOLARE', 'TITOLARI', 'QUOTA', 'QUOTE', 'SOCIALE',
    'PARTECIPAZIONE', 'PARTECIPAZIONI', 'CODICE', 'FISCALE', 'NOME',
    'COGNOME', 'VALORE', 'PERCENTUALE', 'TIPO', 'DIRITTI', 'SEZIONE',
    'CAPITALE', 'NATO', 'NATA', 'RESIDENTE', 'DOMICILIO', 'AMMINISTRATORE',
    'PRESIDENTE', 'CONSIGLIERE', 'RAPPRESENTANTE', 'CARICA', 'E',
    'COMPOSIZIONE', 'SOCIETARIA', 'EUR', 'EURO',
  ]);
  const CF_RE = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/gi;
  const PIVA_RE = /\b(\d{11})\b/g;
  const VALUE_RE = /(?:€|euro|eur)?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|\d+(?:[.,]\d{1,2}))\s*(?:€|euro|eur)?/i;
  const PCT_RE = /(\d{1,3}(?:[.,]\d{1,4})?)\s*%/i;
  const normalizeKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9ÀÈÉÌÒÙ]/g, '');
  const cleanName = (value: string): string => value
    .replace(/\b(?:CODICE|FISCALE|CF|P\.?\s*IVA|NOME|COGNOME|SOCIO|SOCI|TITOLARE|TITOLARI|QUOTA|QUOTE|VALORE|PERCENTUALE|DIRITTI)\b/gi, ' ')
    .replace(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/gi, ' ')
    .replace(/\b\d{11}\b/g, ' ')
    .replace(/\b\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?\b/g, ' ')
    .replace(/[%€|:;()[\]{}]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const nameFrom = (value: string): string => {
    const cleaned = cleanName(value);
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return '';
    // Prendi l'ultimo gruppo di parole utile prima dell'identificativo:
    // le intestazioni del PDF ("composizione societaria", "cognome e nome")
    // vengono così escluse senza imporre che il nominativo sia tutto maiuscolo.
    let end = tokens.length;
    while (end > 0 && STOP_WORDS.has(tokens[end - 1].toUpperCase())) end--;
    let start = Math.max(0, end - 6);
    for (let i = end - 2; i >= start; i--) {
      if (STOP_WORDS.has(tokens[i].toUpperCase())) {
        start = i + 1;
        break;
      }
    }
    let candidate = tokens.slice(start, end).join(' ');
    // Evita l'artefatto frequente "E DI ROSSI MARIO" prodotto da colonne
    // estratte in ordine diverso, senza eliminare un cognome "DI ...".
    candidate = candidate.replace(/^E\s+DI\s+/i, '').trim();
    return candidate.split(/\s+/).length >= 2 ? candidate : '';
  };
  const add = (nome: string, id: string, valore = '', percentuale = '') => {
    const clean = nameFrom(nome);
    if (!clean || clean.length < 3 || STOP_WORDS.has(clean.toUpperCase())) return;
    const key = normalizeKey(id) || normalizeKey(clean);
    const existing = seen.get(key);
    if (existing !== undefined) {
      // Se la stessa riga è stata ricostruita da due pattern, conserviamo
      // la versione con più dati invece di creare un doppione.
      if (!results[existing].valore && valore) results[existing].valore = valore;
      if (!results[existing].percentuale && percentuale) results[existing].percentuale = percentuale;
      if (results[existing].nome.length < clean.length) results[existing].nome = clean;
      return;
    }
    seen.set(key, results.length);
    results.push({ nome: clean, codice_fiscale: id, valore, percentuale });
  };

  const idMatches = (value: string): string[] => [
    ...Array.from(value.matchAll(CF_RE), m => m[1]),
    ...Array.from(value.matchAll(PIVA_RE), m => m[1]),
  ];
  const contextFor = (index: number): string => lines
    .slice(Math.max(0, index - 2), Math.min(lines.length, index + 3))
    .join(' ');

  // Prima passata: righe tabellari e blocchi "Socio: ... / Codice fiscale: ...".
  lines.forEach((line, index) => {
    const context = contextFor(index);
    const ids = idMatches(context);
    if (!ids.length) return;
    const ownershipContext = /soci?|titolari?|quot[ae]|partecipazion|compagine|assetto\s+proprietario|%/i.test(context);
    if (!ownershipContext) return;
    const administrationOnly = /amministrator|presidente|consigliere|sindaco|revisore|liquidatore|cariche\s+sociali/i.test(line)
      && !/soci?|titolari?|quot[ae]|partecipazion/i.test(line);
    if (administrationOnly) return;
    // Se la riga contiene già l'identificativo, usiamo quello della riga:
    // la finestra può includere anche il socio precedente/successivo.
    const lineIds = idMatches(line);
    const id = lineIds[0] ?? ids[0];
    const source = lineIds.length ? line : context;
    const idPos = source.indexOf(id);
    const before = idPos >= 0 ? source.slice(0, idPos) : source;
    const after = idPos >= 0 ? source.slice(idPos + id.length) : '';
    const labeledName = context.match(/(?:socio|titolare|quotista|partecipante)\s*[:\-]?\s*([^|;]+)/i)?.[1] ?? '';
    const nome = nameFrom(before) || nameFrom(labeledName) || nameFrom(after);
    const valueMatch = source.match(/(?:valore|quota|capitale|importo|€|eur)\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|\d+(?:[.,]\d{1,2}))/i)
      ?? source.match(VALUE_RE)
      ?? context.match(VALUE_RE);
    const pctMatch = source.match(PCT_RE) ?? context.match(PCT_RE);
    add(nome, id, valueMatch?.[1] ?? '', pctMatch?.[1] ? `${pctMatch[1]}%` : '');
  });

  // Seconda passata: record societari con P.IVA e percentuale, incluse
  // denominazioni con apostrofi/punti e ordine colonne variabile.
  for (const line of lines) {
    const piva = line.match(PIVA_RE)?.[1];
    const pct = line.match(PCT_RE)?.[1];
    if (!piva || !pct) continue;
    const before = line.slice(0, line.indexOf(piva));
    const after = line.slice(line.indexOf(piva) + piva.length);
    const value = line.match(/(?:€|eur|valore|quota)?\s*(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|\d+(?:[.,]\d{1,2}))/i)?.[1] ?? '';
    add(nameFrom(before) || nameFrom(after), piva, value, `${pct}%`);
  }

  // Fallback per testi ancora appiattiti: copre il formato più comune
  // "NOME COGNOME CF VALORE PERCENTUALE" senza reintrodurre gli amministratori.
  const flat = s4.replace(/\n/g, ' ');
  const direct = /\b([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ'’-]{1,24}(?:\s+[A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ'’-]{1,24}){1,4})\s+(?:C(?:odice)?\s*F(?:iscale)?\s*[:\-]?\s*)?([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/gi;
  for (const match of flat.matchAll(direct)) {
    const after = flat.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 180);
    const pct = after.match(PCT_RE)?.[1] ?? '';
    const value = after.match(VALUE_RE)?.[1] ?? '';
    if (pct || /soci?|titolari?|quot[ae]|partecipazion/i.test(flat.slice(Math.max(0, (match.index ?? 0) - 80), (match.index ?? 0) + 80))) {
      add(match[1], match[2], value, pct ? `${pct}%` : '');
    }
  }

  return results;
}

const LEGAL_WORDS_AMM = new Set([
  'COSTITUISCE','OGGETTO','DELIBERA','DELIBERATO','CONFERITI','CONFERIRE',
  'VENGONO','VIENE','SOCIETA','RESPONSABILITA','LIMITATA','AVENTE','ESERCIZIO',
  'IMPRESA','ATTIVITA','MEDESIMA','STESSA','QUANTO','QUANDO','OVVERO','NONCHE',
  'FATTO','CASO','SENSI','NORMA','LEGGE','DECRETO','ARTICOLO','COMMA','LETTERA',
  'PUNTO','NUMERO','CONTRATTO','STATUTO','ATTO','VERBALE','ASSEMBLEA','RIUNIONE',
  'CAPITALE','QUOTA','VALORE','IMPORTO','EURO','LIRE','CIASCUN','SEGUENTE',
  'SEGUENTI','PRESENTE','PRESENTI','PREDETTO','PREDETTI','SUDDETTO','SUDDETTI',
  'MEDESIMO','ALTRETTANTO','ALTRESI','POTERI','POTERE','FACOLTA','FIRMA',
  'FIRMARE','RAPPRESENTARE',
]);

function isPersonName(s: string): boolean {
  if (!s || s.length < 4 || s.length > 70) return false;
  const words = s.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  for (const w of words) {
    if (w.length < 2 || w.length > 25) return false;
    if (LEGAL_WORDS_AMM.has(w.toUpperCase())) return false;
    if (!/^[A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙa-zàèéìòùA-Z\'\-]*$/i.test(w)) return false;
  }
  return true;
}

const CARICA_PATTERN = String.raw`(Amministratore\s+(?:Unico|[Dd]elegato)|AMM(?:\.RE?|INISTRATORE)?\s*(?:UNICO|[Uu]nico|DELEGATO|[Dd]elegato)|Presidente(?:\s+(?:del\s+)?C(?:onsiglio|\.?D\.?A\.?))?|Consigliere(?:\s+[Dd]elegato)?|Liquidatore(?:\s+[Uu]nico)?|Direttore\s+[Gg]enerale)`;

export function parseAmministratori(raw: string, _sociCFs: Set<string> = new Set()): AmministratoreResult[] {
  const s5 = isolaSezione(raw,
    [/(?:sezione\s+(?:V|5)\b|\b5[\s\.\)]\s*Amministrat|organi\s+sociali|persone\s+che\s+esercitano)/i],
    /(?:sezione\s+(?:VI|6)\b|\b6[\s\.\)]\s*Sindac|$)/i,
  ) || raw;

  const results: AmministratoreResult[] = [];
  const seenCFs = new Set<string>();
  const seenNames = new Set<string>();

  const cfReCopy = new RegExp(CF_PF_RE.source, 'g');
  let cfm: RegExpExecArray | null;
  while ((cfm = cfReCopy.exec(s5)) !== null) {
    const cf = cfm[1];
    if (seenCFs.has(cf)) continue;
    const winStart = Math.max(0, cfm.index - 350);
    const winEnd = Math.min(s5.length, cfm.index + cf.length + 350);
    const window = s5.substring(winStart, winEnd);
    const caricaMatch = window.match(new RegExp(CARICA_PATTERN, 'i'));
    if (!caricaMatch) continue;

    seenCFs.add(cf);
    const carica = caricaMatch[1].trim();
    const beforeCF = s5.substring(Math.max(0, cfm.index - 250), cfm.index);
    const nameRe = /\b([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\'\-]{1,24}(?:\s+[A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\'\-]{1,24}){1,3})\b/g;
    const nameMatches = Array.from(beforeCF.matchAll(nameRe));
    let nome = '';
    for (let k = nameMatches.length - 1; k >= 0; k--) {
      const cand = nameMatches[k][1].trim();
      if (isPersonName(cand)) { nome = cand; break; }
    }

    if (!isPersonName(nome)) {
      const afterCF = s5.substring(cfm.index + cf.length, cfm.index + cf.length + 250);
      nome = afterCF.match(/^\s*[,\-]?\s*([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s\'\-]{4,50}?)(?=\s+(?:nato|nata|\d{2}[\/\-]|\bdi\b|Rap|Carica|Cod))/i)?.[1]?.trim() ?? '';
    }

    nome = nome.replace(/\b(?:CODICE|FISCALE|NATO|NATA|DEL|DELLA|CARICA|RAPPRESENTANTE|UNICO|DELEGATO|CF)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
    if (seenNames.has(nome || cf)) continue;
    seenNames.add(nome || cf);
    results.push({ nome: nome || 'N/D', codice_fiscale: cf, carica });
  }

  if (results.length === 0) {
    const CARICA_RE = new RegExp(CARICA_PATTERN, 'gi');
    let m: RegExpExecArray | null;
    while ((m = CARICA_RE.exec(s5)) !== null) {
      const carica = m[1].trim();
      const after = s5.substring(m.index + m[0].length, m.index + m[0].length + 400);
      const before = s5.substring(Math.max(0, m.index - 200), m.index);
      const cfMatch = after.match(/\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/);
      const cf = cfMatch?.[1];
      if (cf && seenCFs.has(cf)) continue;
      if (cf) seenCFs.add(cf);

      let rawNome = after.slice(0, 300).match(/([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s\'\-]{1,50}?)(?=\s+(?:[A-Z]{6}\d{2}|Nato\s+[aA]|Codice|domicilio|\d{1,2}[\/\-]\d{1,2}))/)?.[1]?.trim() ?? '';
      if (!isPersonName(rawNome)) {
        rawNome = before.match(/([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\']{1,20}\s+[A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\']{1,20}(?:\s+[A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\']{1,20})?)\s*$/)?.[1]?.trim() ?? '';
      }
      if (!isPersonName(rawNome)) continue;
      const nome = rawNome.replace(/\b(?:CODICE|FISCALE|NATO|NATA|DEL|DELLA|CARICA|RAPPRESENTANTE|UNICO|DELEGATO)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
      if (!nome || nome.length < 3 || seenNames.has(nome)) continue;
      seenNames.add(nome);
      results.push({ nome, codice_fiscale: cf, carica });
    }
  }

  return results;
}

export function parseVisuraCompleta(text: string): VisuraResult {
  const clean = text.replace(/[^\S\n]+/g, ' ').replace(/\n+/g, '\n');
  const flat = clean.replace(/\n/g, ' ');
  const get = (patterns: RegExp[]): string | undefined => {
    for (const re of patterns) {
      const m = flat.match(re);
      if (m?.[1]?.trim()) return cleanup(m[1]);
    }
  };

  const B = String.raw`(?=\s+(?:Data\s+(?:atto|cost)|Forma\s+giuridica|Natura\s+giuridica|Codice\s+[Ff]iscale|Partita\s+IVA|P\.?\s*IVA|Sede\s+legale|Indirizzo|Numero\s+REA|REA\s|Registro\s+[Ii]mprese|Iscrizione|Stato\s+dell|Capitale|Pec\b|PEC\b|Attivit|Oggetto\s+sociale|Sistema\s+di|Durata\s+della|Poteri\b|Archivio\s+ufficiale))`;
  const LABEL_RS = String.raw`(?:Denominazione(?:\s*[\/eo]\s*[Rr]agione\s+[Ss]ociale)?|Ragione\s+[Ss]ociale)\s*[:\-]?\s*`;
  const ragione_sociale = (() => {
    const m1 = flat.match(new RegExp(LABEL_RS + String.raw`(.{2,}?)` + B, 'i'));
    if (m1?.[1]?.trim()) return cleanup(m1[1]);
    const m2 = flat.match(new RegExp(LABEL_RS + String.raw`([^\:]{2,80}?(?:S\.?\s*R\.?\s*L\.?|S\.?\s*P\.?\s*A\.?|S\.?\s*N\.?\s*C\.?|S\.?\s*A\.?\s*S\.?|SRL|SPA|SNC|SAS|S\.?\s*S\.?|Soc\.?\s*Coop\.?|ONLUS|ETS|APS|ODV|IMPRESA\s+INDIVIDUALE)\.?)`, 'i'));
    if (m2?.[1]?.trim()) return cleanup(m2[1]);
    return undefined;
  })();

  const piva = get([/Partita\s*IVA\s*[:\-]?\s*(\d{11})/i, /P\.?\s*IVA\s*[:\-]?\s*(\d{11})/i]) ?? flat.match(/\b(\d{11})\b/)?.[1];
  const codice_fiscale_raw = get([/Codice\s+[Ff]iscale\s*[:\-]?\s*([A-Z0-9]{11,16})/i, /C\.?\s*F\.?\s*[:\-]?\s*([A-Z0-9]{11,16})/i, /\bCF\b\s*[:\-]?\s*([A-Z0-9]{11,16})/i]);
  const codice_fiscale = codice_fiscale_raw && codice_fiscale_raw !== piva ? codice_fiscale_raw : piva;

  const forma_giuridica = get([/Forma\s+giuridica\s*[:\-]?\s*([^:]{3,80}?)(?=\s+(?:Capitale|Sede|Data|Codice|Partita|Registro|REA|Attivit))/i, /Natura\s+giuridica\s*[:\-]?\s*([^:]{3,80}?)(?=\s+(?:Capitale|Sede|Data|Codice|Partita|Registro|REA|Attivit))/i]);
  const ADDR_B = String.raw`(?=\s+(?:Partita\s+IVA|P\.?\s*IVA|Codice\s+[Ff]iscale|Pec\b|PEC\b|REA\s|Registro|Telefono|Tel\b|Email|Attivit|Stato\s+dell))`;
  const indirizzo = (() => {
    const m = flat.match(new RegExp(String.raw`Sede\s+legale\s*[:\-]?\s*(.{5,})` + ADDR_B, 'i'));
    if (m?.[1]?.trim()) return cleanup(m[1]);
    return get([/Sede\s+legale\s*[:\-]?\s*([^\:]{5,120})/i, /Indirizzo\s*[:\-]?\s*([^\:]{5,120})/i]);
  })();

  const atecoMatch = flat.match(/(?:Attivit[àa]\s+(?:prevalente|principale|esercitata)|codice\s+ATECO|ATECO)\s*[:\-]?\s*[^\d]*(\d{2}\.\d{2}(?:\.\d{1,2})?)(?:\s+([^.;]{5,120}))?/i) ?? flat.match(/\bATECO\b[^\d]*(\d{2}\.\d{2}(?:\.\d{1,2})?)(?:\s+([^.;]{5,120}))?/i);
  const codice_ateco = atecoMatch?.[1];
  const ateco_descrizione = atecoMatch?.[2] ? cleanup(atecoMatch[2]) : undefined;
  const email = flat.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/)?.[1];
  const telMatch = flat.match(/\b((?:\+39\s?|0039\s?)?(?:0\d{1,4}[\s\-]?\d{5,10}|3\d{2}[\s\-]?\d{6,7}))\b/);
  const telefonoRaw = telMatch?.[1]?.replace(/\s+/g, ' ').trim();
  const telefono = (telefonoRaw && piva && telefonoRaw.replace(/[\s\-]/g, '') === piva) ? undefined : telefonoRaw;
  const data_costituzione = parseDataCostituzione(flat);
  const capitale_versato = get([/[Cc]apitale\s+sociale\s+in\s+[Ee]uro\s+versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i, /[Cc]apitale\s+(?:sociale\s+)?(?:interamente\s+)?versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i, /[Cc]apitale\s+versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i, /versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i]);
  const capitaleSocialeRaw = get([/[Cc]apitale\s+sociale\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i]);
  // Il parser soci usa le righe per ricostruire correttamente le colonne del
  // PDF; non passare il testo appiattito, altrimenti due righe adiacenti
  // possono essere deduplicate come se fossero lo stesso socio.
  const soci = parseSoci(clean);
  const sociCFs = new Set(soci.map(s => s.codice_fiscale).filter(Boolean));
  const amministratori = parseAmministratori(flat, sociCFs);

  const warnings: string[] = [];
  if (!data_costituzione) warnings.push('Data costituzione assente');
  if (soci.length === 0) warnings.push('Soci non trovati');
  if (amministratori.length === 0) warnings.push('Amministratori non trovati');
  if (!codice_ateco) warnings.push('ATECO assente');
  if (!piva) warnings.push('P.IVA assente');

  return {
    ragione_sociale,
    codice_fiscale,
    piva,
    data_costituzione,
    forma_giuridica,
    capitale_sociale: parseItalianNumber(capitaleSocialeRaw ?? capitale_versato),
    capitale_versato,
    codice_ateco,
    ateco_descrizione,
    indirizzo,
    email,
    telefono,
    soci,
    amministratori,
    qualita: {
      data_costituzione_trovata: Boolean(data_costituzione),
      soci_trovati: soci.length,
      amministratori_trovati: amministratori.length,
      capitale_trovato: Boolean(capitale_versato || capitaleSocialeRaw),
      ateco_trovato: Boolean(codice_ateco),
      piva_trovata: Boolean(piva),
      warnings,
    },
  };
}
