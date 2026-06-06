const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok   = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const {
      to_email,
      to_name,
      consulente_nome,
      consulente_email,
      report_id,
      client_name,
      anno_bilancio,
      indice_bancabilita,
      pdf_base64,   // PDF codificato in base64 da allegare
    } = await req.json()

    if (!to_email) return fail('to_email obbligatorio')

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'Credifile <noreply@stedasrls.it>'
    if (!resendKey) return fail('RESEND_API_KEY non configurata')

    const ratingLabel = (score: number) => {
      if (score >= 85) return 'Eccellente';
      if (score >= 70) return 'Buono';
      if (score >= 55) return 'Sufficiente';
      if (score >= 40) return 'Critico';
      return 'Non bancabile';
    }

    const ratingColor = (score: number) => {
      if (score >= 85) return '#059669';
      if (score >= 70) return '#16a34a';
      if (score >= 55) return '#ca8a04';
      if (score >= 40) return '#ea580c';
      return '#dc2626';
    }

    const score = indice_bancabilita ?? null
    const rLabel = score !== null ? ratingLabel(score) : null
    const rColor = score !== null ? ratingColor(score) : '#6b7280'

    const attachments = pdf_base64 ? [{
      filename: `Report_Bancabilita_${client_name?.replace(/\s/g, '_')}_${anno_bilancio ?? 'ND'}.pdf`,
      content: pdf_base64,
    }] : []

    const emailBody = {
      from: fromEmail,
      to: [to_email],
      reply_to: consulente_email || undefined,
      subject: `Report di Bancabilità — ${client_name} (${anno_bilancio ?? 'N/D'})`,
      attachments,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;color:#1e293b">
        <div style="background:#0f766e;border-radius:12px;padding:20px 24px;margin-bottom:24px">
          <h1 style="color:#fff;margin:0;font-size:22px">Credifile</h1>
          <p style="color:#ccfbf1;margin:4px 0 0;font-size:13px">Report di Bancabilità Professionale</p>
        </div>

        <p>Gentile ${to_name ?? to_email},</p>
        <p>Le inviamo in allegato il <strong>Report di Bancabilità</strong> elaborato da <strong>${consulente_nome ?? 'il suo Consulente'}</strong> per la società <strong>${client_name}</strong>.</p>

        ${score !== null ? `
        <div style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;padding:20px;margin:20px 0;text-align:center">
          <p style="margin:0 0 8px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Indice di Bancabilità</p>
          <div style="font-size:48px;font-weight:900;color:${rColor};line-height:1">${score}</div>
          <div style="font-size:15px;font-weight:700;color:${rColor};margin-top:4px">/100 — ${rLabel}</div>
        </div>
        ` : ''}

        <p>Il report contiene:</p>
        <ul style="line-height:1.8;color:#475569">
          <li>Analisi completa dei KPI aziendali</li>
          <li>Confronto con i benchmark del settore (Mediobanca/ISTAT)</li>
          <li>I 3 migliori e i 3 peggiori indicatori di bancabilità</li>
          <li>Raccomandazioni specifiche per migliorare la bancabilità</li>
        </ul>

        <p style="margin-top:24px">Per qualsiasi chiarimento è possibile contattare il consulente${consulente_email ? ` all'indirizzo <a href="mailto:${consulente_email}">${consulente_email}</a>` : ''}.</p>

        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
        <p style="font-size:11px;color:#94a3b8;text-align:center">
          Report generato da Credifile — Sistema di Gestione Finanziaria<br>
          ${consulente_nome ? `Consulente: ${consulente_nome}` : ''}
          ${report_id ? ` · ID Report: ${report_id}` : ''}
        </p>
      </div>`
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailBody)
    })

    if (!res.ok) {
      const errData = await res.json()
      return fail(`Errore Resend: ${JSON.stringify(errData)}`)
    }

    return ok({ success: true })
  } catch (e) { return fail(String(e)) }
})
