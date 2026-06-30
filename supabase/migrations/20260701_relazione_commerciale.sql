-- Relazione commerciale AI — template, risposte e output DOCX/PDF
CREATE TABLE IF NOT EXISTS relazione_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(200) NOT NULL,
  bank_id UUID REFERENCES banks(id) ON DELETE SET NULL,
  sezioni JSONB NOT NULL DEFAULT '[]',
  attivo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE relazione_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='relazione_templates' AND policyname='relazione_templates_select') THEN
    CREATE POLICY relazione_templates_select ON relazione_templates FOR SELECT TO authenticated USING (attivo = TRUE);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='relazione_templates' AND policyname='relazione_templates_admin') THEN
    CREATE POLICY relazione_templates_admin ON relazione_templates FOR ALL TO authenticated
      USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND ruolo IN ('super_admin','segreteria')))
      WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND ruolo IN ('super_admin','segreteria')));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS relazioni_commerciali (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  consulente_report_id UUID,
  template_id UUID REFERENCES relazione_templates(id) ON DELETE SET NULL,
  bank_id UUID REFERENCES banks(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'bozza',
  risposte JSONB DEFAULT '{}',
  docx_url TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE relazioni_commerciali ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='relazioni_commerciali' AND policyname='relazioni_select') THEN
    CREATE POLICY relazioni_select ON relazioni_commerciali FOR SELECT TO authenticated USING (TRUE);
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='relazioni_commerciali' AND policyname='relazioni_write') THEN
    CREATE POLICY relazioni_write ON relazioni_commerciali FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
  END IF;
END $$;

INSERT INTO relazione_templates (nome, bank_id, sezioni, attivo)
SELECT 'Relazione Commerciale', NULL, '[{"id": "presentazione_azienda", "titolo": "Presentazione Azienda", "domande": [{"id": "presentazione_storia", "tipo": "textarea", "obbligatoria": true, "testo": "Sintesi della storia imprenditoriale e dei soci/amministratori. Indicare chi ha funzioni chiave nel business."}, {"id": "presentazione_continuita", "tipo": "textarea", "obbligatoria": false, "testo": "Eventuale presenza in azienda della famiglia per continuità aziendale. Temi successori."}, {"id": "presentazione_trasformazioni", "tipo": "textarea", "obbligatoria": false, "testo": "Eventuali trasformazioni societarie avvenute nella storia della società."}, {"id": "presentazione_attivita", "tipo": "textarea", "obbligatoria": true, "testo": "Precisa descrizione dell''attività svolta, prodotti, mercati/settori di sbocco e clienti di riferimento."}, {"id": "presentazione_competitors", "tipo": "textarea", "obbligatoria": false, "testo": "Principali competitors e vantaggi competitivi dell''azienda."}]}, {"id": "analisi_reputazionale", "titolo": "Analisi Qualitativa / Reputazionale", "domande": [{"id": "rep_compagine", "tipo": "textarea", "obbligatoria": false, "testo": "La società è stata costituita dagli attuali soci o si rileva un cambio nella compagine societaria?"}, {"id": "rep_precedente", "tipo": "textarea", "obbligatoria": false, "testo": "L''attuale attività è stata rilevata da una società precedente? Come andava? Eventuali fallimenti/concordati?"}, {"id": "rep_acquisizioni", "tipo": "textarea", "obbligatoria": false, "testo": "La società ha mai acquisito/affittato rami d''azienda di altre società?"}, {"id": "rep_quote_terze", "tipo": "textarea", "obbligatoria": false, "testo": "Quote dirette o indirette in società terze riconducibili ai soci. Fatturato e rapporti con la richiedente."}, {"id": "rep_conservatorie", "tipo": "textarea", "obbligatoria": false, "testo": "Eventuali eventi di conservatoria sulle persone fisiche legate alla società."}, {"id": "rep_collegate", "tipo": "textarea", "obbligatoria": false, "testo": "Le società collegate/controllate sono attive? Problematiche relative a liquidazioni o procedure?"}, {"id": "rep_negativita", "tipo": "textarea", "obbligatoria": true, "testo": "Analisi reputazionale soci/amministratori. Pregiudizievoli, decreti ingiuntivi, protesti, procedure concorsuali."}, {"id": "rep_gruppo", "tipo": "textarea", "obbligatoria": false, "testo": "Eventuale presenza di gruppo giuridico/economico. Altre società degli stessi UBO (es. immobiliare di famiglia)."}]}, {"id": "clienti_mercati", "titolo": "Clienti e Mercati", "domande": [{"id": "clienti_descrizione", "tipo": "textarea", "obbligatoria": true, "testo": "Descrizione clienti, concentrazioni con % rilevante (dal 10% in su), modalità e tempi di incasso."}, {"id": "clienti_settori", "tipo": "textarea", "obbligatoria": false, "testo": "Principali settori serviti. Per aziende su commessa: portafoglio ordini."}, {"id": "clienti_export", "tipo": "textarea", "obbligatoria": false, "testo": "% export e Paesi con indicazione % dei più rilevanti (dal 10% in su)."}]}, {"id": "fornitori", "titolo": "Fornitori", "domande": [{"id": "fornitori_concentrazioni", "tipo": "textarea", "obbligatoria": true, "testo": "Concentrazioni rilevanti lato fornitori (dal 10% in su). Dipendenza da materie prime specifiche."}, {"id": "fornitori_pagamento", "tipo": "textarea", "obbligatoria": false, "testo": "Modalità e tempi medi di pagamento fornitori."}, {"id": "fornitori_import", "tipo": "textarea", "obbligatoria": false, "testo": "% quota import con indicazione Paesi principali."}]}, {"id": "finalita_operazione", "titolo": "Finalità dell''Operazione", "domande": [{"id": "finalita_descrizione", "tipo": "textarea", "obbligatoria": true, "testo": "Descrizione precisa della finalità (liquidità/investimento). Se investimento: importo totale, parte finanziata, copertura."}, {"id": "finalita_vantaggio", "tipo": "textarea", "obbligatoria": false, "testo": "Descrizione del vantaggio dell''investimento e volumi/redditività attesi."}, {"id": "finalita_coerenza", "tipo": "textarea", "obbligatoria": false, "testo": "L''investimento è coerente con il piano di crescita? Capacità di generazione di cassa per il servizio del debito?"}, {"id": "finalita_commissioni", "tipo": "text", "obbligatoria": false, "testo": "Commissioni di mediazione applicate (% e importo €)."}]}, {"id": "aspetti_bilancio", "titolo": "Aspetti Rilevanti di Bilancio", "domande": [{"id": "bilancio_analisi", "tipo": "textarea", "obbligatoria": true, "testo": "Breve analisi dell''ultimo bilancio. Voci più significative e variazioni di fatturato nell''ultimo triennio."}, {"id": "bilancio_sede", "tipo": "text", "obbligatoria": false, "testo": "La sede produttiva/commerciale è di proprietà, in leasing o in affitto?"}, {"id": "bilancio_crediti_debiti", "tipo": "textarea", "obbligatoria": false, "testo": "In caso di bilancio abbreviato: dettaglio delle voci di crediti e debiti."}]}, {"id": "eventi_straordinari", "titolo": "Eventi Straordinari", "domande": [{"id": "straordinari_operazioni", "tipo": "textarea", "obbligatoria": false, "testo": "Eventuali operazioni straordinarie sul capitale o modifiche societarie previste dalla proprietà."}, {"id": "straordinari_investimenti", "tipo": "textarea", "obbligatoria": false, "testo": "Eventuali futuri investimenti di rilievo (immobili, impianti) con modalità di finanziamento."}]}, {"id": "impegni_finanziari_tributari", "titolo": "Impegni Finanziari e Tributari", "domande": [{"id": "finanziario_impegni", "tipo": "textarea", "obbligatoria": true, "testo": "Voci significative a livello di impegni finanziari: prestiti obbligazionari soci, finanziamenti soci, crediti/debiti tributari."}, {"id": "finanziario_tributario", "tipo": "textarea", "obbligatoria": false, "testo": "Debiti tributari: accertamenti, rateizzazioni in essere, situazione con l''Agenzia delle Entrate."}, {"id": "finanziario_banche", "tipo": "textarea", "obbligatoria": true, "testo": "Dettaglio banche e affidamenti in essere: fidi a breve e medio-lungo termine, garanzie rilasciate."}]}, {"id": "note_visita", "titolo": "Note Relative alla Visita", "domande": [{"id": "visita_sede", "tipo": "textarea", "obbligatoria": false, "testo": "Indicazione sintetica della sede: dove si trova, se produzione e commerciale sono nello stesso posto, sedi secondarie."}, {"id": "visita_stato_immobile", "tipo": "textarea", "obbligatoria": false, "testo": "Stato dell''immobile o delle unità immobiliari."}, {"id": "visita_logistica", "tipo": "textarea", "obbligatoria": false, "testo": "Situazione logistica. Zone industriali, snodi stradali/ferroviari."}, {"id": "visita_disponibilita", "tipo": "text", "obbligatoria": false, "testo": "Disponibilità dell''imprenditore a fornire informazioni."}]}, {"id": "esperienza_pregressa", "titolo": "Esperienza Pregressa con il Cliente", "domande": [{"id": "pregressa_contatti", "tipo": "textarea", "obbligatoria": false, "testo": "Eventuali contatti precedenti con il mediatore e/o la banca. Richieste pregresse ed esito."}, {"id": "pregressa_erogati", "tipo": "textarea", "obbligatoria": false, "testo": "Finanziamenti già erogati: se ancora in essere o chiusi, andamentale."}]}, {"id": "foto_aziendali", "titolo": "Foto Aziendali (opzionale)", "domande": [{"id": "foto_note", "tipo": "textarea", "obbligatoria": false, "testo": "Note sulle foto aziendali allegate. Descrivere brevemente cosa mostrano (NO foto da siti web)."}]}]'::jsonb, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM relazione_templates WHERE nome = 'Relazione Commerciale' AND bank_id IS NULL
);
