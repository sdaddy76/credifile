// api/send-whatsapp.js
// Invia messaggio WhatsApp via Twilio Business API
// Env vars richieste: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
// (es. TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886" per sandbox Twilio)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { to, message, practice_numero, cliente } = req.body ?? {};

    if (!to || !message) {
      return res.status(400).json({ success: false, error: 'Parametri mancanti: to, message' });
    }

    const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
    const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
    const FROM        = process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886';

    if (!ACCOUNT_SID || !AUTH_TOKEN) {
      return res.status(503).json({
        success: false,
        error: 'WhatsApp non configurato. Aggiungi TWILIO_ACCOUNT_SID e TWILIO_AUTH_TOKEN nelle variabili d\'ambiente Vercel.',
      });
    }

    // Formatta il numero di telefono: rimuovi spazi, aggiungi +39 se mancante il +
    let toNumber = to.replace(/\s+/g, '').replace(/^0/, '+390');
    if (!toNumber.startsWith('+')) toNumber = '+39' + toNumber;
    const toWhatsApp = `whatsapp:${toNumber}`;

    // Componi messaggio
    const fullMessage = message
      || `Gentile ${cliente ?? 'Cliente'},\n\nLa informiamo che per la pratica n° ${practice_numero ?? ''} è disponibile un aggiornamento su Credifile.\n\nIl suo consulente`;

    // Chiama Twilio REST API
    const params = new URLSearchParams();
    params.append('From', FROM);
    params.append('To', toWhatsApp);
    params.append('Body', fullMessage);

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
    );

    const twilioData = await twilioRes.json();

    if (!twilioRes.ok) {
      return res.status(502).json({
        success: false,
        error: twilioData?.message ?? 'Errore Twilio',
        code: twilioData?.code,
      });
    }

    return res.status(200).json({
      success: true,
      message_sid: twilioData.sid,
      to: toWhatsApp,
      status: twilioData.status,
    });

  } catch (e) {
    console.error('send-whatsapp error:', e);
    return res.status(500).json({ success: false, error: String(e) });
  }
}
