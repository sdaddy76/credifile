// Vercel Serverless Function — Invia pratica alla banca via Resend
// Sostituisce la Supabase Edge Function send-to-bank (BOOT_ERROR sul progetto fhieppjqlefdlanvrpik)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM         = process.env.FROM_EMAIL   || 'Credifile <docflow@stedasrls.it>';
const APP          = process.env.APP_URL      || 'https://credifile-eosin.vercel.app';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Content-Type': 'application/json',
};

// ── helper colore score ────────────────────────────────────────────────────
function scoreColor(s) {
  if (s == null) return '#888';
  if (s >= 70) return '#16a34a';
  if (s >= 40) return '#d97706';
  return '#dc2626';
}
function scoreLabel(s) {
  if (s == null) return 'N/D';
  if (s >= 70) return 'Buono';
  if (s >= 40) return 'Medio';
  return 'Basso';
}


// ── calcolaScore (replica IndiceBancabilita.tsx) ───────────────────────────
function calcolaScoreNode(valore, ottimo, suff, critica, inverso) {
  if (ottimo === null || suff === null || critica === null) return 50;
  if (!inverso) {
    if (valore >= ottimo) return 100;
    if (valore <= critica) return 0;
    if (valore >= suff) return 55 + ((valore - suff) / (ottimo - suff)) * 45;
    return ((valore - critica) / (suff - critica)) * 55;
  } else {
    if (valore <= ottimo) return 100;
    if (valore >= critica) return 0;
    if (valore <= suff) return 55 + ((suff - valore) / (suff - ottimo)) * 45;
    return ((critica - valore) / (critica - suff)) * 55;
  }
}

// ── helper: estrae KPI "piatti" dal JSON annidato ──────────────────────────
function flattenKpi(kpiJson) {
  if (!kpiJson) return [];
  const rows = [];
  for (const area of Object.values(kpiJson)) {
    if (typeof area !== 'object' || !area) continue;
    for (const entry of Object.values(area)) {
      // Supporta sia entry.value (vecchio) sia entry.valore (nuovo)
      const valoreNum = entry?.valore ?? entry?.value ?? null;
      if (valoreNum == null) continue;
      const formatted = entry?.formatted
        ?? (typeof valoreNum === 'number'
            ? (Number.isInteger(valoreNum) ? String(valoreNum) : valoreNum.toFixed(2))
            : String(valoreNum));
      rows.push({
        label:    entry?.label ?? '—',
        value:    formatted,
        valore:   typeof valoreNum === 'number' ? valoreNum : parseFloat(valoreNum) || null,
        semaforo: entry?.semaforo ?? 'nd',
      });
    }
  }
  return rows; // nessun limite: tutti i KPI
}

// ── commento testuale per singolo KPI ─────────────────────────────────────
function kpiComment(label, valore, semaforo) {
  if (valore === null || semaforo === 'nd') return 'Dato non disponibile.';
  const v = valore;
  switch (label) {
    case 'Current Ratio':
      if (semaforo === 'verde') return v >= 2 ? 'Ottima liquidità a breve termine.' : 'Buona copertura delle passività a breve.';
      if (semaforo === 'giallo') return 'Liquidità sufficiente ma da monitorare.';
      return 'Rischio liquidità: attivo corrente insufficiente.';
    case 'Quick Ratio':
      if (semaforo === 'verde') return 'Buona liquidità senza dipendenza dal magazzino.';
      if (semaforo === 'giallo') return 'Dipendenza dal magazzino per la liquidità.';
      return 'Liquidità immediata critica.';
    case 'Acid Test':
      if (semaforo === 'verde') return 'Eccellente disponibilità di cassa e crediti.';
      if (semaforo === 'giallo') return 'Riserve liquide nel limite minimo.';
      return 'Scarsa liquidità immediata, rischio insolvenza.';
    case 'Debt/Equity':
      if (semaforo === 'verde') return v < 1 ? 'Eccellente indipendenza finanziaria.' : 'Rapporto debito/PN nella norma.';
      if (semaforo === 'giallo') return 'Indebitamento elevato rispetto al patrimonio, monitorare.';
      return 'Eccessivo ricorso al capitale di debito, struttura fragile.';
    case 'Leverage':
      if (semaforo === 'verde') return 'Struttura finanziaria equilibrata, leva contenuta.';
      if (semaforo === 'giallo') return 'Leva finanziaria elevata, prudenza nell\'assumere nuovi debiti.';
      return 'Leva eccessiva, rischio finanziario significativo.';
    case 'PN / Totale Attivo':
      if (semaforo === 'verde') return v > 50 ? 'Solida capitalizzazione aziendale, basso rischio.' : 'Buona autonomia finanziaria.';
      if (semaforo === 'giallo') return 'Autonomia finanziaria da rafforzare con nuovi apporti.';
      return 'Capitalizzazione insufficiente, alta dipendenza da terzi.';
    case 'Grado Indebitamento':
      if (semaforo === 'verde') return 'Bassa esposizione bancaria a breve, situazione fisiologica.';
      if (semaforo === 'giallo') return 'Esposizione bancaria a breve da monitorare.';
      return 'Elevata dipendenza dal credito bancario a breve termine.';
    case 'ROE':
      if (semaforo === 'verde') return v > 15 ? 'Ottima redditività per gli azionisti.' : 'Buona remunerazione del capitale proprio.';
      if (semaforo === 'giallo') return 'Redditività del capitale proprio modesta ma positiva.';
      return 'Rendimento insufficiente per gli investitori.';
    case 'ROI':
      if (semaforo === 'verde') return 'Buon rendimento degli investimenti effettuati.';
      if (semaforo === 'giallo') return 'Rendimento degli asset da migliorare.';
      return 'Scarsa efficienza nell\'utilizzo degli investimenti.';
    case 'ROS':
      if (semaforo === 'verde') return v > 10 ? 'Ottimi margini operativi sulle vendite.' : 'Margine operativo sulle vendite positivo.';
      if (semaforo === 'giallo') return 'Margine di vendita ridotto, pricing o costi da rivedere.';
      return 'Marginalità operativa critica, pressione sui costi elevata.';
    case 'EBITDA Margin':
      if (semaforo === 'verde') return v > 20 ? 'Eccellente capacità di generare cassa operativa.' : 'Buona generazione di cassa dalla gestione corrente.';
      if (semaforo === 'giallo') return 'Capacità di generare cassa al limite minimo accettabile.';
      return 'Cassa operativa insufficiente per sostenere gli investimenti.';
    case 'PFN / EBITDA':
      if (semaforo === 'verde') return v < 1.5 ? 'Debito finanziario netto ripagabile in meno di 2 anni.' : 'Posizione debitoria sostenibile rispetto ai flussi.';
      if (semaforo === 'giallo') return 'Debito elevato rispetto alla capacità di rimborso.';
      return `Debito netto critico (${v.toFixed(1)}× EBITDA), sostenibilità a rischio.`;
    case 'DSO (giorni crediti)':
      if (semaforo === 'verde') return 'Incassi rapidi, ottima gestione del credito commerciale.';
      if (semaforo === 'giallo') return `Tempi di incasso da ridurre (${Math.round(v)} gg medi).`;
      return `Incassi lenti (${Math.round(v)} gg), rischio crediti inesigibili.`;
    case 'Interest Coverage':
      if (semaforo === 'verde') return v > 5 ? 'Eccellente copertura degli oneri finanziari.' : 'Buona capacità di coprire gli interessi passivi.';
      if (semaforo === 'giallo') return 'Copertura interessi nel limite minimo, monitorare.';
      return 'Difficoltà a sostenere il costo del debito finanziario.';
    default:
      if (label.startsWith('DSCR')) {
        if (semaforo === 'verde') return 'Adeguata copertura del servizio del debito (rate + interessi).';
        if (semaforo === 'giallo') return 'Copertura rata finanziamenti al limite, margine ridotto.';
        return 'Copertura rata insufficiente, rischio default su finanziamenti.';
      }
      if (semaforo === 'verde') return 'Valore nella norma, nessuna criticità rilevata.';
      if (semaforo === 'giallo') return 'Valore richiede attenzione e monitoraggio periodico.';
      return 'Valore critico, intervento correttivo raccomandato.';
  }
}

// ── valutazione complessiva testuale ──────────────────────────────────────
function buildGeneralComment(kpiRows, ragioneSociale, annoBilancio) {
  if (!kpiRows || kpiRows.length === 0) return null;
  let verde = 0, giallo = 0, rosso = 0;
  const positivi = [];
  // Descrizioni estese per punti di forza principali
  const FORZA_DESC = {
    'Current Ratio':      'un\'ottima copertura delle obbligazioni a breve termine',
    'Quick Ratio':        'una solida liquidità immediata, indipendente dal magazzino',
    'Acid Test':          'un\'eccellente disponibilità di liquidità pronta',
    'Debt/Equity':        'un\'indipendenza finanziaria dal debito di rilievo',
    'Leverage':           'una leva finanziaria equilibrata e sostenibile',
    'PN / Totale Attivo': 'un\'elevata capitalizzazione patrimoniale',
    'Grado Indebitamento':'una contenuta esposizione bancaria a breve',
    'ROE':                'un\'ottima remunerazione del capitale proprio',
    'ROI':                'un buon rendimento degli investimenti aziendali',
    'ROS':                'solidi margini operativi sulle vendite',
    'EBITDA Margin':      'un\'elevata capacità di generare cassa operativa',
    'PFN / EBITDA':       'un debito finanziario netto ampiamente sostenibile',
    'DSO (giorni crediti)':'tempi di incasso rapidi e una gestione efficiente del credito',
    'Interest Coverage':  'un\'ampia copertura degli oneri finanziari',
  };
  for (const k of kpiRows) {
    if (k.semaforo === 'verde') { verde++; positivi.push(k.label); }
    else if (k.semaforo === 'giallo') giallo++;
    else if (k.semaforo === 'rosso') rosso++;
  }
  const total = verde + giallo + rosso;
  const pct = total > 0 ? Math.round((verde / total) * 100) : 0;
  const nome = ragioneSociale ?? 'L\'azienda';
  const anno = annoBilancio ?? '';

  // Apertura positiva sempre
  let text = `${nome} presenta${anno ? `, con riferimento all\'esercizio ${anno},` : ''} `;

  if (pct >= 70) {
    text += `un profilo finanziario solido e ben strutturato, con ${verde} indicatori su ${total} (${pct}%) in area positiva. `;
    text += `La società dimostra una gestione finanziaria efficace e una struttura patrimoniale robusta, `;
    text += `elementi che la collocano in una posizione favorevole per l\'accesso al credito bancario. `;
  } else if (pct >= 50) {
    text += `un profilo finanziario equilibrato, con ${verde} indicatori su ${total} (${pct}%) in area positiva. `;
    text += `La società mostra una base finanziaria stabile con diversi elementi di solidità `;
    text += `che supportano la fiducia nella sua capacità di far fronte agli impegni finanziari. `;
  } else if (verde > 0) {
    text += `aree di forza significative dal punto di vista finanziario, con ${verde} indicatore${verde > 1 ? 'i' : 'e'} in area positiva su ${total} analizzati. `;
    text += `Nonostante il contesto competitivo, la società esprime punti di solidità rilevanti `;
    text += `che sostengono la valutazione complessiva della pratica. `;
  } else {
    text += `una struttura in fase di consolidamento. La società ha avviato un percorso di rafforzamento `;
    text += `patrimoniale e finanziario che si prevede porterà a miglioramenti progressivi degli indicatori. `;
  }

  // Punti di forza specifici (max 4, con descrizione estesa)
  if (positivi.length > 0) {
    const top = positivi.slice(0, 4);
    const descrList = top.map(l => FORZA_DESC[l] ? `${l} (${FORZA_DESC[l]})` : l);
    text += `In particolare, si evidenziano: ${descrList.join('; ')}. `;
  }

  // Chiusura sempre orientata al credito
  if (pct >= 70) {
    text += `Il posizionamento complessivo della società è pienamente coerente con un\'operazione di finanziamento, con rischio contenuto e buone prospettive di rimborso.`;
  } else if (pct >= 50) {
    text += `La valutazione complessiva è positiva e supporta la presentazione della pratica di finanziamento.`;
  } else if (verde > 0) {
    text += `Gli elementi positivi rilevati sostengono la valutazione della pratica e la disponibilità al dialogo con l\'istituto bancario.`;
  } else {
    text += `Si rimanda alla documentazione allegata per un quadro completo della situazione aziendale e delle prospettive di sviluppo.`;
  }

  return text;
}

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // Imposta header CORS su ogni risposta
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { practice_id, bank_id, note } = req.body;
    if (!practice_id || !bank_id) {
      return res.status(400).json({ success: false, error: 'practice_id e bank_id obbligatori' });
    }

    const H = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation',
    };

    // 1+2+3a. Pratica, banca e lista file in parallelo
    const [praticaArr, pbArr, filesRaw] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/practices?id=eq.${encodeURIComponent(practice_id)}&select=*,clients(id,ragione_sociale,codice_fiscale),agent:admin_profiles!practices_assigned_to_fkey(id,nome,email)&limit=1`,
        { headers: H },
      ).then(r => r.json()),
      fetch(
        `${SUPABASE_URL}/rest/v1/practice_banks?practice_id=eq.${encodeURIComponent(practice_id)}&bank_id=eq.${encodeURIComponent(bank_id)}&select=*,banks(nome,email,email_invio_banca,email_cc,email_bcc)&limit=1`,
        { headers: H },
      ).then(r => r.json()),
      fetch(
        `${SUPABASE_URL}/rest/v1/uploaded_files?practice_id=eq.${encodeURIComponent(practice_id)}&select=id,nome_file,storage_path,practice_documents(nome,status)&order=created_at.asc`,
        { headers: H },
      ).then(r => r.json()).catch(() => []),
    ]);

    const pratica = Array.isArray(praticaArr) ? praticaArr[0] : null;
    if (!pratica) return res.status(404).json({ success: false, error: 'Pratica non trovata' });

    const clientId   = pratica.clients?.id;
    const agentEmail = pratica.agent?.email ?? null;
    const agentNome  = pratica.agent?.nome  ?? null;

    const pb = Array.isArray(pbArr) ? pbArr[0] : null;
    if (!pb) return res.status(404).json({ success: false, error: 'Assegnazione banca non trovata' });

    const bankEmail = pb.banks?.email_invio_banca || pb.banks?.email;
    if (!bankEmail) return res.status(422).json({ success: false, error: 'Email banca non configurata' });

    // Destinatari CC e BCC (salvati come stringa separata da virgola)
    const ccList  = (pb.banks?.email_cc  || '').split(',').map(e => e.trim()).filter(Boolean);
    const bccList = (pb.banks?.email_bcc || '').split(',').map(e => e.trim()).filter(Boolean);

    // 3b. URL firmati in parallelo (tutti i file contemporaneamente)
    const files = Array.isArray(filesRaw) ? filesRaw : [];
    const signResults = await Promise.all(
      files
        .filter(f => !!f.storage_path)
        .map(async f => {
          const encodedPath = f.storage_path.split('/').map(s => encodeURIComponent(s)).join('/');
          try {
            const signRes = await fetch(
              `${SUPABASE_URL}/storage/v1/object/sign/practice-files/${encodedPath}`,
              { method: 'POST', headers: H, body: JSON.stringify({ expiresIn: 315360000 }) },
            );
            if (!signRes.ok) return null;
            const signData = await signRes.json();
            let url = signData?.signedUrl ?? null;
            if (!url && signData?.signedURL) url = `${SUPABASE_URL}/storage/v1${signData.signedURL}`;
            if (!url) return null;
            return { nomeDoc: f.practice_documents?.nome ?? f.nome_file, nomeFile: f.nome_file, url };
          } catch { return null; }
        }),
    );
    const docLinks = signResults.filter(Boolean);

    // 4. KPI finanziari (bilancio più recente per la pratica)
    let kpiRows = [];
    let annoBilancio = null;
    {
      const kpiArr = await fetch(
        `${SUPABASE_URL}/rest/v1/bilanci_kpi?practice_id=eq.${encodeURIComponent(practice_id)}&select=anno_esercizio,kpi&order=anno_esercizio.desc&limit=1`,
        { headers: H },
      ).then(r => r.json()).catch(() => []);
      if (kpiArr?.[0]) {
        annoBilancio = kpiArr[0].anno_esercizio;
        kpiRows = flattenKpi(kpiArr[0].kpi);
      }
    }

    // 5. Score reputazione (analisi più recente per pratica)
    let rep = null;
    {
      const repArr = await fetch(
        `${SUPABASE_URL}/rest/v1/reputational_analyses?practice_id=eq.${encodeURIComponent(practice_id)}&select=score_globale,score_societa,score_amm,score_soci&order=created_at.desc&limit=1`,
        { headers: H },
      ).then(r => r.json()).catch(() => []);
      if (Array.isArray(repArr) && repArr[0]) rep = repArr[0];
    }

    // 6. Indice bancabilità — pesi default (banca_id IS NULL) + override banca specifica + KPI pratica
    let bancabScore = null;
    try {
      const [pesiDefault, pesiOverride, kpiLatest] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/bancabilita_pesi?banca_id=is.null&attivo=eq.true&select=kpi_key,kpi_area,peso,soglia_ottimo,soglia_suff,soglia_critica,inverso`, { headers: H }).then(r => r.json()),
        fetch(`${SUPABASE_URL}/rest/v1/bancabilita_pesi?banca_id=eq.${encodeURIComponent(bank_id)}&attivo=eq.true&select=kpi_key,kpi_area,peso,soglia_ottimo,soglia_suff,soglia_critica,inverso`, { headers: H }).then(r => r.json()),
        fetch(`${SUPABASE_URL}/rest/v1/bilanci_kpi?practice_id=eq.${encodeURIComponent(practice_id)}&select=kpi&order=anno_esercizio.desc&limit=1`, { headers: H }).then(r => r.json()),
      ]);
      // Merge: override banca ha priorità sui default per lo stesso kpi_key
      const defaults  = Array.isArray(pesiDefault)  ? pesiDefault  : [];
      const overrides = Array.isArray(pesiOverride) ? pesiOverride : [];
      const merged = defaults.map(d => overrides.find(o => o.kpi_key === d.kpi_key) ?? d);
      for (const o of overrides) { if (!merged.find(m => m.kpi_key === o.kpi_key)) merged.push(o); }
      const pesi   = merged.filter(p => (p.peso ?? 0) > 0);
      const kpiObj = (Array.isArray(kpiLatest) && kpiLatest[0]?.kpi) ? kpiLatest[0].kpi : null;
      if (pesi.length > 0 && kpiObj) {
        let pesoPonderato = 0, sommaScore = 0;
        for (const p of pesi) {
          const entry  = kpiObj[p.kpi_area]?.[p.kpi_key];
          const valore = entry?.valore ?? entry?.value ?? null;
          if (valore == null) continue;
          const num = typeof valore === 'number' ? valore : parseFloat(valore);
          if (isNaN(num)) continue;
          const s = calcolaScoreNode(num, p.soglia_ottimo, p.soglia_suff, p.soglia_critica, !!p.inverso);
          sommaScore    += s * (p.peso ?? 1);
          pesoPonderato += (p.peso ?? 1);
        }
        if (pesoPonderato > 0) bancabScore = Math.round(sommaScore / pesoPonderato);
      }
    } catch { /* ignora errori bancabilità */ }

    // 6b. Finanziamenti in corso
    let financing = [];
    if (clientId || practice_id) {
      financing = await fetch(
        `${SUPABASE_URL}/rest/v1/client_financing?practice_id=eq.${encodeURIComponent(practice_id)}&select=tipologia,banca_finanziaria,importo_iniziale,rata,durata_mesi,debito_residuo,tipo_garanzia,stato_rapporto&order=ordinamento.asc`,
        { headers: H },
      ).then(r => r.json()).catch(() => []) ?? [];
    }

    // ── 7. Componi HTML email ─────────────────────────────────────────────
    const cliente  = pratica.clients?.ragione_sociale ?? pratica.clients?.codice_fiscale ?? 'N/D';
    const notaHtml = note ? `<p style="color:#555;margin-top:12px;"><strong>Note:</strong> ${note}</p>` : '';

    const docsHtml = docLinks.length > 0
      ? docLinks.map(d =>
          `<li style="margin:8px 0;">` +
          `<a href="${d.url}" style="color:#2563eb;font-weight:600;">${d.nomeDoc}</a>` +
          ` <span style="color:#888;font-size:11px;">(${d.nomeFile})</span>` +
          `</li>`,
        ).join('')
      : '<li style="color:#888;">Nessun documento disponibile al momento</li>';

    // Solo KPI verdi (positivi) per l'email alla banca
    const kpiVerdi = kpiRows.filter(k => k.semaforo === 'verde');

    const kpiSection = kpiVerdi.length > 0 ? `
<h3 style="color:#1e3a5f;margin-top:28px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
  ✅ Punti di Forza — Indicatori Positivi${annoBilancio ? ` (Bilancio ${annoBilancio})` : ''}
</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
  <thead>
    <tr style="background:#f0fdf4;">
      <th style="text-align:left;padding:7px 10px;color:#166534;font-weight:600;border-bottom:1px solid #bbf7d0;">Indicatore</th>
      <th style="text-align:right;padding:7px 10px;color:#166534;font-weight:600;border-bottom:1px solid #bbf7d0;white-space:nowrap;">Valore</th>
      <th style="text-align:left;padding:7px 10px;color:#166534;font-weight:600;border-bottom:1px solid #bbf7d0;">Commento</th>
    </tr>
  </thead>
  <tbody>
    ${kpiVerdi.map((k, i) => {
      const comment = kpiComment(k.label, k.valore, k.semaforo);
      return `<tr style="background:${i % 2 === 0 ? '#fff' : '#f0fdf4'};">` +
        `<td style="padding:6px 10px;color:#374151;font-weight:500;">${k.label}</td>` +
        `<td style="padding:6px 10px;text-align:right;font-weight:700;color:#16a34a;white-space:nowrap;">● ${k.value}</td>` +
        `<td style="padding:6px 10px;color:#4b5563;font-style:italic;font-size:12px;">${comment}</td>` +
        `</tr>`;
    }).join('')}
  </tbody>
</table>` : '';

    const generalComment = buildGeneralComment(kpiRows, pratica.clients?.ragione_sociale, annoBilancio);
    const generalSection = generalComment ? `
<h3 style="color:#1e3a5f;margin-top:28px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
  📝 Valutazione Complessiva
</h3>
<div style="background:#f8fafc;border-left:4px solid #1e3a5f;border-radius:4px;padding:14px 16px;margin-top:8px;font-size:13px;color:#374151;line-height:1.6;">
  ${generalComment}
</div>` : '';


    // Sezione finanziamenti
    const finSection = financing.length > 0 ? `
<h3 style="color:#1e3a5f;margin-top:28px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
  💳 Finanziamenti in Corso (${financing.length})
</h3>
<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">
  <thead>
    <tr style="background:#f1f5f9;">
      <th style="text-align:left;padding:6px 8px;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">Tipologia</th>
      <th style="text-align:left;padding:6px 8px;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">Banca/Istituto</th>
      <th style="text-align:right;padding:6px 8px;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">Importo €</th>
      <th style="text-align:right;padding:6px 8px;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">Rata €</th>
      <th style="text-align:right;padding:6px 8px;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">Debito Res. €</th>
      <th style="text-align:left;padding:6px 8px;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">Garanzia</th>
    </tr>
  </thead>
  <tbody>
    ${financing.map((f, i) =>
      `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'};">` +
      `<td style="padding:5px 8px;color:#374151;">${f.tipologia || '—'}</td>` +
      `<td style="padding:5px 8px;color:#374151;">${f.banca_finanziaria || '—'}</td>` +
      `<td style="padding:5px 8px;text-align:right;font-weight:600;color:#1e3a5f;">${f.importo_iniziale != null ? Number(f.importo_iniziale).toLocaleString('it-IT') : '—'}</td>` +
      `<td style="padding:5px 8px;text-align:right;color:#374151;">${f.rata != null ? Number(f.rata).toLocaleString('it-IT') : '—'}</td>` +
      `<td style="padding:5px 8px;text-align:right;color:#374151;">${f.debito_residuo != null ? Number(f.debito_residuo).toLocaleString('it-IT') : '—'}</td>` +
      `<td style="padding:5px 8px;color:#374151;">${f.tipo_garanzia || '—'}</td>` +
      `</tr>`
    ).join('')}
  </tbody>
</table>` : '';

    const bancabSection = `
<h3 style="color:#1e3a5f;margin-top:28px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
  🏦 Indice di Bancabilità
</h3>
<div style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 24px;margin-top:8px;text-align:center;">
  ${bancabScore != null
    ? `<div style="font-size:36px;font-weight:800;color:${scoreColor(bancabScore)};">${bancabScore.toFixed(0)}<span style="font-size:16px;color:#64748b;">/100</span></div>
       <div style="font-size:13px;font-weight:600;color:${scoreColor(bancabScore)};margin-top:2px;">${scoreLabel(bancabScore)}</div>`
    : `<div style="font-size:18px;color:#94a3b8;font-weight:500;">Non calcolato</div>`
  }
</div>`;

    const repSection = rep ? `
<h3 style="color:#1e3a5f;margin-top:28px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
  🔎 Score Reputazione
</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
  <thead>
    <tr style="background:#f1f5f9;">
      <th style="text-align:left;padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">Dimensione</th>
      <th style="text-align:center;padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">Score</th>
      <th style="text-align:center;padding:7px 10px;color:#475569;border-bottom:1px solid #e2e8f0;">Giudizio</th>
    </tr>
  </thead>
  <tbody>
    ${[
      { label: 'Score Globale',  s: rep.score_globale },
      { label: 'Società',        s: rep.score_societa },
      { label: 'Amministratori', s: rep.score_amm },
      { label: 'Soci',           s: rep.score_soci },
    ].map((r, i) =>
      `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'};">` +
      `<td style="padding:6px 10px;color:#374151;">${r.label}</td>` +
      `<td style="padding:6px 10px;text-align:center;font-weight:700;color:${scoreColor(r.s)};">${r.s != null ? Number(r.s).toFixed(0) + '/100' : 'N/D'}</td>` +
      `<td style="padding:6px 10px;text-align:center;font-size:12px;color:${scoreColor(r.s)};">${scoreLabel(r.s)}</td>` +
      `</tr>`,
    ).join('')}
  </tbody>
</table>` : '';

    const htmlBody = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:650px;margin:auto;padding:24px;color:#1e293b;">
<div style="border-bottom:3px solid #1e3a5f;padding-bottom:12px;margin-bottom:20px;">
  <h2 style="color:#1e3a5f;margin:0;">Credifile — Pratica inviata</h2>
</div>
<p>Gentile <strong>${pb.banks?.nome}</strong>,</p>
<p>Le trasmettiamo la documentazione relativa alla pratica di <strong>${cliente}</strong>
(rif. <code>${pratica.numero_pratica}</code>).</p>
${notaHtml}
<h3 style="color:#1e3a5f;margin-top:24px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
  📎 Documenti allegati (${docLinks.length})
</h3>
<ul style="padding-left:20px;">${docsHtml}</ul>
${kpiSection}
${generalSection}
${finSection}
${bancabSection}
${repSection}
<div style="margin-top:32px;padding:14px;background:#f8fafc;border-radius:8px;font-size:12px;color:#64748b;border-left:3px solid #1e3a5f;">
  ${agentNome ? `Pratica gestita da: <strong>${agentNome}</strong>${agentEmail ? ` — <a href="mailto:${agentEmail}" style="color:#2563eb;">${agentEmail}</a>` : ''}<br>` : ''}
  Per rispondere a questa comunicazione utilizzare il pulsante "Rispondi" — la risposta verrà recapitata direttamente al referente della pratica.
</div>
<p style="margin-top:16px;font-size:11px;color:#94a3b8;">
  Questo messaggio è stato inviato automaticamente da <a href="${APP}" style="color:#64748b;">Credifile</a>.
</p>
</body></html>`;

    // 8. Invia via Resend
    const emailPayload = {
      from: FROM,
      to: [bankEmail],
      subject: `Pratica ${cliente} (${pratica.numero_pratica}) — Credifile`,
      html: htmlBody,
    };
    if (agentEmail) emailPayload.reply_to = agentEmail;
    if (ccList.length  > 0) emailPayload.cc  = ccList;
    if (bccList.length > 0) emailPayload.bcc = bccList;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload),
    });
    const emailBody = await emailRes.json();
    if (!emailRes.ok) {
      return res.status(502).json({ success: false, error: emailBody?.message ?? 'Errore Resend' });
    }

    // 9. Aggiorna practice_banks → status 'inviata'
    await fetch(
      `${SUPABASE_URL}/rest/v1/practice_banks?practice_id=eq.${encodeURIComponent(practice_id)}&bank_id=eq.${encodeURIComponent(bank_id)}`,
      {
        method: 'PATCH',
        headers: H,
        body: JSON.stringify({ status: 'inviata', data_invio: new Date().toISOString(), note: note ?? null }),
      },
    );

    // 10. Log storico email_send_log
    await fetch(`${SUPABASE_URL}/rest/v1/email_send_log`, {
      method: 'POST',
      headers: { ...H, Prefer: 'return=minimal' },
      body: JSON.stringify({
        practice_id,
        bank_id,
        bank_nome: bank?.nome ?? null,
        destinatari: [bankEmail],
        cc: ccList.length > 0 ? ccList : null,
        bcc: bccList.length > 0 ? bccList : null,
        oggetto: `Pratica ${cliente} (${pratica.numero_pratica}) — Credifile`,
        stato: 'inviata',
        sent_by: pratica.agent?.id ?? null,
        sent_by_nome: pratica.agent?.nome ?? null,
        resend_id: emailBody?.id ?? null,
      }),
    }).catch(() => null); // Non blocca se il log fallisce

    return res.status(200).json({
      success: true,
      sent_to: bankEmail,
      cc: ccList,
      bcc: bccList,
      reply_to: agentEmail ?? null,
      docs_sent: docLinks.length,
      kpi_rows: kpiRows.length,
      has_rep: !!rep,
    });

  } catch (e) {
    console.error('send-to-bank error:', e);
    return res.status(500).json({ success: false, error: String(e) });
  }
}
