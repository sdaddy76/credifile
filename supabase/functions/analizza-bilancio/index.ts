const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, ...data as object }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function fail(msg: string, status = 200) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Parsing numeri in formato italiano ──────────────────────────────────────
function parseNum(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const s = raw.trim().replace(/\s/g, '');
  if (s === '' || s === '-' || s === '—') return 0;
  // valori negativi tra parentesi: (78.791) → -78791
  const negative = s.startsWith('(') && s.endsWith(')');
  let clean = negative ? s.slice(1, -1) : s;
  // rimuovi punti separatori migliaia, sostituisci virgola decimale
  clean = clean.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(clean);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

// ─── Estrai valore da tabella markdown cercando l'etichetta ──────────────────
function extractVal(text: string, patterns: string[]): number | null {
  const lines = text.split('\n');
  for (const line of lines) {
    for (const pat of patterns) {
      if (!line.toLowerCase().includes(pat.toLowerCase())) continue;

      // Formato markdown: | etichetta | valore1 | valore2 |
      if (line.includes('|')) {
        const cols = line.split('|').map(c => c.trim()).filter(c => c && c !== '---');
        if (cols.length >= 2) {
          const v = parseNum(cols[1]);
          if (v !== null) return v;
        }
      }

      // Formato testo grezzo da pdfjs: "Totale attivo 1.917.440 65.263"
      // Cerca i numeri che compaiono DOPO il testo dell'etichetta
      const patIdx = line.toLowerCase().indexOf(pat.toLowerCase());
      const afterLabel = line.slice(patIdx + pat.length);
      // Estrae tutti i token numerici (anche con punti, virgole, parentesi per negativi)
      const nums = afterLabel.match(/\(?[\d]+(?:[.,][\d]{3})*(?:[.,]\d+)?\)?/g);
      if (nums && nums.length > 0) {
        const v = parseNum(nums[0]);
        if (v !== null) return v;
      }
    }
  }
  return null;
}

// ─── Parser XBRL deterministico ──────────────────────────────────────────────
function parseBilancio(text: string) {
  const e = (pats: string[]) => extractVal(text, pats);

  // Dati anagrafici — supporta sia markdown (##) che testo grezzo pdfjs
  const rsMatch = text.match(/(?:##\s+)?([A-Z][A-Z0-9 &'.,-]+(?:SRL|SPA|SAS|SNC|SRLS|SSP|SCRL|COOP)?[A-Z0-9 &'.,-]*)\s*\n[\s\S]{0,200}?Bilancio di esercizio al/i)
    ?? text.match(/##\s+(.+?)\s*\n/);
  const ragione_sociale = rsMatch ? rsMatch[1].trim() : null;
  const annoMatch = text.match(/Bilancio di esercizio al\s+\d{1,2}[-/]\d{2}[-/](\d{4})/);
  const anno_esercizio = annoMatch ? parseInt(annoMatch[1]) : null;

  // SP Attivo
  const totale_attivo = e(['Totale attivo']);
  const totale_immobilizzazioni = e(['Totale immobilizzazioni (B)', 'Totale immobilizzazioni']);
  const imm_immateriali = e(['I - Immobilizzazioni immateriali', 'Immobilizzazioni immateriali']);
  const imm_materiali = e(['II - Immobilizzazioni materiali', 'Immobilizzazioni materiali']);
  const imm_finanziarie = e(['III - Immobilizzazioni finanziarie', 'Immobilizzazioni finanziarie']);
  const totale_attivo_circolante = e(['Totale attivo circolante (C)', 'Totale attivo circolante']);
  const rimanenze = e(['I - Rimanenze', 'Totale rimanenze', 'Rimanenze']);
  const crediti_circolante = e(['Totale crediti']);
  const disponibilita_liquide = e(['IV - Disponibilità liquide', 'Disponibilità liquide']);
  const ratei_risconti_attivi = e(['D) Ratei e risconti', 'Ratei e risconti attivi']);

  // SP Passivo
  const totale_patrimonio_netto = e(['Totale patrimonio netto']);
  const capitale_sociale = e(['I - Capitale', '| Capitale |']);
  const utile_perdita_esercizio = e(['IX - Utile (perdita)', 'Utile (perdita) dell\'esercizio']);
  const fondi_rischi = e(['B) Fondi per rischi', 'Fondi per rischi e oneri']);
  const tfr = e(['C) Trattamento di fine rapporto', 'Trattamento di fine rapporto di lavoro']);
  const totale_debiti = e(['Totale debiti']);
  const ratei_risconti_passivi = e(['E) Ratei e risconti']);

  // Dettaglio debiti (dalla nota integrativa)
  const debiti_banche_breve = e(['Debiti verso banche']);
  const debiti_altri_finanziatori = e(['Debiti verso altri finanziatori']);
  const debiti_fornitori = e(['Debiti verso fornitori']);
  const debiti_tributari = e(['Debiti tributari']);

  // CE
  const ricavi_vendite = e(['1) ricavi delle vendite', 'ricavi delle vendite e delle prestazioni']);
  const totale_valore_produzione = e(['Totale valore della produzione']);
  const costi_materie = e(['per materie prime', 'Materie prime']);
  const costi_servizi = e(['per servizi', '| Servizi |']);
  const costo_personale_salari = e(['Salari e stipendi']);
  const costo_personale_oneri = e(['Oneri sociali']);
  const costo_personale_tfr_quota = e(['Trattamento di fine rapporto']);
  const costo_personale = (costo_personale_salari ?? 0) + (costo_personale_oneri ?? 0) + (costo_personale_tfr_quota ?? 0) || null;
  const amm_imm = e(['Ammortamento immobilizzazioni immateriali']);
  const amm_mat = e(['Ammortamento immobilizzazioni materiali']);
  const ammortamenti = ((amm_imm ?? 0) + (amm_mat ?? 0)) || null;
  const oneri_diversi_gestione = e(['oneri diversi di gestione', '14) oneri diversi']);
  const totale_costi_produzione = e(['Totale costi della produzione']);
  const differenza_ab = e(['Differenza tra valore e costi della produzione']);
  const proventi_partecipazioni = e(['Totale proventi da partecipazioni', 'da imprese controllate']);
  const interessi_passivi = e(['Interessi e altri oneri finanziari']);
  const risultato_ante_imposte = e(['Risultato prima delle imposte']);
  const imposte = e(['21) Imposte', '20) Imposte', 'Imposte sul reddito']);
  const utile_netto = e(['21) Utile (perdita)', 'Utile (perdita) dell\'esercizio']);

  // Formato
  const isXbrl = text.includes('tassonomia itcc-ci') || text.includes('Conforme alla tassonomia');

  return {
    ragione_sociale, anno_esercizio,
    totale_attivo, totale_immobilizzazioni, imm_immateriali, imm_materiali, imm_finanziarie,
    totale_attivo_circolante, rimanenze, crediti_circolante, disponibilita_liquide, ratei_risconti_attivi,
    totale_patrimonio_netto, capitale_sociale, utile_perdita_esercizio,
    fondi_rischi, tfr,
    debiti_banche_breve: debiti_banche_breve ?? 0, debiti_banche_lungo: 0,
    debiti_altri_finanziatori: debiti_altri_finanziatori ?? 0,
    debiti_fornitori: debiti_fornitori ?? 0, debiti_tributari: debiti_tributari ?? 0,
    totale_debiti, ratei_risconti_passivi,
    ricavi_vendite, totale_valore_produzione,
    costi_materie, costi_servizi, costo_personale, ammortamenti, oneri_diversi_gestione,
    totale_costi_produzione, differenza_ab,
    proventi_partecipazioni, interessi_passivi,
    risultato_ante_imposte, imposte, utile_netto,
    formato_rilevato: isXbrl ? 'xbrl_standard' : 'libero',
  };
}

// ─── Calcolo KPI ─────────────────────────────────────────────────────────────
type Semaforo = 'verde' | 'giallo' | 'rosso' | 'nd';
interface KpiEntry { valore: number | null; formatted: string; semaforo: Semaforo; label: string }

function semaforo(v: number | null, thresholds: { green: [number, number] | null; yellow: [number, number] | null }, higherIsBetter: boolean): Semaforo {
  if (v === null || !isFinite(v)) return 'nd';
  if (thresholds.green && v >= thresholds.green[0] && v <= thresholds.green[1]) return 'verde';
  if (thresholds.yellow && v >= thresholds.yellow[0] && v <= thresholds.yellow[1]) return 'giallo';
  return 'rosso';
}

function fmtPct(v: number | null) { return v !== null ? v.toFixed(1) + '%' : 'N/D'; }
function fmtMult(v: number | null) { return v !== null ? v.toFixed(2) + 'x' : 'N/D'; }
function fmtRatio(v: number | null) { return v !== null ? v.toFixed(2) : 'N/D'; }
function fmtEur(v: number | null) {
  if (v === null) return 'N/D';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(v);
}
function fmtGiorni(v: number | null) { return v !== null ? Math.round(v) + ' gg' : 'N/D'; }

function calcolaKpi(d: ReturnType<typeof parseBilancio>) {
  const pn = d.totale_patrimonio_netto;
  const ta = d.totale_attivo;
  const ac = d.totale_attivo_circolante ?? 0;
  const rim = d.rimanenze ?? 0;
  const liq = d.disponibilita_liquide ?? 0;
  const td = d.totale_debiti ?? 0;
  const dbBrv = (d.debiti_banche_breve ?? 0) + (d.debiti_banche_lungo ?? 0) + (d.debiti_altri_finanziatori ?? 0);
  const passCorr = td; // approssimazione: tutti i debiti come correnti se non c'è dettaglio
  const tvp = d.totale_valore_produzione;
  const ebit = d.differenza_ab !== null
    ? d.differenza_ab + (d.proventi_partecipazioni ?? 0) - (d.interessi_passivi ?? 0)
    : d.risultato_ante_imposte;
  const ebitda = ebit !== null ? ebit + (d.ammortamenti ?? 0) : null;
  const pfn = dbBrv - liq;
  const intPass = d.interessi_passivi;
  const isHolding = (d.ricavi_vendite === 0 || d.ricavi_vendite === null) && (d.proventi_partecipazioni ?? 0) > 0;

  function kpi(label: string, valore: number | null, formatted: string, sem: Semaforo): KpiEntry {
    return { valore, formatted, semaforo: sem, label };
  }

  const currentRatio = passCorr > 0 ? ac / passCorr : null;
  const quickRatio = passCorr > 0 ? (ac - rim) / passCorr : null;
  const acidTest = passCorr > 0 ? liq / passCorr : null;
  const debtEquity = pn && pn > 0 ? td / pn : null;
  const leverage = pn && pn > 0 ? (ta ?? 0) / pn : null;
  const pnSuTa = ta && ta > 0 ? (pn ?? 0) / ta * 100 : null;
  const gradoIndebit = pn && pn > 0 ? dbBrv / pn : null;
  const roe = pn && pn > 0 ? (d.utile_netto ?? 0) / pn * 100 : null;
  const roi = ta && ta > 0 && ebit !== null ? ebit / ta * 100 : null;
  const ros = tvp && tvp > 0 && ebit !== null ? ebit / tvp * 100 : null;
  const ebitdaMargin = tvp && tvp > 0 && ebitda !== null ? ebitda / tvp * 100 : null;
  const pfnEbitda = ebitda && ebitda > 0 ? pfn / ebitda : null;
  const pfnPn = pn && pn > 0 ? pfn / pn : null;
  const dso = d.ricavi_vendite && d.ricavi_vendite > 0 && d.crediti_circolante !== null
    ? d.crediti_circolante / (d.ricavi_vendite / 365) : null;
  const dpo = d.costi_materie && d.costi_materie > 0 && d.debiti_fornitori !== null
    ? d.debiti_fornitori / (d.costi_materie / 365) : null;
  const dsi = d.costi_materie && d.costi_materie > 0 && rim > 0
    ? rim / (d.costi_materie / 365) : null;
  const intCov = intPass && intPass > 0 && ebit !== null ? ebit / intPass : null;

  return {
    is_holding: isHolding,
    ebit, ebitda, pfn,
    kpi: {
      liquidita: {
        current_ratio: kpi('Current Ratio', currentRatio, fmtRatio(currentRatio),
          currentRatio === null ? 'nd' : currentRatio >= 1.5 ? 'verde' : currentRatio >= 1.0 ? 'giallo' : 'rosso'),
        quick_ratio: kpi('Quick Ratio', quickRatio, fmtRatio(quickRatio),
          quickRatio === null ? 'nd' : quickRatio >= 1.0 ? 'verde' : quickRatio >= 0.8 ? 'giallo' : 'rosso'),
        acid_test: kpi('Acid Test', acidTest, fmtRatio(acidTest),
          acidTest === null ? 'nd' : acidTest >= 0.5 ? 'verde' : acidTest >= 0.2 ? 'giallo' : 'rosso'),
      },
      solidita: {
        debt_equity: kpi('Debt/Equity', debtEquity, fmtRatio(debtEquity),
          debtEquity === null ? 'nd' : debtEquity <= 1.5 ? 'verde' : debtEquity <= 3.0 ? 'giallo' : 'rosso'),
        leverage: kpi('Leverage', leverage, fmtRatio(leverage),
          leverage === null ? 'nd' : leverage <= 2.5 ? 'verde' : leverage <= 4.0 ? 'giallo' : 'rosso'),
        pn_su_ta: kpi('PN / Totale Attivo', pnSuTa, fmtPct(pnSuTa),
          pnSuTa === null ? 'nd' : pnSuTa >= 25 ? 'verde' : pnSuTa >= 15 ? 'giallo' : 'rosso'),
        grado_indebitamento: kpi('Grado Indebitamento', gradoIndebit, fmtRatio(gradoIndebit),
          gradoIndebit === null ? 'nd' : gradoIndebit <= 1.0 ? 'verde' : gradoIndebit <= 2.0 ? 'giallo' : 'rosso'),
      },
      redditivita: {
        roe: kpi('ROE', roe, fmtPct(roe),
          roe === null ? 'nd' : roe >= 5 ? 'verde' : roe >= 0 ? 'giallo' : 'rosso'),
        roi: kpi('ROI', roi, fmtPct(roi),
          roi === null ? 'nd' : roi >= 3 ? 'verde' : roi >= 0 ? 'giallo' : 'rosso'),
        ros: kpi('ROS', ros, fmtPct(ros),
          ros === null ? 'nd' : ros >= 3 ? 'verde' : ros >= 0 ? 'giallo' : 'rosso'),
        ebitda_margin: kpi('EBITDA Margin', ebitdaMargin, fmtPct(ebitdaMargin),
          ebitdaMargin === null ? 'nd' : ebitdaMargin >= 10 ? 'verde' : ebitdaMargin >= 5 ? 'giallo' : 'rosso'),
        ebitda_eur: kpi('EBITDA (€)', ebitda, fmtEur(ebitda), ebitda === null ? 'nd' : ebitda > 0 ? 'verde' : 'rosso'),
      },
      indebitamento: {
        pfn: kpi('PFN (€)', pfn, fmtEur(pfn), pfn <= 0 ? 'verde' : pfn <= (pn ?? 0) ? 'giallo' : 'rosso'),
        pfn_ebitda: kpi('PFN / EBITDA', pfnEbitda, pfnEbitda !== null ? pfnEbitda.toFixed(1) + 'x' : 'N/D',
          pfnEbitda === null ? 'nd' : pfnEbitda <= 3 ? 'verde' : pfnEbitda <= 5 ? 'giallo' : 'rosso'),
        pfn_pn: kpi('PFN / PN', pfnPn, fmtRatio(pfnPn),
          pfnPn === null ? 'nd' : pfnPn <= 1.0 ? 'verde' : pfnPn <= 2.0 ? 'giallo' : 'rosso'),
      },
      efficienza: {
        dso: kpi('DSO (giorni crediti)', dso, fmtGiorni(dso),
          dso === null ? 'nd' : dso <= 60 ? 'verde' : dso <= 120 ? 'giallo' : 'rosso'),
        dpo: kpi('DPO (giorni debiti)', dpo, fmtGiorni(dpo), 'nd'),
        dsi: kpi('DSI (giorni magazzino)', dsi, fmtGiorni(dsi), 'nd'),
      },
      copertura: {
        interest_coverage: kpi('Interest Coverage', intCov, fmtMult(intCov),
          intCov === null ? 'nd' : intCov >= 3 ? 'verde' : intCov >= 1.5 ? 'giallo' : 'rosso'),
      },
    },
  };
}

// ─── Handler principale ───────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { practice_id, pdf_text, uploaded_file_id } = await req.json();
  if (!practice_id || !pdf_text) return fail('practice_id e pdf_text sono obbligatori');

  // Parse bilancio
  const bilData = parseBilancio(pdf_text);
  const { is_holding, ebit: _ebit, ebitda: _ebitda, pfn: _pfn, kpi } = calcolaKpi(bilData);

  // Upsert su DB via REST
  const row = {
    practice_id,
    uploaded_file_id: uploaded_file_id ?? null,
    anno_esercizio: bilData.anno_esercizio,
    ragione_sociale: bilData.ragione_sociale,
    totale_attivo: bilData.totale_attivo,
    totale_immobilizzazioni: bilData.totale_immobilizzazioni,
    imm_immateriali: bilData.imm_immateriali,
    imm_materiali: bilData.imm_materiali,
    imm_finanziarie: bilData.imm_finanziarie,
    totale_attivo_circolante: bilData.totale_attivo_circolante,
    rimanenze: bilData.rimanenze,
    crediti_circolante: bilData.crediti_circolante,
    disponibilita_liquide: bilData.disponibilita_liquide,
    ratei_risconti_attivi: bilData.ratei_risconti_attivi,
    totale_patrimonio_netto: bilData.totale_patrimonio_netto,
    capitale_sociale: bilData.capitale_sociale,
    utile_perdita_esercizio: bilData.utile_perdita_esercizio,
    fondi_rischi: bilData.fondi_rischi,
    tfr: bilData.tfr,
    debiti_banche_breve: bilData.debiti_banche_breve,
    debiti_altri_finanziatori: bilData.debiti_altri_finanziatori,
    debiti_fornitori: bilData.debiti_fornitori,
    debiti_tributari: bilData.debiti_tributari,
    totale_debiti: bilData.totale_debiti,
    ricavi_vendite: bilData.ricavi_vendite,
    totale_valore_produzione: bilData.totale_valore_produzione,
    costi_materie: bilData.costi_materie,
    costi_servizi: bilData.costi_servizi,
    costo_personale: bilData.costo_personale,
    ammortamenti: bilData.ammortamenti,
    totale_costi_produzione: bilData.totale_costi_produzione,
    differenza_ab: bilData.differenza_ab,
    proventi_partecipazioni: bilData.proventi_partecipazioni,
    interessi_passivi: bilData.interessi_passivi,
    risultato_ante_imposte: bilData.risultato_ante_imposte,
    imposte: bilData.imposte,
    utile_netto: bilData.utile_netto,
    kpi,
    is_holding,
    formato_rilevato: bilData.formato_rilevato,
  };

  const upsertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bilanci_kpi?on_conflict=practice_id,anno_esercizio`,
    {
      method: 'POST',
      headers: {
        'apikey': SERVICE_ROLE,
        'Authorization': `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(row),
    }
  );

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    return fail('Errore salvataggio DB: ' + err);
  }

  const saved = await upsertRes.json();
  return ok({ bilancio_id: saved?.[0]?.id, anno: bilData.anno_esercizio, ragione_sociale: bilData.ragione_sociale, kpi, is_holding });
});
