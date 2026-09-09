-- Conserva il periodo coperto dai bilanci provvisori per evitare confronti
-- impropri con gli esercizi annuali e consentire proiezioni trasparenti.
ALTER TABLE public.bilanci_kpi
  ADD COLUMN IF NOT EXISTS periodo_inizio DATE,
  ADD COLUMN IF NOT EXISTS periodo_fine DATE,
  ADD COLUMN IF NOT EXISTS mesi_coperti NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS is_provvisorio BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.bilanci_kpi.mesi_coperti IS
  'Mesi effettivamente coperti dal bilancio provvisorio; usato solo per annualizzare i flussi.';
COMMENT ON COLUMN public.bilanci_kpi.is_provvisorio IS
  'TRUE quando il documento è una situazione/bilancio infrannuale provvisorio.';
