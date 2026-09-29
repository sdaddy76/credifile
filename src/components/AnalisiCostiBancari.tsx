import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AlertCircle, BarChart3, Building2, Calculator, CheckCircle2, FileSearch, Percent, RefreshCw, WalletCards } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { analyzeBankCosts, bankCostLabel, type BankCostTransaction } from '@/lib/bankCostAnalysis';

interface Props {
  practiceId: string;
  transactions?: BankCostTransaction[];
  accessCode?: string;
  clientEmail?: string;
}

type StoredTransaction = BankCostTransaction & {
  classification_confidence?: 'alta' | 'media' | 'bassa' | null;
  parse_confidence?: 'alta' | 'media' | 'bassa' | null;
};

const currency = (value: number) => new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
}).format(value);

const dateLabel = (value?: string | null) => value
  ? new Date(value).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  : '—';

function Metric({ label, value, hint, tone = 'slate' }: { label: string; value: string; hint?: string; tone?: 'blue' | 'orange' | 'red' | 'indigo' | 'slate' }) {
  const styles = {
    blue: 'border-blue-100 bg-blue-50 text-blue-900',
    orange: 'border-orange-100 bg-orange-50 text-orange-900',
    red: 'border-red-100 bg-red-50 text-red-900',
    indigo: 'border-indigo-100 bg-indigo-50 text-indigo-900',
    slate: 'border-slate-200 bg-slate-50 text-slate-900',
  } as const;
  return (
    <div className={`rounded-xl border p-3 ${styles[tone]}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] opacity-70">{hint}</p>}
    </div>
  );
}

export function AnalisiCostiBancari({
  practiceId,
  transactions: providedTransactions,
  accessCode,
  clientEmail,
}: Props) {
  const [transactions, setTransactions] = useState<StoredTransaction[]>(providedTransactions as StoredTransaction[] ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('tutti');
  const [reviewOnly, setReviewOnly] = useState(false);

  const load = useCallback(async () => {
    if (providedTransactions) {
      setTransactions(providedTransactions as StoredTransaction[]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const query = accessCode && clientEmail
      ? supabase.rpc('get_practice_bank_cost_transactions', {
        p_practice_id: practiceId,
        p_access_code: accessCode,
        p_client_email: clientEmail,
      })
      : supabase
        .from('estratto_conto_transactions')
        .select('*')
        .eq('practice_id', practiceId)
        .order('data_valuta', { ascending: true });
    const { data, error: queryError } = await query;
    if (queryError) {
      setError(queryError.message);
      setTransactions([]);
    } else {
      setTransactions((data ?? []) as StoredTransaction[]);
    }
    setLoading(false);
  }, [practiceId, providedTransactions]);

  useEffect(() => { load(); }, [load]);

  const analysis = useMemo(() => analyzeBankCosts(transactions), [transactions]);
  const filtered = useMemo(() => analysis.transactions.filter(transaction => {
    if (categoryFilter !== 'tutti' && transaction.bank_cost_type !== categoryFilter) return false;
    if (reviewOnly && transaction.bank_cost_confidence !== 'bassa') return false;
    return true;
  }), [analysis.transactions, categoryFilter, reviewOnly]);

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed py-16">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">Calcolo dei costi bancari…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold">Impossibile caricare i movimenti</p>
            <p className="mt-1">{error}</p>
          </div>
          <Button size="sm" variant="outline" onClick={load}>Riprova</Button>
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
        <FileSearch className="mx-auto h-10 w-10 text-slate-300" />
        <h3 className="mt-3 text-sm font-semibold text-slate-800">Nessun estratto conto analizzato</h3>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          Importa prima un estratto conto dalla scheda “Estratto Conto”. Quando i movimenti sono disponibili, qui vengono separati costi certi, rate e interessi.
        </p>
      </div>
    );
  }

  const totalCostHint = analysis.totalOutflows > 0 && analysis.costIncidence !== null
    ? `${analysis.costIncidence.toFixed(1)}% di tutte le uscite`
    : 'Nessuna uscita disponibile per il confronto';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <WalletCards className="h-5 w-5 text-indigo-600" />
            <h3 className="text-base font-semibold text-slate-900">Analisi costi bancari</h3>
          </div>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Costi estratti dai movimenti già analizzati. Le quote capitale, gli interessi e i tassi sono mostrati solo quando esplicitamente riconoscibili nel documento.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5" /> Aggiorna
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Costo bancario totale" value={currency(analysis.totalCost)} hint={totalCostHint} tone="indigo" />
        <Metric label="Media mensile" value={currency(analysis.averageMonthlyCost)} hint={`${analysis.monthly.length || 0} mesi coperti`} tone="blue" />
        <Metric label="Interessi pagati" value={currency(analysis.interestPaid)} hint={analysis.interestPaid > 0 ? 'Rilevati nel conto' : 'Non separati'} tone="red" />
        <Metric label="Rate finanziamento" value={currency(analysis.categories.find(c => c.type === 'rata_finanziamento')?.total ?? 0)} hint={`${analysis.financingReferences.length} riferimenti`} tone="orange" />
        <Metric label="Righe da verificare" value={String(analysis.reviewCount)} hint={`${analysis.sourceCount} file sorgente`} tone="slate" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-indigo-600" /> Costi per categoria
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={analysis.categories} layout="vertical" margin={{ top: 5, right: 18, left: 12, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tickFormatter={(value) => `€${Math.round(value)}`} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="label" width={125} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => [currency(Number(value)), 'Totale']} />
                <Bar dataKey="total" radius={[0, 5, 5, 0]}>
                  {analysis.categories.map(category => <Cell key={category.type} fill={category.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Calculator className="h-4 w-4 text-orange-600" /> Incidenza interessi e finanziamenti
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-orange-100 bg-orange-50 p-3">
                <p className="text-orange-700">Quota capitale rilevata</p>
                <p className="mt-1 text-base font-bold text-orange-900">{currency(analysis.principalPaid)}</p>
              </div>
              <div className="rounded-lg border border-red-100 bg-red-50 p-3">
                <p className="text-red-700">Tassi identificati</p>
                <p className="mt-1 text-base font-bold text-red-900">
                  {analysis.identifiedInterestRates.length > 0 ? analysis.identifiedInterestRates.map(rate => `${rate.toLocaleString('it-IT')}%`).join(', ') : 'Non rilevati'}
                </p>
              </div>
            </div>
            {analysis.financingReferences.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Riferimenti finanziamento</p>
                {analysis.financingReferences.slice(0, 4).map(reference => (
                  <div key={reference} className="flex items-start gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" /> {reference}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Non sono state riconosciute controparti o riferimenti di finanziamento distinti.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Andamento mensile dei costi</CardTitle>
        </CardHeader>
        <CardContent>
          {analysis.monthly.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={analysis.monthly} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={(value) => `€${Math.round(value)}`} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value, name) => [currency(Number(value)), name === 'total' ? 'Totale' : name === 'interests' ? 'Interessi' : name === 'installments' ? 'Rate' : 'Altri costi']} />
                <Line type="monotone" dataKey="total" stroke="#4f46e5" strokeWidth={3} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="interests" stroke="#dc2626" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="installments" stroke="#ea580c" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-10 text-center text-xs text-slate-500">Le date dei movimenti non consentono un andamento mensile.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-sm">Dettaglio costi verificabile</CardTitle>
            <p className="mt-1 text-[11px] text-slate-500">Ogni riga resta collegata alla transazione e al file di origine.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={categoryFilter}
              onChange={event => setCategoryFilter(event.target.value)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
            >
              <option value="tutti">Tutte le categorie</option>
              {analysis.categories.map(category => <option key={category.type} value={category.type}>{category.label}</option>)}
            </select>
            <Button
              size="sm"
              variant={reviewOnly ? 'default' : 'outline'}
              className="h-8 gap-1.5 text-xs"
              onClick={() => setReviewOnly(value => !value)}
            >
              <AlertCircle className="h-3.5 w-3.5" /> {reviewOnly ? 'Mostra tutte' : 'Solo da verificare'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Causale / riferimento</th>
                  <th className="px-3 py-2 font-medium">Categoria</th>
                  <th className="px-3 py-2 text-right font-medium">Importo</th>
                  <th className="px-3 py-2 text-right font-medium">Interessi</th>
                  <th className="px-3 py-2 font-medium">Tasso</th>
                  <th className="px-3 py-2 font-medium">Affidabilità</th>
                  <th className="px-3 py-2 font-medium">Fonte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((transaction, index) => (
                  <tr key={transaction.id ?? `${transaction.data_valuta}-${index}`} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-3 py-2 text-slate-500">{dateLabel(transaction.data_valuta ?? transaction.data_contabile)}</td>
                    <td className="max-w-[310px] px-3 py-2 text-slate-700">
                      <p className="truncate" title={transaction.descrizione ?? ''}>{transaction.descrizione || '—'}</p>
                      {transaction.financing_reference && <p className="truncate text-[10px] text-indigo-600">{transaction.financing_reference}</p>}
                      {transaction.bank_cost_notes && <p className="text-[10px] text-slate-400">{transaction.bank_cost_notes}</p>}
                    </td>
                    <td className="px-3 py-2"><Badge variant="outline" className="whitespace-nowrap">{bankCostLabel(transaction.bank_cost_type!)}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-red-700">{currency(Number(transaction.importo) || 0)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-red-600">{transaction.interest_amount != null ? currency(Number(transaction.interest_amount)) : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2">{transaction.interest_rate != null ? `${Number(transaction.interest_rate).toLocaleString('it-IT')}%` : 'Non rilevato'}</td>
                    <td className="px-3 py-2">
                      {transaction.bank_cost_confidence === 'alta'
                        ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Alta</span>
                        : transaction.bank_cost_confidence === 'bassa'
                          ? <span className="inline-flex items-center gap-1 text-amber-700"><AlertCircle className="h-3.5 w-3.5" /> Verifica</span>
                          : <span className="text-blue-700">Media</span>}
                    </td>
                    <td className="max-w-[140px] truncate px-3 py-2 text-slate-400" title={transaction.file_nome ?? ''}>{transaction.file_nome || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && <p className="p-8 text-center text-xs text-slate-500">Nessun costo corrisponde ai filtri selezionati.</p>}
        </CardContent>
      </Card>

      <p className="flex items-start gap-1.5 text-[10px] text-slate-400">
        <Percent className="mt-0.5 h-3 w-3 shrink-0" />
        Un tasso o una quota interessi non presenti nella causale o nel documento non vengono stimati automaticamente: restano indicati come non rilevati.
      </p>
    </div>
  );
}

export default AnalisiCostiBancari;
