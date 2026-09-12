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
export function parseSedi(text) {
  const lines = String(text ?? '').split(/[\n\r]+/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const currentAddresses = [];
  const variations = [];
  const transferSummary = text.match(/\bTrasferimenti\s+di\s+sede\s*[:\-]?\s*(\d+)\b/i);
  const explicitTransferCount = transferSummary ? Number.parseInt(transferSummary[1], 10) : null;
  const addressPattern = /\b(?:VIA|VIALE|PIAZZA|PIAZZALE|CORSO|STRADA|LOCALIT[AÀ]|FRAZIONE|CAP)\b|[A-ZÀ-Ù]{2,}\s*\([A-Z]{2}\)/i;

  const addCurrentAddress = (rawAddress, date = null) => {
    const address = String(rawAddress ?? '')
      .replace(/\s+(?:Domicilio\s+digitale|PEC|Partita\s+IVA|Numero\s+REA).*$/i, '')
      .trim();
    if (address.length < 5 || !addressPattern.test(address)) return;

    const normalized = address.toLocaleLowerCase('it-IT').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const relatedIndex = currentAddresses.findIndex(candidate => {
      const candidateNormalized = candidate.indirizzo.toLocaleLowerCase('it-IT').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      return candidateNormalized.startsWith(normalized) || normalized.startsWith(candidateNormalized);
    });
    const record = { indirizzo: address, data_inizio: date, tipo: 'sede_legale' };
    if (relatedIndex === -1) {
      currentAddresses.push(record);
    } else if (address.length > currentAddresses[relatedIndex].indirizzo.length) {
      currentAddresses[relatedIndex] = record;
    }
  };

  for (const line of lines) {
    const currentMatch = line.match(/^(?:Indirizzo\s+)?Sede\s+legale(?:\s*[:\-])?\s+(.{5,180})$/i);
    if (currentMatch) {
      const date = currentMatch[1].match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/)?.[1] ?? null;
      addCurrentAddress(currentMatch[1], date);
      continue;
    }

    const variationMatch = line.match(/^(?:Variazione|Trasferimento)\s+(?:della\s+|di\s+)?sede(?:\s+legale)?(?:\s*[:\-])?\s+(.{5,180})$/i);
    if (!variationMatch || /^trasferimenti\s+di\s+sede\b/i.test(line)) continue;
    const date = variationMatch[1].match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/)?.[1] ?? null;
    const address = variationMatch[1].trim();
    if (addressPattern.test(address)) variations.push({ indirizzo: address, data_inizio: date, tipo: 'variazione' });
  }

  const uniqueVariations = variations.filter((record, index, list) => {
    const key = `${record.indirizzo.toLocaleLowerCase('it-IT').replace(/\s+/g, ' ').trim()}|${record.data_inizio ?? ''}`;
    return list.findIndex(candidate =>
      `${candidate.indirizzo.toLocaleLowerCase('it-IT').replace(/\s+/g, ' ').trim()}|${candidate.data_inizio ?? ''}` === key
    ) === index;
  });

  return {
    sedi: [...currentAddresses, ...uniqueVariations],
    trasferimentiSede: Number.isInteger(explicitTransferCount) ? explicitTransferCount : uniqueVariations.length,
  };
}

// ── Rami d'azienda ────────────────────────────────────────────────────────
export function parseRami(text) {
  const source = String(text ?? '');
  const sectionHeadings = [...source.matchAll(/(?:^|\n)\s*(?:6\s+)?Trasferimenti\s+d['’]azienda(?:,\s*fusioni,\s*scissioni,\s*subentri)?[^\n]*/gim)];
  let section = source;
  const lastHeading = sectionHeadings.at(-1);
  if (lastHeading?.index !== undefined) {
    const start = lastHeading.index + lastHeading[0].length;
    const tail = source.slice(start);
    const nextSection = tail.search(/\n\s*(?:7\s+)?Attivit[aà](?:,|\s|$)/i);
    section = nextSection >= 0 ? tail.slice(0, nextSection) : tail;
  }

  const acts = [];
  const actPattern = /\b(compravendita|cessione\s+di\s+ramo(?:\s+di(?:\s+azienda)?)?|affitto\s+(?:di\s+)?ramo(?:\s+d['’]azienda)?|conferimento\s+(?:di\s+)?ramo(?:\s+d['’]azienda)?)\b[^\n\r]{0,240}/gi;
  for (const match of section.matchAll(actPattern)) {
    const rawType = match[1].toLocaleLowerCase('it-IT');
    const date = match[0].match(/(\d{2}[\/\-\.]\d{2}[\/\-\.]\d{4})/)?.[1] ?? null;
    const tipo = rawType.startsWith('compravendita')
      ? 'Compravendita d’azienda'
      : rawType.startsWith('cessione')
        ? 'Cessione di ramo d’azienda'
        : rawType.startsWith('affitto')
          ? 'Affitto di ramo d’azienda'
          : 'Conferimento di ramo d’azienda';
    const description = match[0].replace(/\s+/g, ' ').trim().substring(0, 180);
    const key = `${tipo}|${date ?? description.toLocaleLowerCase('it-IT')}`;
    if (!acts.some(act => act.key === key)) acts.push({ key, tipo, descrizione: description, data: date });
  }

  return acts.map(({ key: _key, ...act }) => act);
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
export function generaSegnali(amm, soci, sedi, rami, trasferimentiSede = null) {
  const s = [];
  const cessati = amm.filter(a => a.cessato);
  const variazioniSede = Number.isInteger(trasferimentiSede)
    ? trasferimentiSede
    : sedi.filter(sede => sede.tipo === 'variazione').length;
  if (cessati.length >= 3) s.push({ tipo:'warning', categoria:'Governance', titolo:'Cambi frequenti di amministratori', descrizione:`${cessati.length} cessazioni di cariche rilevate. Possibile instabilità gestionale.`, peso:-15 });
  else if (cessati.length === 2) s.push({ tipo:'attenzione', categoria:'Governance', titolo:'Variazioni nel management', descrizione:'2 variazioni di cariche rilevate. Da monitorare nel tempo.', peso:-5 });
  if (variazioniSede >= 2) s.push({ tipo:'warning', categoria:'Stabilità', titolo:'Multiple variazioni di sede legale', descrizione:`${variazioniSede} variazioni di sede rilevate. Possibile instabilità operativa.`, peso:-8 });
  else if (variazioniSede === 1) s.push({ tipo:'info', categoria:'Stabilità', titolo:'Trasferimento sede legale', descrizione:'Rilevato un trasferimento della sede legale.', peso:0 });
  if (rami.length > 0) s.push({ tipo: rami.length>1?'warning':'info', categoria:'Struttura aziendale', titolo:rami.length>1?'Multipli passaggi di rami d\'azienda':'Passaggio di ramo d\'azienda', descrizione:`${rami.length} passaggi di ramo d'azienda rilevati. Verificare continuità operativa e integrità del business.`, peso:rami.length>1?-10:-3 });
  const sociConDate = soci.filter(s => s.data_variazione);
  if (sociConDate.length > 2) s.push({ tipo:'warning', categoria:'Governance', titolo:'Frequenti variazioni compagine societaria', descrizione:`${sociConDate.length} variazioni di soci/quote nel periodo. Verificare continuità dell'assetto proprietario.`, peso:-8 });
  if (cessati.length === 0 && variazioniSede === 0 && rami.length === 0) s.push({ tipo:'positivo', categoria:'Governance', titolo:'Governance stabile', descrizione:'Nessun cambio di amministratori, sede o passaggio di rami d\'azienda rilevato.', peso:8 });
  return s;
}

function getStructuralSignalId(signal) {
  return [signal?.tipo, signal?.categoria, signal?.titolo, signal?.descrizione]
    .map(value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it-IT').trim())
    .join('|');
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
    const sedeAnalysis = parseSedi(testo);
    const sedi = sedeAnalysis.sedi;
    const trasferimentiSede = sedeAnalysis.trasferimentiSede;
    const rami = parseRami(testo);
    const anagrafica = parseAnagrafica(testo);
    const segnali = generaSegnali(amm, soci, sedi, rami, trasferimentiSede);

    const currentClientRes = await supa(`clients?id=eq.${encodeURIComponent(pratica.client_id)}&select=visura_json`);
    const currentClient = (await currentClientRes.json())?.[0];
    const previousExclusions = Array.isArray(currentClient?.visura_json?.excluded_from_bank_email)
      ? currentClient.visura_json.excluded_from_bank_email.filter(value => typeof value === 'string')
      : [];
    const currentSignalIds = new Set(segnali.map(getStructuralSignalId));
    const preservedExclusions = previousExclusions.filter(value => currentSignalIds.has(value));
    const visuraJson = {
      storico_amministratori: amm,
      storico_soci: soci,
      storico_sedi: sedi,
      trasferimenti_sede: trasferimentiSede,
      passaggi_rami: rami,
      segnali_strutturali: segnali,
      excluded_from_bank_email: preservedExclusions,
      anagrafica,
      data_analisi: new Date().toISOString(),
      caratteri_analizzati: testo.length,
    };

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
      sommario: { amministratori_totali:amm.length, amministratori_cessati:amm.filter(a=>a.cessato).length, soci_trovati:soci.length, variazioni_sede:trasferimentiSede, rami_azienda:rami.length, segnali_warning:segnali.filter(s=>s.tipo==='warning').length, segnali_positivi:segnali.filter(s=>s.tipo==='positivo').length, anagrafica },
      visura_json: visuraJson,
    });
  } catch(err) {
    console.error('[analizza-visura]', err);
    return res.status(500).json({ error: err.message??'Errore interno' });
  }
}
