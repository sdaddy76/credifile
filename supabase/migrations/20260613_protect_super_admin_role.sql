-- ============================================================
-- Protegge il ruolo super_admin di stefano@daddino.com
-- da qualsiasi upsert, update o insert accidentale
-- ============================================================

-- 1. Ripristina immediatamente il ruolo corretto
UPDATE admin_profiles
SET ruolo = 'super_admin'
WHERE email = 'stefano@daddino.com';

-- 2. Funzione trigger: forza ruolo = 'super_admin' per email protette
CREATE OR REPLACE FUNCTION protect_super_admin_role()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  protected_emails TEXT[] := ARRAY['stefano@daddino.com'];
BEGIN
  -- Se l'email (nuova o esistente) è nell'elenco protetto,
  -- forza sempre ruolo = 'super_admin' ignorando il valore passato
  IF NEW.email = ANY(protected_emails) THEN
    NEW.ruolo := 'super_admin';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Attacca il trigger su INSERT e UPDATE
DROP TRIGGER IF EXISTS trg_protect_super_admin_role ON admin_profiles;
CREATE TRIGGER trg_protect_super_admin_role
  BEFORE INSERT OR UPDATE ON admin_profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_super_admin_role();

-- 4. Verifica
SELECT id, email, ruolo FROM admin_profiles WHERE email = 'stefano@daddino.com';
