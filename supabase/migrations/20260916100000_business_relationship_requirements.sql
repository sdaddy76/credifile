-- Campi strutturati per clienti e fornitori principali.
-- Ogni documento salva la risposta in practice_documents.client_response:
-- { "rows": [{ "partita_iva": "...", "denominazione_sociale": "...", "percentuale": "..." }] }

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'bank_document_requirements_input_type_check'
       AND conrelid = 'public.bank_document_requirements'::regclass
  ) THEN
    ALTER TABLE public.bank_document_requirements
      DROP CONSTRAINT bank_document_requirements_input_type_check;
  END IF;

  ALTER TABLE public.bank_document_requirements
    ADD CONSTRAINT bank_document_requirements_input_type_check
    CHECK (input_type IN ('upload', 'text', 'contacts', 'customers', 'suppliers'));

  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'practice_documents_input_type_check'
       AND conrelid = 'public.practice_documents'::regclass
  ) THEN
    ALTER TABLE public.practice_documents
      DROP CONSTRAINT practice_documents_input_type_check;
  END IF;

  ALTER TABLE public.practice_documents
    ADD CONSTRAINT practice_documents_input_type_check
    CHECK (input_type IN ('upload', 'text', 'contacts', 'customers', 'suppliers'));
END $$;
