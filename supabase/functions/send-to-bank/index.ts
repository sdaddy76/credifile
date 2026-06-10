import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json',
};

// ── helper colore score (0-100) ────────────────────────────────────────────
function scoreColor(s: number | null): string {
  if (s == null) return '#888';
  if (s >= 70) return '#16a34a';
  if (s >= 40) return '#d97706';
  return '#dc2626';
}
function scoreLabel(s: number | null): string {
  if (s == null) return 'N/D';
  if (s >= 70) return 'Buono';
  if (s >= 40) return 'Medio';
  return 'Basso';
}

// ── helper: estrae KPI "piatti" dal JSON annidato ──────────────────────────
function flattenKpi(kpiJson: Record<string, unknown> | null): { label: string; value: string }[] {
  if (!kpiJson) return [];
  const rows: { label: string; value: string }[] = [];
  for (const area of Object.values(kpiJson)) {
    if (typeof area !== 'object' || !area) continue;
    for (const [label, entry] of Object.entries(area as Record<string, unknown>)) {
      const val = (entry as Record<string, unknown>)?.value;
      if (val != null) {
        const formatted = typeof val === 'number'
          ? (Number.isInteger(val) ? String(val) : val.toFixed(2))
          : String(val);
        rows.push({ label, value: formatted });
      }
    }
  }
  return rows.slice(0, 14); // max 14 KPI chiave
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const { practice_id, bank_id, note } = await req.json();
    if (!practice_id || !bank_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'practice_id e bank_id obbligatori' }),
        { headers: CORS },
      );
    }

    const SUPA_URL   = Deno.env.get('SUPABASE_URL')!;
    const SUPA_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
    const FROM       = Deno.env.get('FROM_EMAIL') ?? 'Credifile <docflow@stedasrls.it>';
    const APP        = Deno.env.get('APP_URL') ?? 'https://credifile-eosin.vercel.app';

    const H = {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation',
    };

    // 1. Pratica + cliente
    const praticaArr = await (await fetch(
      `${SUPA_URL}/rest/v1/practices?id=eq.${encodeURIComponent(practice_id)}&select=*,clients(id,ragione_sociale,codice_fiscale),agent:admin_profiles!practices_assigned_to_fkey(id,nome,email)&limit=1`,
      { headers: H },
    )).json();
    const pratica = praticaArr?.[0];
    if (!pratica) return new Response(JSON.stringify({ success: false, error: 'Pratica non trovata' }), { headers: CORS });

    const clientId   = pratica.clients?.id;
    const agentEmail = pratica.agent?.email as string | undefined;
    const agentNome  = pratica.agent?.nome  as string | undefined;

    // 2. Banca
    const pbArr = await (await fetch(
      `${SUPA_URL}/rest/v1/practice_banks?practice_id=eq.${encodeURIComponent(practice_id)}&bank_id=eq.${encodeURIComponent(bank_id)}&select=*,banks(nome,email,email_invio_banca)&limit=1`,
      { headers: H },
    )).json();
    const pb = pbArr?.[0];
    if (!pb) return new Response(JSON.stringify({ success: false, error: 'Assegnazione banca non trovata' }), { headers: CORS });

    const bankEmail = pb.banks?.email_invio_banca || pb.banks?.email;
    if (!bankEmail) return new Response(JSON.stringify({ success: false, error: 'Email banca non configurata' }), { headers: CORS });

    // 3. File + signed URL
    const files = await (await fetch(
      `${SUPA_URL}/rest/v1/uploaded_files?practice_id=eq.${encodeURIComponent(practice_id)}&select=id,nome_file,storage_path,practice_documents(nome,status)&order=created_at.asc`,
      { headers: H },
    )).json() ?? [];

    const docLinks: { nomeDoc: string; nomeFile: string; url: string }[] = [];
    for (const f of files) {
      if (!f.storage_path) continue;
      const encodedPath = f.storage_path.split('/').map((s: string) => encodeURIComponent(s)).join('/');
      const signRes = await fetch(
        `${SUPA_URL}/storage/v1/object/sign/practice-files/${encodedPath}`,
        { method: 'POST', headers: H, body: JSON.stringify({ expiresIn: 604800 }) },
      );
      if (signRes.ok) {
        const signData = await signRes.json();
        let url = signData?.signedUrl ?? null;
        if (!url && signData?.signedURL) url = `${SUPA_URL}/storage/v1${signData.signedURL}`;
        if (url) docLinks.push({ nomeDoc: f.practice_documents?.nome ?? f.nome_file, nomeFile: f.nome_file, url });
      }
    }

    // 4. KPI finanziari (bilancio più recente del cliente)
    let kpiRows: { label: string; value: string }[] = [];
    let annoBilancio: number | null = null;
    if (clientId) {
      const kpiArr = await (await fetch(
        `${SUPA_URL}/rest/v1/bilanci_kpi?client_id=eq.${encodeURIComponent(clientId)}&select=anno_bilancio,kpi&order=anno_bilancio.desc&limit=1`,
        { headers: H },
      )).json();
      if (kpiArr?.[0]) {
        annoBilancio = kpiArr[0].anno_bilancio;
        kpiRows = flattenKpi(kpiArr[0].kpi);
      }
    }

    // 5. Score reputazione (analisi più recente del cliente)
    let rep: { score_globale: number | null; score_societa: number | null; score_amm: number | null; score_soci: number | null } | null = null;
    if (clientId) {
      const repArr = await (await fetch(
        `${SUPA_URL}/rest/v1/reputational_analyses?client_id=eq.${encodeURIComponent(clientId)}&select=score_globale,score_societa,score_amm,score_soci&order=created_at.desc&limit=1`,
        { headers: H },
      )).json();
      if (repArr?.[0]) rep = repArr[0];
    }

    // 6. Indice bancabilità: query bancabilita_pesi per il punteggio salvato (se esiste)
    let bancabScore: number | null = null;
    if (clientId) {
      const bpArr = await (await fetch(
        `${SUPA_URL}/rest/v1/bancabilita_pesi?client_id=eq.${encodeURIComponent(clientId)}&select=score_globale&order=updated_at.desc&limit=1`,
        { headers: H },
      )).json().catch(() => []);
      if (bpArr?.[0]?.score_globale != null) bancabScore = bpArr[0].score_globale;
    }

    // ─────────────────────────────────────────────────────────────────────
    // 7. Componi HTML email
    // ─────────────────────────────────────────────────────────────────────
    const cliente  = pratica.clients?.ragione_sociale ?? pratica.clients?.codice_fiscale ?? 'N/D';
    const notaHtml = note ? `<p style="color:#555;margin-top:12px;"><strong>Note:</strong> ${note}</p>` : '';

    const docsHtml = docLinks.length > 0
      ? docLinks.map(d =>
          `<li style="margin:8px 0;">` +
          `<a href="${d.url}" style="color:#2563eb;font-weight:600;">${d.nomeDoc}</a>` +
          ` <span style="color:#888;font-size:11px;">(${d.nomeFile} — link valido 7 giorni)</span>` +
          `</li>`,
        ).join('')
      : '<li style="color:#888;">Nessun documento disponibile al momento</li>';

    // KPI sezione
    const kpiSection = kpiRows.length > 0 ? `
<h3 style="color:#1e3a5f;margin-top:28px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
  📊 KPI Finanziari${annoBilancio ? ` — Bilancio ${annoBilancio}` : ''}
</h3>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;">
  <thead>
    <tr style="background:#f1f5f9;">
      <th style="text-align:left;padding:7px 10px;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">Indicatore</th>
      <th style="text-align:right;padding:7px 10px;color:#475569;font-weight:600;border-bottom:1px solid #e2e8f0;">Valore</th>
    </tr>
  </thead>
  <tbody>
    ${kpiRows.map((k, i) =>
      `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'};">` +
      `<td style="padding:6px 10px;color:#374151;">${k.label}</td>` +
      `<td style="padding:6px 10px;text-align:right;font-weight:600;color:#1e3a5f;">${k.value}</td>` +
      `</tr>`,
    ).join('')}
  </tbody>
</table>` : '';

    // Bancabilità sezione
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

    // Reputazione sezione
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
      { label: 'Score Globale',    s: rep.score_globale },
      { label: 'Società',          s: rep.score_societa },
      { label: 'Amministratori',   s: rep.score_amm },
      { label: 'Soci',             s: rep.score_soci },
    ].map((r, i) =>
      `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8fafc'};">` +
      `<td style="padding:6px 10px;color:#374151;">${r.label}</td>` +
      `<td style="padding:6px 10px;text-align:center;font-weight:700;color:${scoreColor(r.s)};">${r.s != null ? r.s.toFixed(0) + '/100' : 'N/D'}</td>` +
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

    // 8. Invia via Resend con reply_to agente
    const emailPayload: Record<string, unknown> = {
      from: FROM,
      to: [bankEmail],
      subject: `Pratica ${cliente} (${pratica.numero_pratica}) — Credifile`,
      html: htmlBody,
    };
    if (agentEmail) emailPayload.reply_to = agentEmail;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload),
    });
    const emailBody = await emailRes.json();
    if (!emailRes.ok) {
      return new Response(JSON.stringify({ success: false, error: emailBody?.message ?? 'Errore Resend' }), { headers: CORS });
    }

    // 9. Aggiorna practice_banks → status 'inviata'
    await fetch(
      `${SUPA_URL}/rest/v1/practice_banks?practice_id=eq.${encodeURIComponent(practice_id)}&bank_id=eq.${encodeURIComponent(bank_id)}`,
      {
        method: 'PATCH',
        headers: H,
        body: JSON.stringify({ status: 'inviata', data_invio: new Date().toISOString(), note: note ?? null }),
      },
    );

    return new Response(
      JSON.stringify({ success: true, sent_to: bankEmail, reply_to: agentEmail ?? null, docs_sent: docLinks.length, kpi_rows: kpiRows.length, has_rep: !!rep }),
      { headers: CORS },
    );
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { headers: CORS });
  }
});
