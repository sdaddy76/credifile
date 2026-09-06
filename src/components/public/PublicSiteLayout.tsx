import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileCheck2, LogIn } from 'lucide-react';

export default function PublicSiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Credifile — pagina iniziale">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-700 text-white shadow-sm">
              <FileCheck2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-bold tracking-tight text-slate-950">Credifile</span>
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex" aria-label="Navigazione principale">
            <Link to="/#come-funziona" className="transition-colors hover:text-blue-700">Come funziona</Link>
            <Link to="/#analisi" className="transition-colors hover:text-blue-700">Cosa analizziamo</Link>
            <Link to="/#destinatari" className="transition-colors hover:text-blue-700">Per chi è</Link>
            <Link to="/#faq" className="transition-colors hover:text-blue-700">FAQ</Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:inline-flex"
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Accedi
            </Link>
            <Link
              to="/richiedi-valutazione"
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-700 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2"
            >
              Richiedi valutazione
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      {children}

      <footer className="border-t border-slate-200 bg-slate-950 text-slate-300">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
          <div>
            <div className="flex items-center gap-2.5 text-white">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600">
                <FileCheck2 className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-lg font-bold">Credifile</span>
            </div>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-400">
              Analisi documentale e finanziaria per aiutare imprese e professionisti a preparare richieste di credito più complete, leggibili e coerenti.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Servizio</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li><Link className="hover:text-white" to="/richiedi-valutazione">Richiedi una valutazione</Link></li>
              <li><Link className="hover:text-white" to="/#analisi">Contenuti dell’analisi</Link></li>
              <li><Link className="hover:text-white" to="/login">Accesso area riservata</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Informazioni</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <li><Link className="hover:text-white" to="/privacy">Privacy</Link></li>
              <li><Link className="hover:text-white" to="/termini">Termini del servizio</Link></li>
              <li><a className="hover:text-white" href="mailto:stefano@daddino.com">Contatti</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-800">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <span>© {new Date().getFullYear()} Credifile. Tutti i diritti riservati.</span>
            <span>Le valutazioni non costituiscono promessa o garanzia di concessione del credito.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
