const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "onboarding@resend.dev";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const { to, consultant_name, documents, link, code, practice_number, company_name, cc, reply_to } = await req.json();

    if (!to || !consultant_name || !link || !code) {
      return new Response(JSON.stringify({ success: false, error: "Parametri mancanti" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ success: false, error: "RESEND_API_KEY non configurata" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const docListHtml = (documents as string[] ?? []).map((d) => `<li style="margin:4px 0;">${d}</li>`).join("");
    const docListText = (documents as string[] ?? []).map((d) => `  • ${d}`).join("\n");

    // Oggetto con nome azienda se disponibile
    const subject = company_name
      ? `Richiesta documenti — ${company_name}`
      : "Richiesta documenti per la vostra pratica";

    // Intestazione con nome azienda
    const companyLine = company_name
      ? `<p style="font-size:15px;">In riferimento all'azienda <strong>${company_name}</strong>, il consulente <strong>${consultant_name}</strong> ha richiesto i seguenti documenti per avviare la valutazione della pratica.</p>`
      : `<p>Il consulente <strong>${consultant_name}</strong> ha richiesto dei documenti per iniziare la valutazione della sua azienda.</p>`;

    const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1e40af;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:20px;">Richiesta Documenti</h1>
    ${company_name ? `<p style="color:#bfdbfe;margin:4px 0 0 0;font-size:14px;">${company_name}</p>` : ""}
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
    <p>Gentile cliente,</p>
    ${companyLine}
    ${practice_number ? `<p style="color:#6b7280;font-size:13px;">Numero pratica: <code>${practice_number}</code></p>` : ""}
    <p><strong>Documenti richiesti:</strong></p>
    <ul style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:12px 12px 12px 28px;margin:8px 0;">${docListHtml}</ul>
    <p>Per caricare i documenti clicca sul seguente link:</p>
    <div style="text-align:center;margin:20px 0;">
      <a href="${link}" style="background:#1e40af;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Carica i Documenti</a>
    </div>
    <p>e inserisci il seguente codice di accesso:</p>
    <div style="text-align:center;margin:16px 0;">
      <span style="font-family:monospace;font-size:28px;font-weight:bold;letter-spacing:8px;color:#1e40af;background:#eff6ff;padding:12px 24px;border-radius:8px;border:2px solid #bfdbfe;">${code}</span>
    </div>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
    <p style="color:#6b7280;font-size:13px;">Per qualsiasi problema non esiti a contattare il suo consulente.</p>
    <p>Distinti Saluti<br><strong>${consultant_name}</strong></p>
  </div>
</body></html>`;

    const textBody = `Richiesta Documenti${company_name ? ` — ${company_name}` : ""}\n\nGentile cliente,\n\nIl consulente ${consultant_name} ha richiesto dei documenti${company_name ? ` per l'azienda ${company_name}` : ""}.\n\nDocumenti richiesti:\n${docListText}\n\nLink: ${link}\nCodice: ${code}\n\nDistinti Saluti\n${consultant_name}`;

    const emailPayload: Record<string, unknown> = { from: FROM_EMAIL, to: [to], subject, html: htmlBody, text: textBody };
    if (cc) emailPayload.cc = Array.isArray(cc) ? cc : [cc];
    if (typeof reply_to === "string" && reply_to.trim()) emailPayload.reply_to = reply_to.trim();

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });

    const resData = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ success: false, error: resData }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true, id: resData.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
