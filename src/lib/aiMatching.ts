/** Chiama /api/ai-matching-banche (Vercel serverless, sostituisce edge function con BOOT_ERROR) */
export async function invokeAiMatching(body: { practice_id: string }): Promise<{
  data: Record<string, unknown> | null;
  error: { message: string } | null;
}> {
  try {
    const res = await fetch('/api/ai-matching-banche', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      return { data: null, error: { message: json.error ?? 'Errore matching' } };
    }
    return { data: json, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}
