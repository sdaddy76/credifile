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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ success: false, error: 'No auth' }), { headers: CORS });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    );

    // Valida JWT e ottieni utente
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return new Response(JSON.stringify({ success: false, error: 'Token non valido' }), { headers: CORS });

    // Leggi IP reale (Vercel mette l'IP in x-forwarded-for)
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || req.headers.get('x-real-ip')
      || 'unknown';
    const userAgent = req.headers.get('user-agent') || '';

    // Controlla se IP già visto per questo utente
    const { data: existing } = await supabase
      .from('user_access_logs')
      .select('id')
      .eq('user_id', user.id)
      .eq('ip_address', ip)
      .limit(1);

    const isNewIp = !existing || existing.length === 0;

    // Salva il log
    await supabase.from('user_access_logs').insert({
      user_id: user.id,
      ip_address: ip,
      user_agent: userAgent,
      is_new_ip: isNewIp,
    });

    // Se IP nuovo → email di avviso
    if (isNewIp) {
      const { data: profile } = await supabase
        .from('admin_profiles')
        .select('nome')
        .eq('id', user.id)
        .maybeSingle();

      const userEmail = user.email;
      const nome = profile?.nome || 'Utente';
      const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
      const FROM = Deno.env.get('FROM_EMAIL') ?? 'Credifile <docflow@stedasrls.it>';
      const APP = Deno.env.get('APP_URL') ?? 'https://credifile-eosin.vercel.app';
      const now = new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' });

      if (userEmail) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
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
<p style="color:#dc2626;">❌ <strong>Non sei stato tu?</strong> Cambia immediatamente la password accedendo a <a href="${APP}">${APP}</a></p>
<hr style="margin:24px 0;border:none;border-top:1px solid #eee;">
<p style="font-size:12px;color:#999;text-align:center;">Credifile — Sistema di gestione documentale finanziaria</p>
</body></html>`,
          }),
        });
      }
    }

    return new Response(JSON.stringify({ success: true, is_new_ip: isNewIp, ip }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), { headers: CORS });
  }
});
