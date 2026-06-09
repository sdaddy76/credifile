-- ─── FIX document_templates colonne mancanti ────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_templates' AND column_name='nome') THEN
    ALTER TABLE document_templates ADD COLUMN nome VARCHAR(200) NOT NULL DEFAULT 'Template';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_templates' AND column_name='categoria') THEN
    ALTER TABLE document_templates ADD COLUMN categoria VARCHAR(100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_templates' AND column_name='contenuto') THEN
    ALTER TABLE document_templates ADD COLUMN contenuto TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_templates' AND column_name='variabili') THEN
    ALTER TABLE document_templates ADD COLUMN variabili JSONB DEFAULT '[]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_templates' AND column_name='attivo') THEN
    ALTER TABLE document_templates ADD COLUMN attivo BOOLEAN DEFAULT TRUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_templates' AND column_name='creato_da') THEN
    ALTER TABLE document_templates ADD COLUMN creato_da UUID REFERENCES admin_profiles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_templates' AND column_name='created_at') THEN
    ALTER TABLE document_templates ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='document_templates' AND column_name='updated_at') THEN
    ALTER TABLE document_templates ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='document_templates' AND policyname='templates_select') THEN
    CREATE POLICY templates_select ON document_templates FOR SELECT USING (attivo = TRUE);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='document_templates' AND policyname='templates_admin') THEN
    CREATE POLICY templates_admin ON document_templates FOR ALL
      USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND ruolo IN ('super_admin','segreteria')));
  END IF;
END $$;

INSERT INTO document_templates (nome, categoria, contenuto, variabili, attivo)
SELECT v.nome, v.categoria, v.contenuto, v.variabili::jsonb, TRUE
FROM (VALUES
  ('Lettera di Presentazione Pratica','lettera_presentazione',
   E'Spett.le {{nome_banca}},\n\ncon la presente siamo a presentare la pratica relativa alla società {{ragione_sociale}}, con sede in {{citta}}, ATECO {{codice_ateco}}.\n\nImporto richiesto: € {{importo_richiesto}} per {{motivazione}}.\n\nKPI ultimo bilancio: Fatturato € {{fatturato}} | EBITDA € {{ebitda}} | PN € {{patrimonio_netto}} | DSCR {{dscr}}\n\nRestiamo a disposizione.\n\nCordiali saluti,\n{{agente_nome}} – {{data}}',
   '["nome_banca","ragione_sociale","citta","codice_ateco","importo_richiesto","motivazione","fatturato","ebitda","patrimonio_netto","dscr","agente_nome","data"]'),
  ('Richiesta Documenti al Cliente','richiesta_documenti',
   E'Gentile {{nome_referente}},\n\nin riferimento alla pratica n. {{numero_pratica}} ({{ragione_sociale}}), è necessaria la seguente documentazione:\n\n{{lista_documenti}}\n\nPrego caricarla entro il {{data_scadenza}} sul portale clienti.\n\nCordiali saluti,\n{{agente_nome}} – Credifile',
   '["nome_referente","numero_pratica","ragione_sociale","lista_documenti","data_scadenza","agente_nome"]'),
  ('Comunicazione Esito Banca','comunicazione_banca',
   E'Gentile {{nome_referente}},\n\nla pratica n. {{numero_pratica}} ({{ragione_sociale}}) ha ricevuto il seguente esito da {{nome_banca}}:\n\n{{esito_descrizione}}\n\n{{note_aggiuntive}}\n\nCordiali saluti,\n{{agente_nome}} – {{data}}',
   '["nome_referente","numero_pratica","ragione_sociale","nome_banca","esito_descrizione","note_aggiuntive","agente_nome","data"]')
) AS v(nome, categoria, contenuto, variabili)
WHERE NOT EXISTS (SELECT 1 FROM document_templates LIMIT 1);

-- ─── LEADS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                VARCHAR(100) NOT NULL,
  cognome             VARCHAR(100),
  email               VARCHAR(255),
  telefono            VARCHAR(50),
  azienda             VARCHAR(200),
  ruolo_azienda       VARCHAR(100),
  note                TEXT,
  stato               VARCHAR(50) DEFAULT 'nuovo',
  importo_potenziale  NUMERIC,
  agente_id           UUID REFERENCES admin_profiles(id) ON DELETE SET NULL,
  codice_ateco        VARCHAR(20),
  citta               VARCHAR(100),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='leads' AND policyname='leads_rls') THEN
    CREATE POLICY leads_rls ON leads FOR ALL
      USING (agente_id = auth.uid() OR EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND ruolo IN ('super_admin','segreteria')))
      WITH CHECK (agente_id = auth.uid() OR EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND ruolo IN ('super_admin','segreteria')));
  END IF;
END $$;

-- ─── BANK NOTIFICATION SETTINGS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bank_notification_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id         UUID REFERENCES banks(id) ON DELETE CASCADE,
  email           VARCHAR(255) NOT NULL,
  notifica_nuove  BOOLEAN DEFAULT TRUE,
  ateco_filter    TEXT[],
  importo_min     NUMERIC DEFAULT 0,
  importo_max     NUMERIC,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(bank_id)
);
ALTER TABLE bank_notification_settings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_notification_settings' AND policyname='bns_admin') THEN
    CREATE POLICY bns_admin ON bank_notification_settings FOR ALL
      USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND ruolo IN ('super_admin','segreteria')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bank_notification_settings' AND policyname='bns_banca_read') THEN
    CREATE POLICY bns_banca_read ON bank_notification_settings FOR SELECT
      USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid() AND ruolo = 'banca'));
  END IF;
END $$;
