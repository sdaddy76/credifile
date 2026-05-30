import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const ok   = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (msg: string) => new Response(JSON.stringify({ success: false, error: msg }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { practice_id, note } = await req.json()
    if (!practice_id) return fail('practice_id obbligatorio')

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const appUrl = Deno.env.get('APP_URL') || 'https://credifile-eosin.vercel.app'
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromEmail = Deno.env.get('FROM_EMAIL') || 'onboarding@resend.dev'

    // Carica pratica con tutti i dati
    const { data: practice, error: pe } = await sb
      .from('practices')
      .select(`*, clients(*), banks(*), assigned_agent:admin_profiles!practices_assigned_to_fkey(nome,email)`)
      .eq('id', practice_id)
      .single()
    if (pe || !practice) return fail('Pratica non trovata')

    const bank = practice.banks
    if (!bank) return fail('Nessuna banca associata alla pratica')

    const bankEmail = bank.email_invio_banca || bank.email
    if (!bankEmail) return fail('La banca non ha un indirizzo email configurato')

    const client = practice.clients
    const assignedAgent = practice.assigned_agent

    // Carica documenti caricati
    const { data: docs } = await sb
      .from('practice_documents')
      .select('*, uploaded_files(*)')
      .eq('practice_id', practice_id)
      .order('tipo')

    // Genera URL firmati per ogni file (durata 7 giorni = 604800 sec)
    type UploadedFile = { id: string; nome_file: string; storage_path: string }
    type PracticeDoc = { id: string; nome: string; tipo: string; status: string; uploaded_files?: UploadedFile[] }

    const docsWithUrls: { nome: string; tipo: string; status: string; files: { nome: string; url: string }[] }[] = []

    for (const doc of (docs ?? []) as PracticeDoc[]) {
      const fileLinks: { nome: string; url: string }[] = []
      for (const f of (doc.uploaded_files ?? [])) {
        const { data: signed } = await sb.storage.from('practice-files').createSignedUrl(f.storage_path, 604800)
        if (signed?.signedUrl) fileLinks.push({ nome: f.nome_file, url: signed.signedUrl })
      }
      if (fileLinks.length > 0) {
        docsWithUrls.push({ nome: doc.nome, tipo: doc.tipo, status: doc.status, files: fileLinks })
      }
    }

    // Raggruppa per tipo
    const byTipo: Record<string, typeof docsWithUrls> = {}
    docsWithUrls.forEach(d => { byTipo[d.tipo] = [...(byTipo[d.tipo] ?? []), d] })

    const tipoLabels: Record<string, string> = { standard: 'Documenti Standard', banca: 'Documenti Specifici Banca', integrazione: 'Integrazioni' }

    const docsSections = Object.entries(byTipo).map(([tipo, items]) => `
      <h3 style="font-size:13px;font-weight:700;color:#374151;margin:16px 0 8px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb;padding-bottom:4px">
        ${tipoLabels[tipo] ?? tipo}
      </h3>
      ${items.map(d => `
        <div style="margin-bottom:8px">
          <p style="font-size:13px;font-weight:600;color:#111827;margin:0 0 4px">${d.nome}</p>
          ${d.files.map(f => `
            <a href="${f.url}" style="display:inline-block;background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;border-radius:4px;padding:3px 10px;font-size:12px;text-decoration:none;margin:2px 2px 2px 0">
              📎 ${f.nome}
            </a>`).join('')}
        </div>`).join('')}
    `).join('')

    const html = `
      <div style="font-family:sans-serif;max-width:680px;margin:auto;padding:24px;color:#111827">
        <div style="background:#1e40af;border-radius:12px;padding:20px 24px;margin-bottom:24px">
          <h1 style="color:#fff;margin:0;font-size:20px">Credifile — Invio Pratica</h1>
          <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px">Documentazione per valutazione finanziaria</p>
        </div>

        <p>Gentile <strong>${bank.nome}</strong>,</p>
        <p style="color:#374151">In allegato (tramite link sicuri) la documentazione relativa alla pratica <strong>${practice.numero_pratica}</strong> per il cliente <strong>${client?.ragione_sociale ?? '—'}</strong>.</p>

        ${note ? `
        <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin:16px 0">
          <p style="font-weight:700;margin:0 0 4px;color:#92400e;font-size:13px">Note dalla segreteria:</p>
          <p style="margin:0;color:#92400e;font-size:13px">${note}</p>
        </div>` : ''}

        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0">
          <h2 style="font-size:14px;font-weight:700;color:#1e40af;margin:0 0 12px">📋 Riepilogo Pratica</h2>
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <tr><td style="padding:4px 0;color:#6b7280;width:140px">N° Pratica</td><td style="font-weight:600">${practice.numero_pratica}</td></tr>
            <tr><td style="padding:4px 0;color:#6b7280">Cliente</td><td style="font-weight:600">${client?.ragione_sociale ?? '—'}</td></tr>
            ${client?.codice_fiscale ? `<tr><td style="padding:4px 0;color:#6b7280">Cod. Fiscale</td><td>${client.codice_fiscale}</td></tr>` : ''}
            ${client?.piva ? `<tr><td style="padding:4px 0;color:#6b7280">P.IVA</td><td>${client.piva}</td></tr>` : ''}
            ${practice.importo_richiesto ? `<tr><td style="padding:4px 0;color:#6b7280">Importo richiesto</td><td style="font-weight:600">€ ${Number(practice.importo_richiesto).toLocaleString('it-IT')}</td></tr>` : ''}
            ${practice.motivazione ? `<tr><td style="padding:4px 0;color:#6b7280">Finalità</td><td>${practice.motivazione}</td></tr>` : ''}
            ${assignedAgent ? `<tr><td style="padding:4px 0;color:#6b7280">Agente</td><td>${assignedAgent.nome || assignedAgent.email}</td></tr>` : ''}
          </table>
        </div>

        <h2 style="font-size:14px;font-weight:700;color:#1e40af;margin:20px 0 4px">📎 Documenti allegati</h2>
        <p style="font-size:12px;color:#6b7280;margin:0 0 8px">I link sono validi per 7 giorni.</p>
        ${docsWithUrls.length > 0 ? docsSections : '<p style="color:#6b7280;font-size:13px">Nessun documento caricato.</p>'}

        <div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb">
          <p style="color:#9ca3af;font-size:11px;margin:0">Email inviata tramite Credifile — ${new Date().toLocaleDateString('it-IT')}</p>
          <p style="color:#9ca3af;font-size:11px;margin:4px 0 0">Per informazioni: <a href="mailto:${fromEmail}" style="color:#1e40af">${fromEmail}</a></p>
        </div>
      </div>`

    if (!resendKey) return fail('Servizio email non configurato')

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [bankEmail],
        reply_to: fromEmail,
        subject: `Pratica ${practice.numero_pratica} — ${client?.ragione_sociale ?? ''} — Credifile`,
        html,
      })
    })

    if (!emailRes.ok) {
      const err = await emailRes.json()
      return fail('Errore invio email: ' + (err?.message ?? emailRes.status))
    }

    // Aggiorna stato pratica → inviata_banca
    await sb.from('practices').update({ status: 'inviata_banca' }).eq('id', practice_id)
    await sb.from('practice_status_log').insert({ practice_id, new_status: 'inviata_banca', note: `Inviata a ${bankEmail}${note ? ' — ' + note : ''}`, created_by: 'admin' })

    return ok({ success: true, sent_to: bankEmail })
  } catch (e) { return fail(String(e)) }
})
