-- Passività correnti esplicite: necessarie per Current Ratio, Quick Ratio
-- e Acid Test. Non viene ricostruita dal totale debiti.
ALTER TABLE public.bilanci_kpi
  ADD COLUMN IF NOT EXISTS passivita_correnti NUMERIC(15,2);

COMMENT ON COLUMN public.bilanci_kpi.passivita_correnti IS
  'Passività con scadenza entro l’esercizio; se non estratte resta NULL e i ratio di liquidità risultano non disponibili.';
