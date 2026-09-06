import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  Calculator,
  Check,
  ChevronRight,
  CircleDollarSign,
  FileSearch,
  Files,
  Landmark,
  LockKeyhole,
  MessagesSquare,
  Scale,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Users,
} from 'lucide-react';
import PublicSiteLayout from '@/components/public/PublicSiteLayout';
import { usePageMeta } from '@/lib/pageMeta';

const analysisItems = [
  {
    icon: BarChart3,
    title: 'Bilancio e indicatori',
    text: 'Lettura economica, patrimoniale e finanziaria con 14 KPI, DSCR e indice di bancabilità.',
  },
  {
    icon: Scale,
    title: 'Confronto con il settore',
    text: 'Gli indicatori vengono commentati e confrontati con i benchmark disponibili per il settore di attività.',
  },
  {
    icon: FileSearch,
    title: 'Anomalie da approfondire',
    text: 'Evidenzia poste poco chiare, incoerenze e valori che richiedono spiegazioni o documenti integrativi.',
  },
  {
    icon: CircleDollarSign,
    title: 'Estratti conto',
    text: 'Analisi di entrate, uscite, saldi, ricorrenze, tensioni di liquidità e movimenti da verificare.',
  },
  {
    icon: SearchCheck,
    title: 'Coerenza documentale',
    text: 'Confronta i dati presenti nei documenti per rilevare differenze, omissioni o informazioni non allineate.',
  },
  {
    icon: Landmark,
    title: 'Preparazione bancaria',
    text: 'Organizza la pratica e le integrazioni in modo separato per ciascuna banca coinvolta.',
  },
];

const audiences = [
  {
    icon: Building2,
    title: 'Imprese',
    text: 'Per comprendere come viene letta l’azienda dalla banca e preparare una richiesta più consapevole.',
  },
  {
    icon: Calculator,
    title: 'Commercialisti',
    text: 'Per affiancare i clienti con un report strutturato, commentato e utilizzabile nel confronto con gli istituti.',
  },
  {
    icon: Users,
    title: 'Consulenti',
    text: 'Per raccogliere documenti, gestire chiarimenti e monitorare ogni pratica da un unico ambiente.',
  },
];

const faqs = [
  {
    question: 'La valutazione garantisce l’ottenimento del finanziamento?',
    answer: 'No. Il report supporta la preparazione e la comprensione della pratica, ma la decisione resta esclusivamente della banca o dell’intermediario finanziario.',
  },
  {
    question: 'Quali documenti servono per iniziare?',
    answer: 'Per la prima richiesta è necessaria la visura camerale. È possibile aggiungere bilanci, situazioni contabili, estratti conto e altri documenti disponibili.',
  },
  {
    question: 'Posso richiedere il report senza indicare una banca?',
    answer: 'Sì. L’impresa può richiedere una valutazione autonoma e decidere successivamente se attivare la ricerca di una banca con il supporto di un consulente.',
  },
  {
    question: 'Come vengono gestiti i documenti?',
    answer: 'I documenti sono associati alla pratica e resi disponibili soltanto agli utenti autorizzati. Prima dell’invio viene richiesta l’accettazione dell’informativa applicabile.',
  },
];

export default function PublicHomePage() {
  usePageMeta({
    title: 'Credifile — Valutazione di bancabilità per imprese',
    description: 'Analisi di bilancio, DSCR, KPI, estratti conto e coerenza documentale per preparare una richiesta di credito aziendale più completa.',
    path: '/',
  });

  return (
    <PublicSiteLayout>
      <main>
        <section className="relative isolate overflow-hidden border-b border-slate-200 bg-slate-50">
          <div className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.13),transparent_42%),radial-gradient(circle_at_top_left,rgba(249,115,22,0.10),transparent_34%)]" />
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1.08fr_0.92fr] lg:px-8 lg:py-32">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Valutazione documentale e finanziaria
              </div>
              <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Prepara la tua impresa al confronto con la banca
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                Credifile trasforma bilanci, estratti conto e documenti societari in un’analisi strutturata della bancabilità, evidenziando punti di forza e aspetti da approfondire.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/richiedi-valutazione"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                >
                  Richiedi una valutazione
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a
                  href="#come-funziona"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3.5 text-sm font-semibold text-slate-800 transition-colors hover:border-slate-400 hover:bg-slate-50"
                >
                  Scopri come funziona
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
              <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-600">
                {['Report autonomo', 'Documenti protetti', 'Pratica seguibile online'].map(item => (
                  <li key={item} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_28px_80px_-40px_rgba(15,23,42,0.45)] sm:p-7">
                <div className="flex items-center justify-between border-b border-slate-100 pb-5">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Esempio di analisi</p>
                    <p className="mt-1 text-lg font-bold text-slate-950">Profilo finanziario impresa</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Documenti completi</span>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  {[
                    ['14', 'KPI commentati'],
                    ['DSCR', 'Capacità di rimborso'],
                    ['ATECO', 'Confronto settore'],
                    ['Alert', 'Aspetti da chiarire'],
                  ].map(([value, label]) => (
                    <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xl font-bold text-blue-700">{value}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 space-y-3">
                  {[
                    ['Bilancio e indicatori', 'Analizzato'],
                    ['Estratti conto', 'Analizzato'],
                    ['Coerenza documentale', 'Verificata'],
                  ].map(([label, state]) => (
                    <div key={label} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                        <BadgeCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                        {label}
                      </span>
                      <span className="text-xs font-semibold text-slate-500">{state}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-xs leading-5 text-slate-500">
                  Rappresentazione dimostrativa. Risultati e approfondimenti dipendono dai documenti effettivamente disponibili.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="come-funziona" className="scroll-mt-24 bg-white py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-600">Come funziona</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Un percorso chiaro, dalla visura al report</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                La richiesta iniziale apre un percorso documentale verificabile. In ogni momento sai cosa è stato ricevuto e quali informazioni devono essere integrate.
              </p>
            </div>
            <ol className="mt-12 grid gap-5 md:grid-cols-3">
              {[
                { icon: UploadCloud, number: '01', title: 'Invia la richiesta', text: 'Carica la visura e i documenti che hai già disponibili, accettando le informative richieste.' },
                { icon: Files, number: '02', title: 'Completa la pratica', text: 'Il sistema organizza i documenti e segnala eventuali integrazioni o chiarimenti necessari.' },
                { icon: BarChart3, number: '03', title: 'Consulta l’analisi', text: 'Ricevi un quadro commentato degli indicatori e degli aspetti utili al confronto con la banca.' },
              ].map(step => (
                <li key={step.number} className="relative rounded-2xl border border-slate-200 bg-slate-50 p-6">
                  <div className="flex items-center justify-between">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-700 text-white">
                      <step.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="font-mono text-sm font-semibold text-slate-400">{step.number}</span>
                  </div>
                  <h3 className="mt-6 text-lg font-bold text-slate-950">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="analisi" className="scroll-mt-24 border-y border-slate-200 bg-slate-50 py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-blue-700">Contenuti dell’analisi</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">I documenti diventano informazioni utilizzabili</h2>
              <p className="mt-4 text-base leading-7 text-slate-600">
                L’obiettivo non è sostituire la decisione della banca, ma rendere la pratica più leggibile e far emergere prima gli aspetti che potrebbero richiedere chiarimenti.
              </p>
            </div>
            <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {analysisItems.map(item => (
                <article key={item.title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
                    <item.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-base font-bold text-slate-950">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="destinatari" className="scroll-mt-24 bg-white py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-600">Per chi è</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Un linguaggio comune tra impresa e professionisti</h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Credifile coordina informazioni, documenti e richieste di approfondimento senza confondere i ruoli e senza sovrapporre le pratiche delle diverse banche.
                </p>
              </div>
              <div className="grid gap-5 md:grid-cols-3">
                {audiences.map(item => (
                  <article key={item.title} className="rounded-2xl border border-slate-200 p-6">
                    <item.icon className="h-6 w-6 text-blue-700" aria-hidden="true" />
                    <h3 className="mt-5 text-lg font-bold text-slate-950">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-blue-800 py-16 text-white sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_0.8fr] lg:items-center lg:px-8">
            <div>
              <div className="flex items-center gap-2 text-blue-100">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                <span className="text-sm font-semibold">Riservatezza e controllo degli accessi</span>
              </div>
              <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Documenti finanziari trattati in un percorso controllato</h2>
              <p className="mt-4 max-w-2xl text-base leading-7 text-blue-100">
                Il caricamento è collegato alla singola pratica. L’accesso ai documenti e la loro eventuale trasmissione avvengono secondo i ruoli autorizzati e le accettazioni registrate.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                [LockKeyhole, 'Accesso riservato'],
                [ShieldCheck, 'Consensi registrati'],
                [Files, 'Documenti organizzati'],
                [MessagesSquare, 'Richieste tracciate'],
              ].map(([Icon, label]) => {
                const ItemIcon = Icon as typeof LockKeyhole;
                return (
                  <div key={label as string} className="flex items-center gap-3 rounded-xl border border-blue-600 bg-blue-700/60 p-4">
                    <ItemIcon className="h-5 w-5 text-orange-300" aria-hidden="true" />
                    <span className="text-sm font-semibold">{label as string}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="faq" className="scroll-mt-24 bg-slate-50 py-20 sm:py-24">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-blue-700">Domande frequenti</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Prima di iniziare</h2>
            </div>
            <div className="mt-10 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white px-6">
              {faqs.map(item => (
                <details key={item.question} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-slate-950">
                    {item.question}
                    <span className="text-xl font-normal text-blue-700 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="mt-3 max-w-3xl pr-8 text-sm leading-6 text-slate-600">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-white py-20">
          <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
            <h2 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Inizia dalla documentazione che hai già</h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600">
              La visura camerale è il primo documento richiesto. Potrai aggiungere gli altri file disponibili e completare successivamente le integrazioni.
            </p>
            <Link
              to="/richiedi-valutazione"
              className="mt-8 inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
            >
              Richiedi una valutazione
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>
    </PublicSiteLayout>
  );
}
