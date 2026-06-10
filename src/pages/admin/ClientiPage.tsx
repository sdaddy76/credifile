import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Plus, Search, Users, Pencil, Trash2, Mail, Phone,
  FileText, Loader2, CheckCircle2, AlertCircle, Users2, Building2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Client, Socio, Amministratore } from '@/lib/types';
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

/** Estrae testo grezzo da PDF usando pdfjs-dist v6 */
async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const ct = await pg.getTextContent();
    pages.push(ct.items.map((it: unknown) => (it as { str?: string }).str ?? '').join(' '));
  }
  return pages.join('\n');
}

/** Isola un segmento di testo tra due marker regex */
function isolaSezione(text: string, start: RegExp, end: RegExp): string {
  const si = text.search(start);
  if (si === -1) return '';
  const sub = text.substring(si);
  const ei  = sub.search(end);
  return ei !== -1 ? sub.substring(0, ei) : sub;
}

/** Rimuove caratteri jolly finali tipici del layout PDF */
function cleanup(s: string): string {
  return s.trim().replace(/\s{2,}/g, ' ').replace(/[,|\/\\]+$/, '').trim();
}

// ═══════════════════════════════════════════════════════════
//  TIPI VISURA
// ═══════════════════════════════════════════════════════════

interface VisuraData {
  ragione_sociale?:       string;
  piva?:                  string;
  codice_fiscale?:        string;
  indirizzo?:             string;
  email?:                 string;
  telefono?:              string;
  codice_ateco?:          string;
  data_costituzione?:     string;
  capitale_versato?:      string;
  soci?:                  Socio[];
  amministratori?:        Amministratore[];
}

interface ParseResult {
  data:     VisuraData;
  found:    string[];
  notFound: string[];
}

// ═══════════════════════════════════════════════════════════
//  PARSER VISURA CAMERALE
// ═══════════════════════════════════════════════════════════

/** Regex per codice fiscale di persona fisica (16 char) */
const CF_PF_RE = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/g;

/** Estrae lista soci dalla sezione 4 */
function parseSoci(raw: string): Socio[] {
  // Tenta isolamento sezione IV — fallback al testo completo
  const s4 = isolaSezione(raw,
    /(?:sezione\s+(?:IV|4)\b|\b4[\s\.\)]\s*Soci|soci\s+e\s+titolari|quote\s+sociali|TITOLARI\s+DI\s+QUOTE)/i,
    /(?:sezione\s+(?:V|5)\b|\b5[\s\.\)]\s*Amministrat|organi\s+sociali|rappresentanza|persone\s+che\s+esercitano)/i,
  ) || raw;

  const results: Socio[] = [];
  const seen = new Set<string>();
  const STOPWORDS = /\b(?:SOCIO|SOCIA|QUOTA|VALORE|NOMINATIVO|COGNOME|NOME|DENOMINAZIONE|TIPO|NATURA|TITOLO|SEZIONE|IV|SOCI|E|DI|SU|CODICE|FISCALE|C\.F\.?)\b/g;

  // ── Soci persona fisica (CF 16 char alfanumerico) ─────────────────────────
  CF_PF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CF_PF_RE.exec(s4)) !== null) {
    const cf = m[1];
    if (seen.has(cf)) continue;
    seen.add(cf);

    const before = s4.substring(Math.max(0, m.index - 200), m.index);
    const after  = s4.substring(m.index + cf.length, m.index + cf.length + 300);

    // Prova nome PRIMA del CF (formato più comune)
    const nameFromBefore = before.match(/([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s\'\-]{2,60})\s*(?:Codice\s+[Ff]iscale|C\.F\.?)?\s*$/)?.[1]?.trim() ?? '';
    // Prova nome DOPO il CF (alcuni layout mettono CF prima del nome)
    const nameFromAfter  = after.match(/^\s*[,\-]?\s*([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s\'\-]{2,60}?)(?=\s+(?:nato|nata|resid|domicil|carica|quota|€|%|\d{2}[\/\-]\d{2}))/i)?.[1]?.trim() ?? '';

    const rawName = nameFromBefore.length >= 3 ? nameFromBefore : nameFromAfter;
    const nome = rawName.replace(STOPWORDS, '').replace(/\s{2,}/g, ' ').trim();
    if (!nome || nome.length < 3) continue;

    const valMatch = after.match(/(?:€|[Ee]uro)\s*([\d.,]+)/)
                  ?? after.match(/quota\s+in\s+euro\s+([\d.,]+)/i)
                  ?? after.match(/\b([\d]{1,3}(?:\.\d{3})*,\d{2})\b/);
    const valore = valMatch?.[1] ?? '';

    const percMatch = after.match(/([\d]{1,3}(?:[,\.]\d{1,5})?)\s*%/)
                   ?? before.match(/([\d]{1,3}(?:[,\.]\d{1,5})?)\s*%/);
    const percentuale = percMatch?.[1] ? percMatch[1].replace(/%$/, '') + '%' : '';
    results.push({ nome, codice_fiscale: cf, valore, percentuale });
  }

  // ── Soci azienda (CF/PIVA 11 cifre) ───────────────────────────────────────
  const COMP_RE = /([A-Z0-9][A-Z0-9\s\.\'\-]{2,60}?(?:SRL|S\.R\.L\.|SPA|S\.P\.A\.|SNC|SAS|S\.S\.|SCARL|SCRL|COOP)\.?)\s+(\d{11})\s+([\d.,]+)\s+([\d,]+(?:[.,]\d+)?)\s*%/gi;
  let mc: RegExpExecArray | null;
  while ((mc = COMP_RE.exec(s4)) !== null) {
    const cf = mc[2];
    if (seen.has(cf)) continue;
    seen.add(cf);
    const nome        = mc[1].replace(/\s{2,}/g, ' ').trim();
    const valore      = mc[3];
    const percentuale = mc[4] + '%';
    if (nome.length >= 3) results.push({ nome, codice_fiscale: cf, valore, percentuale });
  }

  return results;
}

// ── Parole che indicano testo statutario, non nomi di persone ──────────────
const LEGAL_WORDS_AMM = new Set([
  'COSTITUISCE','OGGETTO','DELIBERA','DELIBERATO','CONFERITI','CONFERIRE',
  'VENGONO','VIENE','SOCIETA','RESPONSABILITA','LIMITATA','OGGETTO',
  'AVENTE','ESERCIZIO','IMPRESA','ATTIVITA','MEDESIMA','STESSA',
  'QUANTO','QUANDO','OVVERO','NONCHE','FATTO','CASO','SENSI','NORMA',
  'LEGGE','DECRETO','ARTICOLO','COMMA','LETTERA','PUNTO','NUMERO',
  'CONTRATTO','STATUTO','ATTO','VERBALE','ASSEMBLEA','RIUNIONE',
  'CAPITALE','QUOTA','VALORE','IMPORTO','EURO','LIRE','CIASCUN',
  'SEGUENTE','SEGUENTI','PRESENTE','PRESENTI','PREDETTO','PREDETTI',
  'SUDDETTO','SUDDETTI','MEDESIMO','ALTRETTANTO','ALTRESI',
  'POTERI','POTERE','FACOLTA','FIRMA','FIRMARE','RAPPRESENTARE',
]);

/**
 * Verifica che una stringa sembri un nome di persona fisica:
 * 2-4 parole, ognuna 2-25 char, nessuna è una LEGAL_WORD.
 */
function isPersonName(s: string): boolean {
  if (!s || s.length < 4 || s.length > 70) return false;
  const words = s.trim().split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  for (const w of words) {
    if (w.length < 2 || w.length > 25) return false;
    if (LEGAL_WORDS_AMM.has(w.toUpperCase())) return false;
    // Ogni parola deve essere solo lettere (e apostrofo/trattino)
    if (!/^[A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙa-zàèéìòùA-Z\'\-]*$/i.test(w)) return false;
  }
  return true;
}

/** Pattern carica (stringa per poterla rieseguire in più contesti) */
const CARICA_PATTERN = String.raw`(Amministratore\s+(?:Unico|[Dd]elegato)|AMM(?:\.RE?|INISTRATORE)?\s*(?:UNICO|[Uu]nico|DELEGATO|[Dd]elegato)|Presidente(?:\s+(?:del\s+)?C(?:onsiglio|\.?D\.?A\.?))?|Consigliere(?:\s+[Dd]elegato)?|Liquidatore(?:\s+[Uu]nico)?|Direttore\s+[Gg]enerale)`;

/** Estrae lista amministratori dalla sezione 5 */
function parseAmministratori(raw: string): Amministratore[] {
  // Tenta isolamento sezione V — fallback al testo completo
  const s5 = isolaSezione(raw,
    /(?:sezione\s+(?:V|5)\b|\b5[\s\.\)]\s*Amministrat|organi\s+sociali|persone\s+che\s+esercitano)/i,
    /(?:sezione\s+(?:VI|6)\b|\b6[\s\.\)]\s*Sindac|$)/i,
  ) || raw;

  const results: Amministratore[] = [];
  const seenCFs   = new Set<string>();
  const seenNames = new Set<string>();

  // ─────────────────────────────────────────────────────────────────────────
  // STRATEGIA 1 (alta confidenza): ancora sul CODICE FISCALE persona fisica.
  // Cerca tutti i CF nel testo, verifica se c'è una carica nelle vicinanze,
  // e ricostruisce il nome nelle 200 char prima/dopo il CF.
  // ─────────────────────────────────────────────────────────────────────────
  const cfReCopy = new RegExp(CF_PF_RE.source, 'g');
  let cfm: RegExpExecArray | null;
  while ((cfm = cfReCopy.exec(s5)) !== null) {
    const cf = cfm[1];
    if (seenCFs.has(cf)) continue;

    const winStart = Math.max(0, cfm.index - 350);
    const winEnd   = Math.min(s5.length, cfm.index + cf.length + 350);
    const window   = s5.substring(winStart, winEnd);

    // Se nel window c'è una carica, questo CF è associato a un amministratore
    const caricaMatch = window.match(new RegExp(CARICA_PATTERN, 'i'));
    if (!caricaMatch) continue;

    seenCFs.add(cf);
    const carica = caricaMatch[1].trim();

    // Cerca nome nelle 250 char PRIMA del CF (layout più comune: NOME CF carica)
    const beforeCF = s5.substring(Math.max(0, cfm.index - 250), cfm.index);
    let nome = beforeCF
      .match(/([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s\'\-]{1,50}?)\s*(?:C(?:odice)?\s*F(?:iscale)?|CF\.?)?\s*$/)?.[1]
      ?.trim() ?? '';

    if (!isPersonName(nome)) {
      // Prova dopo il CF (layout alternativo: CF NOME carica)
      const afterCF = s5.substring(cfm.index + cf.length, cfm.index + cf.length + 250);
      nome = afterCF
        .match(/^\s*[,\-]?\s*([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s\'\-]{4,50}?)(?=\s+(?:nato|nata|\d{2}[\/\-]|\bdi\b|Rap|Carica|Cod))/i)?.[1]
        ?.trim() ?? '';
    }

    // Pulizia finale
    nome = nome
      .replace(/\b(?:CODICE|FISCALE|NATO|NATA|DEL|DELLA|CARICA|RAPPRESENTANTE|UNICO|DELEGATO|CF)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (seenNames.has(nome || cf)) continue;
    seenNames.add(nome || cf);
    results.push({ nome: nome || 'N/D', codice_fiscale: cf, carica });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STRATEGIA 2 (fallback): ancora sulla CARICA, ma con isPersonName() stretta.
  // Usata solo quando la strategia 1 non trova nulla (visure senza CF esplicito).
  // ─────────────────────────────────────────────────────────────────────────
  if (results.length === 0) {
    const CARICA_RE = new RegExp(CARICA_PATTERN, 'gi');
    let m: RegExpExecArray | null;
    while ((m = CARICA_RE.exec(s5)) !== null) {
      const carica = m[1].trim();
      const after  = s5.substring(m.index + m[0].length, m.index + m[0].length + 400);
      const before = s5.substring(Math.max(0, m.index - 200), m.index);

      // CF opzionale
      const cfMatch = after.match(/\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/);
      const cf = cfMatch?.[1];
      if (cf && seenCFs.has(cf)) continue;
      if (cf) seenCFs.add(cf);

      // Nome: prova con lookahead al CF
      let rawNome = after.slice(0, 300).match(
        /([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s\'\-]{1,50}?)(?=\s+(?:[A-Z]{6}\d{2}|Nato\s+[aA]|Codice|domicilio|\d{1,2}[\/\-]\d{1,2}))/
      )?.[1]?.trim() ?? '';

      // Prova nome prima della carica ("MARIO ROSSI Amministratore Unico")
      if (!isPersonName(rawNome)) {
        rawNome = before.match(
          /([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\']{1,20}\s+[A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\']{1,20}(?:\s+[A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\']{1,20})?)\s*$/
        )?.[1]?.trim() ?? '';
      }

      // FILTRO CRUCIALE: scarta se non è un nome di persona
      if (!isPersonName(rawNome)) continue;

      const nome = rawNome
        .replace(/\b(?:CODICE|FISCALE|NATO|NATA|DEL|DELLA|CARICA|RAPPRESENTANTE|UNICO|DELEGATO)\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      if (!nome || nome.length < 3 || seenNames.has(nome)) continue;
      seenNames.add(nome);
      results.push({ nome, codice_fiscale: cf, carica });
    }
  }

  return results;
}

/** Parser principale — tutti i campi visura */
function parseVisura(text: string): VisuraData {
  // Normalizza whitespace mantenendo newline come separatore di sezione
  const clean  = text.replace(/[^\S\n]+/g, ' ').replace(/\n+/g, '\n');
  const flat   = clean.replace(/\n/g, ' '); // versione flat per regex inline

  const get = (patterns: RegExp[]): string | undefined => {
    for (const re of patterns) {
      const m = flat.match(re);
      if (m?.[1]?.trim()) return cleanup(m[1]);
    }
  };

  // ── Boundary comuni tra campi visura ──────────────────────────────────────
  const B = String.raw`(?=\s+(?:Data\s+(?:atto|cost)|Forma\s+giuridica|Natura\s+giuridica|` +
            String.raw`Codice\s+[Ff]iscale|Partita\s+IVA|P\.?\s*IVA|Sede\s+legale|Indirizzo|` +
            String.raw`Numero\s+REA|REA\s|Registro\s+[Ii]mprese|Iscrizione|Stato\s+dell|` +
            String.raw`Capitale|Pec\b|PEC\b|Attivit|Oggetto\s+sociale|Sistema\s+di|` +
            String.raw`Durata\s+della|Poteri\b|Archivio\s+ufficiale))`;

  // ── Ragione Sociale ───────────────────────────────────────────────────────
  const LABEL_RS = String.raw`(?:Denominazione(?:\s*[\/eo]\s*[Rr]agione\s+[Ss]ociale)?|Ragione\s+[Ss]ociale)\s*[:\-]?\s*`;

  const ragione_sociale = (() => {
    // Priorità 1: NON-greedy (.{2,}?) — si ferma al PRIMO boundary, non all'ultimo
    const m1 = flat.match(new RegExp(LABEL_RS + String.raw`(.{2,}?)` + B, 'i'));
    if (m1?.[1]?.trim()) return cleanup(m1[1]);
    // Priorità 2: si ferma alla forma giuridica inclusa nel nome (ammette cifre)
    const m2 = flat.match(new RegExp(
      LABEL_RS + String.raw`([^\:]{2,80}?(?:S\.?\s*R\.?\s*L\.?|S\.?\s*P\.?\s*A\.?|S\.?\s*N\.?\s*C\.?|S\.?\s*A\.?\s*S\.?|SRL|SPA|SNC|SAS|S\.?\s*S\.?|Soc\.?\s*Coop\.?|ONLUS|ETS|APS|ODV|IMPRESA\s+INDIVIDUALE)\.?)`,
      'i'
    ));
    if (m2?.[1]?.trim()) return cleanup(m2[1]);
    return undefined;
  })();

  // ── P.IVA ─────────────────────────────────────────────────────────────────
  const piva = get([
    /Partita\s*IVA\s*[:\-]?\s*(\d{11})/i,
    /P\.?\s*IVA\s*[:\-]?\s*(\d{11})/i,
  ]) ?? flat.match(/\b(\d{11})\b/)?.[1];

  // ── Codice Fiscale ────────────────────────────────────────────────────────
  const codice_fiscale_raw = get([
    /Codice\s+[Ff]iscale\s*[:\-]?\s*([A-Z0-9]{11,16})/i,
    /C\.?\s*F\.?\s*[:\-]?\s*([A-Z0-9]{11,16})/i,
    /\bCF\b\s*[:\-]?\s*([A-Z0-9]{11,16})/i,
  ]);
  // Se CF === PIVA (ditta individuale) cerca un CF persona fisica nel testo
  const codice_fiscale = (() => {
    if (codice_fiscale_raw && codice_fiscale_raw !== piva) return codice_fiscale_raw;
    // Fallback: cerca CF alfanumerico 16 char (persona fisica) se non già trovato
    const cfPF = flat.match(/\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/)?.[1];
    return cfPF ?? (codice_fiscale_raw !== piva ? codice_fiscale_raw : undefined);
  })();

  // ── Sede Legale ───────────────────────────────────────────────────────────
  const ADDR_B = String.raw`(?=\s+(?:Partita\s+IVA|P\.?\s*IVA|Codice\s+[Ff]iscale|Pec\b|PEC\b|REA\s|Registro|Telefono|Tel\b|Email|Attivit|Stato\s+dell))`;
  const indirizzo = (() => {
    const m = flat.match(new RegExp(String.raw`Sede\s+legale\s*[:\-]?\s*(.{5,})` + ADDR_B, 'i'));
    if (m?.[1]?.trim()) return cleanup(m[1]);
    return get([
      /Sede\s+legale\s*[:\-]?\s*([^\:]{5,120})/i,
      /Indirizzo\s*[:\-]?\s*([^\:]{5,120})/i,
    ]);
  })();

  // ── Codice ATECO ancorato all'etichetta ───────────────────────────────────
  const atecoMatch = flat.match(
    /(?:Attivit[àa]\s+(?:prevalente|principale|esercitata)|codice\s+ATECO|ATECO)\s*[:\-]?\s*[^\d]*(\d{2}\.\d{2}(?:\.\d{1,2})?)/i
  ) ?? flat.match(/\bATECO\b[^\d]*(\d{2}\.\d{2}(?:\.\d{1,2})?)/i);
  const codice_ateco = atecoMatch?.[1];

  // ── Email ─────────────────────────────────────────────────────────────────
  const email = flat.match(/\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/)?.[1];

  // ── Telefono ──────────────────────────────────────────────────────────────
  const telMatch = flat.match(
    /\b((?:\+39\s?|0039\s?)?(?:0\d{1,4}[\s\-]?\d{5,10}|3\d{2}[\s\-]?\d{6,7}))\b/
  );
  const telefono = telMatch?.[1]?.replace(/\s+/g, ' ').trim();

  // ── Data atto di costituzione ─────────────────────────────────────────────
  const data_costituzione = get([
    /Data\s+atto\s+di\s+costituzione\s*[:\-]?\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i,
    /Data\s+cost(?:ituzione)?\s*[:\-]?\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i,
    /(?:Atto\s+costitutivo|Costituzione)\s*[:\-]?\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i,
  ]);

  // ── Capitale sociale versato ──────────────────────────────────────────────
  const capitale_versato = get([
    /[Cc]apitale\s+sociale\s+in\s+[Ee]uro\s+versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i,
    /[Cc]apitale\s+(?:sociale\s+)?(?:interamente\s+)?versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i,
    /[Cc]apitale\s+versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i,
    /versato\s*[:\-]?\s*(?:€\s*)?([\d.,]+)/i,
  ]);

  // ── Soci e Amministratori ─────────────────────────────────────────────────
  const soci           = parseSoci(flat);
  const amministratori = parseAmministratori(flat);

  return {
    ragione_sociale, piva, codice_fiscale, indirizzo,
    email, telefono, codice_ateco,
    data_costituzione, capitale_versato,
    soci:           soci.length           > 0 ? soci           : undefined,
    amministratori: amministratori.length > 0 ? amministratori : undefined,
  };
}

/** Costruisce il feedback trovati/non trovati */
function buildParseResult(d: VisuraData): ParseResult {
  const LABELS: Record<keyof VisuraData, string> = {
    ragione_sociale:   'Ragione Sociale',
    piva:              'P.IVA',
    codice_fiscale:    'Codice Fiscale',
    indirizzo:         'Sede Legale',
    email:             'Email',
    telefono:          'Telefono',
    codice_ateco:      'ATECO',
    data_costituzione: 'Data Costituzione',
    capitale_versato:  'Capitale Versato',
    soci:              'Soci',
    amministratori:    'Amministratori',
  };
  const found: string[] = [], notFound: string[] = [];
  (Object.keys(LABELS) as (keyof VisuraData)[]).forEach(k => {
    const v = d[k];
    const present = Array.isArray(v) ? v.length > 0 : Boolean(v);
    (present ? found : notFound).push(LABELS[k]);
  });
  return { data: d, found, notFound };
}

// ═══════════════════════════════════════════════════════════
//  FORM STATE
// ═══════════════════════════════════════════════════════════

interface FormState {
  ragione_sociale:       string;
  piva:                  string;
  codice_fiscale:        string;
  email:                 string;
  telefono:              string;
  indirizzo:             string;
  data_costituzione:     string;
  capitale_versato:      string;
  soci:                  Socio[];
  amministratori:        Amministratore[];
}

const EMPTY: FormState = {
  ragione_sociale: '', piva: '', codice_fiscale: '', email: '',
  telefono: '', indirizzo: '', data_costituzione: '', capitale_versato: '',
  soci: [], amministratori: [],
};

// ═══════════════════════════════════════════════════════════
//  COMPONENTE
// ═══════════════════════════════════════════════════════════

export default function ClientiPage() {
  const { user, loading: authLoading, isSegnalatore, isAgente, isSegreteria } = useAuth();
  const [clients,     setClients]     = useState<Client[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [showForm,    setShowForm]    = useState(false);
  const [editing,     setEditing]     = useState<Client | null>(null);
  const [form,        setForm]        = useState<FormState>(EMPTY);
  const [saving,      setSaving]      = useState(false);
  const [parsing,     setParsing]     = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sezione documenti per segnalatore
  const [segOpenClientId, setSegOpenClientId] = useState<string | null>(null);
  const [segPracticeId, setSegPracticeId]     = useState<string | null>(null);
  const [segDocs, setSegDocs]                 = useState<{id:string;nome:string;status:string}[]>([]);
  const [segUploading, setSegUploading]       = useState<string | null>(null);
  const fileSegRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function load() {
    if (!user?.id) return;
    if (isSegnalatore) {
      const { data: pratt } = await supabase.from('practices').select('client_id').eq('segnalatore_id', user.id);
      const ids = [...new Set((pratt ?? []).map((p: {client_id:string}) => p.client_id).filter(Boolean))];
      if (ids.length === 0) { setClients([]); setLoading(false); return; }
      const { data } = await supabase.from('clients').select('*').in('id', ids).order('ragione_sociale');
      setClients(data ?? []);
    } else if (isAgente) {
      // Agente: vede solo i clienti con pratiche assegnate a lui
      const { data: pratt } = await supabase.from('practices').select('client_id').eq('assigned_to', user.id);
      const ids = [...new Set((pratt ?? []).map((p: {client_id:string}) => p.client_id).filter(Boolean))];
      if (ids.length === 0) { setClients([]); setLoading(false); return; }
      const { data } = await supabase.from('clients').select('*').in('id', ids).order('ragione_sociale');
      setClients(data ?? []);
    } else if (isSegreteria) {
      // Segreteria: vede solo i clienti con pratiche assegnate ai suoi agenti
      const { data: assignments } = await supabase.from('segreteria_agent_assignments').select('agent_user_id').eq('segreteria_user_id', user.id);
      const agentIds = (assignments ?? []).map((a: {agent_user_id:string}) => a.agent_user_id);
      if (agentIds.length === 0) { setClients([]); setLoading(false); return; }
      const { data: pratt } = await supabase.from('practices').select('client_id').in('assigned_to', agentIds);
      const ids = [...new Set((pratt ?? []).map((p: {client_id:string}) => p.client_id).filter(Boolean))];
      if (ids.length === 0) { setClients([]); setLoading(false); return; }
      const { data } = await supabase.from('clients').select('*').in('id', ids).order('ragione_sociale');
      setClients(data ?? []);
    } else {
      const { data, error } = await supabase.from('clients').select('*').order('ragione_sociale');
      if (error) toast.error('Errore caricamento clienti: ' + error.message);
      setClients(data ?? []);
    }
    setLoading(false);
  }

  async function openSegDocs(clientId: string) {
    if (!user?.id) return;
    setSegOpenClientId(clientId);
    setSegDocs([]); setSegPracticeId(null);
    const { data } = await supabase.from('practices').select('id').eq('client_id', clientId).eq('segnalatore_id', user.id).limit(1).maybeSingle();
    if (!data?.id) { toast.error('Nessuna pratica trovata'); return; }
    setSegPracticeId(data.id);
    const { data: docs } = await supabase.from('practice_documents').select('id,nome,status').eq('practice_id', data.id).order('created_at');
    setSegDocs((docs ?? []) as {id:string;nome:string;status:string}[]);
  }

  async function handleSegUpload(docId: string, file: File) {
    if (!segPracticeId || !user?.id) return;
    setSegUploading(docId);
    const ext = file.name.split('.').pop();
    const path = `${segPracticeId}/${docId}/${Date.now()}.${ext}`;
    try { await supabase.storage.from('practice-files').upload(path, file, { upsert: false }); } catch (_) { /* ok */ }
    await supabase.from('uploaded_files').insert({ practice_id: segPracticeId, doc_id: docId, nome_file: file.name, storage_path: path, uploaded_by: user.id });
    await supabase.from('practice_documents').update({ status: 'caricato', uploaded_at: new Date().toISOString() }).eq('id', docId);
    setSegUploading(null);
    toast.success('Documento caricato!');
    const { data: docs } = await supabase.from('practice_documents').select('id,nome,status').eq('practice_id', segPracticeId!).order('created_at');
    setSegDocs((docs ?? []) as {id:string;nome:string;status:string}[]);
  }

  useEffect(() => { if (!authLoading && user?.id) load(); }, [authLoading, user?.id, isSegnalatore, isAgente, isSegreteria]);

  const toForm = (c: Client): FormState => ({
    ragione_sociale:   c.ragione_sociale,
    piva:              c.piva             ?? '',
    codice_fiscale:    c.codice_fiscale   ?? '',
    email:             c.email,
    telefono:          c.telefono         ?? '',
    indirizzo:         c.indirizzo        ?? '',
    data_costituzione: c.data_costituzione ?? '',
    capitale_versato:  c.capitale_sociale_versato ?? '',
    soci:              c.soci             ?? [],
    amministratori:    c.amministratori   ?? [],
  });

  const openCreate = () => { setEditing(null); setForm(EMPTY); setParseResult(null); setShowForm(true); };
  const openEdit   = (c: Client) => { setEditing(c); setForm(toForm(c)); setParseResult(null); setShowForm(true); };

  // ── Import visura ─────────────────────────────────────────────────────────
  const handleVisuraFile = async (file: File) => {
    if (file.type !== 'application/pdf') { toast.error('Seleziona un file PDF'); return; }
    setParsing(true); setParseResult(null);
    try {
      const text   = await extractPdfText(file);
      const parsed = parseVisura(text);
      const result = buildParseResult(parsed);
      // Pre-compila solo i campi testo vuoti (non sovrascrive dati esistenti)
      setForm(prev => ({
        ragione_sociale:   prev.ragione_sociale   || parsed.ragione_sociale   || '',
        piva:              prev.piva              || parsed.piva              || '',
        codice_fiscale:    prev.codice_fiscale    || parsed.codice_fiscale    || '',
        email:             prev.email             || parsed.email             || '',
        telefono:          prev.telefono          || parsed.telefono          || '',
        indirizzo:         prev.indirizzo         || parsed.indirizzo         || '',
        data_costituzione: prev.data_costituzione || parsed.data_costituzione || '',
        capitale_versato:  prev.capitale_versato  || parsed.capitale_versato  || '',
        // Soci e amministratori si aggiornano sempre da visura
        soci:              parsed.soci           ?? prev.soci,
        amministratori:    parsed.amministratori ?? prev.amministratori,
      }));
      setParseResult(result);
      toast.success(`Estratti: ${result.found.join(', ')}`);
    } catch (e) {
      toast.error('Errore lettura PDF: ' + String(e));
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Salva cliente ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.ragione_sociale.trim() || !form.email.trim()) {
      toast.error('Ragione sociale ed email obbligatori'); return;
    }
    if (!user?.id) { toast.error('Sessione non valida. Ricarica la pagina.'); return; }
    setSaving(true);
    const payload = {
      ragione_sociale:         form.ragione_sociale.trim(),
      piva:                    form.piva             || null,
      codice_fiscale:          form.codice_fiscale   || null,
      email:                   form.email.trim(),
      telefono:                form.telefono         || null,
      indirizzo:               form.indirizzo        || null,
      data_costituzione:       form.data_costituzione || null,
      capitale_sociale_versato: form.capitale_versato || null,
      soci:                    form.soci.length           > 0 ? form.soci           : null,
      amministratori:          form.amministratori.length > 0 ? form.amministratori : null,
    };
    if (editing) {
      const { error } = await supabase.from('clients').update(payload).eq('id', editing.id);
      if (error) { toast.error('Errore aggiornamento: ' + error.message); setSaving(false); return; }
      if (payload.email !== editing.email) {
        const { data: practices } = await supabase.from('practices').select('id').eq('client_id', editing.id);
        if (practices?.length) {
          await supabase.from('practice_access_codes')
            .update({ email_cliente: payload.email.toLowerCase() })
            .in('practice_id', practices.map((p: { id: string }) => p.id));
        }
      }
      toast.success('Cliente aggiornato');
    } else {
      const { error } = await supabase.from('clients').insert({ ...payload, created_by: user.id });
      if (error) { toast.error('Errore creazione: ' + error.message); setSaving(false); return; }
      toast.success('Cliente creato');
    }
    setSaving(false); setShowForm(false); load();
  };

  const handleDelete = async (id: string, nome: string) => {
    if (!confirm(`Eliminare il cliente "${nome}"? Saranno eliminate anche le pratiche associate.`)) return;
    await supabase.from('clients').delete().eq('id', id);
    toast.success('Cliente eliminato'); load();
  };

  const filtered = clients.filter(c =>
    c.ragione_sociale.toLowerCase().includes(search.toLowerCase()) ||
    (c.piva ?? '').includes(search) ||
    (c.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Intestazione */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clienti</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isSegnalatore ? 'Clienti delle tue pratiche' : `${clients.length} clienti registrati`}
          </p>
        </div>
        {!isSegnalatore && <Button onClick={openCreate} className="gap-2"><Plus className="w-4 h-4" /> Nuovo Cliente</Button>}
      </div>

      {/* Ricerca */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Cerca per nome, P.IVA, email…" className="pl-9"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="py-16 text-center">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30 text-muted-foreground" />
          <p className="text-muted-foreground">Nessun cliente trovato</p>
          <Button variant="outline" className="mt-4" onClick={openCreate}>Aggiungi il primo cliente</Button>
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <Card key={c.id} className="border-border hover:border-primary/30 transition-colors">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-4">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">{c.ragione_sociale.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{c.ragione_sociale}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      {c.piva && <span className="font-mono">P.IVA: {c.piva}</span>}
                      <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>
                      {c.telefono && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.telefono}</span>}
                      {c.soci && c.soci.length > 0 && (
                        <span className="flex items-center gap-1 text-blue-600">
                          <Users2 className="w-3 h-3" />{c.soci.length} soc.
                        </span>
                      )}
                      {c.amministratori && c.amministratori.length > 0 && (
                        <span className="flex items-center gap-1 text-violet-600">
                          <Building2 className="w-3 h-3" />Amm.: {c.amministratori.map(a => a.nome).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {isSegnalatore ? (
                      <Button variant="outline" size="sm" className="text-xs gap-1 h-8 px-2 text-orange-700 border-orange-300 hover:bg-orange-50"
                        onClick={() => openSegDocs(c.id)}>
                        <FileText className="w-3.5 h-3.5" /> Documenti
                      </Button>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                          onClick={() => handleDelete(c.id, c.ragione_sociale)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog nuovo/modifica cliente */}
      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setParseResult(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifica Cliente' : 'Nuovo Cliente'}</DialogTitle>
          </DialogHeader>

          {/* ── Riquadro Import Visura ── */}
          <div className="bg-muted/40 rounded-lg px-4 py-3 border border-dashed border-border space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Importa da Visura Camerale
              </p>
              <label className="cursor-pointer">
                <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1.5 pointer-events-none">
                  <span>
                    {parsing
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Lettura PDF…</>
                      : <><FileText className="w-3 h-3" />Carica visura PDF</>}
                  </span>
                </Button>
                <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                  disabled={parsing}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleVisuraFile(f); }} />
              </label>
            </div>

            {parseResult && (
              <div className="space-y-1">
                {parseResult.found.length > 0 && (
                  <div className="flex items-start gap-1.5 text-xs text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span><strong>Trovati:</strong> {parseResult.found.join(' · ')}</span>
                  </div>
                )}
                {parseResult.notFound.length > 0 && (
                  <div className="flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span><strong>Non trovati:</strong> {parseResult.notFound.join(' · ')}</span>
                  </div>
                )}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              Funziona su visure camerali ufficiali del Registro Imprese (PDF digitale, non scansioni).
            </p>
          </div>

          {/* ── Campi base ── */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>Ragione Sociale *</Label>
              <Input placeholder="Es. Mario Rossi S.r.l." value={form.ragione_sociale}
                onChange={e => setForm(f => ({ ...f, ragione_sociale: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>P.IVA</Label>
              <Input placeholder="12345678901" value={form.piva}
                onChange={e => setForm(f => ({ ...f, piva: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Codice Fiscale</Label>
              <Input placeholder="RSSMRA80…" value={form.codice_fiscale}
                onChange={e => setForm(f => ({ ...f, codice_fiscale: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" placeholder="info@azienda.it" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Telefono</Label>
              <Input placeholder="+39 02 1234567" value={form.telefono}
                onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Indirizzo Sede</Label>
              <Input placeholder="Via Roma 1, 20100 Milano" value={form.indirizzo}
                onChange={e => setForm(f => ({ ...f, indirizzo: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Data Costituzione</Label>
              <Input placeholder="gg/mm/aaaa" value={form.data_costituzione}
                onChange={e => setForm(f => ({ ...f, data_costituzione: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Capitale Sociale Versato (€)</Label>
              <Input placeholder="10.000,00" value={form.capitale_versato}
                onChange={e => setForm(f => ({ ...f, capitale_versato: e.target.value }))} />
            </div>
          </div>

          {/* ── Soci / Titolari — sempre visibile, editabile ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Users2 className="w-3.5 h-3.5 text-blue-500" />
                Soci / Titolari {form.soci.length > 0 && `(${form.soci.length})`}
              </p>
              <Button
                type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                onClick={() => setForm(f => ({ ...f, soci: [...f.soci, { nome: '', codice_fiscale: '', valore: '', percentuale: '' }] }))}
              >
                <Plus className="w-3 h-3" /> Aggiungi
              </Button>
            </div>
            {form.soci.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded-md border-border">
                Nessun socio. Carica la visura o aggiungi manualmente.
              </p>
            ) : (
              <div className="space-y-1.5">
                {form.soci.length > 0 && (
                  <div className="flex gap-1.5 px-0.5">
                    <span className="text-[10px] text-muted-foreground flex-[2] px-1">Nome / Denominazione</span>
                    <span className="text-[10px] text-muted-foreground flex-[1.5] px-1">Cod. Fiscale</span>
                    <span className="text-[10px] text-muted-foreground flex-1 px-1">Valore €</span>
                    <span className="text-[10px] text-muted-foreground w-16 shrink-0 px-1">%</span>
                    <span className="w-7 shrink-0" />
                  </div>
                )}
                {form.soci.map((s, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <Input
                      placeholder="Nome / Denominazione"
                      value={s.nome}
                      className="h-7 text-xs flex-[2]"
                      onChange={e => setForm(f => ({ ...f, soci: f.soci.map((x, j) => j === i ? { ...x, nome: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="Cod. Fiscale"
                      value={s.codice_fiscale}
                      className="h-7 text-xs flex-[1.5] font-mono"
                      onChange={e => setForm(f => ({ ...f, soci: f.soci.map((x, j) => j === i ? { ...x, codice_fiscale: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="Valore"
                      value={s.valore}
                      className="h-7 text-xs flex-1"
                      onChange={e => setForm(f => ({ ...f, soci: f.soci.map((x, j) => j === i ? { ...x, valore: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="%"
                      value={s.percentuale}
                      className="h-7 text-xs w-16 shrink-0"
                      onChange={e => setForm(f => ({ ...f, soci: f.soci.map((x, j) => j === i ? { ...x, percentuale: e.target.value } : x) }))}
                    />
                    <Button
                      type="button" variant="ghost" size="sm"
                      className="h-7 w-7 p-0 shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => setForm(f => ({ ...f, soci: f.soci.filter((_, j) => j !== i) }))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Organi Sociali / Amministratori — sempre visibile, editabile ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-violet-500" />
                Organi Sociali / Amministratori {form.amministratori.length > 0 && `(${form.amministratori.length})`}
              </p>
              <Button
                type="button" variant="outline" size="sm" className="h-7 text-xs gap-1"
                onClick={() => setForm(f => ({ ...f, amministratori: [...f.amministratori, { nome: '', carica: '', codice_fiscale: '' }] }))}
              >
                <Plus className="w-3 h-3" /> Aggiungi
              </Button>
            </div>
            {form.amministratori.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded-md border-border">
                Nessun amministratore. Carica la visura o aggiungi manualmente.
              </p>
            ) : (
              <div className="space-y-1.5">
                {form.amministratori.length > 0 && (
                  <div className="flex gap-1.5 px-0.5">
                    <span className="text-[10px] text-muted-foreground flex-[2] px-1">Nome</span>
                    <span className="text-[10px] text-muted-foreground flex-[1.5] px-1">Carica</span>
                    <span className="text-[10px] text-muted-foreground flex-[1.5] px-1">Cod. Fiscale</span>
                    <span className="w-7 shrink-0" />
                  </div>
                )}
                {form.amministratori.map((a, i) => (
                  <div key={i} className="flex gap-1.5 items-center">
                    <Input
                      placeholder="Nome"
                      value={a.nome}
                      className="h-7 text-xs flex-[2]"
                      onChange={e => setForm(f => ({ ...f, amministratori: f.amministratori.map((x, j) => j === i ? { ...x, nome: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="Carica (es. Amm. Unico)"
                      value={a.carica}
                      className="h-7 text-xs flex-[1.5]"
                      onChange={e => setForm(f => ({ ...f, amministratori: f.amministratori.map((x, j) => j === i ? { ...x, carica: e.target.value } : x) }))}
                    />
                    <Input
                      placeholder="Cod. Fiscale"
                      value={a.codice_fiscale ?? ''}
                      className="h-7 text-xs flex-[1.5] font-mono"
                      onChange={e => setForm(f => ({ ...f, amministratori: f.amministratori.map((x, j) => j === i ? { ...x, codice_fiscale: e.target.value } : x) }))}
                    />
                    <Button
                      type="button" variant="ghost" size="sm"
                      className="h-7 w-7 p-0 shrink-0 text-destructive hover:bg-destructive/10"
                      onClick={() => setForm(f => ({ ...f, amministratori: f.amministratori.filter((_, j) => j !== i) }))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annulla</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Salvo…' : editing ? 'Salva Modifiche' : 'Crea Cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog documenti segnalatore */}
      <Dialog open={!!segOpenClientId} onOpenChange={v => { if (!v) { setSegOpenClientId(null); setSegDocs([]); setSegPracticeId(null); } }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>📄 Documenti Pratica</DialogTitle></DialogHeader>
          {segDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {segPracticeId === null ? 'Caricamento...' : 'Nessun documento richiesto per questa pratica.'}
            </p>
          ) : (
            <div className="space-y-2 py-2">
              {segDocs.map(doc => {
                const done = doc.status === 'caricato' || doc.status === 'approvato';
                return (
                  <div key={doc.id} className={`flex items-center justify-between p-2.5 rounded-lg border text-sm ${done ? 'bg-green-50 border-green-200' : 'bg-muted/40 border-border'}`}>
                    <div className="flex items-center gap-2">
                      {done
                        ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                        : <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />}
                      <span className={done ? 'text-green-800 font-medium' : 'font-medium'}>{doc.nome}</span>
                    </div>
                    {!done && (
                      <>
                        <input type="file" className="hidden" ref={el => { fileSegRefs.current[doc.id] = el; }}
                          onChange={e => { const f = e.target.files?.[0]; if (f) handleSegUpload(doc.id, f); e.target.value = ''; }} />
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
                          disabled={segUploading === doc.id}
                          onClick={() => fileSegRefs.current[doc.id]?.click()}>
                          {segUploading === doc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                          {segUploading === doc.id ? 'Upload...' : 'Carica'}
                        </Button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSegOpenClientId(null); setSegDocs([]); setSegPracticeId(null); }}>Chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
