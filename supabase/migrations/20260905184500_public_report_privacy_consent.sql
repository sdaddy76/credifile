-- Tracciamento del consenso raccolto dal modulo pubblico di richiesta
-- valutazione/report autonomo impresa.

ALTER TABLE public.segnalazioni_pubbliche
  ADD COLUMN IF NOT EXISTS privacy_consent_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_consent_version text,
  ADD COLUMN IF NOT EXISTS privacy_consent_text text,
  ADD COLUMN IF NOT EXISTS privacy_consent_user_agent text;

COMMENT ON COLUMN public.segnalazioni_pubbliche.privacy_consent_accepted_at IS
  'Data e ora dell autorizzazione privacy accettata nel modulo pubblico.';

COMMENT ON COLUMN public.segnalazioni_pubbliche.privacy_consent_text IS
  'Copia esatta del testo di autorizzazione accettato nel modulo pubblico.';
