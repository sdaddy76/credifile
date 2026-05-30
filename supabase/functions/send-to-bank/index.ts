import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const { practice_id, bank_id, note } = await req.json();
    if (!practice_id || !bank_id) return new Response(JSON.stringify({ success: false, error: 'practice_id e bank_id obbligatori' }), { headers: CORS });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
    const FROM = Deno.env.get('FROM_EMAIL') ?? 'DocFlow <docflow@stedasrls.it>';
    const APP = Deno.env.get('APP_URL') ?? 'https://credifile-eosin.vercel.app';

    // Carica pratica + cliente
    const { data: pratica } = await supabase.from('practices').select('*, clients(ragione_sociale,codice_fiscale)').eq('id', practice_id).single();
    if (!pratica) return new Response(JSON.stringify({ success: false, error: 'Pratica non trovata' }), { headers: CORS });

    // Carica banca dalla practice_banks
    const { data: pb } = await supabase.from('practice_banks').select('*, banks(nome,email,email_invio_banca)').eq('practice_id', practice_id).eq('bank_id', bank_id).single();
    if (!pb) return new Response(JSON.stringify({ success: false, error: 'Assegnazione banca non trovata' }), { headers: CORS });

    const bankEmail = pb.banks?.email_invio_banca || pb.banks?.email;
    if (!bankEmail) return new Response(JSON.stringify({ success: false, error: 'Email banca non configurata' }), { headers: CORS });

    // Documenti approvati/caricati
    const { data: docs } = await supabase.from('practice_documents').select('*').eq('practice_id', practice_id).in('status', ['approvato', 'caricato']);

    // Genera signed URL per ogni documento con file_path
    const docLinks: { nome: string; url: string }[] = [];
    for (const doc of docs ?? []) {
      if (!doc.file_path) continue;
      const { data: signed } = await supabase.storage.from('practice-documents').createSignedUrl(doc.file_path, 604800);
      if (signed?.signedUrl) docLinks.push({ nome: doc.nome, url: signed.signedUrl });
    }

    const cliente = pratica.clients?.ragione_sociale ?? pratica.clients?.codice_fiscale ?? 'N/D';
    const notaHtml = note ? `<p style="color:#555;"><strong>Note:</strong> ${note}</p>` : '';
    const docsHtml = docLinks.length > 0
      ? docLinks.map(d => `<li style="margin:6px 0;"><a href="${d.url}" style="color:#2563eb;">${d.nome}</a> <span style="font-size:11px;color:#888;">(link valido 7 giorni)</span></li>`).join('')
      : '<li style="color:#888;">Nessun documento caricato disponibile</li>';

    const htmlBody = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;">
<h2 style="color:#1e3a5f;">Credifile — Pratica inviata</h2>
<p>Gentile <strong>${pb.banks?.nome}</strong>,</p>
<p>Le trasmettiamo la documentazione relativa alla pratica di <strong>${cliente}</strong>.</p>
${notaHtml}
<h3 style="color:#1e3a5f;margin-top:20px;">Documenti allegati:</h3>
<ul>${docsHtml}</ul>
<p style="margin-top:24px;font-size:12px;color:#999;">Questo messaggio è stato inviato automaticamente da <a href="${APP}">Credifile</a>.</p>
</body></html>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [bankEmail], subject: `Pratica ${cliente} — Credifile`, html: htmlBody }),
    });
    const resBody = await res.json();
    if (!res.ok) return new Response(JSON.stringify({ success: false, error: resBody?.message ?? 'Errore Resend' }), { headers: CORS });

    // Aggiorna practice_banks
    await supabase.from('practice_banks').update({ status: 'inviata', data_invio: new Date().toISOString(), note: note ?? null }).eq('practice_id', practice_id).eq('bank_id', bank_id);

    return new Response(JSON.stringify({ success: true, sent_to: bankEmail, docs_sent: docLinks.length }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { headers: CORS });
  }
});
