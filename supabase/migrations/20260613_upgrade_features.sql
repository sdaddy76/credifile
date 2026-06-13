-- ═══════════════════════════════════════════════════════════════════
-- CREDIFILE UPGRADE — Note, Notifiche, Task, Checklist, Email Log, Commissioni
-- ═══════════════════════════════════════════════════════════════════

-- 1. NOTE INTERNE PER PRATICA
CREATE TABLE IF NOT EXISTS practice_notes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  testo text NOT NULL,
  autore_id uuid REFERENCES admin_profiles(id),
  autore_nome text,
  autore_ruolo text,
  pinned boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_practice ON practice_notes(practice_id, created_at DESC);
ALTER TABLE practice_notes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practice_notes' AND policyname='staff_notes') THEN
    CREATE POLICY "staff_notes" ON practice_notes USING (auth.role()='authenticated') WITH CHECK (auth.role()='authenticated');
  END IF;
END $$;

-- 2. NOTIFICHE IN-APP
CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES admin_profiles(id) ON DELETE CASCADE,
  tipo text NOT NULL,  -- 'pratica_assegnata','documento_richiesto','stato_aggiornato','task_assegnato','nota_aggiunta'
  titolo text NOT NULL,
  testo text,
  link text,           -- path frontend es. /admin/pratiche/uuid
  letto boolean DEFAULT false,
  practice_id uuid REFERENCES practices(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, letto, created_at DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='notifications' AND policyname='own_notif') THEN
    CREATE POLICY "own_notif" ON notifications USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "staff_notif_ins" ON notifications FOR INSERT WITH CHECK (auth.role()='authenticated');
  END IF;
END $$;

-- 3. TASK / TO-DO PER PRATICA
CREATE TABLE IF NOT EXISTS practice_tasks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  titolo text NOT NULL,
  descrizione text,
  assegnato_a uuid REFERENCES admin_profiles(id) ON DELETE SET NULL,
  assegnato_nome text,
  priorita text DEFAULT 'media',  -- 'alta','media','bassa'
  stato text DEFAULT 'aperta',    -- 'aperta','in_corso','completata','annullata'
  scadenza date,
  completata_at timestamptz,
  created_by uuid REFERENCES admin_profiles(id),
  created_by_nome text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_practice ON practice_tasks(practice_id, stato, scadenza ASC);
CREATE INDEX IF NOT EXISTS idx_tasks_assegnato ON practice_tasks(assegnato_a, stato, scadenza ASC);
ALTER TABLE practice_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practice_tasks' AND policyname='staff_tasks') THEN
    CREATE POLICY "staff_tasks" ON practice_tasks USING (auth.role()='authenticated') WITH CHECK (auth.role()='authenticated');
  END IF;
END $$;

-- 4. CHECKLIST TEMPLATE (configurabili per tipo pratica)
CREATE TABLE IF NOT EXISTS checklist_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  tipo_pratica text,   -- null = generico; oppure 'mutuo','leasing','fido',ecc.
  descrizione text,
  attivo boolean DEFAULT true,
  created_by uuid REFERENCES admin_profiles(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='checklist_templates' AND policyname='staff_chtpl') THEN
    CREATE POLICY "staff_chtpl" ON checklist_templates USING (auth.role()='authenticated') WITH CHECK (auth.role()='authenticated');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS checklist_template_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descrizione text,
  obbligatorio boolean DEFAULT true,
  ordine integer DEFAULT 0
);
ALTER TABLE checklist_template_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='checklist_template_items' AND policyname='staff_chtpl_items') THEN
    CREATE POLICY "staff_chtpl_items" ON checklist_template_items USING (auth.role()='authenticated') WITH CHECK (auth.role()='authenticated');
  END IF;
END $$;

-- 5. CHECKLIST ISTANZA PER PRATICA
CREATE TABLE IF NOT EXISTS practice_checklist_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  template_item_id uuid REFERENCES checklist_template_items(id) ON DELETE SET NULL,
  nome text NOT NULL,
  obbligatorio boolean DEFAULT true,
  completato boolean DEFAULT false,
  completato_da uuid REFERENCES admin_profiles(id),
  completato_nome text,
  completato_at timestamptz,
  note text,
  ordine integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chk_practice ON practice_checklist_items(practice_id, ordine);
ALTER TABLE practice_checklist_items ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='practice_checklist_items' AND policyname='staff_chk') THEN
    CREATE POLICY "staff_chk" ON practice_checklist_items USING (auth.role()='authenticated') WITH CHECK (auth.role()='authenticated');
  END IF;
END $$;

-- 6. STORICO INVII EMAIL BANCHE
CREATE TABLE IF NOT EXISTS email_send_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  bank_id uuid REFERENCES banks(id) ON DELETE SET NULL,
  bank_nome text,
  destinatari text[],
  cc text[],
  bcc text[],
  oggetto text,
  stato text DEFAULT 'inviata',  -- 'inviata','errore'
  errore text,
  sent_by uuid REFERENCES admin_profiles(id),
  sent_by_nome text,
  resend_id text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_email_log_practice ON email_send_log(practice_id, created_at DESC);
ALTER TABLE email_send_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='email_send_log' AND policyname='staff_email_log') THEN
    CREATE POLICY "staff_email_log" ON email_send_log USING (auth.role()='authenticated') WITH CHECK (auth.role()='authenticated');
  END IF;
END $$;

-- 7. COMMISSIONI SEGNALATORI
CREATE TABLE IF NOT EXISTS segnalatore_commissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  segnalatore_id uuid NOT NULL REFERENCES admin_profiles(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
  agente_id uuid REFERENCES admin_profiles(id),
  percentuale numeric(5,2) DEFAULT 0,
  importo_base numeric(15,2),    -- importo su cui calcolare la %
  importo_commissione numeric(15,2),  -- calcolato: importo_base * percentuale / 100
  stato text DEFAULT 'maturata',  -- 'maturata','liquidata','annullata'
  note text,
  liquidata_at date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(segnalatore_id, practice_id)
);
CREATE INDEX IF NOT EXISTS idx_comm_segnalatore ON segnalatore_commissions(segnalatore_id, stato);
ALTER TABLE segnalatore_commissions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='segnalatore_commissions' AND policyname='staff_comm') THEN
    CREATE POLICY "staff_comm" ON segnalatore_commissions USING (auth.role()='authenticated') WITH CHECK (auth.role()='authenticated');
    CREATE POLICY "own_comm" ON segnalatore_commissions FOR SELECT USING (auth.uid() = segnalatore_id);
  END IF;
END $$;

-- 8. PERCENTUALE COMMISSIONE DEFAULT PER SEGNALATORE (campo su admin_profiles se non esiste)
ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS commissione_default numeric(5,2) DEFAULT 0;

-- 9. TIPO PRATICA (per agganciare la checklist)
ALTER TABLE practices ADD COLUMN IF NOT EXISTS tipo_pratica text;

