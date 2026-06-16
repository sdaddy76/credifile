// Vercel Serverless Function — Notifica nuova segnalazione all'agente/segreteria/superadmin
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM         = process.env.FROM_EMAIL || 'Credifile <docflow@stedasrls.it>';
const APP          = process.env.APP_URL    || 'https://credifile-eosin.vercel.app';

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
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { segnalatore_id, ragione_sociale, cellulare, email_cliente, note, file_urls } = req.body;
    if (!segnalatore_id || !ragione_sociale) {
      return res.status(400).json({ success: false, error: 'segnalatore_id e ragione_sociale obbligatori' });
    }

    const H = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // 1. Carica profilo segnalatore
    const segnArr = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_profiles?id=eq.${encodeURIComponent(segnalatore_id)}&select=id,nome,email&limit=1`,
      { headers: H },
    ).then(r => r.json()).catch(() => []);
    const segnalatore = Array.isArray(segnArr) ? segnArr[0] : null;
    const segnNome  = segnalatore?.nome  ?? segnalatore?.email ?? 'Segnalatore';
    const segnEmail = segnalatore?.email ?? null;

    // 2. Routing: cerca agente collegato → segreteria → super admin
    let destinatario = null;

    // 2a. Agente collegato via agent_segnalatori
    const agArr = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_segnalatori?segnalatore_id=eq.${encodeURIComponent(segnalatore_id)}&select=agent_id,agent:agent_id(id,nome,email)&limit=1`,
      { headers: H },
    ).then(r => r.json()).catch(() => []);
    const agLink = Array.isArray(agArr) ? agArr[0] : null;
    if (agLink?.agent?.email) {
      destinatario = { nome: agLink.agent.nome ?? agLink.agent.email, email: agLink.agent.email, ruolo: 'Agente' };
    }

    // 2b. Nessun agente → cerca supervisore_segreteria
    if (!destinatario) {
      const segArr = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_profiles?ruolo=eq.supervisore_segreteria&select=id,nome,email&order=created_at.asc&limit=1`,
        { headers: H },
      ).then(r => r.json()).catch(() => []);
      const seg = Array.isArray(segArr) ? segArr[0] : null;
      if (seg?.email) {
        destinatario = { nome: seg.nome ?? seg.email, email: seg.email, ruolo: 'Segreteria' };
      }
    }

    // 2c. Nessuna segreteria → super admin
    if (!destinatario) {
      const saArr = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_profiles?ruolo=eq.super_admin&select=id,nome,email&order=created_at.asc&limit=1`,
        { headers: H },
      ).then(r => r.json()).catch(() => []);
      const sa = Array.isArray(saArr) ? saArr[0] : null;
      if (sa?.email) {
        destinatario = { nome: sa.nome ?? sa.email, email: sa.email, ruolo: 'Super Admin' };
      }
    }

    if (!destinatario) {
      return res.status(422).json({ success: false, error: 'Nessun destinatario trovato (agente/segreteria/superadmin)' });
    }

    // 3. Componi email HTML
    const fileList = Array.isArray(file_urls) && file_urls.length > 0
      ? `<h3 style="color:#1e3a5f;margin-top:20px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">📎 Documenti allegati (${file_urls.length})</h3>
<ul style="padding-left:18px;">
${file_urls.map(f => `<li style="margin:6px 0;"><a href="${f.url}" style="color:#2563eb;font-weight:600;">${f.nome}</a></li>`).join('')}
</ul>`
      : '<p style="color:#94a3b8;font-size:13px;margin-top:12px;">Nessun documento allegato.</p>';

    const noteSection = note
      ? `<div style="background:#f8fafc;border-left:4px solid #1e3a5f;border-radius:4px;padding:12px 16px;margin-top:16px;font-size:13px;color:#374151;">
  <strong>Note dal segnalatore:</strong><br>${note.replace(/\n/g, '<br>')}
</div>`
      : '';

    const htmlBody = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;color:#1e293b;">
<div style="border-bottom:3px solid #f97316;padding-bottom:12px;margin-bottom:20px;">
  <h2 style="color:#1e3a5f;margin:0;">Credifile — Nuova Segnalazione</h2>
</div>
<p>Gentile <strong>${destinatario.nome}</strong>,</p>
<p>Il segnalatore <strong>${segnNome}</strong>${segnEmail ? ` (<a href="mailto:${segnEmail}" style="color:#2563eb;">${segnEmail}</a>)` : ''} ha inviato una nuova segnalazione cliente.</p>

<h3 style="color:#1e3a5f;margin-top:20px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">👤 Dati Cliente</h3>
<table style="width:100%;font-size:13px;border-collapse:collapse;">
  <tr><td style="padding:6px 8px;color:#64748b;width:160px;">Ragione Sociale</td><td style="padding:6px 8px;font-weight:600;">${ragione_sociale}</td></tr>
  ${cellulare ? `<tr><td style="padding:6px 8px;color:#64748b;">Cellulare</td><td style="padding:6px 8px;"><a href="tel:${cellulare}" style="color:#2563eb;">${cellulare}</a></td></tr>` : ''}
  ${email_cliente ? `<tr><td style="padding:6px 8px;color:#64748b;">Email</td><td style="padding:6px 8px;"><a href="mailto:${email_cliente}" style="color:#2563eb;">${email_cliente}</a></td></tr>` : ''}
</table>

${noteSection}
${fileList}

<div style="margin-top:24px;padding:12px;background:#fff7ed;border-radius:8px;font-size:12px;color:#92400e;border-left:3px solid #f97316;">
  Questa segnalazione ti è stata inviata perché sei il referente del segnalatore <strong>${segnNome}</strong> (${destinatario.ruolo}).
</div>
<p style="margin-top:16px;">
  <a href="${APP}" style="display:inline-block;background:#1e3a5f;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Accedi a Credifile →</a>
</p>
<p style="margin-top:16px;font-size:11px;color:#94a3b8;">
  Questo messaggio è stato inviato automaticamente da <a href="${APP}" style="color:#64748b;">Credifile</a>.
</p>
</body></html>`;

    // 4. Invia via Resend
    const emailPayload = {
      from: FROM,
      to: [destinatario.email],
      subject: `Nuova segnalazione: ${ragione_sociale} — da ${segnNome}`,
      html: htmlBody,
    };
    if (segnEmail) emailPayload.reply_to = segnEmail;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload),
    });
    const emailBody = await emailRes.json();
    if (!emailRes.ok) {
      return res.status(502).json({ success: false, error: emailBody?.message ?? 'Errore Resend' });
    }

    return res.status(200).json({
      success: true,
      sent_to: destinatario.email,
      destinatario_ruolo: destinatario.ruolo,
    });

  } catch (e) {
    console.error('notifica-segnalazione error:', e);
    return res.status(500).json({ success: false, error: String(e) });
  }
}
