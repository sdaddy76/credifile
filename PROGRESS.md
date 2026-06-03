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
