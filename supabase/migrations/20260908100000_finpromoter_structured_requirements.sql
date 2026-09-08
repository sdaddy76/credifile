-- Checklist FinPromoter: distingue upload, testo e contatti strutturati.
-- Mantiene le risposte nella richiesta della pratica per renderle disponibili
-- al cliente, all'agente e all'invio banca.

ALTER TABLE public.bank_document_requirements
  ADD COLUMN IF NOT EXISTS input_type TEXT NOT NULL DEFAULT 'upload';

ALTER TABLE public.practice_documents
  ADD COLUMN IF NOT EXISTS input_type TEXT NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS client_response JSONB,
  ADD COLUMN IF NOT EXISTS response_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'bank_document_requirements_input_type_check'
       AND conrelid = 'public.bank_document_requirements'::regclass
  ) THEN
    ALTER TABLE public.bank_document_requirements
      ADD CONSTRAINT bank_document_requirements_input_type_check
      CHECK (input_type IN ('upload', 'text', 'contacts'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'practice_documents_input_type_check'
       AND conrelid = 'public.practice_documents'::regclass
  ) THEN
    ALTER TABLE public.practice_documents
      ADD CONSTRAINT practice_documents_input_type_check
      CHECK (input_type IN ('upload', 'text', 'contacts'));
  END IF;
END $$;

DO $$
DECLARE
  v_bank_id UUID;
  target RECORD;
  source RECORD;
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

  UPDATE public.bank_document_requirements
     SET input_type = 'contacts',
         descrizione = 'Inserire nome, cognome, e-mail e cellulare del legale rappresentante, dell’amministratore e di ciascun titolare effettivo.'
   WHERE bank_id = v_bank_id
     AND lower(nome) = lower('Cellulari ed e-mail — legale rappresentante, amministratore e titolari effettivi');

  UPDATE public.bank_document_requirements
     SET input_type = 'text',
         descrizione = 'Descrivere in modo chiaro finalità, scopo e natura dell’operazione richiesta.'
   WHERE bank_id = v_bank_id
     AND lower(nome) = lower('Relazione sullo scopo e sulla natura dell’operazione');

  UPDATE public.practice_documents pd
     SET input_type = requirement.input_type
    FROM public.bank_document_requirements requirement
   WHERE pd.bank_requirement_id = requirement.id
     AND requirement.bank_id = v_bank_id
     AND pd.input_type IS DISTINCT FROM requirement.input_type;

  -- Bonifica anche le pratiche FinPromoter già assegnate. I file eventualmente
  -- presenti sulle righe standard vengono prima ricollegati alla richiesta banca;
  -- soltanto dopo la riga standard duplicata viene eliminata.
  FOR target IN
    SELECT pd.id, pd.practice_id, pd.nome, pd.input_type
      FROM public.practice_documents pd
      JOIN public.bank_document_requirements requirement
        ON requirement.id = pd.bank_requirement_id
     WHERE requirement.bank_id = v_bank_id
       AND (
         lower(pd.nome) = lower('Visura camerale')
         OR lower(pd.nome) = lower('Ultimi due bilanci approvati completi + dati provvisori di bilancio')
         OR lower(pd.nome) = lower('Ultime due dichiarazioni dei redditi + situazioni contabili complete + dati provvisori')
         OR lower(pd.nome) = lower('Ultime due dichiarazioni dei redditi + situazioni contabili + dati provvisori di Conto Economico')
         OR lower(pd.nome) = lower('Relazione sullo scopo e sulla natura dell’operazione')
       )
  LOOP
    FOR source IN
      SELECT standard.id, standard.status, standard.uploaded_at
        FROM public.practice_documents standard
       WHERE standard.practice_id = target.practice_id
         AND standard.tipo = 'standard'
         AND (
           (
             lower(target.nome) = lower('Visura camerale')
             AND lower(standard.nome) = lower('Visura Camerale Aggiornata')
           )
           OR (
             (
               lower(target.nome) = lower('Ultimi due bilanci approvati completi + dati provvisori di bilancio')
               OR lower(target.nome) = lower('Ultime due dichiarazioni dei redditi + situazioni contabili complete + dati provvisori')
               OR lower(target.nome) = lower('Ultime due dichiarazioni dei redditi + situazioni contabili + dati provvisori di Conto Economico')
             )
             AND (
               lower(standard.nome) = lower('Bilancio Depositato')
               OR lower(standard.nome) = lower('Bilancio Provvisorio')
             )
           )
           OR (
             lower(target.nome) = lower('Relazione sullo scopo e sulla natura dell’operazione')
             AND lower(standard.nome) = lower('Motivazione della Richiesta')
           )
         )
    LOOP
      UPDATE public.uploaded_files
         SET practice_document_id = target.id
       WHERE practice_document_id = source.id;

      UPDATE public.practice_documents destination
         SET status = CASE
           WHEN target.input_type = 'upload'
             AND (destination.status = 'approvato' OR source.status = 'approvato') THEN 'approvato'
           WHEN target.input_type = 'upload'
             AND source.status = 'caricato'
             AND destination.status IN ('richiesto', 'rifiutato') THEN 'caricato'
           ELSE destination.status
         END,
         uploaded_at = CASE
           WHEN target.input_type = 'upload' THEN COALESCE(
             GREATEST(destination.uploaded_at, source.uploaded_at),
             destination.uploaded_at,
             source.uploaded_at
           )
           ELSE destination.uploaded_at
         END
       WHERE destination.id = target.id;

      DELETE FROM public.practice_documents
       WHERE id = source.id;
    END LOOP;
  END LOOP;
END $$;

GRANT UPDATE (client_response, response_updated_at, status, uploaded_at, note_rifiuto)
  ON public.practice_documents TO anon;

CREATE INDEX IF NOT EXISTS idx_practice_documents_input_type
  ON public.practice_documents(practice_id, input_type, status);

ALTER TABLE public.agent_document_upload_notifications
  DROP CONSTRAINT IF EXISTS agent_document_upload_notifications_notification_type_check;

ALTER TABLE public.agent_document_upload_notifications
  ADD CONSTRAINT agent_document_upload_notifications_notification_type_check
  CHECK (notification_type IN ('file_uploaded', 'form_completed', 'all_documents_completed'));
