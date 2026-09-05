-- Checklist documentale FinPromoter condizionata alla tipologia aziendale
-- e alle condizioni della pratica.

ALTER TABLE public.bank_document_requirements
  ADD COLUMN IF NOT EXISTS condizione TEXT NOT NULL DEFAULT 'sempre';

ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS tipologia_azienda TEXT DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS regime_contabile TEXT,
  ADD COLUMN IF NOT EXISTS checklist_condizioni JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE
  v_bank_id UUID;
BEGIN
  SELECT id
    INTO v_bank_id
    FROM public.banks
   WHERE lower(nome) = 'finpromoter'
      OR upper(codice) IN ('FINPRO', 'FINPROMOTER')
   ORDER BY CASE WHEN lower(nome) = 'finpromoter' THEN 0 ELSE 1 END
   LIMIT 1;

  IF v_bank_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.bank_document_requirements
    (bank_id, nome, descrizione, obbligatorio, ordine, condizione)
  SELECT
    v_bank_id, seed.nome, seed.descrizione, seed.obbligatorio, seed.ordine, seed.condizione
  FROM (VALUES
    ('Visura camerale',
     'Visura camerale aggiornata della richiedente.',
     TRUE, 10, 'sempre'),
    ('Documenti identità e tessere sanitarie — legale rappresentante, amministratore e titolari effettivi',
     'Copia fronte/retro in corso di validità del documento di identità e della tessera sanitaria.',
     TRUE, 20, 'sempre'),
    ('Cellulari ed e-mail — legale rappresentante, amministratore e titolari effettivi',
     'Recapiti aggiornati dei soggetti indicati.',
     TRUE, 30, 'sempre'),
    ('Ultimi due bilanci approvati completi + dati provvisori di bilancio',
     'Per società di capitali: ultimi due bilanci approvati completi di tutte le parti inscindibili, oltre a Stato Patrimoniale e Conto Economico provvisori aggiornati.',
     TRUE, 40, 'societa_capitali'),
    ('Ultime due dichiarazioni dei redditi + situazioni contabili complete + dati provvisori',
     'Per società di persone e imprese individuali in contabilità ordinaria: UNICO e IRAP con attestazioni di invio, ultime due situazioni contabili complete di Stato Patrimoniale e Conto Economico timbrate e firmate, e dati provvisori aggiornati.',
     TRUE, 50, 'persone_ordinaria'),
    ('Ultime due dichiarazioni dei redditi + situazioni contabili + dati provvisori di Conto Economico',
     'Per società di persone e imprese individuali in contabilità semplificata: UNICO e IRAP con attestazioni di invio, ultime due situazioni contabili complete di Conto Economico timbrate e firmate, e dati provvisori aggiornati.',
     TRUE, 60, 'persone_semplificata'),
    ('Estratti conto degli ultimi 6 mesi delle banche principali',
     'Estratti conto completi relativi agli ultimi sei mesi.',
     TRUE, 70, 'sempre'),
    ('Documentazione imprese collegate/associate',
     'Solo se presenti imprese collegate o associate: per tutte le società del gruppo, ultimi due bilanci approvati oppure ultime due dichiarazioni dei redditi (UNICO e IRAP), secondo la forma giuridica.',
     TRUE, 80, 'gruppo'),
    ('Libro soci con specifica delle quote',
     'Richiesto solo per le società cooperative.',
     TRUE, 90, 'cooperativa'),
    ('Relazione sullo scopo e sulla natura dell’operazione',
     'Descrizione della finalità, dello scopo e della natura dell’operazione.',
     TRUE, 100, 'sempre'),
    ('Documentazione relativa agli investimenti',
     'Solo in caso di investimenti: preventivi, preliminare di compravendita, fatture e pagamenti; per acquisizione di azienda o ramo, visura e documentazione contabile del cedente.',
     TRUE, 110, 'investimento'),
    ('Documenti dei garanti',
     'Solo in presenza di garanti: documento di identità, tessera sanitaria e ultima dichiarazione dei redditi personale.',
     TRUE, 120, 'garante'),
    ('Mandato di mediazione firmato',
     'Solo per pratiche presentate da mediatori: mandato firmato da cliente e mediatore.',
     TRUE, 130, 'mediazione'),
    ('Statuto per ammissione a socio FinPromoter',
     'Solo se viene richiesta l’ammissione come socio FinPromoter.',
     FALSE, 140, 'ammissione_socio'),
    ('Atto costitutivo per ammissione a socio FinPromoter',
     'Solo se viene richiesta l’ammissione come socio FinPromoter.',
     FALSE, 150, 'ammissione_socio')
  ) AS seed(nome, descrizione, obbligatorio, ordine, condizione)
  WHERE NOT EXISTS (
    SELECT 1
      FROM public.bank_document_requirements existing
     WHERE existing.bank_id = v_bank_id
       AND lower(existing.nome) = lower(seed.nome)
       AND existing.condizione = seed.condizione
  );

  -- La relazione sull'operazione è parte della checklist base FinPromoter:
  -- riallinea eventuali configurazioni storiche lasciate facoltative.
  UPDATE public.bank_document_requirements
     SET obbligatorio = TRUE
   WHERE bank_id = v_bank_id
     AND lower(nome) = lower('Relazione sullo scopo e sulla natura dell’operazione')
     AND condizione = 'sempre';

  -- Rimuove il vecchio requisito equivalente solo se non è mai stato
  -- utilizzato in una pratica, evitando duplicazioni nella checklist.
  DELETE FROM public.bank_document_requirements legacy
   WHERE legacy.bank_id = v_bank_id
     AND lower(legacy.nome) = lower('Estratti conto su 6 mesi delle banche principali')
     AND NOT EXISTS (
       SELECT 1
         FROM public.practice_documents pd
        WHERE pd.bank_requirement_id = legacy.id
     );
END $$;

CREATE INDEX IF NOT EXISTS idx_bank_document_requirements_condition
  ON public.bank_document_requirements(bank_id, condizione, ordine);
