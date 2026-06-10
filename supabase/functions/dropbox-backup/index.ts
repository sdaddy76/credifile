const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DBX_APP_KEY    = Deno.env.get("DROPBOX_APP_KEY")!;
const DBX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DBX_REFRESH    = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

async function getDropboxToken(): Promise<string> {
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": "Basic " + btoa(`${DBX_APP_KEY}:${DBX_APP_SECRET}`),
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(DBX_REFRESH)}`,
  });
  if (!r.ok) throw new Error("Token error: " + await r.text());
  return (await r.json()).access_token;
}

async function queryTable(table: string): Promise<unknown[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!r.ok) { console.warn(`Skip ${table}: ${r.status}`); return []; }
  return await r.json();
}

async function dropboxUpload(token: string, path: string, body: string): Promise<void> {
  const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", mute: true }),
      "Content-Type": "application/octet-stream",
    },
    body: new TextEncoder().encode(body),
  });
  if (!r.ok) throw new Error("Upload error: " + await r.text());
}

Deno.serve(async (req) => {
  // Gestione preflight CORS (richieste browser)
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const now    = new Date().toISOString().split("T")[0];
    const tables = [
      "practices","clients","banks","admin_profiles","uploaded_files",
      "practice_documents","practice_banks","leads","document_templates",
    ];
    const backup: Record<string, unknown> = { _meta: { date: now, tables } };
    for (const t of tables) backup[t] = await queryTable(t);

    const json  = JSON.stringify(backup, null, 2);
    const token = await getDropboxToken();
    await dropboxUpload(token, `/Apps/Credifile/backups/backup_${now}.json`, json);
    await dropboxUpload(token, "/Apps/Credifile/backups/backup_latest.json",  json);

    const kb = Math.round(json.length / 1024);
    return new Response(JSON.stringify({ ok: true, date: now, size_kb: kb }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
