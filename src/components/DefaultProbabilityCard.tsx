import { Calculator, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  calculateProbabilityOfDefault, formatDefaultProbability, PD_MODEL,
  type DefaultProbabilityInput,
} from '@/lib/probabilityOfDefault';

interface Props {
  bilancio: DefaultProbabilityInput & { anno_esercizio: number | null };
  codiceAteco: string | null;
}

const amount = (value: number) => value.toLocaleString('it-IT', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 2,
});
const ratio = (value: number) => value.toLocaleString('it-IT', {
  minimumFractionDigits: 4, maximumFractionDigits: 6,
});

export default function DefaultProbabilityCard({ bilancio, codiceAteco }: Props) {
  const result = calculateProbabilityOfDefault(bilancio, codiceAteco);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2"><Calculator className="w-4 h-4" />PD · Probabilità di Default (stima indicativa)</span>
          <Badge variant="outline">Bilancio {bilancio.anno_esercizio ?? 'anno N/D'}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Proxy di probabilità di dissesto · {PD_MODEL.name}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {result.status === 'estimated' ? formatDefaultProbability(result.probability) : 'Non calcolabile'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0" /><span>{PD_MODEL.limitation}</span>
          </p>
        </div>
        {result.status === 'unavailable' ? (
          <div className="text-xs space-y-2">
            <p className="font-medium">Dati o verifiche necessari</p>
            <ul className="list-disc pl-4 space-y-1">{result.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
            <p className="text-muted-foreground">Completa o verifica il bilancio e rianalizza il documento. Nessun dato mancante viene sostituito con zero o con il totale debiti.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div><p className="text-muted-foreground">ROA · Utile netto / Attivo</p><p className="font-semibold">{ratio(result.ratios.roa)}</p></div>
              <div><p className="text-muted-foreground">L · Passività totali / Attivo</p><p className="font-semibold">{ratio(result.ratios.leverage)}</p></div>
              <div><p className="text-muted-foreground">CR · Attivo circolante / Passività correnti{bilancio.kpi?.liquidita?.current_ratio?.source_note?.includes('PROXY') ? ' (proxy debiti a breve)' : ''}</p><p className="font-semibold">{ratio(result.ratios.currentRatio)}</p></div>
            </div>
            {result.warnings.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-amber-800 space-y-1">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
            )}
          </>
        )}
        <details className="rounded-md border p-3 text-xs">
          <summary className="cursor-pointer font-medium">Come viene calcolata la PD · formula e dati utilizzati</summary>
          <div className="mt-3 space-y-2 break-words">
            <p className="font-mono">{PD_MODEL.formula}</p>
            <p className="font-mono">PD indicativa = Φ(X) × 100</p>
            <p className="text-muted-foreground">Φ è la funzione di distribuzione cumulativa della normale standard (probit), non una funzione logistica. I rapporti entrano come numeri decimali, non come percentuali.</p>
            {result.status === 'estimated' && (
              <>
                <p>Passività totali = Attivo − Patrimonio netto = {amount(result.amounts.totalAssets)} − ({amount(result.amounts.equity)}) = {amount(result.amounts.totalLiabilities)}.</p>
                <p>ROA = {amount(result.amounts.netIncome)} / {amount(result.amounts.totalAssets)} = {ratio(result.ratios.roa)}.</p>
                <p>L = {amount(result.amounts.totalLiabilities)} / {amount(result.amounts.totalAssets)} = {ratio(result.ratios.leverage)}.</p>
                <p>CR = {amount(result.amounts.currentAssets)} / {amount(result.amounts.currentLiabilities)} = {ratio(result.ratios.currentRatio)}.</p>
                <p className="font-mono">X ≈ −4,3 − 4,5 × ({ratio(result.ratios.roa)}) + 5,7 × ({ratio(result.ratios.leverage)}) − 0,004 × ({ratio(result.ratios.currentRatio)}) = {ratio(result.score)}</p>
                <p className="font-semibold">Φ({ratio(result.score)}) × 100 = {formatDefaultProbability(result.probability)}</p>
              </>
            )}
            <p className="text-muted-foreground">Le passività totali comprendono anche fondi, TFR e ratei: non coincidono con la sola voce “Totale debiti”. La stima usa solo il bilancio selezionato, senza mescolare annualità o società. Nessuna classe di rating bancario è assegnata.</p>
            <p>Fonte della specificazione arrotondata: <a className="underline" href={PD_MODEL.sourceUrl} target="_blank" rel="noopener noreferrer">Viciwati (2020), DIJEFA, pag. 797 — modello Zmijewski</a>.</p>
            <p className="text-muted-foreground">Versione: {PD_MODEL.version}. Solo analisi interna: questa aggiunta non inserisce la PD nelle email o nei report destinati alla banca.</p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
