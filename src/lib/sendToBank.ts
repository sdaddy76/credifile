/**
 * Chiama la Vercel serverless function /api/send-to-bank
 * (sostituisce supabase.functions.invoke('send-to-bank') — BOOT_ERROR su questo progetto)
 */
export async function invokeSendToBank(body: {
  practice_id: string;
  bank_id: string;
  note?: string | null;
}): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
  try {
    const res = await fetch('/api/send-to-bank', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
