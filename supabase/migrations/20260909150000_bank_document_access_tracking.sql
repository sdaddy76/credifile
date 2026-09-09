-- Tracciamento per singolo documento inviato alla banca.
-- I link sono temporanei e il tracker registra l'intenzione di apertura
-- o download prima di reindirizzare al file storage.
CREATE TABLE IF NOT EXISTS public.bank_document_access_links (
  token TEXT PRIMARY KEY,
  practice_id UUID NOT NULL,
  bank_id UUID NOT NULL,
  practice_document_id UUID,
  uploaded_file_id UUID,
  relation_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'downloaded')),
  target_url TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_document_access_links_lookup
  ON public.bank_document_access_links (practice_id, bank_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bank_document_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL REFERENCES public.bank_document_access_links(token) ON DELETE CASCADE,
  practice_id UUID NOT NULL,
  bank_id UUID NOT NULL,
  practice_document_id UUID,
  uploaded_file_id UUID,
  relation_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN ('opened', 'downloaded')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  referer TEXT
);

CREATE INDEX IF NOT EXISTS idx_bank_document_access_logs_document
  ON public.bank_document_access_logs (practice_id, bank_id, uploaded_file_id, occurred_at DESC);

ALTER TABLE public.bank_document_access_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_document_access_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_manage_bank_document_access_links" ON public.bank_document_access_links;
CREATE POLICY "service_manage_bank_document_access_links"
  ON public.bank_document_access_links FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "staff_read_bank_document_access_links" ON public.bank_document_access_links;
CREATE POLICY "staff_read_bank_document_access_links"
  ON public.bank_document_access_links FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE id = auth.uid()
      AND ruolo IN ('super_admin', 'segreteria', 'agente', 'consulente', 'segnalatore')
  ));

DROP POLICY IF EXISTS "service_manage_bank_document_access_logs" ON public.bank_document_access_logs;
CREATE POLICY "service_manage_bank_document_access_logs"
  ON public.bank_document_access_logs FOR ALL TO service_role
  USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "staff_read_bank_document_access_logs" ON public.bank_document_access_logs;
CREATE POLICY "staff_read_bank_document_access_logs"
  ON public.bank_document_access_logs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_profiles
    WHERE id = auth.uid()
      AND ruolo IN ('super_admin', 'segreteria', 'agente', 'consulente', 'segnalatore')
  ));
