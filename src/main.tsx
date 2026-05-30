import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// ── Intercetta token Supabase PRIMA che HashRouter consumi l'hash ──
// Quando Supabase redirige dopo invite/recovery, appende:
//   #access_token=...&refresh_token=...&type=invite (o recovery)
// HashRouter userebbe questo hash come percorso di rotta, perdendo il token.
// Salviamo i parametri in sessionStorage e riscriviamo l'hash con la rotta corretta.
const rawHash = window.location.hash;
if (rawHash && rawHash.includes('access_token=')) {
  const params = new URLSearchParams(rawHash.substring(1));
  const type = params.get('type');
  sessionStorage.setItem('sb_callback', rawHash.substring(1));
  if (type === 'recovery') {
    window.location.hash = '#/reset-password';
  } else {
    // invite o altri tipi
    window.location.hash = '#/set-password';
  }
}

createRoot(document.getElementById("root")!).render(<App />);
