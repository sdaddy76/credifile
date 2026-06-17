/* @section: analizza-visura-api */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const config = { maxDuration: 60 };

function supa(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    ...opts,
  });
}

// ── Storico amministratori ─────────────────────────────────────────────────
function parseAmministratori(text) {
  const result = [];
  const blockMatch = text.match(/(?:ORGANO\s+(?:AMMIN\w*|GESTIONE)|CARICHE\s+SOCIALI|RAPPRESENTANZA)([\s\S]{0,8000}?)(?:SOCI\b|TITOLARI\b|QUOTA\b|CAPITALE\b|SEDI\b|UFFICI\b|ATTIVIT)/i);
  const block = blockMatch ? blockMatch[1] : text.substring(0, 6000);
  const cariche = ['PRESIDENTE','AMMINISTRATORE DELEGATO','AMMINISTRATORE UNICO','CONSIGLIERE','LIQUIDATORE','DIRETTORE GENERALE','PROCURATORE','LEGALE RAPPRESENTANTE','SINDACO','REVISORE'];
  const caricaRe = new RegExp(`(${cariche.map(c=>c.replace(/\./g,'\\.')).join('|')})[^A-Z\\n]{0,40}?([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\\s\'\\-]{4,45})`, 'gi');
  for (const m of [...block.matchAll(caricaRe)]) {
    const line = block.substring(Math.max(0,m.index-10), m.index+m[0].length+80);
    const dates = [...line.matchAll(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/g)];
    const isCessato = /cessato|dimissioni|revocato|scaduto|cessaz/i.test(line);
    result.push({ carica: m[1].trim().toUpperCase(), nome: m[2].trim(), data_inizio: dates[0]?.[1]??null, data_fine: dates[1]?.[1]??(isCessato?(dates[0]?.[1]??'sconosciuta'):null), cessato: isCessato });
  }
  return result;
}

// ── Storico soci ───────────────────────────────────────────────────────────
function parseSoci(text) {
  const result = [];
  const blockMatch = text.match(/(?:SOCI\b|TITOLARI\s+(?:DIRITTI|QUOTE)|COMPAGINE\s+SOCIETARIA)([\s\S]{0,5000}?)(?:ORGANO\b|CARICHE\b|SEDE\b|ATTIVIT|UFFICI\b)/i);
  const block = blockMatch ? blockMatch[1] : '';
  if (!block) return result;
  for (const line of block.split(/[\n\r]+/)) {
    const clean = line.replace(/\s{2,}/g,' ').trim();
    if (clean.length < 8) continue;
    const pct = clean.match(/(\d{1,3}(?:[,\.]\d+)?)\s*%/);
    const date = clean.match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/);
    const nome = clean.match(/^([A-ZÀÈÉÌÒÙ][A-ZÀÈÉÌÒÙ\s\'\.]{4,50}?)(?:\s+EUR|\s+\d|\s*\|)/i);
    if (pct || nome) result.push({ nome: nome?.[1]?.trim()??'N/D', percentuale: pct?parseFloat(pct[1].replace(',','.')):null, data_variazione: date?.[1]??null });
  }
  return result;
}

// ── Storico sedi ──────────────────────────────────────────────────────────
function parseSedi(text) {
  const raw = [];
  for (const m of [...text.matchAll(/SEDE\s+LEGALE[:\s]+([^\n\r]{10,120})(?:[^\n\r]{0,60}(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}))?/gi)])
    raw.push({ indirizzo: m[1].trim(), data_inizio: m[2]??null, tipo: 'sede_legale' });
  for (const m of [...text.matchAll(/(?:VARIAZIONE|TRASFERIMENTO)\s+(?:DI\s+)?SEDE[:\s]+([^\n\r]{10,120})(?:[^\n\r]{0,60}(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4}))?/gi)])
    raw.push({ indirizzo: m[1].trim(), data_inizio: m[2]??null, tipo: 'variazione' });
  // Deduplicazione: "SEDE LEGALE" appare molte volte nel testo con lo stesso indirizzo.
  // Manteniamo solo la prima occorrenza per ogni indirizzo normalizzato (primi 50 char).
  const seen = new Set();
  return raw.filter(r => {
    const key = r.indirizzo.toLowerCase().replace(/\s{2,}/g, ' ').trim().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Rami d'azienda ────────────────────────────────────────────────────────
function parseRami(text) {
  const result = [];
  for (const m of [...text.matchAll(/(?:RAMO\s+D['']?AZIENDA|CESSIONE\s+(?:DI\s+)?RAMO|AFFITTO\s+(?:DI\s+)?RAMO|CONFERIMENTO\s+(?:DI\s+)?RAMO)([^\n\r]{0,200})/gi)]) {
    const date = m[1].match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/);
    result.push({ descrizione: m[0].substring(0,120).trim(), data: date?.[1]??null });
  }
  return result;
}

// ── Anagrafica ────────────────────────────────────────────────────────────
function parseAnagrafica(text) {
  const r = {};
  const cost = text.match(/(?:DATA\s+(?:DI\s+)?COSTITUZIONE|COSTITUITA\s+IL|ISCRITTA\s+IL)[:\s]+(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/i);
  if (cost) r.data_costituzione = cost[1];
  const forma = text.match(/(?:NATURA\s+GIURIDICA|FORMA\s+GIURIDICA|TIPO\s+(?:DI\s+)?IMPRESA)[:\s]+([^\n\r]{5,60})/i)
             || text.match(/\b(S\.R\.L\.S?\.|S\.P\.A\.|S\.A\.S\.|S\.N\.C\.|SOCI[EÀ]+\s+A\s+RESPONSABILIT[AÀ]+\s+LIMITATA|SOCI[EÀ]+\s+PER\s+AZIONI)\b/i);
  if (forma) r.forma_giuridica = forma[1]?.trim()??forma[0]?.trim();
  const cap = text.match(/CAPITALE\s+SOCIALE[:\s]+(?:EURO\s+|EUR\s+|€\s*)?(\d[\d\.,]+)/i);
  if (cap) r.capitale_sociale = parseFloat(cap[1].replace(/\./g,'').replace(',','.'));
  const ateco = text.match(/(?:CODICE\s+)?ATECO\s*[:\s]+(\d{2}(?:[\.\/]\d{2}(?:[\.\/]\d{1,2})?)?)/i);
  if (ateco) r.codice_ateco = ateco[1];
  const att = text.match(/(?:OGGETTO\s+SOCIALE|ATTIVIT[AÀ]+\s+PREVALENTE|DESCRIZIONE\s+ATTIVIT[AÀ]+)[:\s]+([^\n\r]{10,200})/i);
  if (att) r.ateco_descrizione = att[1].trim().substring(0,200);
  return r;
}

// ── Segnali strutturali ───────────────────────────────────────────────────
function generaSegnali(amm, soci, sedi, rami) {
  const s = [];
  const cessati = amm.filter(a => a.cessato);
  if (cessati.length >= 3) s.push({ tipo:'warning', categoria:'Governance', titolo:'Cambi frequenti di amministratori', descrizione:`${cessati.length} cessazioni di cariche rilevate. Possibile instabilità gestionale.`, peso:-15 });
  else if (cessati.length === 2) s.push({ tipo:'attenzione', categoria:'Governance', titolo:'Variazioni nel management', descrizione:'2 variazioni di cariche rilevate. Da monitorare nel tempo.', peso:-5 });
  if (sedi.length > 2) s.push({ tipo:'warning', categoria:'Stabilità', titolo:'Multiple variazioni di sede legale', descrizione:`${sedi.length} variazioni di sede. Possibile instabilità operativa.`, peso:-8 });
  else if (sedi.length === 2) s.push({ tipo:'info', categoria:'Stabilità', titolo:'Trasferimento sede legale', descrizione:'Rilevato un trasferimento della sede legale.', peso:0 });
  if (rami.length > 0) s.push({ tipo: rami.length>1?'warning':'info', categoria:'Struttura aziendale', titolo:rami.length>1?'Multipli passaggi di rami d\'azienda':'Passaggio di ramo d\'azienda', descrizione:`${rami.length} passaggi di ramo d'azienda rilevati. Verificare continuità operativa e integrità del business.`, peso:rami.length>1?-10:-3 });
  const sociConDate = soci.filter(s => s.data_variazione);
  if (sociConDate.length > 2) s.push({ tipo:'warning', categoria:'Governance', titolo:'Frequenti variazioni compagine societaria', descrizione:`${sociConDate.length} variazioni di soci/quote nel periodo. Verificare continuità dell'assetto proprietario.`, peso:-8 });
  if (cessati.length === 0 && sedi.length <= 1 && rami.length === 0) s.push({ tipo:'positivo', categoria:'Governance', titolo:'Governance stabile', descrizione:'Nessun cambio di amministratori, sede o passaggio di rami d\'azienda rilevato.', peso:8 });
  return s;
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k,v]) => res.setHeader(k,v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { practice_id, visura_testo } = req.body;
    if (!practice_id) return res.status(400).json({ error: 'practice_id obbligatorio' });
    if (!visura_testo || visura_testo.trim().length < 50) return res.status(400).json({ error: 'Testo visura assente o troppo breve' });

    const praticaRes = await supa(`practices?id=eq.${encodeURIComponent(practice_id)}&select=client_id`);
    const pratica = (await praticaRes.json())?.[0];
    if (!pratica?.client_id) return res.status(404).json({ error: 'Pratica non trovata' });

    const testo = visura_testo;
    const amm = parseAmministratori(testo);
    const soci = parseSoci(testo);
    const sedi = parseSedi(testo);
    const rami = parseRami(testo);
    const anagrafica = parseAnagrafica(testo);
    const segnali = generaSegnali(amm, soci, sedi, rami);

    const visuraJson = { storico_amministratori:amm, storico_soci:soci, storico_sedi:sedi, passaggi_rami:rami, segnali_strutturali:segnali, anagrafica, data_analisi:new Date().toISOString(), caratteri_analizzati:testo.length };

    const updatePayload = { visura_json: visuraJson };
    if (anagrafica.forma_giuridica)   updatePayload.forma_giuridica   = anagrafica.forma_giuridica;
    if (anagrafica.capitale_sociale)  updatePayload.capitale_sociale  = anagrafica.capitale_sociale;
    if (anagrafica.codice_ateco)      updatePayload.codice_ateco      = anagrafica.codice_ateco;
    if (anagrafica.ateco_descrizione) updatePayload.ateco_descrizione = anagrafica.ateco_descrizione;
    if (anagrafica.data_costituzione) {
      const p = anagrafica.data_costituzione.split(/[\/\-\.]/);
      if (p.length === 3) updatePayload.data_costituzione = `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    }

    await supa(`clients?id=eq.${encodeURIComponent(pratica.client_id)}`, { method:'PATCH', body:JSON.stringify(updatePayload) });

    return res.status(200).json({
      success: true, client_id: pratica.client_id,
      sommario: { amministratori_totali:amm.length, amministratori_cessati:amm.filter(a=>a.cessato).length, soci_trovati:soci.length, variazioni_sede:sedi.length, rami_azienda:rami.length, segnali_warning:segnali.filter(s=>s.tipo==='warning').length, segnali_positivi:segnali.filter(s=>s.tipo==='positivo').length, anagrafica },
      visura_json: visuraJson,
    });
  } catch(err) {
    console.error('[analizza-visura]', err);
    return res.status(500).json({ error: err.message??'Errore interno' });
  }
}
