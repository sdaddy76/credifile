import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

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
