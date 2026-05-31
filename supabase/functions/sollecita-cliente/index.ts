import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const { practice_id } = await req.json();
    if (!practice_id) return new Response(JSON.stringify({ success: false, error: 'practice_id obbligatorio' }), { headers: CORS });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
    const FROM = Deno.env.get('FROM_EMAIL') ?? 'Credifile <docflow@stedasrls.it>';
    const APP_URL = Deno.env.get('APP_URL') ?? 'https://credifile-eosin.vercel.app';

    // Carica pratica + cliente
    const { data: practice } = await supabase
      .from('practices')
      .select('*, clients(ragione_sociale, email, nome_referente)')
      .eq('id', practice_id)
      .single();
    if (!practice) return new Response(JSON.stringify({ success: false, error: 'Pratica non trovata' }), { headers: CORS });

    const client = practice.clients;
    if (!client?.email) return new Response(JSON.stringify({ success: false, error: 'Email cliente non presente' }), { headers: CORS });

    // Carica codice accesso
    const { data: accessCode } = await supabase
      .from('practice_access_codes')
      .select('codice')
      .eq('practice_id', practice_id)
      .maybeSingle();
    if (!accessCode) return new Response(JSON.stringify({ success: false, error: 'Codice accesso non generato. Genera prima il codice dal dettaglio pratica.' }), { headers: CORS });

    // Documenti mancanti (richiesto) e rifiutati
    const { data: docs } = await supabase
      .from('practice_documents')
      .select('nome, status, note_rifiuto')
      .eq('practice_id', practice_id)
      .in('status', ['richiesto', 'rifiutato'])
      .order('status');

    const mancanti = (docs ?? []).filter(d => d.status === 'richiesto');
    const rifiutati = (docs ?? []).filter(d => d.status === 'rifiutato');

    if (mancanti.length === 0 && rifiutati.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'Nessun documento mancante o rifiutato da sollecitare.' }), { headers: CORS });
    }

    const portalLink = `${APP_URL}/#/accesso?p=${practice_id}`;
    const nomeCliente = client.nome_referente || client.ragione_sociale || 'Gentile Cliente';
    const now = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });

    // Sezione documenti mancanti
    const mancantiHtml = mancanti.length > 0 ? `
      <div style="margin:16px 0;">
        <h3 style="color:#b45309;font-size:15px;margin:0 0 8px 0;">
          📋 Documenti ancora da caricare (${mancanti.length})
        </h3>
        <ul style="margin:0;padding:0 0 0 20px;color:#555;">
          ${mancanti.map(d => `<li style="margin:4px 0;">${d.nome}</li>`).join('')}
        </ul>
      </div>` : '';

    // Sezione documenti rifiutati
    const rifiutatiHtml = rifiutati.length > 0 ? `
      <div style="margin:16px 0;">
        <h3 style="color:#dc2626;font-size:15px;margin:0 0 8px 0;">
          ❌ Documenti da ricaricare (${rifiutati.length})
        </h3>
        ${rifiutati.map(d => `
          <div style="background:#fff5f5;border:1px solid #fecaca;border-radius:8px;padding:10px 14px;margin:6px 0;">
            <p style="font-weight:600;color:#333;margin:0;">${d.nome}</p>
            ${d.note_rifiuto ? `<p style="color:#dc2626;font-size:13px;margin:4px 0 0 0;">⚠️ Motivo: ${d.note_rifiuto}</p>` : ''}
          </div>`).join('')}
      </div>` : '';

    const htmlBody = `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;color:#333;">
  <div style="background:#1e3a5f;color:#fff;padding:16px 24px;border-radius:10px 10px 0 0;margin-bottom:0;">
    <h1 style="margin:0;font-size:20px;">Credifile</h1>
    <p style="margin:4px 0 0 0;font-size:13px;opacity:0.8;">Sistema di gestione documentale</p>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:24px;">
    <p style="font-size:15px;">Buongiorno <strong>${nomeCliente}</strong>,</p>
    <p style="color:#555;">Ti scriviamo riguardo alla pratica <strong>${practice.numero_pratica}</strong> in lavorazione presso il nostro ufficio.</p>
    <p style="color:#555;">Per poter procedere con la tua richiesta, è necessario che tu provveda a caricare i documenti indicati di seguito accedendo al tuo portale personale.</p>

    ${mancantiHtml}
    ${rifiutatiHtml}

    <div style="text-align:center;margin:28px 0 20px 0;">
      <a href="${portalLink}"
         style="background:#1e3a5f;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;">
        🔐 Accedi al portale
      </a>
    </div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin:16px 0;text-align:center;">
      <p style="margin:0 0 4px 0;font-size:13px;color:#666;">Codice di accesso</p>
      <code style="font-size:24px;font-weight:700;letter-spacing:6px;color:#1e3a5f;">${accessCode.codice}</code>
    </div>

    <p style="font-size:13px;color:#888;">Se hai già caricato i documenti nelle ultime ore, puoi ignorare questa email. Per qualsiasi dubbio, contatta il tuo referente.</p>
    <hr style="margin:20px 0;border:none;border-top:1px solid #eee;">
    <p style="font-size:12px;color:#aaa;text-align:center;">Credifile — ${now}</p>
  </div>
</body></html>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM,
        to: [client.email],
        subject: `⏰ Documenti richiesti — Pratica ${practice.numero_pratica}`,
        html: htmlBody,
      }),
    });
    const emailBody = await emailRes.json();
    if (!emailRes.ok) return new Response(JSON.stringify({ success: false, error: emailBody?.message ?? 'Errore Resend' }), { headers: CORS });

    // Log nel practice_status_log
    await supabase.from('practice_status_log').insert({
      practice_id,
      new_status: practice.status,
      note: `Sollecito inviato al cliente (${mancanti.length} mancanti, ${rifiutati.length} rifiutati)`,
      created_by: 'system',
    });

    return new Response(JSON.stringify({
      success: true,
      sent_to: client.email,
      mancanti: mancanti.length,
      rifiutati: rifiutati.length,
    }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { headers: CORS });
  }
});
