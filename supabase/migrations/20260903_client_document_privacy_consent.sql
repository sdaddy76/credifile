ALTER TABLE practice_access_codes
  ADD COLUMN IF NOT EXISTS privacy_consent_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_consent_version text,
  ADD COLUMN IF NOT EXISTS privacy_consent_text text,
  ADD COLUMN IF NOT EXISTS privacy_consent_email text,
  ADD COLUMN IF NOT EXISTS privacy_consent_user_agent text;

COMMENT ON COLUMN practice_access_codes.privacy_consent_accepted_at IS
  'Data e ora in cui il cliente ha accettato l autorizzazione privacy della pratica.';

COMMENT ON COLUMN practice_access_codes.privacy_consent_version IS
  'Versione del testo di autorizzazione privacy accettato dal cliente.';

COMMENT ON COLUMN practice_access_codes.privacy_consent_text IS
  'Copia esatta del testo di autorizzazione privacy accettato dal cliente.';
