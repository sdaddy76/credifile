[2026-05-31 10:17] fix backtick build error (0deeb84); inizio diagnosi white screen mobile + sistema log accessi IP
[2026-05-31 10:19] diagnosi white screen mobile (fetchRole hang su rete lenta); avvio fix useAuth + DB user_access_logs + edge function log-access
[2026-05-31 10:21] COMPLETATO: fix mobile white screen (timeout 8s useAuth + fetchRole error handling) + DB user_access_logs + edge function log-access (IP check + Resend alert) + ProfiloPage 'Accessi recenti' + LoginPage chiama log-access post-login — commit b265e62
[2026-05-31 10:43] inizio implementazione sollecito cliente documenti mancanti/rifiutati
[2026-05-31 10:44] edge function sollecita-cliente scritta; implemento UI pulsante in PraticaDetailPage
[2026-05-31 10:45] COMPLETATO: edge function sollecita-cliente (email doc mancanti+rifiutati+link portale+codice) + pulsante BellRing in PraticaDetailPage tab Documenti + dialog conferma con anteprima lista — commit e303a6c, deploy ACTIVE
[2026-05-31 11:42] avvio hardening sicurezza: storage RLS per-pratica + anon upload + bucket MIME/size + rate limiting portale
[2026-05-31 12:53] Diagnosticato BOOT_ERROR reset-password: import esm.sh fallisce al boot. Riscrittura in corso con fetch REST diretto.
[2026-05-31 13:53] Fix redirect_to: rimosso /#/reset-password, ora usa appUrl root. Deploy ok v3.
[2026-05-31 13:59] Avvio implementazione: delete utente + cambia password per super admin
[2026-05-31 14:01] Implementato: elimina utente + cambia password in UtentiPage. Nuova edge function admin-update-user. Commit e492fb5.
[2026-05-31 14:14] Aggiunto handleDeleteFile: cancella file singolo, mantiene campo doc, reset status se ultimo file.
[2026-05-31 14:18] Fix: rimuovi duplicati Riassegna Agente + aggiungi assegna banca in PratichePage
[2026-05-31 14:19] Commit: rimossi duplicati Riassegna Agente, aggiunto assegna banca in PratichePage.
[2026-05-31 14:26] Fix: XCircle elimina file ora sempre visibile, non solo su hover. Storage RLS gia' ok per agenti.
[2026-05-31 14:38] Fix: can_access_practice + assigned_to (agenti assegnati possono eliminare file). Bottone rosso visibile.
[2026-05-31 15:15] Fix race condition StatistichePage: authLoading + deps isSegreteria/isSuperAdmin.
[2026-05-31 16:03] Avvio implementazione backup automatico segreteria: tabella, hook, pagina impostazioni, nav
[2026-05-31 16:05] Backup automatico: tabella backup_preferences, hook useAutoBackup, ImpostazioniPage, nav aggiornata.
[2026-05-31 16:13] Inizio fix send-to-bank (BOOT_ERROR esm.sh) + PratichePage dialog notes/email
[2026-05-31 16:16] Fix send-to-bank BOOT_ERROR (rimosso esm.sh, REST nativo). PratichePage: dialog assegna banca con note + checkbox invio email. Deploy + commit 9be8cd6 pushato su main.
[2026-05-31 16:44] Fix send-to-bank: query sbagliata (file_path/practice-documents) -> uploaded_files.storage_path + bucket practice-files. PratichePage: dialog invio posticipato.
[2026-05-31 16:47] Fix send-to-bank: query corretta su uploaded_files+storage_path+bucket practice-files. PratichePage: dialog Gestione Banche con sezione banche esistenti+invio posticipato+reinvio. Commit 0e493bd pushato.
[2026-05-31 17:07] Fix StatistichePage: KPI 'In corso'=2 errato (solo raccolta_documenti), corretto in 'Da completare'=totale-completate-rifiutate + aggiungi banche attive + Riepilogo granulare
[2026-05-31 17:08] Commit ebdeb12: fix StatistichePage - KPI 'In corso'=2 sostituito con 'Da completare'=totale-completate-rifiutate (ora=13), aggiunto totaleBanche, Riepilogo granulare per stato.
[2026-05-31 17:27] Aggiunta created_by a practice_banks + filtro segreteria + pulsante rimuovi banca
[2026-06-01 21:34] Implementati KPI requirements per banca (BanchePage.tsx) + Verifica Bancabilità (AnalisiFinanziariaTab.tsx) + tabella bank_kpi_requirements su Supabase. Commit 854da71.
[2026-06-01 21:35] jspdf + jspdf-autotable installati. Inizio scrittura generateBancabilitaReport.
[2026-06-01 21:36] Generazione report PDF bancabilità completata: jspdf + jspdf-autotable installati, funzione generateBancabilitaReport() in AnalisiFinanziariaTab.tsx, bottone 'Genera Report PDF', commit 0765929 pushato.
[2026-06-01 21:39] Avvio creazione BancabilitaTab.tsx + tab dedicato in PraticaDetailPage.
[2026-06-01 21:42] Creato BancabilitaTab.tsx + tab Bancabilita in PraticaDetailPage. Commit pushato.
[2026-06-01 21:47] Avvio feature loghi banche in tab Bancabilità: logo_url su banks, BanchePage form, BancabilitaTab strip+cards.
[2026-06-01 21:48] Colonna logo_url aggiunta a banks. Ora aggiorno BanchePage form e BancabilitaTab loghi.
[2026-06-01 21:50] Loghi banche implementati: logo_url su DB, form BanchePage, strip+card BancabilitaTab. Commit pushato.
[2026-06-01 22:00] Avvio: KPI ordinati + fatturato + ATECO. DB changes + edge function + BanchePage + BancabilitaTab + PraticaDetailPage.
[2026-06-01 22:03] KPI ordinati+fatturato+ATECO completato. Edge function redeployata. Commit pushato.
[2026-06-01 22:08] Fix strip bancabilita: sempre visibile, banche senza KPI incluse in presentabili.
[2026-06-01 22:13] Fix strip bancabilità visibilità. Ora: fix tasto Invia + bancabilità pre-assegnazione.
[2026-06-01 22:15] Fix tasto Invia + bancabilità pre-assegnazione. Commit pushato.
[2026-06-01 23:24] Fix bancabilità sempre visibile indipendentemente da bilancio analizzato.
[2026-06-02 10:06] Fix BancabilitaTab: rimosso filtro attiva=true, load prima di assignBank, catch esplicito - commit 306e19f pushato
[2026-06-02 10:10] Feature moduli banca: tabelle bank_moduli + practice_moduli_compilati create, bucket bank-moduli creato, fix BancabilitaTab filtro attiva commit 306e19f
[2026-06-02 10:15] feat moduli banca: tabelle bank_moduli+practice_moduli_compilati, bucket bank-moduli, BanchePage/BancabilitaTab/ClientPortalPage - commit 25c997c
[2026-06-02 16:05] Avvio estensione visura: data_costituzione, capitale_sociale, soci (JSONB), amministratori (JSONB)
[2026-06-02 16:07] Avvio: migrazione DB + types.ts + ClientiPage.tsx per visura estesa (data_costituzione, capitale, soci, amministratori)
[2026-06-02 16:10] COMPLETATO: visura estesa — DB migrazione (data_costituzione, capitale_sociale_versato, soci JSONB, amministratori JSONB), types.ts aggiornato, ClientiPage.tsx riscritto con parser robusto. Commit f98cfdd pushato.
[2026-06-03 11:55] Avvio ruolo segnalatore: DB (agent_segnalatori + practices.segnalatore_id), types, auth, nav, UtentiPage, pratiche, portal
[2026-06-03 11:56] DB migrazione segnalatore completata: agent_segnalatori + practices.segnalatore_id. Avvio types/auth/layout/UtentiPage/portale
[2026-06-03 12:08] Completamento segnalatore: PratichePage (campo segnalatore + colonne provenance), PraticaDetailPage (sezione segnalatore + doc), send-to-bank CC
[2026-06-03 12:14] segnalatore feature completata — PratichePage (useEffect segnalatori, Select dialog, card provenance agente+segnalatore, form reset), PraticaDetailPage (query join, card segnalatore sidebar), send-to-bank (CC segnalatore). Commit dfd04d1.
[2026-06-03 12:21] Inizio modifiche segnalatore: fix CC email, nav Clienti, auto-link, KPI labels
[2026-06-03 12:23] Inizio implementazione: fix CC email segnalatore, nav Clienti, auto-link, KPI descriptions
[2026-06-03 12:33] Commit f3c7b28 — segnalatore v2 completo: nav Clienti, auto-link, filtro clienti, KPI descriptions, CC email corretta
[2026-06-03 12:33] Commit f3c7b28 completato — segnalatore v2: nav Clienti, auto-link agente, filtro clienti, KPI descriptions, CC email fix, MieiSegnalPage con form creazione
[2026-06-03 13:39] Inizio flusso invito segnalatore: DB table, edge functions, pagina registrazione
[2026-06-03 13:40] DB segnalatore_invites creata, inizio edge functions invite-segnalatore e register-segnalatore
[2026-06-03 13:44] Commit 1748900 — flusso invito segnalatore completo: DB segnalatore_invites, edge fn invite+register, pagina pubblica registrazione, MieiSegnalPage semplificato
[2026-06-04 00:08] stefano ripristinato super_admin, creato superadmin@credifile.test, inizio fix create-admin-user e gestione segnalatori
[2026-06-04 00:12] Aggiunto UNIQUE constraint email su admin_profiles; fix create-admin-user con check email esistente; letto UtentiPage completo
[2026-06-04 00:14] COMPLETATO: UtentiPage handleUpdateRole (protezione super_admin, agente->segnalatore auto-assign, editAssignId selector), sezione Gestione Segnalatori, saveSegnAssignments, loadSegnAssignments; create-admin-user PATCH deploy (v5 ACTIVE); commit 54ab2e9 pushato
[2026-06-04 00:14] Sessione completata: tutti i pending tasks risolti e pushati (commit 54ab2e9)
[2026-06-04 00:24] Inizio diagnosi bug pratiche vuote per agente + ricerca KPI benchmark settoriali
[2026-06-04 00:27] CAUSA bug pratiche vuote: practices_created_by_fkey non in schema cache PostgREST → query PGRST200. Fix: rimuovere join FK rotto, usare created_by UUID + lookup da agents state
[2026-06-04 00:28] Bug pratiche vuote RISOLTO: rimosso join practices_created_by_fkey non in schema cache PostgREST. Build+deploy ok. Ora: ricerca KPI benchmark settoriali ATECO Italia
[2026-06-04 00:35] COMPLETATO: bug pratiche vuote (rimozione practices_created_by_fkey da query), KPI benchmark ATECO (15 settori + default, Mediobanca/ISTAT 2023), codiceAteco loaded in AnalisiFinanziariaTab, KpiCard con colonna benchmark. Deploy ok.
[2026-06-04 01:04] Inizio implementazione analisi reputazionale: DB + edge function + tab React
[2026-06-04 01:04] DB tabella reputational_analyses creata. Implementazione edge function + ReputazioneTab in corso.
[2026-06-04 01:07] COMPLETATO analisi reputazionale: DB reputational_analyses, edge function analisi-reputazione (ACTIVE), ReputazioneTab.tsx, tab PraticaDetailPage. Build+deploy ok, push GitHub ok.
[2026-06-04 01:20] Fix BOOT_ERROR edge function analisi-reputazione: causa root = Deno.serve() nativo richiesto (non serve() da deno.land); funzione funzionante, push GitHub fd6a71a
[2026-06-04 01:21] Soci e amministratori: sezioni read-only sostituite con UI editabile sempre visibile in ClientiPage.tsx (aggiungi/modifica/elimina riga)
[2026-06-04 01:45] Analisi Centrale Rischi BDI: struttura compresa (Intermediario/Data/Crediti per cassa). Avvio migration DB + parser + UI
[2026-06-04 01:53] Import Centrale Rischi: parser parseCentraleRischi.ts, DB migration client_financing (+8 colonne CR), UI preview+import in PraticaDetailPage. Build OK, push github
[2026-06-04 01:58] Fix UtentiPage blank: SelectItem value='' → '__none__' (3 occorrenze). Radix UI vieta stringa vuota come value
[2026-06-04 02:26] Parser CR v2 deployato (9df2de8). Identificati 3 bug: 1) guida alla lettura estratta come dati reali (BANCA UNO/QUATTRO), 2) selezione mese sbagliata, 3) termini CR vs bancari. Fix in corso.
[2026-06-04 02:29] Parser CR v3 deployato (9d19f09): strip guida alla lettura, selezione primo mese per posizione, nomi bancari standard in categoriaToTipologia + TIPOLOGIE_FIN aggiornato.
[2026-06-04 07:45] Parser CR v4 deployato: regex 6-numeri diretti, accoppiamento per ordine, strip guida.
[2026-06-04 09:24] Fix monitoraggio accessi deployato (commit 48c26a0): log-access ora chiamato anche per sessione già attiva (LoginPage.tsx) e da SetPasswordPage.tsx. PPT Credifile 14 slide completata.
[2026-06-04 23:00] Fix segnalatore: CC solo su richiesta documenti al cliente (non su email banche). Avvio fix slide 3 + indagine codice.
[2026-06-04 23:06] Fix CC segnalatore: aggiunto cc in generateAccessCode() di PraticaDetailPage.tsx. Deploy su Vercel via build_and_deploy. PPT slide 3 aggiornata: bullet 'Riceve CC nelle richieste documenti al cliente'.
[2026-06-04 23:31] Avvio implementazione Indice di Bancabilità: tabella bancabilita_pesi + componente + config pesi per banca
[2026-06-04 23:33] Inizio build frontend Indice Bancabilità: IndiceBancabilita.tsx + integrazione BancabilitaTab + config BanchePage
[2026-06-04 23:36] Creato IndiceBancabilita.tsx, integrato in BancabilitaTab.tsx (globale + per-banca). Build in corso.
[2026-06-04 23:37] Deploy Indice Bancabilità completato. File: IndiceBancabilita.tsx (nuovo), BancabilitaTab.tsx (aggiornato). SQL migration salvata in supabase/migrations/bancabilita_pesi.sql.
[2026-06-06 00:29] Avvio implementazione ruolo Consulente/Commercialista: SQL + edge functions + portale frontend + PDF generator
[2026-06-06 00:30] Scrittura SQL migration consulente + tutte le edge functions + frontend portale consulente
[2026-06-06 00:40] Deploy Consulente completato. File: IndiceBancabilita.tsx, generateReportPdf.ts, ConsulenteDashboard, NuovoReportWizard, ProfiloConsulentePage, RegistrazioneConsulentePage, LoginPage (redirect), App.tsx (routes), useAuth.ts (ruolo). Edge functions: invite-consulente, genera-suggerimenti-kpi (Groq), send-report-consulente. SQL: supabase/migrations/consulente.sql (manuale).
[2026-06-06 00:57] Fix registrazione consulente + implementazione consenso CR (GDPR): edge functions, pagina consenso, wizard update
[2026-06-06 01:04] Deploy commit 24d2c15 su GitHub (Vercel auto-deploy). Fix reg. consulente + consenso CR + wizard step + pagina pubblica.
[2026-06-06 01:34] Upload visura camerale nel form nuovo cliente consulente
[2026-06-06 01:53] Fix parsing visura consulente: form sempre visibile, diagnostica errori, gestione PDF scansionato
[2026-06-07 17:33] Banner read-only agente nel tab Banche pratica
[2026-06-07 18:06] Inizio implementazione riassegnazione filtrata + note declino
[2026-06-07 18:16] Avvio implementazione portale banche anonimo: bank_interest_requests, BancaPortalPage, flusso richiesta/approvazione documenti
[2026-06-07 18:30] Portale banche completato: BancaPortalPage (lista anonima KPI/ATECO/città), ruolo 'banca', creazione account da BanchePage, richieste pendenti in Dashboard con approvazione/rifiuto. Commit 4235903 su GitHub/Vercel. SQL migration da eseguire manualmente.
[2026-06-07 19:05] Inizio implementazione tab Pratiche Ricevute nel portale banche
[2026-06-08 10:58] Fix protezione ruoli super_admin (commit 53a78db): Lock icon, no Trash, handleDelete guard. Fix RLS ricorsiva admin_profiles (policy banca). SQL roles corretti. Fix loading bug BancaPortalPage in corso.
[2026-06-08 11:06] Diagnosticato: bank_user_id=info@fiw.it su tutte e 5 le banche causa .maybeSingle() fail. Vercel non auto-deploya. Fix in corso.
[2026-06-08 15:49] Fix codice_ateco (commit 6694142) pushato su GitHub. Diagnosi: 400 su practices per colonna inesistente. In corso: crea utenti test banche + diagnosi visibilità pratiche.
[2026-06-08 17:43] Deploy Vercel completato (commit 6694142). URL: credifile-eosin.vercel.app. Token Vercel salvato. Fix: codice_ateco non in practices (causa 400), maybeSingle→limit(1), loading bug.
[2026-06-10 11:53] Avvio integrazione Dropbox: Chooser frontend + pianificazione Edge Function backup
[2026-06-10 11:57] Dropbox Chooser deployato (commit b2e2eba): SDK in index.html, handleDropboxChoose in PraticaDetailPage, pulsante Dropbox accanto Upload. In attesa App Secret + auth code per Edge Function backup.
[2026-06-10 12:15] Dropbox backup OK: Edge Function dropbox-backup attiva, cron domenica 02:00 UTC, refresh token aggiornato (scope files.content.write). File: /Apps/Credifile/backups/backup_YYYY-MM-DD.json
[2026-06-10 12:15] Dropbox integrazione completa: Chooser frontend live (commit b2e2eba), Edge Function dropbox-backup v3 attiva, refresh token aggiornato con scope files.content.write, cron domenica 02:00 UTC (schedule id 3). Test backup OK: 66 KB su /Apps/Credifile/backups/
[2026-06-10 13:02] Supabase edge function BOOT_ERROR irrecuperabile su tutti i deploy. Cambio strategia: Vercel serverless function /api/dropbox-backup.js
[2026-06-10 13:03] Creata api/dropbox-backup.js (Vercel serverless). Supabase edge function irrecuperabile (BOOT_ERROR su tutti i deploy incluso hello-world). Aggiungo env vars Vercel e aggiorno frontend.
[2026-06-10 13:06] Fix backup Dropbox completato: Vercel serverless /api/dropbox-backup.js funziona (test: ok=true, 66KB). Supabase edge function abbandonata (BOOT_ERROR irrecuperabile su tutti i deploy). Commit d0aec08 su GitHub + Vercel prod.
[2026-06-10 17:32] Inizio fix box viola/blu AI Banche: rimozione condizioni && su analisi_societa/suggerimento_ai nel frontend + fallback testo API
[2026-06-10 17:34] Fix completato: frontend box viola/blu sempre visibili (placeholder se vuoti) + API fallback testi quando Groq vuoto/non disponibile. Avvio build.
[2026-06-10 17:37] Deploy OK: commit 90d42c8 — box viola/blu AI Banche sempre visibili con fallback testo. Vercel: credifile-eosin.vercel.app
[2026-06-10 18:08] Inizio implementazione duplicazione pratiche super_admin in PratichePage.tsx
[2026-06-10 18:10] Implementazione duplicazione pratiche: import Copy, 4 stati, handleDuplica (clona pratica+documenti+log), pulsante arancione lista, dialog con selezione agente+note. Avvio build.
[2026-06-10 18:12] Deploy OK: commit 13fb57f — duplicazione pratiche super_admin. Vercel: credifile-eosin.vercel.app
[2026-06-10 18:12] Deploy OK commit 13fb57f: duplicazione pratiche per super_admin completata (pulsante Copy, dialog agente+note, handler clona pratica+documenti+log)
[2026-06-10 18:28] Fix KPI banca: aggiunta utile_netto al catalogo, dropdown raggruppato per area, fallback colonne dirette nel matching
[2026-06-10 18:29] Fix KPI banca completati: utile_netto aggiunto al catalogo, dropdown raggruppato per area con emoji, fallback colonne dirette ricavi_vendite/utile_netto nel matching. Avvio build.
[2026-06-10 18:32] Deploy OK commit 4941555: KPI banca — utile_netto aggiunto, dropdown raggruppato per area, fallback matching colonne dirette.
[2026-06-10 18:32] Deploy OK commit 4941555: KPI banca utile_netto aggiunto, dropdown raggruppato per area, fallback matching colonne dirette bilanci_kpi.
[2026-06-15 23:16] Avvio revisione capillare codice: tsc check + review file modificati
[2026-06-15 23:16] tsc --noEmit OK (zero errori). Avvio revisione PraticaDetailPage.tsx
[2026-06-15 23:19] Revisione completata: 3 fix da applicare - dead code update-user-email.js, label agente PratichePage, cast ridondante PraticaDetailPage
[2026-06-15 23:22] Revisione capillare completata. Fix deployati: dead code update-user-email.js, label Assegna ad Agente/Admin, cast practice.client_id semplificato. tsc zero errori. Commit d844225
[2026-06-16 10:32] Fix send-to-bank: parallelizzazione URL signing + fix query reputational_analyses/bilanci_kpi/bancabilita_pesi. Fix scoreBancabilita in PraticaDetailPage (calcolo da bilanci_kpi+pesi). Deploy 143150c.
[2026-06-16 10:34] Inizio implementazione segnalatore semplificato: api/notifica-segnalazione.js + NuovaSegnalazionePage + nav/route
[2026-06-16 20:33] Avvio sviluppo: analisi reputazionale visura, comparazione bilanci, email banca migliorata
[2026-06-16 20:36] Scrittura api/analizza-visura.js, AnalisiFinanziariaTab YoY, ReputazioneTab visura signals, send-to-bank improvements
[2026-06-16 20:43] Completate: api/analizza-visura.js, AnalisiFinanziariaTab YoY, ReputazioneTab visura+modal, send-to-bank profilo+confronto+visura. Avvio build.
[2026-06-16 20:46] Deploy completato commit cb0cc14: api/analizza-visura.js, YoY bilanci, ReputazioneTab visura modal, send-to-bank profilo+confronto+visura. credifile-eosin.vercel.app
[2026-06-16 21:05] Inizio implementazione: link pubblico segnalazione + fix Task segnalatori. Piano: migrazione DB, API pubblica, pagina standalone, route, pannello admin, deploy.
[2026-06-16 21:05] Skill website caricata. Avvio: migrazione DB segnalazioni_pubbliche + inspect_website_project
[2026-06-16 21:11] Completati: migrazione DB segnalazioni_pubbliche, api/segnalazione-pubblica.js, SegnalazionePublicaPage.tsx, SegnalazioniRicevutePage.tsx, route /segnala + /admin/segnalazioni-ricevute, menu AdminLayout, banner TasksPage. Avvio build.
[2026-06-16 21:14] Deploy OK commit e24090e. credifile-eosin.vercel.app. File: SegnalazionePublicaPage, SegnalazioniRicevutePage, api/segnalazione-pubblica.js, AdminLayout (menu Inbox), TasksPage (banner segnalatori), App.tsx (route /segnala + /admin/segnalazioni-ricevute).
[2026-06-16 21:14] Deploy completo commit e24090e. Tutte le feature implementate e online su credifile-eosin.vercel.app
[2026-06-16 21:46] Avvio: aggiunta colonna file_urls a segnalazioni_pubbliche + rewrite SegnalazionePublicaPage con upload visura/documenti identica a NuovaSegnalazionePage
[2026-06-16 21:49] Completati: DB file_urls, API con upload base64->Storage, SegnalazionePublicaPage identica a NuovaSegnalazionePage. Avvio build.
[2026-06-16 21:52] Deploy OK commit f946c22. Pagina pubblica /segnala aggiornata con 4 card (Dati Cliente, Visura, Altri Documenti, Note) + upload file via base64->Storage.
[2026-06-16 21:52] Deploy f946c22 OK. SegnalazionePublicaPage riscritta con 4 card identiche a NuovaSegnalazionePage + upload file via base64 su Supabase Storage.
[2026-06-17 10:00] Avvio: auto-detect visura camerale da uploaded_files + estrazione testo PDF con pdfjs-dist in ReputazioneTab
[2026-06-29 16:57] Avvio miglioria analisi reputazionale: CF persone fisiche, storico soci/amm cessati, storico sedi con ricerca eventi negativi per indirizzo
[2026-06-29 17:04] Analisi reputazionale approfondita completata: CF discriminatore persone fisiche, soggetti cessati da visura_json, analisi storico sedi/indirizzi con eventi negativi. Commit 9da1f37, deploy Vercel + Edge Function Supabase OK.
[2026-06-29 17:35] Avvio report consulente potenziato: logo Credifile+consulente, 14 KPI, benchmark settore con commento, bancabilità dettagliata, finanziamenti in essere + cron aggiornamento mensile benchmark
