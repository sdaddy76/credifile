/**
 * Chiama la Vercel serverless function /api/send-to-bank
 * (sostituisce supabase.functions.invoke('send-to-bank') — BOOT_ERROR su questo progetto)
 */
export async function invokeSendToBank(body: {
  practice_id: string;
  bank_id: string;
  note?: string | null;
  integration_request_id?: string | null;
}): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) {
      return { data: null, error: { message: 'Sessione scaduta. Accedi nuovamente prima di inviare alla banca.' } };
    }

    const res = await fetch('/api/send-to-bank', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { data: null, error: { message: json.error ?? 'Errore invio email' } };
    }
    return { data: json, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}
