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
    const { to, consultant_name, documents, link, code, practice_number } = await req.json();

    if (!to || !consultant_name || !link || !code) {
      return new Response(JSON.stringify({ error: "Parametri mancanti" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const docListHtml = (documents as string[]).map((d) => `<li style="margin:4px 0;">${d}</li>`).join("");
    const docListText = (documents as string[]).map((d) => `  • ${d}`).join("\n");

    const htmlBody = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;color:#333;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1e40af;padding:20px 24px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:20px;">Richiesta Documenti</h1>
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
    <p>Gentile cliente,</p>
    <p>il consulente <strong>${consultant_name}</strong> ha richiesto dei documenti per iniziare la valutazione della sua azienda.</p>
    ${practice_number ? `<p style="color:#6b7280;font-size:13px;">Pratica: <code>${practice_number}</code></p>` : ""}
    <p><strong>Documenti richiesti:</strong></p>
    <ul style="background:white;border:1px solid #e2e8f0;border-radius:6px;padding:12px 12px 12px 28px;margin:8px 0;">${docListHtml}</ul>
    <p>Per caricare i documenti basta cliccare sul seguente link:</p>
    <div style="text-align:center;margin:20px 0;">
      <a href="${link}" style="background:#1e40af;color:white;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">Carica i Documenti</a>
    </div>
    <p>ed inserire il seguente codice:</p>
    <div style="text-align:center;margin:16px 0;">
      <span style="font-family:monospace;font-size:28px;font-weight:bold;letter-spacing:8px;color:#1e40af;background:#eff6ff;padding:12px 24px;border-radius:8px;border:2px solid #bfdbfe;">${code}</span>
    </div>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
    <p style="color:#6b7280;font-size:13px;">Per qualsiasi problema non esiti a contattare il suo consulente.</p>
    <p>Distinti Saluti<br><strong>${consultant_name}</strong></p>
  </div>
</body></html>`;

    const textBody = `Richiesta Documenti\n\nGentile cliente,\n\nil consulente ${consultant_name} ha richiesto dei documenti per iniziare la valutazione della sua azienda.\n\nDocumenti richiesti:\n${docListText}\n\nPer caricare i documenti basta cliccare sul seguente link:\n${link}\n\ned inserire il seguente codice: ${code}\n\nPer qualsiasi problema non esiti a contattare il suo consulente.\n\nDistinti Saluti\n${consultant_name}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: "Richiesta documenti", html: htmlBody, text: textBody }),
    });

    const resData = await res.json();
    if (!res.ok) {
      return new Response(JSON.stringify({ error: resData }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ success: true, id: resData.id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
