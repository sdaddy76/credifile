[2026-05-31 10:17] fix backtick build error (0deeb84); inizio diagnosi white screen mobile + sistema log accessi IP
[2026-05-31 10:19] diagnosi white screen mobile (fetchRole hang su rete lenta); avvio fix useAuth + DB user_access_logs + edge function log-access
[2026-05-31 10:21] COMPLETATO: fix mobile white screen (timeout 8s useAuth + fetchRole error handling) + DB user_access_logs + edge function log-access (IP check + Resend alert) + ProfiloPage 'Accessi recenti' + LoginPage chiama log-access post-login — commit b265e62
[2026-05-31 10:43] inizio implementazione sollecito cliente documenti mancanti/rifiutati
[2026-05-31 10:44] edge function sollecita-cliente scritta; implemento UI pulsante in PraticaDetailPage
[2026-05-31 10:45] COMPLETATO: edge function sollecita-cliente (email doc mancanti+rifiutati+link portale+codice) + pulsante BellRing in PraticaDetailPage tab Documenti + dialog conferma con anteprima lista — commit e303a6c, deploy ACTIVE
[2026-05-31 11:42] avvio hardening sicurezza: storage RLS per-pratica + anon upload + bucket MIME/size + rate limiting portale
