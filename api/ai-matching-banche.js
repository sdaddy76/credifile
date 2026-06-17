// Vercel Serverless Function — AI Matching Banche
// Sostituisce la Supabase Edge Function ai-matching-banche (BOOT_ERROR)
// Analizza la compatibilità tra la pratica e le banche attive usando KPI + Groq AI

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Content-Type': 'application/json',
};

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { practice_id } = req.body;
    if (!practice_id) return res.status(400).json({ error: 'practice_id obbligatorio' });

    const h = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Accept': 'application/json',
    };

    // 1. Dati pratica + cliente
    const practices = await fetch(
      `${SUPABASE_URL}/rest/v1/practices?id=eq.${encodeURIComponent(practice_id)}&select=importo_richiesto,motivazione,codice_ateco,clients(ragione_sociale,indirizzo,capitale_sociale_versato,codice_ateco)`,
      { headers: h },
    ).then(r => r.json());
    const p = practices?.[0];
    if (!p) return res.status(404).json({ error: 'Pratica non trovata' });

    // 2. KPI più recenti
    const kpis = await fetch(
      `${SUPABASE_URL}/rest/v1/bilanci_kpi?practice_id=eq.${encodeURIComponent(practice_id)}&select=anno_esercizio,ricavi_vendite,totale_patrimonio_netto,totale_debiti,utile_netto,kpi&order=anno_esercizio.desc&limit=1`,
      { headers: h },
    ).then(r => r.json()).catch(() => []);
    const kpi = kpis?.[0] ?? null;

    // Se bilanci_kpi usa client_id, provo anche con quello
    let kpiFallback = kpi;
    if (!kpiFallback) {
      const clientId = (await fetch(
        `${SUPABASE_URL}/rest/v1/practices?id=eq.${encodeURIComponent(practice_id)}&select=client_id`,
        { headers: h }
      ).then(r => r.json()))?.[0]?.client_id;
      if (clientId) {
        const k2 = await fetch(
          `${SUPABASE_URL}/rest/v1/bilanci_kpi?client_id=eq.${encodeURIComponent(clientId)}&select=anno_esercizio,ricavi_vendite,totale_patrimonio_netto,totale_debiti,utile_netto,kpi&order=anno_esercizio.desc&limit=1`,
          { headers: h },
        ).then(r => r.json()).catch(() => []);
        kpiFallback = k2?.[0] ?? null;
      }
    }
    const kpiData = kpiFallback;

    // 3. Banche attive con criteri KPI
    const banks = await fetch(
      `${SUPABASE_URL}/rest/v1/banks?attiva=eq.true&select=id,nome,bank_kpi_requirements(kpi_key,kpi_area,kpi_label,min_value,max_value),bank_ateco_requirements(codice,tipo)`,
      { headers: h },
    ).then(r => r.json()).catch(() => []);

    // ATECO della pratica: prima da practices, poi da clients (salvato dall'analisi visura)
    const practiceAteco = (p.codice_ateco || p.clients?.codice_ateco || '').trim().toUpperCase().replace('.', '');

    // 4. Score matching per ogni banca
    const matchResults = (banks || []).map(bank => {
      const reqs = bank.bank_kpi_requirements || [];
      const atecoReqs = bank.bank_ateco_requirements || [];

      // ── ATECO check ──────────────────────────────────────────────────────────
      let atecoOk = null; // null = non verificato (nessun requisito)
      if (atecoReqs.length > 0 && practiceAteco) {
        const inclusi = atecoReqs.filter(a => a.tipo === 'incluso').map(a => a.codice.toUpperCase().replace('.', ''));
        const esclusi = atecoReqs.filter(a => a.tipo === 'escluso').map(a => a.codice.toUpperCase().replace('.', ''));
        // Controlla esclusi — match prefisso (es. "56" esclude "5610")
        const isEscluso = esclusi.some(c => practiceAteco.startsWith(c) || c.startsWith(practiceAteco));
        if (isEscluso) {
          atecoOk = false;
        } else if (inclusi.length > 0) {
          // Inclusi: il codice pratica deve corrispondere (match prefisso)
          atecoOk = inclusi.some(c => practiceAteco.startsWith(c) || c.startsWith(practiceAteco));
        } else {
          // Solo esclusi configurati e non colpito → OK
          atecoOk = true;
        }
      }

      if (!reqs.length && atecoOk === null) {
        return { bankId: bank.id, bankName: bank.nome, score: 70, passCount: 0, failCount: 0, ndCount: 0, atecoOk, details: [] };
      }

      let pass = 0, fail = 0, nd = 0;
      const details = [];
      for (const req of reqs) {
        let actual = null;
        if (kpiData?.kpi) {
          const area = kpiData.kpi[req.kpi_area];
          actual = area?.[req.kpi_key]?.value ?? area?.[req.kpi_key]?.valore ?? null;
        }
        // Fallback: colonne dirette in bilanci_kpi
        if (actual === null && kpiData) {
          if (req.kpi_key === 'fatturato' || req.kpi_key === 'ricavi_vendite') {
            actual = kpiData.ricavi_vendite ?? null;
          } else if (req.kpi_key === 'utile_netto') {
            actual = kpiData.utile_netto ?? null;
          }
        }
        let passed = null;
        if (actual !== null) {
          const num = typeof actual === 'number' ? actual : parseFloat(actual);
          if (!isNaN(num)) {
            passed = true;
            if (req.min_value !== null && num < req.min_value) passed = false;
            if (req.max_value !== null && num > req.max_value) passed = false;
          }
        }
        if (passed === true)  pass++;
        else if (passed === false) fail++;
        else nd++;
        details.push({ label: req.kpi_label, pass: passed, actual, min: req.min_value, max: req.max_value });
      }
      const kpiScore = reqs.length > 0 ? Math.round((pass / reqs.length) * 100) : 70;
      // Se ATECO escluso → score 0; se ATECO incluso ma non rispettato → score 0
      const score = atecoOk === false ? 0 : kpiScore;
      return { bankId: bank.id, bankName: bank.nome, score, passCount: pass, failCount: fail, ndCount: nd, atecoOk, details };
    }).sort((a, b) => b.score - a.score);

    // 5. Groq AI — due prompt separati: analisi società + suggerimento banche
    const ragioneSociale = p.clients?.ragione_sociale || 'Società N/D';
    const kpiSummary = kpiData
      ? `Fatturato: ${kpiData.ricavi_vendite || 'N/D'}€ | Patrimonio Netto: ${kpiData.totale_patrimonio_netto || 'N/D'}€ | Totale Debiti: ${kpiData.totale_debiti || 'N/D'}€ | Utile Netto: ${kpiData.utile_netto || 'N/D'}€`
      : 'KPI finanziari non ancora caricati';
    const topBanks = matchResults.slice(0, 3)
      .map(b => `${b.bankName} (${b.score}% — ${b.passCount} OK, ${b.failCount} NOK)`)
      .join('; ') || 'Nessuna banca configurata';

    // Testi di fallback (quando Groq non disponibile o KPI mancanti)
    const fallbackAnalisi = `${ragioneSociale} opera nel settore ATECO ${p.codice_ateco || 'N/D'} e ha richiesto un finanziamento di ${p.importo_richiesto ? Number(p.importo_richiesto).toLocaleString('it-IT') + '€' : 'importo N/D'}. ${kpiData ? 'I KPI finanziari sono disponibili e sono stati analizzati nel matching.' : 'I KPI finanziari non sono ancora stati caricati: si consiglia di completare l\'analisi finanziaria per ottenere un\'analisi AI più accurata.'}`;
    const fallbackSuggerimento = matchResults.length > 0
      ? `Si raccomanda di privilegiare ${matchResults[0].bankName} (${matchResults[0].score}% di compatibilità stimata). Per una raccomandazione AI più precisa, configurare i criteri KPI specifici per ogni banca e caricare i bilanci aziendali.`
      : 'Nessuna banca attiva trovata. Aggiungere banche al sistema e configurarne i criteri KPI per ottenere suggerimenti personalizzati.';

    let aiSuggerimento = '';
    let analisiSocieta = '';

    if (GROQ_API_KEY) {
      // Prompt 1: analisi situazione societaria
      const prompt1 = `Sei un analista creditizio italiano. Analizza la situazione finanziaria di questa società in modo sintetico (3-4 frasi).
Società: ${ragioneSociale} | ATECO: ${p.codice_ateco || 'N/D'}
Finanziamento richiesto: ${p.importo_richiesto || 'N/D'}€ — Motivazione: ${p.motivazione || 'N/D'}
${kpiSummary}
Commenta i punti di forza e le criticità principali in italiano, in modo diretto e professionale. Anche se i KPI non sono disponibili, fornisci comunque una valutazione sul settore e sull'operazione.`;

      // Prompt 2: raccomandazione operativa sulle banche
      const prompt2 = `Sei un consulente finanziario italiano. In 2-3 frasi fornisci una raccomandazione operativa su quale banca privilegiare e perché.
Banche più compatibili: ${topBanks}
Importo richiesto: ${p.importo_richiesto || 'N/D'}€ | ATECO: ${p.codice_ateco || 'N/D'}
Sii diretto e pratico. Rispondi solo in italiano. Fornisci comunque una raccomandazione anche se i dati sono parziali.`;

      try {
        const [res1, res2] = await Promise.all([
          fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama3-8b-8192', messages: [{ role: 'user', content: prompt1 }], max_tokens: 250 }),
          }).then(r => r.json()),
          fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama3-8b-8192', messages: [{ role: 'user', content: prompt2 }], max_tokens: 200 }),
          }).then(r => r.json()),
        ]);
        analisiSocieta = res1.choices?.[0]?.message?.content?.trim() || fallbackAnalisi;
        aiSuggerimento = res2.choices?.[0]?.message?.content?.trim() || fallbackSuggerimento;
      } catch {
        // Groq non raggiungibile — uso i testi di fallback
        analisiSocieta = fallbackAnalisi;
        aiSuggerimento = fallbackSuggerimento;
      }
    } else {
      // GROQ_API_KEY non configurata — uso i testi di fallback
      analisiSocieta = fallbackAnalisi;
      aiSuggerimento = fallbackSuggerimento;
    }

    return res.status(200).json({
      success: true,
      matching: matchResults,
      aiSuggerimento,
      // Alias per compatibilità con il frontend che usa .banche e .suggerimento_ai
      banche: matchResults,
      suggerimento_ai: aiSuggerimento,
      analisi_societa: analisiSocieta,
    });

  } catch (e) {
    console.error('ai-matching-banche error:', e);
    return res.status(500).json({ error: String(e) });
  }
}
