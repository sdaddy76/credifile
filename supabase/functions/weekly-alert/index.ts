import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

// HTML helpers
const badge = (color: string, text: string) =>
  `<span style="display:inline-block;background:${color};color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">${text}</span>`

const statusBadge = (s: string) => {
  const map: Record<string, [string, string]> = {
    bozza: ['#6b7280', 'Bozza'],
    aperta: ['#2563eb', 'Aperta'],
    documenti_mancanti: ['#d97706', 'Doc. Mancanti'],
    completa: ['#7c3aed', 'Completa'],
    inviata_banca: ['#0891b2', 'Inviata Banca'],
    deliberata: ['#16a34a', 'Deliberata'],
    rifiutata: ['#dc2626', 'Rifiutata'],
  }
  const [c, l] = map[s] ?? ['#6b7280', s]
  return badge(c, l)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const appUrl = Deno.env.get('APP_URL') || 'https://credifile-eosin.vercel.app'
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'

    // Carica tutti gli agenti
    const { data: agents } = await sb.from('admin_profiles').select('id,email,nome').eq('ruolo', 'agente')
    if (!agents?.length) return ok({ success: true, message: 'Nessun agente', sent: 0 })

    let sent = 0

    for (const agent of agents) {
      // Pratiche aperte/bozza/documenti_mancanti con almeno un documento in stato 'richiesto'
      const { data: practices } = await sb
        .from('practices')
        .select(`
          id, numero_pratica, status, nome_richiedente,
          clients (ragione_sociale),
          practice_documents (id, nome, status)
        `)
        .eq('created_by', agent.id)
        .in('status', ['bozza', 'aperta', 'documenti_mancanti', 'completa'])
        .order('numero_pratica', { ascending: true })

      if (!practices?.length) continue

      // Filtra: almeno un documento 'richiesto' o 'rifiutato'
      type PracticeDoc = { id: string; nome: string; status: string }
      type Practice = { id: string; numero_pratica: string; status: string; nome_richiedente?: string; clients?: { ragione_sociale?: string }; practice_documents?: PracticeDoc[] }

      const pending = (practices as Practice[]).filter(p =>
        (p.practice_documents ?? []).some(d => d.status === 'richiesto' || d.status === 'rifiutato')
      )
      if (!pending.length) continue

      // Costruisce corpo email HTML
      const rows = pending.map(p => {
        const missingDocs = (p.practice_documents ?? []).filter(d => d.status === 'richiesto' || d.status === 'rifiutato')
        const clientName = (p.clients as { ragione_sociale?: string } | undefined)?.ragione_sociale ?? p.nome_richiedente ?? '—'
        const docsHtml = missingDocs.map(d => `
          <tr>
            <td style="padding:4px 8px;color:#374151;font-size:12px">${d.nome}</td>
            <td style="padding:4px 8px">${badge(d.status === 'rifiutato' ? '#dc2626' : '#d97706', d.status === 'rifiutato' ? 'Rifiutato' : 'Attesa')}</td>
          </tr>`).join('')
        return `
          <tr style="border-bottom:1px solid #e5e7eb">
            <td style="padding:10px 8px;font-size:13px;color:#111827;vertical-align:top">
              <strong>${p.numero_pratica}</strong>
              <div style="font-size:11px;color:#6b7280;margin-top:2px">${clientName}</div>
            </td>
            <td style="padding:10px 8px;vertical-align:top">${statusBadge(p.status)}</td>
            <td style="padding:10px 8px;vertical-align:top">
              <table style="border-collapse:collapse">${docsHtml}</table>
            </td>
            <td style="padding:10px 8px;vertical-align:top">
              <a href="${appUrl}/admin/pratiche/${p.id}" style="color:#1e40af;font-size:12px;font-weight:600">Apri →</a>
            </td>
          </tr>`
      }).join('')

      const html = `
        <div style="font-family:sans-serif;max-width:680px;margin:auto;padding:24px;color:#111827">
          <div style="background:#1e40af;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h1 style="color:#fff;margin:0;font-size:22px">Credifile</h1>
            <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px">Alert Settimanale Documenti</p>
          </div>
          <p>Ciao${agent.nome ? ' <strong>' + agent.nome + '</strong>' : ''},</p>
          <p style="color:#374151">Hai <strong>${pending.length} pratica${pending.length !== 1 ? 'he' : ''}</strong> con documenti ancora in attesa da parte del cliente:</p>

          <div style="overflow-x:auto;margin:16px 0">
            <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
              <thead>
                <tr style="background:#f3f4f6">
                  <th style="padding:10px 8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Pratica</th>
                  <th style="padding:10px 8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Stato</th>
                  <th style="padding:10px 8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Documenti mancanti</th>
                  <th style="padding:10px 8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Azione</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>

          <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin-top:16px">
            <p style="margin:0;font-size:13px;color:#92400e">
              💡 <strong>Suggerimento:</strong> apri la pratica e usa il pulsante <em>"Invia Richiesta Documenti"</em> per inviare un reminder al cliente.
            </p>
          </div>

          <div style="margin-top:28px;text-align:center">
            <a href="${appUrl}" style="background:#1e40af;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Accedi a Credifile</a>
          </div>
          <p style="color:#9ca3af;font-size:11px;margin-top:24px;text-align:center">Alert settimanale automatico di Credifile — per disattivarlo contatta il tuo supervisore.</p>
        </div>`

      if (resendKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromEmail,
            to: [agent.email],
            subject: `⚠️ Alert Settimanale: ${pending.length} pratica${pending.length !== 1 ? 'he' : ''} con documenti in attesa`,
            html,
          })
        })
        sent++
      }
    }

    return ok({ success: true, message: `Alert inviati a ${sent} agenti`, sent })
  } catch (e) { return ok({ success: false, error: String(e) }) }
})
