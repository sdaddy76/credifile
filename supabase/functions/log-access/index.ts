import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ success: false, error: 'No auth' }), { headers: CORS });

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const RESEND_KEY   = Deno.env.get('RESEND_API_KEY') ?? '';
    const FROM         = Deno.env.get('FROM_EMAIL') ?? 'Credifile <docflow@stedasrls.it>';
    const APP          = Deno.env.get('APP_URL') ?? 'https://credifile-eosin.vercel.app';

    const svcHeaders = {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    };

    // ── Valida JWT e ottieni utente ──────────────────────────────────────────
    const token = authHeader.replace('Bearer ', '');
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` },
    });
    if (!userRes.ok) return new Response(JSON.stringify({ success: false, error: 'Token non valido' }), { headers: CORS });
    const userData = await userRes.json();
    const userId    = userData?.id;
    const userEmail = userData?.email;
    if (!userId) return new Response(JSON.stringify({ success: false, error: 'Utente non trovato' }), { headers: CORS });

    // ── IP reale ─────────────────────────────────────────────────────────────
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    const userAgent = req.headers.get('user-agent') || '';

    // ── Controlla se IP già visto per questo utente ──────────────────────────
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_access_logs?user_id=eq.${userId}&ip_address=eq.${encodeURIComponent(ip)}&select=id&limit=1`,
      { headers: svcHeaders }
    );
    const existing = existRes.ok ? await existRes.json() : [];
    const isNewIp  = !Array.isArray(existing) || existing.length === 0;

    // ── Salva il log ─────────────────────────────────────────────────────────
    await fetch(`${SUPABASE_URL}/rest/v1/user_access_logs`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: userId, ip_address: ip, user_agent: userAgent, is_new_ip: isNewIp }),
    });

    // ── Se IP nuovo → email di avviso ────────────────────────────────────────
    if (isNewIp && userEmail && RESEND_KEY) {
      const profRes = await fetch(
        `${SUPABASE_URL}/rest/v1/admin_profiles?id=eq.${userId}&select=nome&limit=1`,
        { headers: svcHeaders }
      );
      const profData = profRes.ok ? await profRes.json() : [];
      const nome = profData[0]?.nome || 'Utente';
      const now  = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [userEmail],
          subject: '⚠️ Nuovo accesso da IP sconosciuto — Credifile',
          html: `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:auto;padding:24px;color:#333;">
<div style="text-align:center;margin-bottom:24px;">
  <div style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 20px;border-radius:8px;font-size:20px;font-weight:700;">Credifile</div>
</div>
<h2 style="color:#dc2626;">⚠️ Nuovo accesso rilevato</h2>
<p>Ciao <strong>${nome}</strong>,</p>
<p>È stato effettuato un accesso al tuo account da un <strong>indirizzo IP non riconosciuto</strong>.</p>
<table style="width:100%;background:#f8f9fa;border-radius:8px;padding:16px;margin:16px 0;border-collapse:collapse;">
  <tr><td style="padding:8px 12px;color:#666;width:120px;">IP Address</td><td style="padding:8px 12px;font-weight:700;font-family:monospace;">${ip}</td></tr>
  <tr style="background:#fff;"><td style="padding:8px 12px;color:#666;">Dispositivo</td><td style="padding:8px 12px;font-size:12px;color:#888;">${userAgent.substring(0, 120)}</td></tr>
  <tr><td style="padding:8px 12px;color:#666;">Data e ora</td><td style="padding:8px 12px;">${now}</td></tr>
</table>
<p>✅ <strong>Sei stato tu?</strong> Puoi ignorare questa email. L'IP verrà riconosciuto ai prossimi accessi.</p>
<p style="color:#dc2626;">❌ <strong>Non sei stato tu?</strong> Cambia immediatamente la password: <a href="${APP}">${APP}</a></p>
<hr style="margin:24px 0;border:none;border-top:1px solid #eee;">
<p style="font-size:12px;color:#999;text-align:center;">Credifile — Sistema di gestione documentale finanziaria</p>
</body></html>`,
        }),
      });
    }

    return new Response(JSON.stringify({ success: true, is_new_ip: isNewIp, ip }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { headers: CORS, status: 500 });
  }
});
