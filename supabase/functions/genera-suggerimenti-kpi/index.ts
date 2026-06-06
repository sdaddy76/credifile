const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok   = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

interface KpiWorst {
  kpi_label: string
  kpi_key: string
  valore: number | null
  score: number
  soglia_ottimo: number | null
  soglia_suff: number | null
  inverso: boolean
  formatted: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const {
      worst_kpis,         // KpiWorst[] — i 3 KPI peggiori
      ragione_sociale,
      settore,
      codice_ateco,
      anno_bilancio,
    } = await req.json()

    if (!worst_kpis || worst_kpis.length === 0) return fail('worst_kpis obbligatorio')

    const groqKey = Deno.env.get('GROQ_API_KEY')
    if (!groqKey) return fail('GROQ_API_KEY non configurata')

    // Costruisci il prompt per Groq
    const kpiList = (worst_kpis as KpiWorst[]).map((k, i) =>
      `${i + 1}. ${k.kpi_label}: valore attuale ${k.formatted}, score bancabilità ${k.score}/100` +
      (k.soglia_ottimo !== null
        ? ` (ottimo ${k.inverso ? '≤' : '≥'}${k.soglia_ottimo})`
        : '')
    ).join('\n')

    const prompt = `Sei un consulente finanziario esperto in bancabilità e finanza aziendale italiana.

Azienda: ${ragione_sociale ?? 'N/D'}
Settore ATECO: ${codice_ateco ?? 'N/D'} — ${settore ?? 'N/D'}
Anno bilancio: ${anno_bilancio ?? 'N/D'}

I seguenti 3 KPI presentano uno score di bancabilità basso e necessitano di miglioramento:

${kpiList}

Per ciascuno dei 3 KPI fornisci:
- Una diagnosi sintetica del problema (1-2 frasi)
- 3 azioni concrete e specifiche che l'azienda può intraprendere per migliorare l'indice
- L'impatto atteso sul KPI se le azioni vengono attuate

Rispondi ESCLUSIVAMENTE in formato JSON con questa struttura esatta:
{
  "suggerimenti": [
    {
      "kpi_key": "...",
      "kpi_label": "...",
      "diagnosi": "...",
      "azioni": ["azione 1", "azione 2", "azione 3"],
      "impatto_atteso": "..."
    }
  ]
}
Non aggiungere testo fuori dal JSON.`

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Sei un esperto di finanza aziendale e bancabilità. Rispondi sempre e solo in JSON valido.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      })
    })

    if (!groqRes.ok) {
      const errText = await groqRes.text()
      // Fallback rule-based se Groq fallisce
      return ok({ success: true, suggerimenti: generaFallback(worst_kpis as KpiWorst[]), source: 'fallback', error: errText })
    }

    const groqData = await groqRes.json()
    const content  = groqData.choices?.[0]?.message?.content ?? ''

    try {
      const parsed = JSON.parse(content)
      return ok({ success: true, suggerimenti: parsed.suggerimenti, source: 'groq' })
    } catch {
      return ok({ success: true, suggerimenti: generaFallback(worst_kpis as KpiWorst[]), source: 'fallback_parse' })
    }

  } catch (e) { return fail(String(e)) }
})

// ── Fallback rule-based ─────────────────────────────────────────────────────
function generaFallback(kpis: KpiWorst[]) {
  const rules: Record<string, { diagnosi: string; azioni: string[]; impatto: string }> = {
    dscr: {
      diagnosi: 'Il DSCR insufficiente indica che il flusso di cassa operativo non copre adeguatamente il servizio del debito. Le banche richiedono tipicamente DSCR ≥ 1,25.',
      azioni: [
        'Estendere la durata dei finanziamenti esistenti per ridurre le rate annuali',
        'Incrementare l\'EBITDA mediante riduzione dei costi fissi e ottimizzazione del margine operativo',
        'Considerare la conversione del debito a breve in debito a lungo termine per alleggerire il servizio annuale',
      ],
      impatto: 'Un miglioramento del 10-15% nell\'EBITDA o una riduzione delle rate del 20% può riportare il DSCR sopra la soglia bancaria di 1,25.'
    },
    pfn_ebitda: {
      diagnosi: 'Il rapporto PFN/EBITDA elevato segnala un livello di indebitamento finanziario netto sproporzionato rispetto alla capacità di generazione di cassa.',
      azioni: [
        'Ridurre il debito finanziario mediante cessione di asset non strategici o immobili di proprietà',
        'Aumentare l\'EBITDA attraverso revisione del pricing, ottimizzazione dei costi operativi e diversificazione ricavi',
        'Valutare un aumento di capitale (equity injection) per ridurre la leva finanziaria netta',
      ],
      impatto: 'Portare PFN/EBITDA sotto 4× migliora significativamente la percezione di rischio da parte degli istituti bancari.'
    },
    ebitda_margin: {
      diagnosi: 'Il margine EBITDA basso indica scarsa redditività operativa. Le banche considerano questo indicatore come proxy della solidità del business model.',
      azioni: [
        'Analizzare e ridurre i costi di struttura non direttamente produttivi (overhead)',
        'Rivedere la politica di pricing per migliorare i margini lordi su prodotti/servizi principali',
        'Focalizzarsi sui segmenti di business con margini più elevati, riducendo o dismettendo quelli in perdita',
      ],
      impatto: 'Un incremento del margine EBITDA di 2-3 punti percentuali migliora sia lo score di bancabilità che la capacità di rimborso.'
    },
    current_ratio: {
      diagnosi: 'Il Current Ratio inferiore a 1 segnala potenziali difficoltà di liquidità a breve termine, con passività correnti superiori all\'attivo circolante.',
      azioni: [
        'Negoziare con i fornitori dilazioni di pagamento più lunghe per alleggerire le uscite a breve',
        'Accelerare l\'incasso dei crediti commerciali tramite factoring o politiche di sconto cassa',
        'Convertire debiti a breve termine in finanziamenti a medio-lungo termine per ridurre le passività correnti',
      ],
      impatto: 'Portare il Current Ratio sopra 1,2 riduce il rischio percepito di crisi di liquidità e migliora l\'accesso al credito a breve.'
    },
    roe: {
      diagnosi: 'Il ROE basso indica un ritorno insufficiente sul capitale proprio, segnalando inefficienza nell\'utilizzo delle risorse degli azionisti.',
      azioni: [
        'Aumentare la redditività netta attraverso ottimizzazione fiscale legittima e riduzione degli oneri finanziari',
        'Valutare l\'ottimizzazione della struttura del capitale (leva finanziaria moderata per amplificare il ROE)',
        'Ridistribuire il capitale verso le aree di business con ROI più elevato, disinvestendo da attività marginali',
      ],
      impatto: 'Un ROE superiore al 5-8% è generalmente considerato accettabile dagli istituti di credito per il settore manifatturiero e dei servizi.'
    },
    leverage: {
      diagnosi: 'Il leverage elevato indica che l\'azienda è eccessivamente dipendente dal debito, con un rapporto debiti/patrimonio che supera le soglie di sicurezza bancaria.',
      azioni: [
        'Attuare un aumento di capitale o conferire nuovi apporti di equity da parte dei soci',
        'Ridurre il debito finanziario tramite rimborso anticipato con risorse generate internamente',
        'Valutare operazioni di sale & leaseback su immobili o macchinari per ridurre il passivo',
      ],
      impatto: 'Portare il leverage sotto 3-4× aumenta la capacità di indebitamento residua e riduce il costo del capitale.'
    },
    pfn_pn: {
      diagnosi: 'Il rapporto PFN/PN elevato segnala che la posizione finanziaria netta eccede il patrimonio netto, indicando un\'eccessiva dipendenza dal debito terzi.',
      azioni: [
        'Aumentare il patrimonio netto attraverso utili non distribuiti o nuovi conferimenti dei soci',
        'Ridurre la PFN estinguendo i debiti finanziari più onerosi con i flussi di cassa disponibili',
        'Valutare strumenti ibridi come finanziamenti soci postergati che migliorano la struttura patrimoniale',
      ],
      impatto: 'Un PFN/PN inferiore a 2× è considerato sostenibile dalla maggior parte degli istituti bancari italiani.'
    },
  }

  return kpis.map(k => {
    const r = rules[k.kpi_key] ?? {
      diagnosi: `Il KPI ${k.kpi_label} presenta uno score di bancabilità di ${k.score}/100, al di sotto della soglia ottimale.`,
      azioni: [
        'Analizzare le cause strutturali dello scostamento rispetto ai benchmark di settore',
        'Definire un piano di miglioramento con obiettivi trimestrali misurabili',
        'Consultare un advisor finanziario per un piano di ristrutturazione mirato'
      ],
      impatto: 'Un miglioramento progressivo nell\'arco di 12-18 mesi può riportare l\'indice nella fascia di bancabilità sufficiente.'
    }
    return {
      kpi_key: k.kpi_key,
      kpi_label: k.kpi_label,
      diagnosi: r.diagnosi,
      azioni: r.azioni,
      impatto_atteso: r.impatto,
    }
  })
}
