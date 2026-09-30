// Crea un utente interno tramite Supabase Admin API.
// Il client non riceve mai la service role key: l'endpoint verifica il
// chiamante e gestisce auth.users, admin_profiles e l'eventuale assegnazione.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fhieppjqlefdlanvrpik.supabase.co';
// Le variabili VITE_* sono disponibili al build client, ma non sempre vengono
// esposte al runtime delle Serverless Function. La anon key è pubblica per
// definizione e viene mantenuta come fallback per validare la sessione Auth.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
  || process.env.VITE_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZoaWVwcGpxbGVmZGxhbnZycGlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNTYxOTksImV4cCI6MjA5NTYzMjE5OX0.tM0B5OyxF1-w9ed1-eEX09S_d5gehZnFUZEJCnXMVBQ';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-supabase-anon-key',
  'Content-Type': 'application/json',
};

const reply = (res, payload) => res.status(200).json(payload);

const restHeaders = () => ({
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});

async function readJson(response) {
  return response.json().catch(() => ({}));
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return reply(res, { success: false, error: 'Metodo non consentito' });

  try {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return reply(res, { success: false, error: 'Configurazione server mancante: SUPABASE_SERVICE_ROLE_KEY' });
    }

    const authorization = req.headers.authorization || '';
    const accessToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    if (!accessToken) return reply(res, { success: false, error: 'Sessione non autorizzata' });

    const browserAnonKey = req.headers['x-supabase-anon-key'];
    const authApiKey = typeof browserAnonKey === 'string' && browserAnonKey.trim()
      ? browserAnonKey.trim()
      : SUPABASE_ANON_KEY;
    const callerResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: authApiKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const caller = await readJson(callerResponse);
    if (!callerResponse.ok || !caller?.id) {
      return reply(res, {
        success: false,
        error: `Sessione non riconosciuta dal progetto Supabase (HTTP ${callerResponse.status}). Aggiorna la pagina e accedi nuovamente.`,
      });
    }

    const callerProfileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_profiles?id=eq.${encodeURIComponent(caller.id)}&select=ruolo&limit=1`,
      { headers: restHeaders() },
    );
    const callerProfiles = await readJson(callerProfileResponse);
    if (!callerProfileResponse.ok || callerProfiles?.[0]?.ruolo !== 'super_admin') {
      return reply(res, { success: false, error: 'Solo il Super Admin può creare utenti da questa sezione' });
    }

    const body = req.body ?? {};
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const nome = String(body.nome ?? '').trim() || null;
    const ruolo = String(body.ruolo ?? '').trim();
    const agentId = body.agent_id ? String(body.agent_id) : '';
    const allowedRoles = new Set(['agente', 'supervisore_segreteria', 'segnalatore']);

    if (!email || !password || !ruolo) {
      return reply(res, { success: false, error: 'Email, password e ruolo sono obbligatori' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply(res, { success: false, error: 'Formato email non valido' });
    }
    if (password.length < 6) {
      return reply(res, { success: false, error: 'La password deve contenere almeno 6 caratteri' });
    }
    if (!allowedRoles.has(ruolo)) {
      return reply(res, { success: false, error: 'Ruolo non consentito da questa sezione' });
    }
    if (ruolo === 'segnalatore' && agentId && !/^[0-9a-f-]{36}$/i.test(agentId)) {
      return reply(res, { success: false, error: 'Agente associato non valido' });
    }

    const existingProfileResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/admin_profiles?email=eq.${encodeURIComponent(email)}&select=id,ruolo&limit=1`,
      { headers: restHeaders() },
    );
    const existingProfiles = await readJson(existingProfileResponse);
    if (!existingProfileResponse.ok) {
      return reply(res, { success: false, error: 'Impossibile verificare gli account esistenti' });
    }
    if (existingProfiles?.[0]) {
      return reply(res, {
        success: false,
        error: `Un account con email ${email} esiste già (ruolo: ${existingProfiles[0].ruolo ?? 'non specificato'})`,
      });
    }

    const createResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: restHeaders(),
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { nome },
      }),
    });
    const createdUser = await readJson(createResponse);
    if (!createResponse.ok || !createdUser?.id) {
      const message = createdUser?.message || createdUser?.msg || createdUser?.error_description;
      return reply(res, {
        success: false,
        error: message
          ? `Impossibile creare l'account: ${message}`
          : `Impossibile creare l'account (errore Supabase ${createResponse.status})`,
      });
    }

    const userId = createdUser.id;
    let profileCreated = false;
    try {
      const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/admin_profiles`, {
        method: 'POST',
        headers: {
          ...restHeaders(),
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({ id: userId, email, nome, ruolo }),
      });
      const profileBody = await readJson(profileResponse);
      if (!profileResponse.ok) {
        throw new Error(profileBody?.message || profileBody?.hint || 'profilo admin non creato');
      }
      profileCreated = true;

      if (ruolo === 'segnalatore' && agentId) {
        const linkResponse = await fetch(`${SUPABASE_URL}/rest/v1/agent_segnalatori`, {
          method: 'POST',
          headers: {
            ...restHeaders(),
            Prefer: 'resolution=merge-duplicates,return=minimal',
          },
          body: JSON.stringify({ agent_id: agentId, segnalatore_id: userId }),
        });
        const linkBody = await readJson(linkResponse);
        if (!linkResponse.ok) {
          throw new Error(linkBody?.message || linkBody?.hint || 'collegamento all’agente non creato');
        }
      }
    } catch (error) {
      if (profileCreated) {
        await fetch(`${SUPABASE_URL}/rest/v1/admin_profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          headers: restHeaders(),
        }).catch(() => {});
      }
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: restHeaders(),
      }).catch(() => {});
      return reply(res, {
        success: false,
        error: `Account non completato: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    return reply(res, { success: true, id: userId });
  } catch (error) {
    return reply(res, {
      success: false,
      error: `Errore durante la creazione: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
