import PublicSiteLayout from '@/components/public/PublicSiteLayout';
import { usePageMeta } from '@/lib/pageMeta';

export default function PublicPrivacyPage() {
  usePageMeta({
    title: 'Privacy — Credifile',
    description: 'Informazioni sul trattamento dei dati e dei documenti trasmessi attraverso Credifile.',
    path: '/privacy',
  });

  return (
    <PublicSiteLayout>
      <main className="bg-slate-50 py-16 sm:py-20">
        <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white px-6 py-10 shadow-sm sm:px-10">
          <p className="text-sm font-bold uppercase tracking-[0.16em] text-blue-700">Informativa generale</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Privacy e trattamento dei documenti</h1>
          <p className="mt-3 text-sm text-slate-500">Versione del 6 settembre 2026</p>

          <div className="mt-8 space-y-8 text-sm leading-7 text-slate-700">
            <section>
              <h2 className="text-lg font-bold text-slate-950">Finalità del trattamento</h2>
              <p className="mt-2">
                I dati identificativi, societari, economici e finanziari sono trattati per registrare la richiesta, organizzare i documenti, elaborare la valutazione richiesta, gestire chiarimenti e integrazioni e, quando espressamente autorizzato, condividere la pratica con banche o intermediari coinvolti.
              </p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-slate-950">Dati e documenti trattati</h2>
              <p className="mt-2">
                Possono essere trattati dati di contatto, visure camerali, bilanci, situazioni contabili, estratti conto, informazioni sui finanziamenti, risposte ai quesiti e ulteriori documenti trasmessi dall’impresa o dai professionisti autorizzati.
              </p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-slate-950">Accesso e destinatari</h2>
              <p className="mt-2">
                L’accesso è limitato agli utenti autorizzati in relazione alla pratica. La trasmissione a una banca o a un intermediario avviene esclusivamente per le finalità della valutazione e dell’eventuale istruttoria e secondo le autorizzazioni registrate.
              </p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-slate-950">Conservazione e sicurezza</h2>
              <p className="mt-2">
                I dati vengono conservati per il tempo necessario alla gestione del servizio, agli obblighi applicabili e alla tutela dei diritti delle parti. Sono adottate misure tecniche e organizzative volte a limitare accessi non autorizzati, perdita o diffusione impropria dei documenti.
              </p>
            </section>
            <section>
              <h2 className="text-lg font-bold text-slate-950">Diritti e contatti</h2>
              <p className="mt-2">
                Per richiedere informazioni, accesso, rettifica, cancellazione, limitazione o per esercitare gli altri diritti applicabili, è possibile scrivere a{' '}
                <a className="font-semibold text-blue-700 underline underline-offset-2" href="mailto:stefano@daddino.com">stefano@daddino.com</a>.
              </p>
            </section>
            <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              Questa pagina descrive il funzionamento generale del servizio. L’informativa completa, con l’identificazione definitiva del titolare, le basi giuridiche e i tempi di conservazione, deve essere validata prima dell’avvio commerciale.
            </aside>
          </div>
        </article>
      </main>
    </PublicSiteLayout>
  );
}
