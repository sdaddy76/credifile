import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

const STATUS_LABELS: Record<string, string> = {
  bozza: 'Bozza', aperta: 'Aperta', documenti_mancanti: 'Doc. Mancanti',
  completa: 'Completa', inviata_banca: 'Inviata Banca', deliberata: 'Deliberata', rifiutata: 'Rifiutata',
}
const STATUS_COLORS: Record<string, string> = {
  bozza: '#6b7280', aperta: '#2563eb', documenti_mancanti: '#d97706',
  completa: '#7c3aed', inviata_banca: '#0891b2', deliberata: '#16a34a', rifiutata: '#dc2626',
}
const badge = (color: string, text: string, count: number) =>
  `<div style="display:inline-block;margin:4px;padding:8px 14px;border-radius:8px;background:${color}15;border:1px solid ${color}40;text-align:center;min-width:90px">
    <div style="font-size:22px;font-weight:700;color:${color}">${count}</div>
    <div style="font-size:11px;color:#6b7280;margin-top:2px">${text}</div>
  </div>`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const appUrl = Deno.env.get('APP_URL') || 'https://credifile-eosin.vercel.app'
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'

    // Mese corrente
    const now = new Date()
    const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre']
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
    const monthLabel = `${monthNames[prevMonth]} ${prevYear}`

    const startDate = new Date(prevYear, prevMonth, 1).toISOString()
    const endDate = new Date(prevYear, prevMonth + 1, 0, 23, 59, 59).toISOString()

    // Carica tutti gli agenti
    const { data: agents } = await sb.from('admin_profiles').select('id,email,nome').eq('ruolo', 'agente')
    if (!agents?.length) return ok({ success: true, message: 'Nessun agente', sent: 0 })

    let sent = 0

    for (const agent of agents) {
      // Tutte le pratiche dell'agente
      const { data: allPractices } = await sb
        .from('practices')
        .select('id, numero_pratica, status, nome_richiedente, created_at, clients(ragione_sociale)')
        .eq('created_by', agent.id)
        .order('status')

      if (!allPractices?.length) continue

      // Pratiche create/modificate nel mese precedente
      const monthPractices = allPractices.filter(p =>
        p.created_at >= startDate && p.created_at <= endDate
      )

      // Conta per stato (tutte le pratiche)
      const countByStatus: Record<string, number> = {}
      allPractices.forEach((p: { status: string }) => {
        countByStatus[p.status] = (countByStatus[p.status] ?? 0) + 1
      })

      // Tabella pratiche mese precedente
      type Practice = { id: string; numero_pratica: string; status: string; nome_richiedente?: string; created_at: string; clients?: { ragione_sociale?: string } }
      const monthRows = (monthPractices as Practice[]).map(p => {
        const clientName = p.clients?.ragione_sociale ?? p.nome_richiedente ?? '—'
        const color = STATUS_COLORS[p.status] ?? '#6b7280'
        const label = STATUS_LABELS[p.status] ?? p.status
        return `<tr style="border-bottom:1px solid #e5e7eb">
          <td style="padding:8px;font-size:13px;color:#111827"><strong>${p.numero_pratica}</strong></td>
          <td style="padding:8px;font-size:12px;color:#6b7280">${clientName}</td>
          <td style="padding:8px"><span style="background:${color}20;color:${color};border:1px solid ${color}40;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700">${label}</span></td>
          <td style="padding:8px"><a href="${appUrl}/admin/pratiche/${p.id}" style="color:#1e40af;font-size:12px;font-weight:600">Apri →</a></td>
        </tr>`
      }).join('')

      // Badges totali per stato
      const summaryBadges = Object.entries(countByStatus)
        .sort((a, b) => b[1] - a[1])
        .map(([s, n]) => badge(STATUS_COLORS[s] ?? '#6b7280', STATUS_LABELS[s] ?? s, n))
        .join('')

      const html = `
        <div style="font-family:sans-serif;max-width:680px;margin:auto;padding:24px;color:#111827">
          <div style="background:#1e40af;border-radius:12px;padding:20px 24px;margin-bottom:24px">
            <h1 style="color:#fff;margin:0;font-size:22px">Credifile</h1>
            <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px">Report Mensile — ${monthLabel}</p>
          </div>

          <p>Ciao${agent.nome ? ' <strong>' + agent.nome + '</strong>' : ''},</p>
          <p style="color:#374151">Ecco il riepilogo delle tue pratiche per il mese di <strong>${monthLabel}</strong>.</p>

          <div style="margin:20px 0">
            <h2 style="font-size:15px;color:#374151;margin-bottom:12px">📊 Riepilogo Totale (tutte le pratiche)</h2>
            <div style="display:flex;flex-wrap:wrap;gap:4px">${summaryBadges}</div>
            <p style="font-size:12px;color:#9ca3af;margin-top:8px">Totale pratiche: <strong>${allPractices.length}</strong></p>
          </div>

          ${monthPractices.length > 0 ? `
          <div style="margin:20px 0">
            <h2 style="font-size:15px;color:#374151;margin-bottom:12px">📋 Pratiche aperte in ${monthLabel} (${monthPractices.length})</h2>
            <div style="overflow-x:auto">
              <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
                <thead>
                  <tr style="background:#f3f4f6">
                    <th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Pratica</th>
                    <th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Cliente</th>
                    <th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Stato attuale</th>
                    <th style="padding:8px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Azione</th>
                  </tr>
                </thead>
                <tbody>${monthRows}</tbody>
              </table>
            </div>
          </div>` : `<p style="color:#6b7280;font-style:italic">Nessuna pratica aperta nel mese di ${monthLabel}.</p>`}

          <div style="margin-top:28px;text-align:center">
            <a href="${appUrl}" style="background:#1e40af;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block">Vai a Credifile</a>
          </div>
          <p style="color:#9ca3af;font-size:11px;margin-top:24px;text-align:center">Report mensile automatico di Credifile — per disattivarlo contatta il tuo supervisore.</p>
        </div>`

      if (resendKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromEmail,
            to: [agent.email],
            subject: `📋 Report Mensile Credifile — ${monthLabel}`,
            html,
          })
        })
        sent++
      }
    }

    return ok({ success: true, message: `Report mensile inviato a ${sent} agenti`, sent })
  } catch (e) { return ok({ success: false, error: String(e) }) }
})
