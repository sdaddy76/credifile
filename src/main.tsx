import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// Dopo un nuovo deploy Vite può rimuovere i chunk della build precedente
// mentre una scheda già aperta prova ancora a importarli. In quel caso il
// browser riceve index.html al posto del modulo JS. Ricarichiamo una sola
// volta l'HTML corrente, evitando il loop infinito e senza toccare i dati.
const CHUNK_RECOVERY_KEY = 'credifile_chunk_recovery';
const isDynamicImportFailure = (value: unknown): boolean => {
  const message = value instanceof Error ? value.message : String(value ?? '');
  return /dynamically imported module|failed to fetch dynamically imported module|importing a module script failed/i.test(message);
};
const recoverFromStaleChunk = (value: unknown) => {
  if (!isDynamicImportFailure(value) || sessionStorage.getItem(CHUNK_RECOVERY_KEY) === '1') return;
  sessionStorage.setItem(CHUNK_RECOVERY_KEY, '1');
  const url = new URL(window.location.href);
  url.searchParams.set('_asset_refresh', Date.now().toString());
  window.location.replace(url.toString());
};
window.addEventListener('error', event => recoverFromStaleChunk(event.error ?? event.message));
window.addEventListener('unhandledrejection', event => recoverFromStaleChunk(event.reason));
if (sessionStorage.getItem(CHUNK_RECOVERY_KEY) === '1') {
  // Lascia il blocco attivo durante il caricamento dei moduli lazy: se anche
  // la build appena ricevuta fosse incoerente, mostriamo il fallback senza
  // avviare un ciclo continuo di ricariche.
  window.setTimeout(() => sessionStorage.removeItem(CHUNK_RECOVERY_KEY), 10_000);
}

// ── Intercetta token Supabase prima del router ─────────────────────────────
// Quando Supabase redirige dopo invite/recovery, appende:
//   #access_token=...&refresh_token=...&type=invite (o recovery)
// Salviamo i parametri in sessionStorage e apriamo la rotta corretta.
// Convertiamo inoltre i vecchi link /#/... nei nuovi URL puliti, così i link
// già inviati a clienti, consulenti e banche restano utilizzabili.
const rawHash = window.location.hash;
if (rawHash && rawHash.includes('access_token=')) {
  const params = new URLSearchParams(rawHash.substring(1));
  const type = params.get('type');
  sessionStorage.setItem('sb_callback', rawHash.substring(1));
  const callbackPath = type === 'recovery' ? '/reset-password' : '/set-password';
  window.history.replaceState(null, '', callbackPath);
} else if (rawHash.startsWith('#/')) {
  const legacyPath = rawHash.slice(1);
  window.history.replaceState(null, '', legacyPath || '/');
}

createRoot(document.getElementById("root")!).render(<App />);
