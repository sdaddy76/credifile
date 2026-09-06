import PublicSiteLayout from '@/components/public/PublicSiteLayout';
import { usePageMeta } from '@/lib/pageMeta';

export default function PublicTermsPage() {
  usePageMeta({
    title: 'Termini del servizio — Credifile',
    description: 'Condizioni generali di accesso alla valutazione documentale e finanziaria Credifile.',
    path: '/termini',
  });

  return (
    <PublicSiteLayout>
      <main className="bg-slate-50 py-16 sm:py-20">
        <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white px-6 py-10 shadow-sm sm:px-10">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-blue-700">Condizioni generali</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Termini del servizio</h1>
          <p className="mt-3 text-sm text-slate-500">Versione del 6 settembre 2026</p>

          <div className="mt-8 space-y-8 text-sm leading-7 text-slate-700">
            <section>
              <h2 className="text-lg font-bold text-slate-950">Oggetto del servizio</h2>
              <p className="mt-2">
                Credifile raccoglie e organizza documenti e informazioni aziendali per elaborare analisi utili alla comprensione della situazione economica, patrimoniale e finanziaria dell’impresa e alla preparazione di una possibile richiesta di credito.
              </p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-slate-950">Nessuna garanzia di finanziamento</h2>
              <p className="mt-2">
                Report, indicatori, valutazioni e confronti non costituiscono delibera, promessa o garanzia di concessione del credito. Ogni banca o intermediario applica autonomamente le proprie politiche e svolge le verifiche previste.
              </p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-slate-950">Qualità delle informazioni</h2>
              <p className="mt-2">
                L’attendibilità dell’analisi dipende dalla completezza, leggibilità, correttezza e aggiornamento dei documenti trasmessi. Eventuali anomalie evidenziate sono aspetti da approfondire e non rappresentano accuse o giudizi sulla condotta dell’impresa o dei professionisti.
              </p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-slate-950">Servizio a pagamento e mediazione</h2>
              <p className="mt-2">
                Il servizio di analisi e ricerca di soluzioni finanziarie è a pagamento. L’eventuale attività di mediazione creditizia viene avviata esclusivamente dopo la sottoscrizione della documentazione contrattuale prevista, che disciplina incarico, compensi e condizioni applicabili.
              </p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-slate-950">Uso corretto del portale</h2>
              <p className="mt-2">
                L’utente deve trasmettere esclusivamente documenti pertinenti, non alterati e che è autorizzato a comunicare. È vietato tentare accessi non autorizzati, interferire con il servizio o caricare contenuti dannosi.
              </p>
            </section>
            <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              Le condizioni contrattuali e la documentazione di trasparenza applicabili devono essere validate e rese disponibili prima dell’offerta commerciale del servizio.
            </aside>
          </div>
        </article>
      </main>
    </PublicSiteLayout>
  );
}
