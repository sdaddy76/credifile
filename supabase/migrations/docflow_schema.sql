
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Admin profiles (linked to Supabase Auth)
CREATE TABLE admin_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  nome TEXT,
  ruolo TEXT DEFAULT 'agente',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clients
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ragione_sociale TEXT NOT NULL,
  piva TEXT,
  codice_fiscale TEXT,
  email TEXT NOT NULL,
  telefono TEXT,
  indirizzo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Banks
CREATE TABLE banks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome TEXT NOT NULL,
  codice TEXT UNIQUE NOT NULL,
  contatto TEXT,
  email TEXT,
  note TEXT,
  attiva BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Document templates (standard docs always required)
CREATE TABLE document_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome TEXT NOT NULL,
  descrizione TEXT,
  obbligatorio BOOLEAN DEFAULT TRUE,
  ordine INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Bank-specific document requirements
CREATE TABLE bank_document_requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_id UUID REFERENCES banks(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  descrizione TEXT,
  obbligatorio BOOLEAN DEFAULT TRUE,
  ordine INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Practices
CREATE TABLE practices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  bank_id UUID REFERENCES banks(id) ON DELETE SET NULL,
  numero_pratica TEXT UNIQUE NOT NULL,
  importo_richiesto NUMERIC(15,2),
  motivazione TEXT,
  status TEXT DEFAULT 'bozza' CHECK (status IN ('bozza','raccolta_documenti','inviata_banca','integrazioni_richieste','completata','approvata','rifiutata')),
  note_admin TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Access codes for client portal
CREATE TABLE practice_access_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  codice TEXT UNIQUE NOT NULL,
  email_cliente TEXT NOT NULL,
  scadenza TIMESTAMPTZ,
  last_access TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Practice documents (one row per requested doc per practice)
CREATE TABLE practice_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  template_id UUID REFERENCES document_templates(id) ON DELETE SET NULL,
  bank_requirement_id UUID REFERENCES bank_document_requirements(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  descrizione TEXT,
  tipo TEXT DEFAULT 'standard' CHECK (tipo IN ('standard','banca','integrazione')),
  obbligatorio BOOLEAN DEFAULT TRUE,
  status TEXT DEFAULT 'richiesto' CHECK (status IN ('richiesto','caricato','approvato','rifiutato')),
  note_rifiuto TEXT,
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Uploaded files
CREATE TABLE uploaded_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  practice_document_id UUID REFERENCES practice_documents(id) ON DELETE CASCADE,
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  nome_file TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  dimensione INTEGER,
  uploaded_by TEXT DEFAULT 'cliente',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Practice status log
CREATE TABLE practice_status_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  practice_id UUID REFERENCES practices(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER practices_updated_at BEFORE UPDATE ON practices FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed default document templates
INSERT INTO document_templates (nome, descrizione, obbligatorio, ordine) VALUES
  ('Visura Camerale Aggiornata','Visura camerale aggiornata, non anteriore a 3 mesi',TRUE,1),
  ('Bilancio Depositato','Ultimo bilancio depositato presso la Camera di Commercio',TRUE,2),
  ('Bilancio Provvisorio','Situazione contabile provvisoria aggiornata',TRUE,3),
  ('Situazione Finanziamenti in Essere','Prospetto dei finanziamenti in corso con rate e scadenze',TRUE,4),
  ('Motivazione della Richiesta','Documento descrittivo della motivazione e destinazione del finanziamento',TRUE,5);

-- RLS
ALTER TABLE admin_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_document_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_status_log ENABLE ROW LEVEL SECURITY;

-- Admin (authenticated) full access
CREATE POLICY "admin_all_clients" ON clients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_banks" ON banks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_doc_templates" ON document_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_bank_reqs" ON bank_document_requirements FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_practices" ON practices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_access_codes" ON practice_access_codes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_practice_docs" ON practice_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_uploaded_files" ON uploaded_files FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_status_log" ON practice_status_log FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_all_profiles" ON admin_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon (client portal) read/write access
CREATE POLICY "anon_read_practices" ON practices FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_access_codes" ON practice_access_codes FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_access_codes" ON practice_access_codes FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_clients" ON clients FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_doc_templates" ON document_templates FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_banks" ON banks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_practice_docs" ON practice_documents FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_practice_docs" ON practice_documents FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_read_uploaded_files" ON uploaded_files FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_uploaded_files" ON uploaded_files FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_read_status_log" ON practice_status_log FOR SELECT TO anon USING (true);
