import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Content-Type': 'application/json',
};

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

    const SUPA_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPA_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
    const FROM = Deno.env.get('FROM_EMAIL') ?? 'DocFlow <docflow@stedasrls.it>';
    const APP = Deno.env.get('APP_URL') ?? 'https://credifile-eosin.vercel.app';

    const restHeaders = {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'return=representation',
    };

    // 1. Carica pratica + cliente
    const praticaRes = await fetch(
      `${SUPA_URL}/rest/v1/practices?id=eq.${encodeURIComponent(practice_id)}&select=*,clients(ragione_sociale,codice_fiscale)&limit=1`,
      { headers: restHeaders },
    );
    const praticaArr = await praticaRes.json();
    const pratica = praticaArr?.[0];
    if (!pratica) {
      return new Response(
        JSON.stringify({ success: false, error: 'Pratica non trovata' }),
        { headers: CORS },
      );
    }

    // 2. Carica practice_banks + banca
    const pbRes = await fetch(
      `${SUPA_URL}/rest/v1/practice_banks?practice_id=eq.${encodeURIComponent(practice_id)}&bank_id=eq.${encodeURIComponent(bank_id)}&select=*,banks(nome,email,email_invio_banca)&limit=1`,
      { headers: restHeaders },
    );
    const pbArr = await pbRes.json();
    const pb = pbArr?.[0];
    if (!pb) {
      return new Response(
        JSON.stringify({ success: false, error: 'Assegnazione banca non trovata' }),
        { headers: CORS },
      );
    }

    const bankEmail = pb.banks?.email_invio_banca || pb.banks?.email;
    if (!bankEmail) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email banca non configurata' }),
        { headers: CORS },
      );
    }

    // 3. Documenti approvati/caricati
    const docsRes = await fetch(
      `${SUPA_URL}/rest/v1/practice_documents?practice_id=eq.${encodeURIComponent(practice_id)}&status=in.(approvato,caricato)&select=*`,
      { headers: restHeaders },
    );
    const docs: { id: string; nome: string; file_path: string | null; status: string }[] =
      await docsRes.json() ?? [];

    // 4. Genera signed URL per ogni file
    const docLinks: { nome: string; url: string }[] = [];
    for (const doc of docs) {
      if (!doc.file_path) continue;
      const signRes = await fetch(
        `${SUPA_URL}/storage/v1/object/sign/practice-documents/${doc.file_path}`,
        {
          method: 'POST',
          headers: restHeaders,
          body: JSON.stringify({ expiresIn: 604800 }),
        },
      );
      if (signRes.ok) {
        const signData = await signRes.json();
        const signedUrl = signData?.signedURL
          ? `${SUPA_URL}/storage/v1${signData.signedURL}`
          : signData?.signedUrl;
        if (signedUrl) docLinks.push({ nome: doc.nome, url: signedUrl });
      }
    }

    // 5. Componi email HTML
    const cliente =
      pratica.clients?.ragione_sociale ?? pratica.clients?.codice_fiscale ?? 'N/D';
    const notaHtml = note
      ? `<p style="color:#555;"><strong>Note:</strong> ${note}</p>`
      : '';
    const docsHtml =
      docLinks.length > 0
        ? docLinks
            .map(
              (d) =>
                `<li style="margin:6px 0;"><a href="${d.url}" style="color:#2563eb;">${d.nome}</a> <span style="font-size:11px;color:#888;">(link valido 7 giorni)</span></li>`,
            )
            .join('')
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

    // 6. Invia email via Resend
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [bankEmail],
        subject: `Pratica ${cliente} — Credifile`,
        html: htmlBody,
      }),
    });
    const emailBody = await emailRes.json();
    if (!emailRes.ok) {
      return new Response(
        JSON.stringify({ success: false, error: emailBody?.message ?? 'Errore Resend' }),
        { headers: CORS },
      );
    }

    // 7. Aggiorna practice_banks → status 'inviata'
    await fetch(
      `${SUPA_URL}/rest/v1/practice_banks?practice_id=eq.${encodeURIComponent(practice_id)}&bank_id=eq.${encodeURIComponent(bank_id)}`,
      {
        method: 'PATCH',
        headers: restHeaders,
        body: JSON.stringify({
          status: 'inviata',
          data_invio: new Date().toISOString(),
          note: note ?? null,
        }),
      },
    );

    return new Response(
      JSON.stringify({ success: true, sent_to: bankEmail, docs_sent: docLinks.length }),
      { headers: CORS },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: String(e) }),
      { headers: CORS },
    );
  }
});
